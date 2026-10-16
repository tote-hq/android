import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import { generateKeyPairSigner } from '@solana/kit';

import { accountInfo, installFetch, orderBytes, RPC_URL, type FakeChain } from './support/fake-chain.ts';

/**
 * GET /api/checkout/status as a handler, with the sandbox and the chain
 * scripted. What it must get right: report what the chain says, never close an
 * order twice, refund when the job did not place, and when the resolver
 * cannot close, tell the shopper (alert) and log codes only.
 */
delete process.env.DATABASE_URL;
delete process.env.SOLANA_RESOLVER_SECRET;
process.env.CHG_SESSION_SECRET = 'session-test-secret';
process.env.SOLANA_RPC_URL = RPC_URL;
process.env.SANDBOX_URL = 'http://sandbox.test';
process.env.SANDBOX_TOKEN = 'sandbox-test-token';

const BASKET = 'cd'.repeat(32);
let n = 0;
const newOrderId = () => (++n).toString(16).padStart(2, '0').repeat(32);

type Job = { status: string; phase: string; result?: Record<string, unknown> } | 'down';

describe('GET /api/checkout/status', () => {
  let buyer: string;
  let cookie: string;
  let otherCookie: string;
  let GET: (req: Request) => Promise<Response>;
  let store: Awaited<ReturnType<typeof import('../checkout/store.ts')['checkoutStore']>>;
  let chain: FakeChain;
  let job: Job;
  let onChain: 0 | 1 | 2 | null;
  let logs: string[];
  const realError = console.error;

  before(async () => {
    buyer = (await generateKeyPairSigner()).address;
    const { mintUserToken } = await import('../login-gate.ts');
    cookie = `chg_user=${encodeURIComponent(await mintUserToken(buyer, 'session-test-secret'))}`;
    const other = (await generateKeyPairSigner()).address;
    otherCookie = `chg_user=${encodeURIComponent(await mintUserToken(other, 'session-test-secret'))}`;
    chain = installFetch(
      (method) => {
        if (method === 'getAccountInfo') {
          if (onChain === null) return accountInfo(null);
          return accountInfo(orderBytes({ orderId: current, buyer, amount: 1_000_000n, basketHash: BASKET, status: onChain }));
        }
        throw new Error(`unexpected ${method}`);
      },
      (url) => {
        if (!url.startsWith('http://sandbox.test/jobs/')) return undefined;
        if (job === 'down') return new Response('boom', { status: 500 });
        return Response.json({ job_id: 'j1', ...job });
      },
    );
    GET = (await import('../../app/api/checkout/status/route.ts')).GET;
    store = (await import('../checkout/store.ts')).checkoutStore();
  });
  after(() => {
    chain.restore();
    console.error = realError;
  });

  let current = '';
  beforeEach(() => {
    logs = [];
    console.error = (...a: unknown[]) => void logs.push(a.map(String).join(' '));
    job = { status: 'running', phase: 'shop' };
    onChain = 0;
  });

  async function seed(extra: Record<string, unknown> = {}) {
    current = newOrderId();
    await store.set({
      orderId: current,
      buyer,
      amount: '1000000',
      amountCents: 100,
      basketHash: BASKET,
      arsPerUsd: 1000,
      totalDisplay: '$1.000',
      retailer: 'dia',
      lines: [],
      handoffUrl: null,
      createdAt: Date.now(),
      jobId: 'j1',
      startedAt: Date.now(),
      ...extra,
    } as never);
    return current;
  }

  const poll = async (id: string, c = cookie) => {
    const res = await GET(new Request(`https://app.changuito.me/api/checkout/status?orderId=${id}`, { headers: { cookie: c } }));
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };

  it('refuses a bad id and another wallet’s order', async () => {
    assert.equal((await poll('nothex')).status, 400);
    const id = await seed();
    assert.equal((await poll(id, otherCookie)).status, 404);
  });

  it('reports a closed order without touching the chain', async () => {
    const id = await seed({ outcome: 'settled', closeSig: 'sig1' });
    const before = chain.calls.length;
    const { body } = await poll(id);
    assert.equal(body.stage, 'done');
    assert.equal(body.alert, null);
    assert.equal(chain.calls.length, before);
  });

  it('is "quoted" before a job exists', async () => {
    const id = await seed({ jobId: undefined });
    assert.equal((await poll(id)).body.stage, 'quoted');
  });

  it('passes the phase through while shopping, and survives a sandbox outage', async () => {
    const id = await seed();
    let r = await poll(id);
    assert.equal(r.body.stage, 'shopping');
    assert.equal(r.body.phase, 'shop');
    job = 'down';
    r = await poll(id);
    assert.equal(r.status, 200);
    assert.equal(r.body.stage, 'shopping');
  });

  it('takes the chain’s word for an order already settled: no second close', async () => {
    const id = await seed();
    job = { status: 'done', phase: 'placed', result: { payment: 'placed', store_order_id: '123' } };
    onChain = 1;
    const { body } = await poll(id);
    assert.equal(body.stage, 'done');
    assert.ok(!chain.calls.some((c) => c.method === 'sendTransaction'));
    assert.equal((await store.get(id))?.outcome, 'settled');
  });

  it('reports a refund the chain already made, with the cause', async () => {
    const id = await seed();
    job = { status: 'done', phase: 'payment', result: { payment: 'declined' } };
    onChain = 2;
    const { body } = await poll(id);
    assert.equal(body.stage, 'refunded');
    assert.match(String(body.error), /rechazó/);
  });

  it('alerts after repeated resolver failures, and logs codes only', async () => {
    const id = await seed();
    job = { status: 'failed', phase: 'checkout', result: { payment: 'error' } };
    onChain = 0; // still open: the route must refund, and the resolver is not configured
    let last: Record<string, unknown> = {};
    for (let i = 0; i < 3; i++) last = (await poll(id)).body;
    assert.equal(last.stage, 'shopping');
    assert.equal(last.alert, 'resolver_failed');
    assert.equal((await store.get(id))?.closeFailures, 3);
    const text = logs.join('\n');
    assert.match(text, /"resolver_close_failed"/);
    assert.match(text, /"code":"resolver_not_configured"/);
    assert.equal(text.match(/"checkout_alert"/g)?.length, 1, 'the alert is logged once');
    assert.ok(!text.includes(id), 'never the whole order id');
    assert.ok(!text.includes(buyer), 'never the buyer');
    assert.doesNotMatch(text, /SOLANA_RESOLVER_SECRET/);
  });

  it('alerts when a run is stuck past the timeout', async () => {
    const { STUCK_AFTER_MS } = await import('../checkout/resolver-alert.ts');
    const id = await seed({ startedAt: Date.now() - STUCK_AFTER_MS - 1000 });
    const { body } = await poll(id);
    assert.equal(body.stage, 'shopping');
    assert.equal(body.alert, 'stuck');
  });
});
