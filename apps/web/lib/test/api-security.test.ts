import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, describe, it } from 'node:test';

/**
 * The shopper APIs, called as handlers. No browser and no chain.
 *
 * A request with no session must not read a profile, list orders, build an
 * escrow transaction, or mint USDC. A session for one wallet must not read
 * another wallet's checkout. The human gate is forced on, the way production
 * runs it.
 */

delete process.env.DATABASE_URL;
process.env.NODE_ENV = 'production';
process.env.TURNSTILE_SECRET_KEY = 'turnstile-test-secret';
process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = 'site-test';
process.env.CHG_SESSION_SECRET = 'session-test-secret';

const TURNSTILE = 'turnstile-test-secret';
const SESSION = 'session-test-secret';
const BUYER = 'BuyerWallet11111111111111111111111111111111';
const OTHER = 'OtherWallet11111111111111111111111111111111';
const ORDER = 'ab'.repeat(32);

type Handler = (req: Request) => Promise<Response>;

const anon = (url: string, init?: RequestInit) => new Request(url, init);

describe('shopper APIs refuse a stranger', () => {
  let profileGet: Handler;
  let profilePut: Handler;
  let faucetPost: Handler;
  let balanceGet: Handler;
  let ordersGet: Handler;
  let quotePost: Handler;
  let startPost: Handler;
  let statusGet: Handler;
  let openPost: Handler;
  let openPut: Handler;
  let humanCookie: string;
  let buyerCookie: string;
  let otherCookie: string;

  before(async () => {
    const { HUMAN_COOKIE, mintHumanToken } = await import('../human-gate.ts');
    const { mintUserToken } = await import('../login-gate.ts');
    humanCookie = `${HUMAN_COOKIE}=${encodeURIComponent(await mintHumanToken(TURNSTILE))}`;
    buyerCookie = `chg_user=${encodeURIComponent(await mintUserToken(BUYER, SESSION))}`;
    otherCookie = `chg_user=${encodeURIComponent(await mintUserToken(OTHER, SESSION))}`;
    profileGet = (await import('../../app/api/profile/route.ts')).GET;
    profilePut = (await import('../../app/api/profile/route.ts')).PUT;
    faucetPost = (await import('../../app/api/faucet/route.ts')).POST;
    balanceGet = (await import('../../app/api/balance/route.ts')).GET;
    ordersGet = (await import('../../app/api/checkout/orders/route.ts')).GET;
    quotePost = (await import('../../app/api/checkout/quote/route.ts')).POST;
    startPost = (await import('../../app/api/checkout/start/route.ts')).POST;
    statusGet = (await import('../../app/api/checkout/status/route.ts')).GET;
    openPost = (await import('../../app/api/checkout/open/route.ts')).POST;
    openPut = (await import('../../app/api/checkout/open/route.ts')).PUT;

    const { checkoutStore } = await import('../checkout/store.ts');
    await checkoutStore().set({
      orderId: ORDER,
      buyer: BUYER,
      amount: '12340000',
      amountCents: 1234,
      basketHash: 'cd'.repeat(32),
      arsPerUsd: 1000,
      totalDisplay: '$12.34',
      retailer: 'dia',
      lines: [],
      handoffUrl: null,
      createdAt: Date.now(),
    });
  });

  it('RULE: profile, orders and checkout stay behind the session', async () => {
    const cases: Array<[string, Handler, Request]> = [
      ['GET /api/profile', profileGet, anon('https://app.changuito.me/api/profile')],
      [
        'PUT /api/profile',
        profilePut,
        anon('https://app.changuito.me/api/profile', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: 'a@b.c', password: 'not-the-real-one' }),
        }),
      ],
      ['GET /api/checkout/orders', ordersGet, anon('https://app.changuito.me/api/checkout/orders')],
      [
        'POST /api/checkout/quote',
        quotePost,
        anon('https://app.changuito.me/api/checkout/quote', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ cart: { cartId: '1', lines: [], total: { centavos: 1 } } }),
        }),
      ],
      [
        'POST /api/checkout/start',
        startPost,
        anon('https://app.changuito.me/api/checkout/start', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ orderId: ORDER, dia: { email: 'a@b.c', password: 'x', dni: '1' } }),
        }),
      ],
      ['GET /api/checkout/status', statusGet, anon(`https://app.changuito.me/api/checkout/status?orderId=${ORDER}`)],
      [
        'POST /api/checkout/open',
        openPost,
        anon('https://app.changuito.me/api/checkout/open', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ orderId: ORDER }),
        }),
      ],
      [
        'PUT /api/checkout/open',
        openPut,
        anon('https://app.changuito.me/api/checkout/open', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ orderId: ORDER, tx: 'not-a-transaction' }),
        }),
      ],
    ];

    for (const [name, handler, req] of cases) {
      const res = await handler(req);
      const text = await res.text();
      assert.equal(res.status, 401, name);
      assert.doesNotMatch(text, /password|cvv|pan|secret|mnemonic|12340000/i, name);
      assert.equal(res.headers.get('set-cookie'), null, name);
    }
  });

  it('RULE: a forged session cookie is not a session', async () => {
    const res = await profileGet(
      anon('https://app.changuito.me/api/profile', { headers: { cookie: 'chg_user=forged.token' } }),
    );
    assert.equal(res.status, 401);
  });

  it('RULE: another wallet cannot read or open this checkout', async () => {
    const statusUrl = `https://app.changuito.me/api/checkout/status?orderId=${ORDER}`;
    const own = await statusGet(anon(statusUrl, { headers: { cookie: buyerCookie } }));
    assert.equal(own.status, 200);
    assert.match(await own.text(), /12\.34/);

    const stolen = await statusGet(anon(statusUrl, { headers: { cookie: otherCookie } }));
    assert.equal(stolen.status, 404);
    assert.doesNotMatch(await stolen.text(), /12\.34|12340000/);

    const open = await openPost(
      anon('https://app.changuito.me/api/checkout/open', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: otherCookie },
        body: JSON.stringify({ orderId: ORDER }),
      }),
    );
    assert.equal(open.status, 404);
    const put = await openPut(
      anon('https://app.changuito.me/api/checkout/open', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie: otherCookie },
        body: JSON.stringify({ orderId: ORDER, tx: 'not-a-transaction' }),
      }),
    );
    assert.equal(put.status, 404);
  });

  it('RULE: faucet and balance do not run without the human cookie', async () => {
    const faucet = await faucetPost(
      anon('https://app.changuito.me/api/faucet', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address: OTHER }),
      }),
    );
    assert.equal(faucet.status, 403);
    const balance = await balanceGet(anon(`https://app.changuito.me/api/balance?address=${BUYER}`));
    assert.equal(balance.status, 403);
    const { requireHuman } = await import('../human-gate.ts');
    const logout = await requireHuman(anon('https://app.changuito.me/api/session/logout', { method: 'POST' }));
    assert.equal(logout?.status, 403);
  });

  it('RULE: a bad address never becomes a balance read', async () => {
    const res = await balanceGet(
      anon('https://app.changuito.me/api/balance?address=not-a-key', { headers: { cookie: humanCookie } }),
    );
    assert.equal(res.status, 400);
    assert.doesNotMatch(await res.text(), /"usdc"/);
  });

  it('RULE: the faucet mints to the session, never to an address in the body', () => {
    const src = readFileSync(new URL('../../app/api/faucet/route.ts', import.meta.url), 'utf8');
    const post = src.slice(src.indexOf('export async function POST'));
    assert.match(post, /const owner = user\.address/);
    assert.doesNotMatch(post, /req\.json|body\.address/);
  });

  it('RULE: the profile answer never carries the password', async () => {
    const { publicProfile } = await import('../profile.ts');
    const pub = publicProfile({
      email: 'a@b.c',
      password: 's3cret-value',
      dni: '30111222',
      postcode: '1406',
    });
    assert.equal(pub.hasPassword, true);
    assert.equal(JSON.stringify(pub).includes('s3cret-value'), false);
    assert.equal('password' in pub, false);
  });

  it('RULE: chat refuses a huge message and a session id that is not a UUID', () => {
    const src = readFileSync(new URL('../../app/api/chat/route.ts', import.meta.url), 'utf8');
    assert.match(src, /MAX_MESSAGE_CHARS = 4_000/);
    assert.match(src, /status: 413/);
    assert.match(src, /sessionId must be a UUID/);
    assert.match(src, /requireHuman\(req\)/);
    assert.match(src, /requireLoginOrFreeTurn/);
  });
});
