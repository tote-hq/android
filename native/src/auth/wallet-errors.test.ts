import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { messageForFailure, sessionErrorFromUnknown } from './messages.ts'
import { classifyWalletFailure } from './wallet-errors.ts'

describe('phone account failures', () => {
  it('keeps a cancel, a missing account, a bad identity and a dropped connection apart', () => {
    assert.equal(classifyWalletFailure({ code: 'ERROR_ASSOCIATION_CANCELLED', message: 'cancelled' }), 'cancelled')
    assert.equal(classifyWalletFailure({ code: -1, message: 'authorization failed' }), 'cancelled')
    assert.equal(classifyWalletFailure({ code: -3, message: 'not signed' }), 'cancelled')
    assert.equal(classifyWalletFailure(new Error('user rejected the request')), 'cancelled')
    assert.equal(classifyWalletFailure({ code: 'ERROR_WALLET_NOT_FOUND' }), 'wallet_missing')
    assert.equal(classifyWalletFailure(new Error('PHONE_WALLET_MISSING')), 'wallet_missing')
    assert.equal(
      classifyWalletFailure({ code: -32602, message: 'When specified, identity.icon must be a relative URI' }),
      'invalid_identity',
    )
    assert.equal(classifyWalletFailure(new Error('Wallet connection timed out')), 'association_failed')
    assert.equal(classifyWalletFailure(new Error('socket hang up')), 'unknown')
  })

  it('says which failure it was, in Spanish and in English', () => {
    const cancelled = sessionErrorFromUnknown({ code: 'ERROR_ASSOCIATION_CANCELLED' })
    assert.match(messageForFailure(cancelled, 'es'), /Cancelaste/)
    assert.match(messageForFailure(cancelled, 'en'), /cancelled/i)
    assert.notEqual(messageForFailure(cancelled, 'es'), messageForFailure(cancelled, 'en'))

    const identity = sessionErrorFromUnknown({ code: -32602, message: 'identity.icon must be a relative URI' })
    assert.match(messageForFailure(identity, 'es'), /presentarse/)
    assert.doesNotMatch(messageForFailure(identity, 'es'), /icon|uri|mwa|privy/i)

    const missing = sessionErrorFromUnknown(new Error('wallet not found'))
    assert.match(messageForFailure(missing, 'en'), /this phone/)
  })
})
