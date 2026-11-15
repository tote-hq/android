import { base64ToBytes, bytesToBase64Url } from './bytes.ts'
import { decodeBase58, isSolanaAddress } from './base58.ts'
import type { FetchLike } from './session-client.ts'

/**
 * In-process stand-in for /api/session/* used by tests and the dev mock.
 * The message shape matches the server: the client signs the exact string
 * and sends it back. The HMAC and the nonce are local to this process.
 */

type Challenge = { address: string; message: string; expires: number }

const TEXT = new TextEncoder()

function bufferSource(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

async function hmac(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    bufferSource(TEXT.encode(secret)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, bufferSource(TEXT.encode(payload)))
  return bytesToBase64Url(new Uint8Array(sig))
}

async function verifyEd25519(publicKey: Uint8Array, message: string, signature: Uint8Array): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey('raw', bufferSource(publicKey), { name: 'Ed25519' }, false, ['verify'])
    return await crypto.subtle.verify({ name: 'Ed25519' }, key, bufferSource(signature), bufferSource(TEXT.encode(message)))
  } catch {
    return false
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}

/** Same rule as the site: the bearer is returned only when the client asked and sent no browser headers. */
function wantsBearer(headers: Headers): boolean {
  const raw = headers.get('x-chg-session-transport')
  if (raw == null || raw.trim().toLowerCase() !== 'bearer') return false
  if (headers.get('origin')) return false
  if (headers.get('sec-fetch-site')) return false
  if (headers.get('sec-fetch-mode')) return false
  return true
}

function presentedBearer(headers: Headers): string | null {
  const raw = headers.get('authorization')
  if (!raw) return null
  const match = /^Bearer ([A-Za-z0-9._-]{16,2048})$/i.exec(raw.trim())
  return match?.[1] ?? null
}

export function createMemorySessionFetch(options?: {
  secret?: string
  humanGate?: boolean
  rateLimit?: boolean
  host?: string
}): FetchLike {
  const secret = options?.secret ?? 'memory-session-secret'
  const host = options?.host ?? 'sol.changuito.me'
  const humanGate = options?.humanGate === true
  const rateLimit = options?.rateLimit === true
  const pending = new Map<string, Challenge>()
  const sessions = new Map<string, string>()
  const closed = new Set<string>()

  return async (url, init) => {
    if (rateLimit) {
      return jsonResponse(429, {
        error: 'rate_limited',
        message: 'Demasiados intentos. Probá de nuevo en unos minutos.',
      })
    }
    if (humanGate) {
      return jsonResponse(403, {
        error: 'solo_humanos',
        message: 'Changuito es solo para personas. Completá la verificación.',
      })
    }
    const path = new URL(url).pathname
    const method = (init?.method ?? 'GET').toUpperCase()
    let body: unknown = null
    if (typeof init?.body === 'string' && init.body) {
      try {
        body = JSON.parse(init.body) as unknown
      } catch {
        return jsonResponse(400, { error: 'expected_json' })
      }
    }
    const headers = new Headers(init?.headers)

    if (method === 'POST' && path === '/api/session/wallet-challenge') {
      const address = (body as { address?: unknown } | null)?.address
      if (!isSolanaAddress(address)) {
        return jsonResponse(400, { error: 'session_proof_invalid', message: 'La dirección no es válida.' })
      }
      const now = Date.now()
      const nonceBytes = new Uint8Array(16)
      crypto.getRandomValues(nonceBytes)
      const nonce = bytesToBase64Url(nonceBytes)
      const issued = now
      const expires = now + 5 * 60 * 1000
      const payload = ['v1', host, address, nonce, String(issued), String(expires)].join('\n')
      const mac = await hmac(secret, payload)
      const message = [
        'Changuito sign-in',
        `Host: ${host}`,
        `Address: ${address}`,
        `Nonce: ${nonce}`,
        `Issued: ${issued}`,
        `Expires: ${expires}`,
        `Mac: ${mac}`,
      ].join('\n')
      pending.set(nonce, { address, message, expires })
      return jsonResponse(200, { message })
    }

    if (method === 'POST' && path === '/api/session/login') {
      const proof = (body as { walletProof?: { address?: unknown; message?: unknown; signature?: unknown } } | null)
        ?.walletProof
      const address = typeof proof?.address === 'string' ? proof.address : ''
      const message = typeof proof?.message === 'string' ? proof.message : ''
      const signatureB64 = typeof proof?.signature === 'string' ? proof.signature : ''
      const lines = message.split('\n')
      const nonce = lines[3]?.startsWith('Nonce: ') ? lines[3].slice('Nonce: '.length) : ''
      const macLine = lines[6]?.startsWith('Mac: ') ? lines[6].slice('Mac: '.length) : ''
      const issued = Number(lines[4]?.slice('Issued: '.length))
      const expires = Number(lines[5]?.slice('Expires: '.length))
      const claimedHost = lines[1]?.startsWith('Host: ') ? lines[1].slice('Host: '.length) : ''
      const claimedAddress = lines[2]?.startsWith('Address: ') ? lines[2].slice('Address: '.length) : ''
      const macPayload = ['v1', claimedHost, claimedAddress, nonce, String(issued), String(expires)].join('\n')
      const expected = nonce ? await hmac(secret, macPayload) : ''
      const challenge = pending.get(nonce)
      const signature = base64ToBytes(signatureB64)
      const publicKey = decodeBase58(address)
      const signed =
        signature?.length === 64 && publicKey
          ? await verifyEd25519(publicKey, message, signature)
          : false
      const fresh = challenge && challenge.message === message && challenge.address === address && challenge.expires >= Date.now()
      if (
        lines.length !== 7 ||
        claimedHost !== host ||
        claimedAddress !== address ||
        expected !== macLine ||
        !fresh ||
        !signed
      ) {
        return jsonResponse(401, {
          error: 'session_proof_invalid',
          message: 'No pudimos confirmar tu sesión. Iniciá sesión de nuevo.',
        })
      }
      pending.delete(nonce)
      const exp = Date.now() + 30 * 24 * 60 * 60 * 1000
      const token = `v2.${exp}.mem.${nonce}`
      sessions.set(token, address)
      const responseBody: { ok: true; address: string; sessionToken?: string } = { ok: true, address }
      if (wantsBearer(headers)) responseBody.sessionToken = token
      return jsonResponse(200, responseBody)
    }

    if (method === 'GET' && path === '/api/session') {
      const token = presentedBearer(headers)
      if (!token) return jsonResponse(200, { address: null })
      if (closed.has(token) || !sessions.has(token)) {
        return jsonResponse(401, { error: 'session_proof_invalid' })
      }
      return jsonResponse(200, { address: sessions.get(token) })
    }

    if (method === 'POST' && path === '/api/session/logout') {
      const token = presentedBearer(headers)
      if (!token) {
        return jsonResponse(401, { error: 'session_proof_invalid' })
      }
      if (closed.has(token)) return jsonResponse(200, { ok: true })
      if (!sessions.has(token)) return jsonResponse(401, { error: 'session_proof_invalid' })
      closed.add(token)
      sessions.delete(token)
      return jsonResponse(200, { ok: true })
    }

    return jsonResponse(404, { error: 'not_found' })
  }
}
