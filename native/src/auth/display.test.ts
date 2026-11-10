import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { shortenAddress, walletTitle } from './display.ts'

const ADDRESS = '9rYNk7tG2sVw8eQh4c1uJm5pLx3aBd6fH2kN7sCtdMM1'

describe('account title', () => {
  it('shortens a long address and keeps a short one whole', () => {
    assert.equal(shortenAddress(ADDRESS), '9rYN…dMM1')
    assert.equal(shortenAddress('short'), 'short')
  })

  it('uses a .skr label and ignores the Seeker ID card title', () => {
    assert.deepEqual(walletTitle(ADDRESS, 'mama.skr'), { title: 'mama.skr', detail: '9rYN…dMM1' })
    assert.deepEqual(walletTitle(ADDRESS, 'Seeker ID'), { title: '9rYN…dMM1', detail: '' })
    assert.deepEqual(walletTitle(ADDRESS, null), { title: '9rYN…dMM1', detail: '' })
    assert.deepEqual(walletTitle(ADDRESS, 'not a name'), { title: '9rYN…dMM1', detail: '' })
  })
})
