import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import { APP_IDENTITY, AUTHORIZED_CHAIN, isRelativeIdentityIcon } from './identity.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

function filesUnder(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'android' || name === 'ios') continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...filesUnder(path))
    else if (!path.endsWith('.test.ts')) out.push(path)
  }
  return out
}

describe('wallet identity', () => {
  it('authorizes devnet only and sends a relative icon', () => {
    assert.equal(AUTHORIZED_CHAIN, 'solana:devnet')
    assert.equal(isRelativeIdentityIcon(APP_IDENTITY.icon), true)
    assert.equal(APP_IDENTITY.uri, 'https://sol.changuito.me')
    assert.equal(APP_IDENTITY.name, 'Changuito')
    assert.equal(isRelativeIdentityIcon('/icons/icon-512.png'), false)
    assert.equal(isRelativeIdentityIcon('https://sol.changuito.me/icons/icon-512.png'), false)
  })

  it('does not mention Privy or carry a key', () => {
    const scanned = filesUnder(join(root, 'src'))
      .concat(filesUnder(join(root, 'plugins')))
      .concat([join(root, 'package.json'), join(root, 'app.json'), join(root, 'eas.json'), join(root, 'README.md')])
    for (const path of scanned) {
      const text = readFileSync(path, 'utf8')
      assert.equal(/privy/i.test(text), false, path)
      assert.equal(/BEGIN [A-Z ]*PRIVATE KEY/.test(text), false, path)
      assert.equal(/\.keystore/.test(text) && !path.endsWith('README.md') && !path.endsWith('.gitignore'), false, path)
    }
  })
})
