import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createDevWallet } from './dev-wallet.ts'
import { BLOCKED_APP_USER_AGENT, NATIVE_USER_AGENT, SESSION_TRANSPORT_HEADER } from './identity.ts'
import { createMemorySessionFetch } from './memory-session.ts'
import { messageForFailure } from './messages.ts'
import { SessionError, createSessionApi, nativeSessionHeaders, type FetchLike } from './session-client.ts'

const BASE = 'https://sol.changuito.me'

function spy(inner: FetchLike): { fetch: FetchLike; calls: { url: string; headers: Headers; body: string | undefined }[] } {
  const calls: { url: string; headers: Headers; body: string | undefined }[] = []
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({
        url,
        headers: new Headers(init?.headers),
        body: typeof init?.body === 'string' ? init.body : undefined,
      })
      return inner(url, init)
    },
  }
}

function headerNames(headers: Headers): string[] {
  return [...headers.keys()].map((name) => name.toLowerCase())
}

describe('native session headers', () => {
  it('names the app and does not look like a browser or a blocked agent', () => {
    assert.equal(NATIVE_USER_AGENT, 'ChanguitoSeeker/2.0.0')
    assert.equal(BLOCKED_APP_USER_AGENT.test(NATIVE_USER_AGENT), false)
    const headers = nativeSessionHeaders({ json: true, transport: true, token: null })
    assert.equal(headers.get('user-agent'), NATIVE_USER_AGENT)
    assert.equal(headers.get(SESSION_TRANSPORT_HEADER), 'bearer')
    assert.equal(headers.get('origin'), null)
    assert.equal(headers.get('sec-fetch-site'), null)
    assert.equal(headers.get('sec-fetch-mode'), null)
    assert.equal(headers.get('cookie'), null)
    assert.equal(headers.get('authorization'), null)
  })
})

describe('wallet sign-in', () => {
  it('asks for a bearer, stores it, and restores the address', async () => {
    const seen: string[] = []
    const traced = spy(createMemorySessionFetch())
    const api = createSessionApi({ baseUrl: BASE, fetch: traced.fetch })
    const wallet = await createDevWallet()
    const signed = await api.signIn({
      address: wallet.address,
      signMessage: async (message) => {
        seen.push(message)
        return wallet.signMessage(message)
      },
    })
    assert.equal(signed.address, wallet.address)
    assert.match(seen[0] ?? '', new RegExp(`^Changuito sign-in\\nHost: sol\\.changuito\\.me\\nAddress: ${wallet.address}\\n`))
    const token = api.token()
    assert.equal(typeof token, 'string')
    assert.match(token ?? '', /^v2\./)

    const login = traced.calls.find((call) => call.url.endsWith('/api/session/login'))
    assert.ok(login)
    assert.equal(login.headers.get(SESSION_TRANSPORT_HEADER), 'bearer')
    assert.equal(login.headers.get('user-agent'), NATIVE_USER_AGENT)
    assert.equal(login.headers.get('authorization'), null)
    for (const call of traced.calls) {
      const names = headerNames(call.headers)
      assert.equal(names.includes('origin'), false, call.url)
      assert.equal(names.some((name) => name.startsWith('sec-fetch-')), false, call.url)
      assert.equal(names.includes('cookie'), false, call.url)
    }
    const proof = JSON.parse(login.body ?? '{}') as { walletProof: { message: string; signature: string } }
    assert.equal(proof.walletProof.message, seen[0])
    assert.equal(proof.walletProof.signature.length > 0, true)

    assert.equal(await api.current(), wallet.address)
    const read = traced.calls.find((call) => call.url.endsWith('/api/session') && !call.url.includes('wallet'))
    assert.equal(read?.headers.get('authorization'), `Bearer ${token}`)

    await api.logout()
    assert.equal(api.token(), null)
    assert.equal(await api.current(), null)

    api.adopt(token)
    await assert.rejects(
      () => api.current(),
      (err: unknown) => err instanceof SessionError && err.code === 'session_closed',
    )
    assert.equal(api.token(), null)
    assert.match(messageForFailure(new SessionError('session_closed', 'session_closed'), 'es'), /venció/)
    assert.match(messageForFailure(new SessionError('session_closed', 'session_closed'), 'en'), /expired/i)
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
    assert.equal(api.token(), null)
  })

  it('refuses a signature that is not 64 bytes', async () => {
    const api = createSessionApi({ baseUrl: BASE, fetch: createMemorySessionFetch() })
    const wallet = await createDevWallet()
    await assert.rejects(
      () => api.signIn({ address: wallet.address, signMessage: async () => new Uint8Array(32) }),
      (err: unknown) => err instanceof SessionError && err.code === 'empty_signature',
    )
  })

  it('refuses to replay a proof after the nonce is spent', async () => {
    const fetchImpl = createMemorySessionFetch()
    const wallet = await createDevWallet()
    let proof: { address: string; message: string; signature: string } | null = null
    const spying: FetchLike = async (url, init) => {
      if (url.endsWith('/api/session/login') && typeof init?.body === 'string') {
        proof = (JSON.parse(init.body) as { walletProof: typeof proof }).walletProof
      }
      return fetchImpl(url, init)
    }
    const api = createSessionApi({ baseUrl: BASE, fetch: spying })
    await api.signIn({ address: wallet.address, signMessage: (message) => wallet.signMessage(message) })
    assert.ok(proof)
    const again = await fetchImpl(`${BASE}/api/session/login`, {
      method: 'POST',
      headers: nativeSessionHeaders({ json: true, transport: true, token: null }),
      body: JSON.stringify({ walletProof: proof }),
    })
    assert.equal(again.status, 401)
  })

  it('names a refusal and a rate limit', async () => {
    const wallet = await createDevWallet()
    const refused = createSessionApi({ baseUrl: BASE, fetch: createMemorySessionFetch({ humanGate: true }) })
    await assert.rejects(
      () => refused.signIn({ address: wallet.address, signMessage: (message) => wallet.signMessage(message) }),
      (err: unknown) => err instanceof SessionError && err.code === 'refused',
    )
    assert.match(messageForFailure(new SessionError('refused', 'refused'), 'en'), /refused/i)
    assert.match(messageForFailure(new SessionError('refused', 'refused'), 'es'), /rechazó/)

    const limited = createSessionApi({ baseUrl: BASE, fetch: createMemorySessionFetch({ rateLimit: true }) })
    await assert.rejects(
      () => limited.signIn({ address: wallet.address, signMessage: (message) => wallet.signMessage(message) }),
      (err: unknown) => err instanceof SessionError && err.code === 'rate_limited',
    )
    assert.match(messageForFailure(new SessionError('rate_limited', 'rate_limited'), 'es'), /minutos/)
    assert.match(messageForFailure(new SessionError('rate_limited', 'rate_limited'), 'en'), /minutes/)
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

  it('stops when the login omits the bearer', async () => {
    const inner = createMemorySessionFetch()
    const fetchImpl: FetchLike = async (url, init) => {
      const headers = new Headers(init?.headers)
      headers.set('origin', BASE)
      return inner(url, { ...init, headers })
    }
    const api = createSessionApi({ baseUrl: BASE, fetch: fetchImpl })
    const wallet = await createDevWallet()
    await assert.rejects(
      () => api.signIn({ address: wallet.address, signMessage: (message) => wallet.signMessage(message) }),
      (err: unknown) => err instanceof SessionError && err.code === 'token_missing',
    )
    assert.equal(api.token(), null)
  })
})
