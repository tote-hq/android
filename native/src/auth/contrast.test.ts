import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { contrastRatio } from './contrast.ts'
import { themeTextPairs, themes } from './theme.ts'

describe('theme contrast', () => {
  it('clears WCAG AA for text in light and dark', () => {
    for (const name of ['light', 'dark'] as const) {
      for (const pair of themeTextPairs(name)) {
        const ratio = contrastRatio(pair.fg, pair.bg)
        assert.ok(ratio >= 4.5, `${name} ${pair.name} is ${ratio.toFixed(2)}`)
      }
    }
  })

  it('keeps the brand background, text and accents', () => {
    assert.equal(themes.light.background, '#FAFAF7')
    assert.equal(themes.light.text, '#2A1A14')
    assert.equal(themes.light.gold, '#F4B942')
    assert.equal(themes.light.coral, '#E07A5F')
    assert.equal(themes.dark.gold, '#F4B942')
    assert.equal(themes.dark.coral, '#E07A5F')
  })
})
