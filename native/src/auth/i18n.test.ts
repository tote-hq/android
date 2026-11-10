import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { copy, deviceLanguage } from './i18n.ts'

describe('copy', () => {
  it('has the same keys in Spanish and English, and none are empty', () => {
    const esKeys = Object.keys(copy.es).sort()
    const enKeys = Object.keys(copy.en).sort()
    assert.deepEqual(esKeys, enKeys)
    for (const key of esKeys) {
      const typed = key as keyof typeof copy.es
      assert.ok(copy.es[typed].length > 0)
      assert.ok(copy.en[typed].length > 0)
    }
  })

  it('uses tú in Spanish, not voseo', () => {
    const forbidden = /\b(ingresá|confirmá|podés|abrila|probá|esperá|volvé|revisá|intentá|pedí|escribí|necesitás|contale|salí)\b/i
    for (const value of Object.values(copy.es)) {
      assert.doesNotMatch(value, forbidden, value)
    }
  })

  it('follows the device language and falls back to Spanish', () => {
    assert.equal(deviceLanguage('en'), 'en')
    assert.equal(deviceLanguage('es'), 'es')
    assert.equal(deviceLanguage('pt'), 'es')
    assert.equal(deviceLanguage(null), 'es')
  })
})
