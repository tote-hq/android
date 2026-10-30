import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createDevWallet } from './dev-wallet.ts'
import { createMemorySessionFetch } from './memory-session.ts'
import { USER_COOKIE } from './identity.ts'
import { SessionError, createSessionApi } from './session-client.ts'

const BASE = 'https://sol.changuito.me'

describe('wallet sign-in', () => {
  it('signs the server message and replays the session cookie', async () => {
    const fetchImpl = createMemorySessionFetch()
    const seen: string[] = []
    const api = createSessionApi({ baseUrl: BASE, fetch: fetchImpl })
    const wallet = await createDevWallet()
    const signed = await api.signIn({
      address: wallet.address,
      signMessage: async (message) => {
        seen.push(message)
        return wallet.signMessage(message)
      },
    })
    assert.equal(signed.address, wallet.address)
    assert.equal(seen.length, 1)
    assert.match(seen[0] ?? '', new RegExp(`^Changuito sign-in\\nHost: sol\\.changuito\\.me\\nAddress: ${wallet.address}\\n`))
    assert.equal(api.jar.has(USER_COOKIE), true)
    assert.equal(await api.current(), wallet.address)

    await api.logout()
    assert.equal(api.jar.has(USER_COOKIE), false)
    assert.equal(await api.current(), null)
  })

  it('rejects a signature that does not match the message', async () => {
    const api = createSessionApi({ baseUrl: BASE, fetch: createMemorySessionFetch() })
    const wallet = await createDevWallet()
    await assert.rejects(
      () =>
        api.signIn({
          address: wallet.address,
          signMessage: async (message) => {
            const signature = await wallet.signMessage(message)
            signature[0] = (signature[0] ?? 0) ^ 0xff
            return signature
          },
        }),
      (err: unknown) => err instanceof SessionError && err.code === 'proof_invalid',
    )
  })

  it('refuses to replay a proof after the nonce is spent', async () => {
    const fetchImpl = createMemorySessionFetch()
    const wallet = await createDevWallet()
    let proof: { address: string; message: string; signature: string } | null = null
    const original = fetchImpl
    const spying: typeof fetchImpl = async (url, init) => {
      if (url.endsWith('/api/session/login') && typeof init?.body === 'string') {
        proof = (JSON.parse(init.body) as { walletProof: typeof proof }).walletProof
      }
      return original(url, init)
    }
    const spy = createSessionApi({ baseUrl: BASE, fetch: spying })
    await spy.signIn({ address: wallet.address, signMessage: (message) => wallet.signMessage(message) })
    assert.ok(proof)
    const again = await fetchImpl(`${BASE}/api/session/login`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ walletProof: proof }),
    })
    assert.equal(again.status, 401)
  })

  it('names the human check when the gate refuses the call', async () => {
    const api = createSessionApi({
      baseUrl: BASE,
      fetch: createMemorySessionFetch({ humanGate: true }),
    })
    const wallet = await createDevWallet()
    await assert.rejects(
      () => api.signIn({ address: wallet.address, signMessage: (message) => wallet.signMessage(message) }),
      (err: unknown) => err instanceof SessionError && err.code === 'human_required',
    )
  })

  it('rejects an address the server would not accept', async () => {
    const api = createSessionApi({ baseUrl: BASE, fetch: createMemorySessionFetch() })
    await assert.rejects(
      () => api.signIn({ address: 'not-an-address', signMessage: async () => new Uint8Array(64) }),
      (err: unknown) => err instanceof SessionError && err.code === 'invalid_address',
    )
  })

  it('reports a network failure without calling it a bad signature', async () => {
    const api = createSessionApi({
      baseUrl: BASE,
      fetch: async () => {
        throw new TypeError('network down')
      },
    })
    const wallet = await createDevWallet()
    await assert.rejects(
      () => api.signIn({ address: wallet.address, signMessage: (message) => wallet.signMessage(message) }),
      (err: unknown) => err instanceof SessionError && err.code === 'network',
    )
  })

  it('accepts a session token in the body when Set-Cookie is hidden', async () => {
    const inner = createMemorySessionFetch()
    const fetchImpl: typeof inner = async (url, init) => {
      const response = await inner(url, init)
      if (!url.endsWith('/api/session/login')) return response
      const body = (await response.json()) as { address: string }
      return new Response(JSON.stringify({ ...body, sessionToken: 'body-token' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    const api = createSessionApi({ baseUrl: BASE, fetch: fetchImpl })
    const wallet = await createDevWallet()
    await api.signIn({ address: wallet.address, signMessage: (message) => wallet.signMessage(message) })
    assert.equal(api.jar.get(USER_COOKIE), 'body-token')
  })

  it('stops when neither a cookie nor a later session read confirms the login', async () => {
    const fetchImpl = async (url: string) => {
      if (url.endsWith('/api/session/wallet-challenge')) {
        return new Response(JSON.stringify({ message: 'Changuito sign-in\nonly-a-test' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      if (url.endsWith('/api/session/login')) {
        return new Response(JSON.stringify({ ok: true, address: 'ignored' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ address: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    const api = createSessionApi({ baseUrl: BASE, fetch: fetchImpl })
    const wallet = await createDevWallet()
    await assert.rejects(
      () => api.signIn({ address: wallet.address, signMessage: async () => new Uint8Array([1]) }),
      (err: unknown) => err instanceof SessionError && (err.code === 'proof_invalid' || err.code === 'cookie_missing'),
    )
  })
})
