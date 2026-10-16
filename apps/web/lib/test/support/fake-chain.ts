/**
 * A scripted Solana RPC (and anything else fetch reaches) for route tests.
 *
 * `@solana/kit` talks JSON-RPC over `fetch`, so replacing `globalThis.fetch`
 * is enough: no network, no devnet, no keys. Each test file runs in its own
 * process (node --test), so the swap never leaks between files.
 */
import { getAddressEncoder } from '@solana/kit';

import { DEPLOYMENTS } from '../../deployments.ts';
import { hexToBytes, ORDER_DISCRIMINATOR, ORDER_SIZE } from '../../escrow.ts';

export const RPC_URL = 'http://rpc.test';
export const PROGRAM = DEPLOYMENTS.devnet.programId;

export type RpcHandler = (method: string, params: unknown[]) => unknown;
export type UrlHandler = (url: string, init?: RequestInit) => Response | Promise<Response> | undefined;

export interface FakeChain {
  calls: { method: string; params: unknown[] }[];
  restore: () => void;
}

/** RPC answers come from `rpc(method)`; any other URL goes to `other`, else 404. */
export function installFetch(rpc: RpcHandler, other?: UrlHandler): FakeChain {
  const real = globalThis.fetch;
  const calls: FakeChain['calls'] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith(RPC_URL)) {
      const body = JSON.parse(String(init?.body ?? '{}')) as { id: unknown; method: string; params?: unknown[] };
      calls.push({ method: body.method, params: body.params ?? [] });
      let result: unknown;
      try {
        result = rpc(body.method, body.params ?? []);
      } catch (err) {
        return Response.json({ jsonrpc: '2.0', id: body.id, error: { code: -32000, message: (err as Error).message } });
      }
      return Response.json({ jsonrpc: '2.0', id: body.id, result });
    }
    const res = await other?.(url, init);
    return res ?? new Response('not found', { status: 404 });
  }) as typeof fetch;
  return { calls, restore: () => void (globalThis.fetch = real) };
}

/** The bytes of an Order account, in the program's layout (lib/escrow.ts decodeOrder). */
export function orderBytes(o: {
  orderId: string;
  buyer: string;
  amount: bigint;
  basketHash: string;
  status: 0 | 1 | 2;
  openedAt?: number;
  deadline?: number;
}): Uint8Array {
  const out = new Uint8Array(ORDER_SIZE);
  const v = new DataView(out.buffer);
  out.set(ORDER_DISCRIMINATOR, 0);
  let p = 8;
  out.set(hexToBytes(o.orderId), p); p += 32;
  out.set(getAddressEncoder().encode(o.buyer as never), p); p += 32;
  v.setBigUint64(p, o.amount, true); p += 8;
  out.set(hexToBytes(o.basketHash), p); p += 32;
  out[p] = o.status; p += 1;
  v.setBigInt64(p, BigInt(o.openedAt ?? 1_700_000_000), true); p += 8;
  v.setBigInt64(p, BigInt(o.deadline ?? 1_700_003_600), true);
  return out;
}

/** A getAccountInfo result for `data` owned by `owner`. */
export function accountInfo(data: Uint8Array | null, owner: string = PROGRAM) {
  return {
    context: { slot: 1 },
    value: data
      ? { data: [Buffer.from(data).toString('base64'), 'base64'], owner, lamports: 1_000_000, executable: false, rentEpoch: 0, space: data.length }
      : null,
  };
}
