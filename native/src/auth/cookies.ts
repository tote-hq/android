export type CookieJar = Map<string, string>

type HeaderReader = {
  get(name: string): string | null
  getSetCookie?: () => string[]
}

/** Set-Cookie lines from a fetch response. Combines the single-header and the list form. */
export function readSetCookieLines(headers: HeaderReader): string[] {
  if (typeof headers.getSetCookie === 'function') {
    const lines = headers.getSetCookie()
    if (lines.length > 0) return lines
  }
  const single = headers.get('set-cookie')
  if (!single) return []
  return splitCombinedSetCookie(single)
}

/**
 * One Set-Cookie header can carry several cookies. The comma inside `Expires`
 * is not a separator; a new cookie starts at a comma followed by a `name=`.
 */
export function splitCombinedSetCookie(header: string): string[] {
  return header
    .split(/,(?=\s*[^;,\s]+=)/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

export function storeSetCookies(jar: CookieJar, lines: string[]): void {
  for (const line of lines) {
    const pair = line.split(';')[0]?.trim() ?? ''
    const eq = pair.indexOf('=')
    if (eq <= 0) continue
    const name = pair.slice(0, eq).trim()
    const rawValue = pair.slice(eq + 1).trim()
    const expired = /(?:^|;\s*)max-age\s*=\s*0(?:\s|;|$)/i.test(line) || rawValue.length === 0
    if (!name) continue
    if (expired) {
      jar.delete(name)
      continue
    }
    try {
      jar.set(name, decodeURIComponent(rawValue))
    } catch {
      jar.set(name, rawValue)
    }
  }
}

export function cookieRequestHeader(jar: CookieJar): string {
  return [...jar.entries()]
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join('; ')
}

export function serializeJar(jar: CookieJar): string {
  return JSON.stringify([...jar.entries()])
}

export function deserializeJar(raw: string | null): CookieJar {
  const jar: CookieJar = new Map()
  if (!raw) return jar
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return jar
    for (const entry of parsed) {
      if (!Array.isArray(entry) || entry.length !== 2) continue
      const [name, value] = entry
      if (typeof name === 'string' && name && typeof value === 'string') jar.set(name, value)
    }
  } catch {
    return jar
  }
  return jar
}
