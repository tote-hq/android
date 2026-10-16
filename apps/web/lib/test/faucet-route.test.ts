import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import { generateKeyPairSigner } from '@solana/kit';

import { installFetch, RPC_URL, type FakeChain } from './support/fake-chain.ts';

/**
 * POST /api/faucet as a handler, with the chain scripted. The resolver key
 * signs every grant, so: no session, no grant; the address comes from the
 * cookie only; "enough already" is a 429 with the balance, not a mint; and a
 * failed mint answers plainly, leaks no key and does not burn the cooldown.
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
    chain = installFetch((method) => {
      if (method === 'getBalance') return { context: { slot: 1 }, value: 0 };
      if (method === 'getTokenAccountBalance') {
        if (usdcUnits === null) throw new Error('could not find account');
        return { context: { slot: 1 }, value: { amount: usdcUnits, decimals: 6, uiAmountString: '0' } };
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
});
