import { API_ORIGIN } from '../auth/identity.ts'
import { nativeSessionHeaders } from '../auth/session-client.ts'
import { parseEvents, postalCodeFromSnapshot, type Cart, type UiEvent } from './protocol.ts'

export type ShopErrorCode = 'refused' | 'unauthorized' | 'network' | 'server' | 'postal' | 'pay'

export class ShopError extends Error {
  readonly code: ShopErrorCode

  constructor(code: ShopErrorCode) {
    super(code)
    this.name = 'ShopError'
    this.code = code
  }
}

export type ShopFetch = (url: string, init?: RequestInit) => Promise<Response>

/**
 * Headers for chat and checkout.
 *
 * The session value is sent as a cookie because those routes read the cookie,
 * and as a bearer because the session routes do. No Origin and no Sec-Fetch.
 */
export function shopHeaders(token: string, accept: string): Headers {
  const headers = nativeSessionHeaders({ json: true, transport: false, token })
  headers.set('accept', accept)
  headers.set('cookie', `chg_user=${encodeURIComponent(token)}`)
  return headers
}

function statusCode(status: number): ShopErrorCode {
  if (status === 403) return 'refused'
  if (status === 401) return 'unauthorized'
  return 'server'
}

async function fail(response: Response): Promise<never> {
  await response.text().catch(() => '')
  throw new ShopError(statusCode(response.status))
}

export async function consumeSse(response: Response, onEvent: (event: UiEvent) => void): Promise<void> {
  if (!response.ok) return fail(response)
  const body = response.body
  if (body && typeof body.getReader === 'function') {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const step = await reader.read()
      if (step.done) break
      buffer += decoder.decode(step.value, { stream: true })
      const parsed = parseEvents(buffer)
      buffer = parsed.rest
      for (const event of parsed.events) onEvent(event)
    }
    if (buffer.trim()) {
      const parsed = parseEvents(`${buffer}\n\n`)
      for (const event of parsed.events) onEvent(event)
    }
    return
  }
  const text = await response.text()
  const parsed = parseEvents(text.endsWith('\n\n') ? text : `${text}\n\n`)
  for (const event of parsed.events) onEvent(event)
}

export async function sendChat(input: {
  baseUrl?: string
  fetch?: ShopFetch
  token: string
  sessionId: string
  message: string
  snapshot?: unknown
  lang: 'es' | 'en'
  onEvent: (event: UiEvent) => void
}): Promise<void> {
  const fetchImpl = input.fetch ?? globalThis.fetch.bind(globalThis)
  const base = (input.baseUrl ?? API_ORIGIN).replace(/\/$/, '')
  let response: Response
  try {
    response = await fetchImpl(`${base}/api/chat`, {
      method: 'POST',
      headers: shopHeaders(input.token, 'text/event-stream, application/json'),
      body: JSON.stringify({
        sessionId: input.sessionId,
        message: input.message,
        snapshot: input.snapshot,
        network: 'devnet',
        lang: input.lang,
      }),
    })
  } catch {
    throw new ShopError('network')
  }
  await consumeSse(response, input.onEvent)
}

type Quote = { orderId: string; amountDisplay: string }

export async function payForCart(input: {
  baseUrl?: string
  fetch?: ShopFetch
  token: string
  cart: Cart
  handoffUrl?: string
  snapshot: unknown
  signTransaction: (txBase64: string) => Promise<string>
}): Promise<{ orderId: string; openSig: string; amountDisplay: string }> {
  const postalCode = postalCodeFromSnapshot(input.snapshot)
  if (!postalCode) throw new ShopError('postal')
  const fetchImpl = input.fetch ?? globalThis.fetch.bind(globalThis)
  const base = (input.baseUrl ?? API_ORIGIN).replace(/\/$/, '')

  async function call(path: string, method: 'POST' | 'PUT', body: unknown): Promise<Record<string, unknown>> {
    let response: Response
    try {
      response = await fetchImpl(`${base}${path}`, {
        method,
        headers: shopHeaders(input.token, 'application/json'),
        body: JSON.stringify(body),
      })
    } catch {
      throw new ShopError('network')
    }
    if (!response.ok) return fail(response)
    const json = (await response.json()) as unknown
    if (!json || typeof json !== 'object') throw new ShopError('server')
    return json as Record<string, unknown>
  }

  const quote = await call('/api/checkout/quote', 'POST', {
    cart: input.cart,
    handoffUrl: input.handoffUrl,
    location: { postalCode },
  })
  const orderId = typeof quote.orderId === 'string' ? quote.orderId : ''
  const amountDisplay = typeof quote.amountDisplay === 'string' ? quote.amountDisplay : ''
  if (!/^[0-9a-f]{64}$/.test(orderId)) throw new ShopError('server')

  const opened = await call('/api/checkout/open', 'POST', { orderId })
  if (typeof opened.tx !== 'string' || opened.tx.length === 0) throw new ShopError('pay')
  const signed = await input.signTransaction(opened.tx)
  if (!signed) throw new ShopError('pay')
  const sent = await call('/api/checkout/open', 'PUT', { orderId, tx: signed })
  const openSig = typeof sent.openSig === 'string' ? sent.openSig : ''
  if (!openSig) throw new ShopError('pay')
  await call('/api/checkout/start', 'POST', { orderId, openSig })
  return { orderId, openSig, amountDisplay }
}

export function quoteAmount(quote: Quote): string {
  return quote.amountDisplay
}
