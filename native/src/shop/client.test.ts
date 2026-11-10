import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { messageForFailure } from '../auth/messages.ts'
import { SessionError, errorFromResponse } from '../auth/session-client.ts'
import { ShopError, payForCart, sendChat, shopHeaders } from './client.ts'
import type { Cart } from './protocol.ts'

const TOKEN = 'v2.1.mem.tokenvalue'
const ORDER = 'ab'.repeat(32)

const cart: Cart = {
  retailer: 'dia',
  cartId: 'cart-1',
  lines: [],
  total: { centavos: 1000, display: '$10,00' },
  messages: [],
}

describe('shop calls', () => {
  it('sends the session as a cookie and does not send browser headers', () => {
    const headers = shopHeaders(TOKEN, 'application/json')
    assert.equal(headers.get('cookie'), `chg_user=${encodeURIComponent(TOKEN)}`)
    assert.equal(headers.get('authorization'), `Bearer ${TOKEN}`)
    assert.equal(headers.get('origin'), null)
    assert.equal(headers.get('sec-fetch-site'), null)
    assert.equal(headers.get('user-agent'), 'ChanguitoSeeker/2.0.0')
  })

  it('reads a chat stream and surfaces a browser-check refusal', async () => {
    const seen: string[] = []
    await sendChat({
      token: TOKEN,
      sessionId: '11111111-1111-4111-8111-111111111111',
      message: 'café',
      lang: 'es',
      fetch: async () =>
        new Response('data: {"t":"text","delta":"Listo"}\n\n', {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        }),
      onEvent: (event) => {
        if (event.t === 'text') seen.push(event.delta)
      },
    })
    assert.deepEqual(seen, ['Listo'])

    await assert.rejects(
      () =>
        sendChat({
          token: TOKEN,
          sessionId: '11111111-1111-4111-8111-111111111111',
          message: 'café',
          lang: 'es',
          fetch: async () => new Response(JSON.stringify({ error: 'solo_humanos' }), { status: 403 }),
          onEvent: () => undefined,
        }),
      (err: unknown) => err instanceof ShopError && err.code === 'refused',
    )
  })

  it('quotes, signs only, and starts the escrow', async () => {
    const calls: string[] = []
    const result = await payForCart({
      token: TOKEN,
      cart,
      snapshot: { location: { postalCode: 'C1425' } },
      signTransaction: async (raw) => {
        assert.equal(raw, 'unsigned-tx')
        return 'signed-tx'
      },
      fetch: async (url, init) => {
        calls.push(`${init?.method} ${url}`)
        if (url.endsWith('/quote')) {
          return Response.json({ orderId: ORDER, amountDisplay: '1.50' })
        }
        if (url.endsWith('/open') && init?.method === 'POST') {
          return Response.json({ tx: 'unsigned-tx' })
        }
        if (url.endsWith('/open') && init?.method === 'PUT') {
          const body = JSON.parse(String(init.body)) as { tx: string }
          assert.equal(body.tx, 'signed-tx')
          return Response.json({ openSig: 'sig-1' })
        }
        if (url.endsWith('/start')) return Response.json({ status: 'running' })
        return new Response('no', { status: 404 })
      },
    })
    assert.equal(result.openSig, 'sig-1')
    assert.equal(result.amountDisplay, '1.50')
    assert.deepEqual(
      calls.map((call) => {
        const [method, url] = call.split(' ')
        return `${method} ${url?.split('/').pop()}`
      }),
      ['POST quote', 'POST open', 'PUT open', 'POST start'],
    )
  })

  it('asks for a postal code before quoting', async () => {
    await assert.rejects(
      () =>
        payForCart({
          token: TOKEN,
          cart,
          snapshot: {},
          signTransaction: async (raw) => raw,
          fetch: async () => {
            throw new Error('should not be called')
          },
        }),
      (err: unknown) => err instanceof ShopError && err.code === 'postal',
    )
  })

  it('names a quota outage separately from a missing sign-in setup', () => {
    const limiter = errorFromResponse(503, { error: 'limiter_unavailable' }, '', 'challenge')
    const missing = errorFromResponse(503, { error: 'session_unconfigured' }, '', 'challenge')
    assert.equal(limiter.code, 'limiter')
    assert.equal(missing.code, 'unconfigured')
    assert.match(messageForFailure(limiter, 'es'), /cupo/)
    assert.match(messageForFailure(new SessionError('limiter', 'limiter'), 'en'), /quota/)
    assert.notEqual(messageForFailure(limiter, 'en'), messageForFailure(missing, 'en'))
  })
})
