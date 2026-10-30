import { bytesToBase64 } from './bytes.ts'
import { cookieRequestHeader, readSetCookieLines, storeSetCookies, type CookieJar } from './cookies.ts'
import { API_ORIGIN, NATIVE_USER_AGENT, USER_COOKIE } from './identity.ts'
import { isSolanaAddress } from './base58.ts'

export type SessionErrorCode =
  | 'cancelled'
  | 'wallet_missing'
  | 'invalid_identity'
  | 'association_failed'
  | 'human_required'
  | 'network'
  | 'proof_invalid'
  | 'unconfigured'
  | 'invalid_address'
  | 'empty_signature'
  | 'cookie_missing'
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
  jar: CookieJar
}

type JsonBody = Record<string, unknown> | null

function requestHeaders(jar: CookieJar, jsonBody: boolean): Headers {
  const headers = new Headers()
  headers.set('accept', 'application/json')
  headers.set('user-agent', NATIVE_USER_AGENT)
  if (jsonBody) headers.set('content-type', 'application/json')
  const cookie = cookieRequestHeader(jar)
  if (cookie) headers.set('cookie', cookie)
  return headers
}

function absorbCookies(jar: CookieJar, response: Response): void {
  storeSetCookies(jar, readSetCookieLines(response.headers))
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

export function errorFromResponse(status: number, json: JsonBody, text: string): SessionError {
  const error = typeof json?.error === 'string' ? json.error : ''
  const message = typeof json?.message === 'string' ? json.message : text
  if (status === 403 && (error === 'solo_humanos' || /solo humanos/i.test(text))) {
    return new SessionError('human_required', message || 'human_required')
  }
  if (status === 503 || error === 'session_unconfigured') {
    return new SessionError('unconfigured', message || 'unconfigured')
  }
  if (status === 400 || status === 401 || error === 'session_proof_invalid' || error === 'session_proof_required') {
    return new SessionError('proof_invalid', message || 'proof_invalid')
  }
  return new SessionError('unknown', message || `http_${status}`)
}

function rememberSessionToken(jar: CookieJar, json: JsonBody): void {
  const token = json?.sessionToken
  if (typeof token === 'string' && token.length > 0) jar.set(USER_COOKIE, token)
}

export function createSessionApi(options?: {
  baseUrl?: string
  fetch?: FetchLike
  jar?: CookieJar
}): SessionApi {
  const baseUrl = (options?.baseUrl ?? API_ORIGIN).replace(/\/$/, '')
  const fetchImpl = options?.fetch ?? globalThis.fetch.bind(globalThis)
  const jar = options?.jar ?? new Map()

  async function send(path: string, method: string, body?: unknown): Promise<{ status: number; json: JsonBody; text: string }> {
    let response: Response
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: requestHeaders(jar, body !== undefined),
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'network'
      throw new SessionError('network', detail)
    }
    absorbCookies(jar, response)
    const parsed = await readJson(response)
    rememberSessionToken(jar, parsed.json)
    return { status: response.status, ...parsed }
  }

  async function current(): Promise<string | null> {
    const result = await send('/api/session', 'GET')
    if (result.status !== 200) throw errorFromResponse(result.status, result.json, result.text)
    const address = result.json?.address
    if (typeof address !== 'string' || address.length === 0) {
      jar.delete(USER_COOKIE)
      return null
    }
    return address
  }

  return {
    jar,
    async signIn({ address, signMessage }) {
      if (!isSolanaAddress(address)) throw new SessionError('invalid_address', 'invalid_address')
      const challenge = await send('/api/session/wallet-challenge', 'POST', { address })
      if (challenge.status !== 200) throw errorFromResponse(challenge.status, challenge.json, challenge.text)
      const message = challenge.json?.message
      if (typeof message !== 'string' || message.length === 0) {
        throw new SessionError('unknown', 'challenge_missing')
      }

      let signature: Uint8Array
      try {
        signature = await signMessage(message)
      } catch (err) {
        if (err instanceof SessionError) throw err
        throw new SessionError('unknown', err instanceof Error ? err.message : 'sign_failed')
      }
      if (signature.length === 0) throw new SessionError('empty_signature', 'empty_signature')

      const login = await send('/api/session/login', 'POST', {
        walletProof: {
          address,
          message,
          signature: bytesToBase64(signature),
        },
      })
      if (login.status !== 200) throw errorFromResponse(login.status, login.json, login.text)
      const returned = login.json?.address
      if (returned !== address) throw new SessionError('proof_invalid', 'address_mismatch')
      if (!jar.has(USER_COOKIE)) {
        const confirmed = await current()
        if (confirmed !== address) throw new SessionError('cookie_missing', 'cookie_missing')
      }
      return { address }
    },
    current,
    async logout() {
      try {
        const result = await send('/api/session/logout', 'POST', {})
        if (result.status !== 200 && result.status !== 403) {
          throw errorFromResponse(result.status, result.json, result.text)
        }
      } finally {
        jar.delete(USER_COOKIE)
      }
    },
  }
}
