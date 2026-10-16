import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { generateKeyPairSigner } from '@solana/kit';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

/**
 * POST /api/session/login and /api/session/logout, as the route handlers,
 * with Privy scripted. lib/test/session-issue.test.ts covers every refusal
 * before Privy is asked; this covers the rest: a real (local) token gets a
 * hardened cookie for the wallet Privy names, and logout clears it.
 */
const env = process.env as Record<string, string | undefined>;
delete env.DATABASE_URL;
env.NODE_ENV = 'production';
env.TURNSTILE_SECRET_KEY = 'turnstile-test-secret';
env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = 'site-test';
env.CHG_SESSION_SECRET = 'session-test-secret';
env.NEXT_PUBLIC_PRIVY_APP_ID = 'test-app-id';
env.PRIVY_APP_SECRET = 'privy-test-secret';

describe('session routes', () => {
  let login: (req: Request) => Promise<Response>;
  let logout: (req: Request) => Promise<Response>;
  let human: string;
  let key: CryptoKey;
  let wallet: string;
  let accounts: unknown[] = [];
  const real = globalThis.fetch;

  before(async () => {
    wallet = (await generateKeyPairSigner()).address;
    const pair = await generateKeyPair('ES256', { extractable: true });
    key = pair.privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'ES256' };
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith('/jwks.json')) return Response.json({ keys: [jwk] });
      if (url.includes('/api/v1/users/')) return Response.json({ linked_accounts: accounts });
      return new Response('not found', { status: 404 });
    }) as typeof fetch;
    const { HUMAN_COOKIE, mintHumanToken } = await import('../human-gate.ts');
    human = `${HUMAN_COOKIE}=${encodeURIComponent(await mintHumanToken('turnstile-test-secret'))}`;
    login = (await import('../../app/api/session/login/route.ts')).POST;
    logout = (await import('../../app/api/session/logout/route.ts')).POST;
  });
  after(() => void (globalThis.fetch = real));

  const privyToken = () =>
    new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
      .setSubject('did:privy:u1')
      .setIssuer('privy.io')
      .setAudience('test-app-id')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(key);

  const post = (path: string, body: unknown, cookie = human) =>
    new Request(`https://app.changuito.me${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(body),
    });

  it('login: a valid Privy token gets an HttpOnly, Secure, SameSite cookie for Privy’s wallet', async () => {
    accounts = [{ type: 'wallet', chain_type: 'solana', wallet_client_type: 'privy', address: wallet }];
    const token = await privyToken();
    const res = await login(post('/api/session/login', { token }));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.address, wallet);
    const cookie = res.headers.get('set-cookie') ?? '';
    assert.match(cookie, /^chg_user=/);
    for (const flag of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']) assert.ok(cookie.includes(flag), flag);
    assert.ok(!cookie.includes(token), 'the Privy token is not the cookie');

    const { readLoggedInUser } = await import('../login-gate.ts');
    const value = cookie.split(';')[0]!;
    const who = await readLoggedInUser(new Request('https://app.changuito.me/', { headers: { cookie: value } }));
    assert.deepEqual(who, { ok: true, address: wallet });
  });

  it('login: an account without a Solana wallet yet gets 409 and no cookie', async () => {
    accounts = [{ type: 'email', address: 'shopper@example.com' }];
    const res = await login(post('/api/session/login', { token: await privyToken() }));
    assert.equal(res.status, 409);
    assert.equal(res.headers.get('set-cookie'), null);
    assert.doesNotMatch(await res.text(), /shopper@example\.com/);
  });

  it('logout: needs the human check, then clears the cookie', async () => {
    const refused = await logout(post('/api/session/logout', {}, ''));
    assert.equal(refused.status, 403);
    assert.equal(refused.headers.get('set-cookie'), null);

    const res = await logout(post('/api/session/logout', {}));
    assert.equal(res.status, 200);
    const cookie = res.headers.get('set-cookie') ?? '';
    assert.match(cookie, /^chg_user=;/);
    assert.match(cookie, /Max-Age=0/);
    assert.match(cookie, /HttpOnly/);
  });
});
