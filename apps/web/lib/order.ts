import type { Cart } from '@changuito/mcp/types';

import type { NetworkId } from './deployments.ts';

/**
 * Turning an approved basket into the five arguments `escrow.open` takes.
 *
 * All of it is pure and runs identically in the browser and in a test: the
 * hash the user's wallet signs has to be reproducible by anyone holding the
 * same cart, or `basket_hash` proves nothing.
 */

/**
 * An hour to get the basket through the store's checkout. Long enough that a
 * slow pickup does not strand the money, short enough that a user who walks
 * away can self-refund the same afternoon rather than next month.
 */
export const DEFAULT_TIMEOUT_SECS = 3600;

/* ------------------------------------------------------------------ bytes */

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error(`odd-length hex: ${hex.length} chars`);
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/* ------------------------------------------------------------- the basket */

/**
 * The exact text that gets hashed into `basket_hash`.
 *
 * Line-oriented and versioned rather than `JSON.stringify`, because a hash is
 * a promise about bytes: object key order is an implementation detail of
 * whoever built the object, and a future refactor that reorders two fields
 * would silently produce a different commitment for the same basket.
 *
 * It commits to what the user was shown — items, quantities, per-line and
 * total pesos, and which lines the store said were unavailable. The USDC
 * amount is deliberately absent: the contract stores that as its own field,
 * so hashing it too would just be a second copy that can disagree.
 */
export function canonicalBasket(cart: Cart): string {
  const lines = [...cart.lines]
    .sort((a, b) => a.index - b.index)
    .map((l) =>
      ['line', l.index, l.skuId, l.quantity, l.lineTotal.centavos, l.available ? 'y' : 'n'].join('|'),
    );
  return [
    'changuito/basket/v1',
    `retailer|${cart.retailer}`,
    `cart|${cart.cartId}`,
    ...lines,
    `total|${cart.total.centavos}`,
    '',
  ].join('\n');
}

async function sha256(text: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return new Uint8Array(digest);
}

/** 32 bytes, which is exactly `BytesN<32>`. */
export function basketHash(cart: Cart): Promise<Uint8Array> {
  return sha256(canonicalBasket(cart));
}

/**
 * Random, not derived from the basket.
 *
 * `open` rejects an id it has already seen, which is what stops a double
 * submit — but it also means a *deliberate* second attempt at the same basket
 * (the first one failed in the wallet, the user tries again) must be a new
 * order, or it would be rejected for the wrong reason.
 */
export function newOrderId(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

/* ------------------------------------------------------------ the receipt */

export interface ReceiptInput {
  /** Hex, as the contract stores it. */
  orderId: string;
  /** The order's buyer, as read from the contract. */
  buyer: string;
  /** Hex of the basket_hash the buyer locked. */
  basketHash: string;
  /** Token units escrowed. */
  amountUnits: string;
  /** ISO 8601. Chosen by the server and returned, so the hash can be re-derived. */
  settledAt: string;
}

/**
 * What `settle` writes on-chain as `receipt_hash`.
 *
 * Every field is one the server read from the contract or chose itself. v1
 * hashed the retailer, cart id and handoff link the browser sent, which let
 * anyone put any text on-chain as a "receipt". In a full product this would
 * hash the store's own order number; until the resolver can check the store,
 * it records what is actually known: this order, this buyer, this basket,
 * released on the buyer's signed word at this moment.
 */
export function canonicalReceipt(r: ReceiptInput): string {
  return [
    'changuito/receipt/v2',
    `order|${r.orderId}`,
    `buyer|${r.buyer}`,
    `basket|${r.basketHash}`,
    `amount|${r.amountUnits}`,
    'basis|buyer-confirmed',
    `settled|${r.settledAt}`,
    '',
  ].join('\n');
}

export function receiptHash(r: ReceiptInput): Promise<Uint8Array> {
  return sha256(canonicalReceipt(r));
}

/** What the browser asks /api/settle to do once the basket is resolved. */
export type SettleAction = 'settle' | 'refund';
