import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ed25519 } from '@noble/curves/ed25519.js'

import { encodeBase58 } from './base58.ts'
import { bytesToBase64, bytesToBase64Url } from './bytes.ts'
import { createDevWallet } from './dev-wallet.ts'
import { createMemorySessionFetch } from './memory-session.ts'
import { SessionError, createSessionApi, type FetchLike } from './session-client.ts'
import { extractEd25519Signature, verifyEd25519Signature } from './signed-payload.ts'

const TEXT = new TextEncoder()
const BASE = 'https://sol.changuito.me'
const MESSAGE = 'Changuito sign-in\nHost: sol.changuito.me\nAddress: café'

function concat(left: Uint8Array, right: Uint8Array): Uint8Array {
  const out = new Uint8Array(left.length + right.length)
  out.set(left, 0)
  out.set(right, left.length)
  return out
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false
  for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return false
  return true
}

function keypair(): { address: string; secretKey: Uint8Array; publicKey: Uint8Array } {
  const { secretKey, publicKey } = ed25519.keygen()
  return { address: encodeBase58(publicKey), secretKey, publicKey }
}

describe('signed message payloads', () => {
  it('keeps a raw 64-byte signature and checks it before login', async () => {
    const { address, secretKey, publicKey } = keypair()
    const messageBytes = TEXT.encode(MESSAGE)
    const signature = ed25519.sign(messageBytes, secretKey)
    assert.equal(signature.length, 64)

    const extracted = extractEd25519Signature(MESSAGE, signature)
    assert.ok(extracted)
    assert.equal(sameBytes(extracted, signature), true)
    assert.equal(ed25519.verify(extracted, messageBytes, publicKey), true)
    assert.equal(verifyEd25519Signature(address, MESSAGE, extracted), true)

    const asBase64 = extractEd25519Signature(MESSAGE, bytesToBase64(signature))
    assert.ok(asBase64)
    assert.equal(ed25519.verify(asBase64, messageBytes, publicKey), true)

    const asList = extractEd25519Signature(MESSAGE, [signature])
    assert.ok(asList)
    assert.equal(sameBytes(asList, signature), true)

    const wallet = await createDevWallet()
    let loginBody: string | undefined
    const inner = createMemorySessionFetch()
    const fetchImpl: FetchLike = async (url, init) => {
      if (url.endsWith('/api/session/login') && typeof init?.body === 'string') loginBody = init.body
      return inner(url, init)
    }
    const api = createSessionApi({ baseUrl: BASE, fetch: fetchImpl })
    const signed = await api.signIn({
      address: wallet.address,
      signMessage: (message) => wallet.signMessage(message),
    })
    assert.equal(signed.address, wallet.address)
    const proof = JSON.parse(loginBody ?? '{}') as { walletProof: { signature: string; message: string } }
    const posted = extractEd25519Signature(proof.walletProof.message, proof.walletProof.signature)
    assert.ok(posted)
    assert.equal(posted.length, 64)
    assert.equal(verifyEd25519Signature(wallet.address, proof.walletProof.message, posted), true)
  })

  it('takes the trailing 64 bytes of a message || signature payload', async () => {
    const { address, secretKey, publicKey } = keypair()
    const messageBytes = TEXT.encode(MESSAGE)
    const signature = ed25519.sign(messageBytes, secretKey)
    const payload = concat(messageBytes, signature)
    assert.equal(payload.length, messageBytes.length + 64)

    const extracted = extractEd25519Signature(MESSAGE, payload)
    assert.ok(extracted)
    assert.equal(extracted.length, 64)
    assert.equal(sameBytes(extracted, signature), true)
    assert.equal(ed25519.verify(extracted, messageBytes, publicKey), true)
    assert.equal(verifyEd25519Signature(address, MESSAGE, extracted), true)

    const fromBase64 = extractEd25519Signature(MESSAGE, bytesToBase64(payload))
    const fromBase64Url = extractEd25519Signature(MESSAGE, bytesToBase64Url(payload))
    assert.ok(fromBase64 && fromBase64Url)
    assert.equal(sameBytes(fromBase64, signature), true)
    assert.equal(sameBytes(fromBase64Url, signature), true)

    const wallet = await createDevWallet()
    let loginBody: string | undefined
    const inner = createMemorySessionFetch()
    const fetchImpl: FetchLike = async (url, init) => {
      if (url.endsWith('/api/session/login') && typeof init?.body === 'string') loginBody = init.body
      return inner(url, init)
    }
    const api = createSessionApi({ baseUrl: BASE, fetch: fetchImpl })
    const signed = await api.signIn({
      address: wallet.address,
      signMessage: async (message) => {
        const detached = await wallet.signMessage(message)
        return bytesToBase64(concat(TEXT.encode(message), detached))
      },
    })
    assert.equal(signed.address, wallet.address)
    const body = JSON.parse(loginBody ?? '{}') as { walletProof: { message: string; signature: string } }
    const posted = extractEd25519Signature(body.walletProof.message, body.walletProof.signature)
    assert.ok(posted)
    assert.equal(posted.length, 64)
    assert.equal(body.walletProof.message.startsWith('Changuito sign-in\n'), true)
    assert.equal(verifyEd25519Signature(wallet.address, body.walletProof.message, posted), true)
  })

  it('rejects a payload that is neither a signature nor the signed message', async () => {
    const messageBytes = TEXT.encode(MESSAGE)
    const { secretKey } = keypair()
    const signature = ed25519.sign(messageBytes, secretKey)
    const shifted = concat(messageBytes, signature)
    shifted[0] = (shifted[0] ?? 0) ^ 0xff
    assert.equal(extractEd25519Signature(MESSAGE, shifted), null)
    assert.equal(extractEd25519Signature(MESSAGE, new Uint8Array(32)), null)
    assert.equal(extractEd25519Signature(MESSAGE, new Uint8Array(messageBytes.length + 32)), null)
    assert.equal(extractEd25519Signature(MESSAGE, 'not a signature'), null)
    assert.equal(extractEd25519Signature(MESSAGE, ''), null)

    const wallet = await createDevWallet()
    let loginCalled = false
    const inner = createMemorySessionFetch()
    const fetchImpl: FetchLike = async (url, init) => {
      if (url.endsWith('/api/session/login')) loginCalled = true
      return inner(url, init)
    }
    const api = createSessionApi({ baseUrl: BASE, fetch: fetchImpl })
    await assert.rejects(
      () => api.signIn({ address: wallet.address, signMessage: async () => new Uint8Array(96) }),
      (err: unknown) => err instanceof SessionError && err.code === 'empty_signature',
    )
    assert.equal(loginCalled, false)
    assert.equal(api.token(), null)
  })
})
