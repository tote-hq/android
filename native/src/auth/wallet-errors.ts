/**
 * Phone-wallet failures, named before they reach the screen.
 *
 * The web client folds every unrecognized failure into one sentence. A
 * cancelled sheet, a missing account, and a rejected identity then look
 * the same. These codes stay separate so the screen can say which one happened.
 */

export type WalletFailureCode =
  | 'cancelled'
  | 'wallet_missing'
  | 'invalid_identity'
  | 'association_failed'
  | 'empty_signature'
  | 'unknown'

const CANCEL_CODES = new Set([
  'ERROR_ASSOCIATION_CANCELLED',
  'ERROR_AUTHORIZATION_FAILED',
  'ERROR_SIGN_MESSAGE_REQUESTS_FAILED',
  '-1',
  '-3',
])

function errorCode(err: unknown): string | null {
  if (!err || typeof err !== 'object' || !('code' in err)) return null
  const code = (err as { code?: unknown }).code
  if (typeof code === 'string' && code) return code
  if (typeof code === 'number' && Number.isFinite(code)) return String(code)
  return null
}

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  return ''
}

export function classifyWalletFailure(err: unknown): WalletFailureCode {
  const code = errorCode(err)
  const text = errorText(err)
  if (code === 'ERROR_WALLET_NOT_FOUND' || /PHONE_WALLET_MISSING|wallet not found|no wallet/i.test(text)) {
    return 'wallet_missing'
  }
  if (code === '-32602' || /identity\.icon|relative uri|invalid identity/i.test(text)) {
    return 'invalid_identity'
  }
  if (
    (code && CANCEL_CODES.has(code)) ||
    /associat\w* cancell?ed|authorization failed|not signed|user rejected|request rejected|declin|cancell?ed by user/i.test(
      text,
    )
  ) {
    return 'cancelled'
  }
  if (/timed out|timeout|connection refused|ERR_CONNECTION|association/i.test(text)) {
    return 'association_failed'
  }
  if (/empty signature/i.test(text)) return 'empty_signature'
  return 'unknown'
}
