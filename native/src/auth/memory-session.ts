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

function jsonResponse(status: number, body: unknown, cookie?: string): Response {
  const headers = new Headers({ 'content-type': 'application/json', 'cache-control': 'no-store' })
  if (cookie) headers.append('set-cookie', cookie)
  return new Response(JSON.stringify(body), { status, headers })
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() !== name) continue
    const value = part.slice(eq + 1).trim()
    try {
      return decodeURIComponent(value)
    } catch {
      return value
    }
  }
  return null
}

export function createMemorySessionFetch(options?: { secret?: string; humanGate?: boolean; host?: string }): FetchLike {
  const secret = options?.secret ?? 'memory-session-secret'
  const host = options?.host ?? 'sol.changuito.me'
  const humanGate = options?.humanGate === true
  const pending = new Map<string, Challenge>()
  const sessions = new Map<string, string>()

  return async (url, init) => {
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
      const payload = ['v1', claimedHost, claimedAddress, nonce, String(issued), String(expires)].join('\n')
      const expected = nonce ? await hmac(secret, payload) : ''
      const challenge = pending.get(nonce)
      const signature = base64ToBytes(signatureB64)
      const publicKey = decodeBase58(address)
      const signed =
        signature && publicKey
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
      const token = `memory.${address}.${nonce}`
      sessions.set(token, address)
      return jsonResponse(200, { ok: true, address }, `chg_user=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`)
    }

    if (method === 'GET' && path === '/api/session') {
      const token = readCookie(headers.get('cookie'), 'chg_user')
      const address = token ? sessions.get(token) ?? null : null
      return jsonResponse(200, { address })
    }

    if (method === 'POST' && path === '/api/session/logout') {
      const token = readCookie(headers.get('cookie'), 'chg_user')
      if (token) sessions.delete(token)
      return jsonResponse(200, { ok: true }, 'chg_user=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0')
    }

    return jsonResponse(404, { error: 'not_found' })
  }
}
