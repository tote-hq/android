import { ed25519 } from '@noble/curves/ed25519.js'

import { decodeBase58 } from './base58.ts'
import { base64ToBytes } from './bytes.ts'

const SIGNATURE_BYTES = 64

/**
 * `sign_messages` does not return a detached signature. The Mobile Wallet
 * Adapter spec appends the 64-byte Ed25519 signature to the message that was
 * signed (`message || signature`). The JS clients hand that payload back as
 * bytes or as base64, and a wallet that already detached the signature hands
 * back 64 bytes. Either shape is accepted. Anything else is not a signature
 * this login can send.
 */
export function extractEd25519Signature(message: string, payload: unknown): Uint8Array | null {
  const bytes = payloadBytes(payload)
  if (!bytes) return null
  if (bytes.length === SIGNATURE_BYTES) return copyBytes(bytes)
  const messageBytes = new TextEncoder().encode(message)
  if (bytes.length > SIGNATURE_BYTES && startsWith(bytes, messageBytes)) {
    return copyBytes(bytes.subarray(bytes.length - SIGNATURE_BYTES))
  }
  return null
}

/** True only when `signature` is an Ed25519 signature of `message` by `address`. */
export function verifyEd25519Signature(address: string, message: string, signature: Uint8Array): boolean {
  if (signature.length !== SIGNATURE_BYTES) return false
  const publicKey = decodeBase58(address)
  if (!publicKey || publicKey.length !== 32) return false
  try {
    return ed25519.verify(signature, new TextEncoder().encode(message), publicKey)
  } catch {
    return false
  }
}

function copyBytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes)
}

function startsWith(bytes: Uint8Array, prefix: Uint8Array): boolean {
  if (prefix.length > bytes.length) return false
  for (let i = 0; i < prefix.length; i++) {
    if (bytes[i] !== prefix[i]) return false
  }
  return true
}

function isByte(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 255
}

function bytesFromList(value: readonly unknown[]): Uint8Array | null {
  if (value.length === 0) return null
  const out = new Uint8Array(value.length)
  for (let i = 0; i < value.length; i++) {
    const item = value[i]
    if (!isByte(item)) return null
    out[i] = item
  }
  return out
}

/** Standard base64 and the unpadded base64url form some MWA clients emit. */
function decodeTransport(value: string): Uint8Array | null {
  const trimmed = value.trim()
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(trimmed)) return null
  const normalized = trimmed.replace(/-/g, '+').replace(/_/g, '/')
  const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4))
  return base64ToBytes(normalized + pad)
}

function payloadBytes(value: unknown, depth = 0): Uint8Array | null {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  if (typeof value === 'string') return decodeTransport(value)
  if (!Array.isArray(value)) return null
  const listed = bytesFromList(value)
  if (listed) return listed
  if (depth < 1 && value.length === 1) return payloadBytes(value[0], depth + 1)
  return null
}
