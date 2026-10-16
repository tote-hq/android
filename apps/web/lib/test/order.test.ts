import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

import type { Cart, CartLine } from '@changuito/mcp/types';

import {
  basketHash,
  canonicalBasket,
  canonicalReceipt,
  receiptHash,
  DEFAULT_TIMEOUT_SECS,
  fromHex,
  newOrderId,
  toHex,
} from '../order.ts';

const line = (over: Partial<CartLine> = {}): CartLine => ({
  index: 0,
  skuId: '12345',
  name: 'Leche descremada 1L',
  quantity: 2,
  sellerId: '1',
  unitPrice: { centavos: 150_000, display: '$1.500,00' },
  lineTotal: { centavos: 300_000, display: '$3.000,00' },
  available: true,
  ...over,
});

const cart = (over: Partial<Cart> = {}): Cart => ({
  retailer: 'dia',
  cartId: 'abc-123',
  lines: [line()],
  total: { centavos: 300_000, display: '$3.000,00' },
  messages: [],
  ...over,
});

const bytes = (n: number, fill = 7) => new Uint8Array(n).fill(fill);

describe('hex', () => {
  it('round-trips through hex', () => {
    const id = newOrderId();
    assert.deepEqual(fromHex(toHex(id)), id);
  });

  it('pads a low byte rather than dropping a nibble', () => {
    assert.equal(toHex(new Uint8Array([0, 1, 255])), '0001ff');
  });
});

describe('newOrderId', () => {
  it('is 32 bytes, which is what BytesN<32> means', () => {
    assert.equal(newOrderId().length, 32);
  });

  it('is not derived from anything — two calls differ', () => {
    // If ids were a hash of the basket, a user retrying a payment that failed
    // in their wallet would be rejected for OrderExists.
    assert.notEqual(toHex(newOrderId()), toHex(newOrderId()));
  });
});

describe('canonicalBasket', () => {
  it('is stable across two equal carts built in a different order', () => {
    const a = cart({ lines: [line({ index: 0 }), line({ index: 1, skuId: '999' })] });
    const b = cart({ lines: [line({ index: 1, skuId: '999' }), line({ index: 0 })] });
    assert.equal(canonicalBasket(a), canonicalBasket(b));
  });

  it('carries a version tag, because a hash is a promise about bytes', () => {
    assert.match(canonicalBasket(cart()), /^changuito\/basket\/v1\n/);
  });

  it('does not depend on the display strings, which are a formatting choice', () => {
    const other = cart({ total: { centavos: 300_000, display: '3000 pesos' } });
    assert.equal(canonicalBasket(cart()), canonicalBasket(other));
  });

  it('ignores store messages, which change without the basket changing', () => {
    assert.equal(canonicalBasket(cart()), canonicalBasket(cart({ messages: ['Promo 2x1'] })));
  });
});

describe('basketHash', () => {
  it('is 32 bytes and deterministic', async () => {
    const a = await basketHash(cart());
    const b = await basketHash(cart());
    assert.equal(a.length, 32);
    assert.deepEqual(a, b);
  });

  it('RULE: changing anything the user was shown changes the hash', async () => {
    // This is the whole point of the commitment. Each of these is a way the
    // agent could settle against a basket the user never approved.
    const base = toHex(await basketHash(cart()));
    const variants: Record<string, Cart> = {
      quantity: cart({ lines: [line({ quantity: 3 })] }),
      sku: cart({ lines: [line({ skuId: '54321' })] }),
      'line price': cart({ lines: [line({ lineTotal: { centavos: 400_000, display: '$4.000,00' } })] }),
      total: cart({ total: { centavos: 999_999, display: '$9.999,99' } }),
      availability: cart({ lines: [line({ available: false })] }),
      retailer: cart({ retailer: 'carrefour' }),
      'an extra line': cart({ lines: [line(), line({ index: 1, skuId: '777' })] }),
    };
    for (const [what, c] of Object.entries(variants)) {
      assert.notEqual(toHex(await basketHash(c)), base, `${what} left the basket hash unchanged`);
    }
  });
});

describe('canonicalReceipt', () => {
  const input = {
    orderId: '20f8af41e9932bbf0d2d3c00bde344a087d3d0c1c8f9a2c0045f97f9fb736e6e',
    buyer: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    basketHash: '09f717841992aabcb6a6925fdae396718d5e9b2c43b6bb35330429523ed89798',
    amountUnits: '34400000',
    settledAt: '2026-09-20T14:30:00.000Z',
  };

  it('is verifiable: the preimage is plain text a person can read', () => {
    // The whole point of returning it from /api/settle. 32 bytes on a block
    // explorer prove nothing unless you can see what was hashed into them.
    assert.match(canonicalReceipt(input), /^changuito\/receipt\/v2\n/);
    assert.match(canonicalReceipt(input), /\nsettled\|2026-09-20T14:30:00\.000Z\n/);
  });

  it('records only what the contract and the server know, and on whose word', () => {
    // v1 hashed a retailer, cart id and link that came from the browser.
    const lines = canonicalReceipt(input).split('\n');
    assert.deepEqual(lines.slice(1, 6), [
      `order|${input.orderId}`,
      `buyer|${input.buyer}`,
      `basket|${input.basketHash}`,
      `amount|${input.amountUnits}`,
      'basis|buyer-confirmed',
    ]);
    assert.doesNotMatch(canonicalReceipt(input), /retailer|cart\||handoff/);
  });

  it('hashes to 32 bytes, and a different moment is a different receipt', async () => {
    const a = await receiptHash(input);
    assert.equal(a.length, 32);
    const b = await receiptHash({ ...input, settledAt: '2026-09-20T14:30:01.000Z' });
    assert.notEqual(toHex(a), toHex(b));
  });

  it('is not the basket hash, even for the same cart', async () => {
    // Two BytesN<32> fields on the same order; a collision here would mean the
    // encoder was reusing one for the other.
    const receipt = toHex(await receiptHash(input));
    const basket = toHex(await basketHash(cart()));
    assert.notEqual(receipt, basket);
  });
});
