import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { appendUser, emptyTurn, parseEvents, postalCodeFromSnapshot, reduceEvent } from './protocol.ts'

describe('chat events', () => {
  it('keeps a split frame and ignores a heartbeat', () => {
    const first = parseEvents('data: {"t":"text","delta":"Ho')
    assert.equal(first.events.length, 0)
    assert.equal(first.rest.includes('Ho'), true)
    const second = parseEvents(`${first.rest}la"}\n\n:\n\n`)
    assert.equal(second.events.length, 1)
    assert.equal(second.events[0]?.t, 'text')
  })

  it('builds a transcript with products, a cart, and the snapshot', () => {
    let state = appendUser(emptyTurn(), 'desayuno')
    const raw = [
      'data: {"t":"status","stage":"received"}\n\n',
      'data: {"t":"text","delta":"Mirá"}\n\n',
      'data: {"t":"text","delta":" estas."}\n\n',
      'data: {"t":"products","items":[{"skuId":"1","productId":"p","name":"Café","price":{"centavos":100,"display":"$1"},"available":true}]}\n\n',
      'data: {"t":"cart","cart":{"retailer":"dia","cartId":"c","lines":[],"total":{"centavos":100,"display":"$1"},"messages":[]},"handoffUrl":"https://example.test/cart"}\n\n',
      'data: {"t":"done","stopReason":"end_turn","snapshot":{"location":{"postalCode":"C1425"}}}\n\n',
    ].join('')
    for (const event of parseEvents(raw).events) state = reduceEvent(state, event)
    assert.equal(state.items[0]?.kind, 'user')
    const assistant = state.items.find((item) => item.kind === 'assistant')
    assert.equal(assistant && assistant.kind === 'assistant' ? assistant.text : '', 'Mirá estas.')
    assert.equal(state.items.some((item) => item.kind === 'products'), true)
    assert.equal(state.items.some((item) => item.kind === 'cart'), true)
    assert.equal(postalCodeFromSnapshot(state.snapshot), 'C1425')
    assert.equal(state.status, null)
  })

  it('ignores a postal code that is not a code', () => {
    assert.equal(postalCodeFromSnapshot({ location: { postalCode: 'no' } }), null)
    assert.equal(postalCodeFromSnapshot(null), null)
  })
})
