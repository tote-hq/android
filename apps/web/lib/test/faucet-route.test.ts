import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import { createKeyPairSignerFromBytes, generateKeyPairSigner, getAddressEncoder, getBase58Decoder } from '@solana/kit';

import { installFetch, RPC_URL, type FakeChain } from './support/fake-chain.ts';

/**
 * POST /api/faucet as a handler, with the chain scripted. The resolver key
 * signs every grant, so: no session, no grant; the address comes from the
 * cookie only; "enough already" is a 429 with the balance, not a mint; and a
 * failed mint answers plainly, leaks no key and does not burn the cooldown;
 * and an address smuggled into the body or the query string changes nothing.
 */
const env = process.env as Record<string, string | undefined>;
delete env.DATABASE_URL;
env.NODE_ENV = 'production';
env.TURNSTILE_SECRET_KEY = 'turnstile-test-secret';
env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = 'site-test';
env.CHG_SESSION_SECRET = 'session-test-secret';
env.SOLANA_RPC_URL = RPC_URL;

describe('POST /api/faucet', () => {
  let POST: (req: Request) => Promise<Response>;
  let buyer: string;
  let cookies: string;
  let chain: FakeChain;
  let usdcUnits: string | null;
  let wrongSecret: string;
  /** When true the fake chain also takes the grant transaction, so it can be inspected. */
  let acceptSend = false;
  const realError = console.error;
  let logs: string[] = [];

  before(async () => {
    buyer = (await generateKeyPairSigner()).address;
    const { HUMAN_COOKIE, mintHumanToken } = await import('../human-gate.ts');
    const { mintUserToken } = await import('../login-gate.ts');
    cookies = [
      `${HUMAN_COOKIE}=${encodeURIComponent(await mintHumanToken('turnstile-test-secret'))}`,
      `chg_user=${encodeURIComponent(await mintUserToken(buyer, 'session-test-secret'))}`,
    ].join('; ');
    // A well-formed key that is not the escrow's resolver, generated here.
    const kp = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', kp.privateKey));
    const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
    wrongSecret = JSON.stringify([...pkcs8.slice(-32), ...pub]);
    chain = installFetch((method, params) => {
      if (method === 'getBalance') return { context: { slot: 1 }, value: 0 };
      if (method === 'getTokenAccountBalance') {
        if (usdcUnits === null) throw new Error('could not find account');
        return { context: { slot: 1 }, value: { amount: usdcUnits, decimals: 6, uiAmountString: '0' } };
      }
      if (acceptSend && method === 'getLatestBlockhash') {
        return { context: { slot: 1 }, value: { blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 100 } };
      }
      if (acceptSend && method === 'sendTransaction') {
        const wire = Buffer.from(String(params[0]), 'base64');
        return getBase58Decoder().decode(wire.subarray(1, 65));
      }
      if (acceptSend && method === 'getSignatureStatuses') {
        return { context: { slot: 1 }, value: [{ slot: 1, confirmations: null, err: null, confirmationStatus: 'confirmed' }] };
      }
      throw new Error(`unexpected ${method}`);
    });
    POST = (await import('../../app/api/faucet/route.ts')).POST;
  });
  after(() => {
    chain.restore();
    console.error = realError;
  });
  beforeEach(() => {
    logs = [];
    console.error = (...a: unknown[]) => void logs.push(a.map(String).join(' '));
    env.SOLANA_RESOLVER_SECRET = wrongSecret;
    usdcUnits = null;
    acceptSend = false;
  });

  const call = (cookie = cookies, headers: Record<string, string> = {}) =>
    POST(new Request('https://app.changuito.me/api/faucet', { method: 'POST', headers: { cookie, ...headers } }));

  it('needs the human check and a session', async () => {
    assert.equal((await call('')).status, 403);
    const humanOnly = cookies.split('; ')[0]!;
    assert.equal((await call(humanOnly)).status, 401);
  });

  it('refuses a session for another wallet than the one the browser acts for', async () => {
    const other = (await generateKeyPairSigner()).address;
    const res = await call(cookies, { 'x-chg-wallet': other });
    assert.equal(res.status, 409);
  });

  it('says so when the faucet has no resolver key', async () => {
    delete env.SOLANA_RESOLVER_SECRET;
    const res = await call();
    assert.equal(res.status, 503);
  });

  it('answers 429 with the balance, and mints nothing, when there is enough', async () => {
    usdcUnits = '150000000';
    const before = chain.calls.length;
    const res = await call();
    assert.equal(res.status, 429);
    const body = await res.json();
    assert.equal(body.address, buyer);
    assert.equal(body.usdcDisplay, '150.00');
    assert.equal(body.txHash, null);
    assert.ok(typeof body.note === 'string' && body.note.length > 0);
    assert.ok(!chain.calls.slice(before).some((c) => c.method === 'sendTransaction'));
  });

  it('a failed mint answers 502 in plain words, leaks no key, and does not start the cooldown', async () => {
    for (let i = 0; i < 2; i++) {
      const res = await call();
      assert.equal(res.status, 502, `attempt ${i + 1}: a retry is not refused as "too soon"`);
      const text = await res.text();
      assert.match(text, /No pudimos cargar USDC/);
      assert.ok(!text.includes(wrongSecret));
    }
    assert.ok(!logs.join('\n').includes(wrongSecret), 'the key never reaches the log');
  });
  // Last on purpose: a real grant starts the per-wallet cooldown.
  it('mints only to the session wallet, whatever address the body or query string names', async () => {
    acceptSend = true;
    // Let the test key act as the resolver for this one grant: the fake chain
    // checks no signature, and the real key never comes near a test.
    const { DEPLOYMENTS } = await import('../deployments.ts');
    const devnet = DEPLOYMENTS.devnet as { resolver: string };
    const realResolver = devnet.resolver;
    devnet.resolver = (await createKeyPairSignerFromBytes(Uint8Array.from(JSON.parse(wrongSecret) as number[]))).address;
    const other = (await generateKeyPairSigner()).address;
    const { usdcAccount } = await import('../usdc.ts');
    const [buyerAta, otherAta] = await Promise.all([usdcAccount(buyer), usdcAccount(other)]);
    const from = chain.calls.length;
    let res: Response;
    try {
      res = await POST(
        new Request(`https://app.changuito.me/api/faucet?address=${other}&to=${other}&owner=${other}`, {
          method: 'POST',
          headers: { cookie: cookies, 'content-type': 'application/json' },
          body: JSON.stringify({ address: other, to: other, owner: other, wallet: other, destination: other }),
        }),
      );
    } finally {
      devnet.resolver = realResolver;
    }
    assert.equal(res.status, 200, logs.join('\n'));
    const body = await res.json();
    assert.equal(body.address, buyer);
    assert.ok(body.txHash);

    const calls = chain.calls.slice(from);
    const sent = calls.filter((c) => c.method === 'sendTransaction');
    assert.equal(sent.length, 1, 'exactly one grant transaction');
    const wire = Buffer.from(String(sent[0]!.params[0]), 'base64');
    const has = (a: string) => wire.includes(Buffer.from(getAddressEncoder().encode(a as never)));
    assert.ok(has(buyer) && has(buyerAta), 'the grant goes to the session wallet and its USDC account');
    assert.ok(!has(other) && !has(otherAta), 'the smuggled address appears nowhere in the transaction');
    assert.ok(!JSON.stringify(calls).includes(other), 'and is never even looked up');
  });
});
