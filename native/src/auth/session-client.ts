import { bytesToBase64 } from './bytes.ts'
import { API_ORIGIN, NATIVE_USER_AGENT, SESSION_TRANSPORT_HEADER } from './identity.ts'
import { isSolanaAddress } from './base58.ts'

export type SessionErrorCode =
  | 'cancelled'
  | 'wallet_missing'
  | 'invalid_identity'
  | 'association_failed'
  | 'refused'
  | 'rate_limited'
  | 'session_closed'
  | 'network'
  | 'proof_invalid'
  | 'unconfigured'
  | 'invalid_address'
  | 'empty_signature'
  | 'token_missing'
  | 'unknown'

export class SessionError extends Error {
  readonly code: SessionErrorCode

  constructor(code: SessionErrorCode, message: string) {
    super(message)
    this.name = 'SessionError'
    this.code = code
  }
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export type SignMessage = (message: string) => Promise<Uint8Array>

export type SessionApi = {
  signIn(input: { address: string; signMessage: SignMessage }): Promise<{ address: string }>
  current(): Promise<string | null>
  logout(): Promise<void>
  /** The bearer from the last login. Null after logout or a rejected read. Never log this. */
  token(): string | null
  adopt(token: string | null): void
}

type JsonBody = Record<string, unknown> | null

type Call = 'challenge' | 'login' | 'read' | 'logout'

const BROWSER_HEADERS = ['origin', 'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest', 'sec-fetch-user']

/**
 * Headers for a native session call.
 * No Origin and no Sec-Fetch-*: the site withholds the bearer when either is present.
 * No Cookie. The session travels as Authorization on the read and the logout.
 */
export function nativeSessionHeaders(input: { json: boolean; transport: boolean; token: string | null }): Headers {
  const headers = new Headers()
  headers.set('accept', 'application/json')
  headers.set('user-agent', NATIVE_USER_AGENT)
  if (input.json) headers.set('content-type', 'application/json')
  if (input.transport) headers.set(SESSION_TRANSPORT_HEADER, 'bearer')
  if (input.token) headers.set('authorization', `Bearer ${input.token}`)
  for (const name of BROWSER_HEADERS) headers.delete(name)
  return headers
}

async function readJson(response: Response): Promise<{ json: JsonBody; text: string }> {
  const text = await response.text()
  if (!text) return { json: null, text }
  try {
    const parsed = JSON.parse(text) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { json: parsed as Record<string, unknown>, text }
    }
  } catch {
    /* not json */
  }
  return { json: null, text }
}

export function errorFromResponse(status: number, json: JsonBody, text: string, call: Call): SessionError {
  const error = typeof json?.error === 'string' ? json.error : ''
  if (status === 429 || error === 'rate_limited') return new SessionError('rate_limited', 'rate_limited')
  if (status === 403 || error === 'solo_humanos' || /solo humanos/i.test(text)) {
    return new SessionError('refused', 'refused')
  }
  if (status === 503 || error === 'session_unconfigured' || error === 'session_unavailable' || error === 'limiter_unavailable') {
    return new SessionError('unconfigured', 'unconfigured')
  }
  if (status === 401) {
    return new SessionError(call === 'read' || call === 'logout' ? 'session_closed' : 'proof_invalid', 'unauthorized')
  }
  if (status === 400 || error === 'session_proof_invalid' || error === 'session_proof_required') {
    return new SessionError('proof_invalid', 'proof_invalid')
  }
  return new SessionError('unknown', 'unknown')
}

export function createSessionApi(options?: { baseUrl?: string; fetch?: FetchLike }): SessionApi {
  const baseUrl = (options?.baseUrl ?? API_ORIGIN).replace(/\/$/, '')
  const fetchImpl = options?.fetch ?? globalThis.fetch.bind(globalThis)
  let token: string | null = null

  async function send(path: string, call: Call, body?: unknown): Promise<{ status: number; json: JsonBody; text: string }> {
    const headers = nativeSessionHeaders({
      json: body !== undefined,
      transport: call === 'login',
      token: call === 'read' || call === 'logout' ? token : null,
    })
    let response: Response
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method: call === 'read' ? 'GET' : 'POST',
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch {
      throw new SessionError('network', 'network')
    }
    const parsed = await readJson(response)
    return { status: response.status, ...parsed }
  }

  async function current(): Promise<string | null> {
    if (!token) return null
    const result = await send('/api/session', 'read')
    if (result.status === 401) {
      token = null
      throw new SessionError('session_closed', 'session_closed')
    }
    if (result.status !== 200) throw errorFromResponse(result.status, result.json, result.text, 'read')
    const address = result.json?.address
    if (typeof address !== 'string' || address.length === 0) {
      token = null
      return null
    }
    return address
  }

  return {
    token: () => token,
    adopt(next) {
      token = next && next.length > 0 ? next : null
    },
    async signIn({ address, signMessage }) {
      if (!isSolanaAddress(address)) throw new SessionError('invalid_address', 'invalid_address')
      const challenge = await send('/api/session/wallet-challenge', 'challenge', { address })
      if (challenge.status !== 200) throw errorFromResponse(challenge.status, challenge.json, challenge.text, 'challenge')
      const message = challenge.json?.message
      if (typeof message !== 'string' || message.length === 0) {
        throw new SessionError('unknown', 'challenge_missing')
      }

      let signature: Uint8Array
      try {
        signature = await signMessage(message)
      } catch (err) {
        if (err instanceof SessionError) throw err
        throw new SessionError('unknown', 'sign_failed')
      }
      if (signature.length !== 64) throw new SessionError('empty_signature', 'empty_signature')

      const login = await send('/api/session/login', 'login', {
        walletProof: {
          address,
          message,
          signature: bytesToBase64(signature),
        },
      })
      if (login.status !== 200) throw errorFromResponse(login.status, login.json, login.text, 'login')
      const returned = login.json?.address
      const sessionToken = login.json?.sessionToken
      if (returned !== address) throw new SessionError('proof_invalid', 'address_mismatch')
      if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
        throw new SessionError('token_missing', 'token_missing')
      }
      token = sessionToken
      return { address }
    },
    current,
    async logout() {
      try {
        if (!token) return
        const result = await send('/api/session/logout', 'logout', {})
        if (result.status !== 200 && result.status !== 401) {
          throw errorFromResponse(result.status, result.json, result.text, 'logout')
        }
      } finally {
        token = null
      }
    },
  }
}
