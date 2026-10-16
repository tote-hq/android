import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { generateKeyPairSigner } from '@solana/kit';

import { accountInfo, installFetch, orderBytes, RPC_URL, type FakeChain } from './support/fake-chain.ts';

/**
 * lib/checkout/escrow-server.ts against a scripted RPC: reading an order,
 * listing a wallet's orders, and the resolver refusing to sign with a key the
 * escrow was not initialized with. Settling for real needs the resolver's
 * secret, which a test must never have; that path is the program's own tests.
 */
process.env.SOLANA_RPC_URL = RPC_URL;

const ORDER = 'ab'.repeat(32);
const BASKET = 'cd'.repeat(32);

describe('escrow-server', () => {
  let buyer: string;
  let chain: FakeChain;
  let account: ReturnType<typeof accountInfo>;
  let mod: typeof import('../checkout/escrow-server.ts');

  before(async () => {
    buyer = (await generateKeyPairSigner()).address;
    account = accountInfo(orderBytes({ orderId: ORDER, buyer, amount: 12_340_000n, basketHash: BASKET, status: 0 }));
    chain = installFetch((method) => {
      if (method === 'getAccountInfo') return account;
      if (method === 'getProgramAccounts') {
        const older = orderBytes({ orderId: '01'.repeat(32), buyer, amount: 1n, basketHash: BASKET, status: 2, openedAt: 10 });
        const newer = orderBytes({ orderId: '02'.repeat(32), buyer, amount: 2n, basketHash: BASKET, status: 1, openedAt: 20 });
        const junk = new Uint8Array(12);
        return [older, junk, newer].map((d) => ({ pubkey: buyer, account: accountInfo(d).value }));
      }
      throw new Error(`unexpected ${method}`);
    });
    mod = await import('../checkout/escrow-server.ts');
  });
  after(() => chain.restore());

  it('reads and decodes an open order', async () => {
    const o = await mod.readOrder(ORDER);
    assert.ok(o);
    assert.equal(o.orderId, ORDER);
    assert.equal(o.buyer, buyer);
    assert.equal(o.amount, 12_340_000n);
    assert.equal(o.basketHash, BASKET);
    assert.equal(o.status, 'open');
  });

  it('returns null for a missing account or one the program does not own', async () => {
    account = accountInfo(null);
    assert.equal(await mod.readOrder(ORDER), null);
    account = accountInfo(orderBytes({ orderId: ORDER, buyer, amount: 1n, basketHash: BASKET, status: 0 }), buyer);
    assert.equal(await mod.readOrder(ORDER), null);
  });

  it('lists a wallet’s orders newest first and skips what does not decode', async () => {
    const list = await mod.ordersOf(buyer);
    assert.deepEqual(
      list.map((o) => [o.orderId.slice(0, 2), o.status]),
      [
        ['02', 'settled'],
        ['01', 'refunded'],
      ],
    );
  });

  it('refuses to settle or refund without a resolver key, and never signs', async () => {
    delete process.env.SOLANA_RESOLVER_SECRET;
    account = accountInfo(orderBytes({ orderId: ORDER, buyer, amount: 1n, basketHash: BASKET, status: 0 }));
    const order = (await mod.readOrder(ORDER))!;
    const before = chain.calls.length;
    await assert.rejects(mod.settleOrder(order, new Uint8Array(32)), /SOLANA_RESOLVER_SECRET is not set/);
    await assert.rejects(mod.refundOrder(order), /SOLANA_RESOLVER_SECRET is not set/);
    assert.ok(!chain.calls.slice(before).some((c) => c.method === 'sendTransaction'));
  });

  it('refuses a resolver key the escrow does not expect, naming addresses only', async () => {
    const { resolverSigner } = await import('../server/resolver.ts');
    const kp = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', kp.privateKey));
    const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
    const secret = [...pkcs8.slice(-32), ...pub];
    const env = { SOLANA_RESOLVER_SECRET: JSON.stringify(secret) } as unknown as NodeJS.ProcessEnv;
    const err = await resolverSigner(env).then(
      () => null,
      (e: Error) => e,
    );
    assert.ok(err);
    assert.match(err.message, /the escrow expects 5zeMdzZCXkCHbTwvoxtEHRHCP5fe7MLc4fHgG54ENhUD/);
    assert.ok(!err.message.includes(JSON.stringify(secret)));
    assert.ok(!err.message.includes('['));
  });
});
