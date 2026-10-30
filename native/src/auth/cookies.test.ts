import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  cookieRequestHeader,
  deserializeJar,
  readSetCookieLines,
  serializeJar,
  splitCombinedSetCookie,
  storeSetCookies,
} from './cookies.ts'

describe('set-cookie parsing', () => {
  it('keeps an Expires comma inside one cookie and splits the next cookie', () => {
    const lines = splitCombinedSetCookie(
      'chg_user=abc; Expires=Thu, 01 Jan 2026 00:00:00 GMT; Path=/, chg_human=xyz; Path=/',
    )
    assert.deepEqual(lines, [
      'chg_user=abc; Expires=Thu, 01 Jan 2026 00:00:00 GMT; Path=/',
      'chg_human=xyz; Path=/',
    ])
  })

  it('stores the decoded value and drops a cleared cookie', () => {
    const jar = new Map<string, string>()
    storeSetCookies(jar, [
      'chg_user=hello%20there; Path=/; HttpOnly; SameSite=Lax; Max-Age=100',
      'chg_human=keep; Path=/',
    ])
    assert.equal(jar.get('chg_user'), 'hello there')
    assert.equal(jar.get('chg_human'), 'keep')
    storeSetCookies(jar, ['chg_user=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'])
    assert.equal(jar.has('chg_user'), false)
    assert.equal(jar.has('chg_human'), true)
    assert.equal(cookieRequestHeader(jar), 'chg_human=keep')
  })

  it('reads the list form of Set-Cookie when the runtime provides it', () => {
    const lines = readSetCookieLines({
      get: () => null,
      getSetCookie: () => ['chg_user=one; Path=/'],
    })
    assert.deepEqual(lines, ['chg_user=one; Path=/'])
  })

  it('round-trips the jar through JSON', () => {
    const jar = new Map([
      ['chg_user', 'a.b'],
      ['chg_human', 'c'],
    ])
    const back = deserializeJar(serializeJar(jar))
    assert.equal(back.get('chg_user'), 'a.b')
    assert.equal(back.get('chg_human'), 'c')
    assert.equal(deserializeJar('not-json').size, 0)
    assert.equal(deserializeJar(null).size, 0)
  })
})
