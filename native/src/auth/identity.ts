/**
 * What the phone wallet shows on the authorize sheet, and the only chain
 * this build asks it to authorize.
 *
 * `icon` is a path relative to `uri` (no scheme, no leading slash). Mobile
 * Wallet Adapter treats anything else as an invalid identity and the Seeker
 * wallet rejects the authorize call.
 *
 * One chain, devnet. Listing mainnet beside it makes the phone offer the
 * Seeker ID account and then fail the session, which is the failure the
 * web shell hit.
 */
export const API_ORIGIN = 'https://sol.changuito.me'

export const AUTHORIZED_CHAIN = 'solana:devnet'

export const APP_IDENTITY = {
  name: 'Changuito',
  uri: API_ORIGIN,
  icon: 'icons/icon-512.png',
} as const

export const APP_VERSION = '2.0.0'

/** Sent on every session call. A browser page cannot use this name, and it is not on the site's crawler list. */
export const NATIVE_USER_AGENT = `ChanguitoSeeker/${APP_VERSION}`

/**
 * The site answers 403 to these agents even on the wallet routes.
 * Kept here so a future change of `NATIVE_USER_AGENT` cannot land on the list.
 */
export const BLOCKED_APP_USER_AGENT =
  /GPTBot|ChatGPT-User|Google-Extended|ClaudeBot|anthropic-ai|Anthropic|Bytespider|CCBot|Amazonbot|PerplexityBot|Diffbot|FacebookBot|meta-externalagent|cohere-ai|Cohere|Applebot-Extended|Omgilibot|Omgili|YouBot|ImagesiftBot|Ai2Bot|Timpibot|Webzio-Extended|PetalBot|Scrapy|python-requests|curl\/|wget\/|Go-http-client|aiohttp|httpx|node-fetch|axios\//i

export const SESSION_TRANSPORT_HEADER = 'x-chg-session-transport'

export function isRelativeIdentityIcon(icon: string): boolean {
  if (!icon || icon.includes(':') || icon.startsWith('/') || icon.startsWith('//')) return false
  return !icon.split('/').includes('..')
}
