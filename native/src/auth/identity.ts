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

export const USER_COOKIE = 'chg_user'

export const APP_VERSION = '2.0.0'

export const NATIVE_USER_AGENT = `Changuito/${APP_VERSION} (Android; native)`

export function isRelativeIdentityIcon(icon: string): boolean {
  if (!icon || icon.includes(':') || icon.startsWith('/') || icon.startsWith('//')) return false
  return !icon.split('/').includes('..')
}
