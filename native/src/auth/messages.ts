import { copy, type CopyKey, type Lang } from './i18n.ts'
import { SessionError, type SessionErrorCode } from './session-client.ts'
import { classifyWalletFailure, type WalletFailureCode } from './wallet-errors.ts'

const SESSION_KEY: Record<SessionErrorCode, CopyKey> = {
  cancelled: 'errorCancelled',
  wallet_missing: 'errorMissing',
  invalid_identity: 'errorIdentity',
  association_failed: 'errorAssociation',
  refused: 'errorRefused',
  rate_limited: 'errorRate',
  session_closed: 'errorClosed',
  network: 'errorNetwork',
  proof_invalid: 'errorProof',
  unconfigured: 'errorUnconfigured',
  invalid_address: 'errorInvalidAddress',
  empty_signature: 'errorEmptySignature',
  token_missing: 'errorToken',
  unknown: 'errorUnknown',
}

const WALLET_KEY: Record<WalletFailureCode, CopyKey> = {
  cancelled: 'errorCancelled',
  wallet_missing: 'errorMissing',
  invalid_identity: 'errorIdentity',
  association_failed: 'errorAssociation',
  empty_signature: 'errorEmptySignature',
  unknown: 'errorUnknown',
}

export function sessionErrorFromUnknown(err: unknown): SessionError {
  if (err instanceof SessionError) return err
  const code = classifyWalletFailure(err)
  const mapped: SessionErrorCode =
    code === 'cancelled'
      ? 'cancelled'
      : code === 'wallet_missing'
        ? 'wallet_missing'
        : code === 'invalid_identity'
          ? 'invalid_identity'
          : code === 'association_failed'
            ? 'association_failed'
            : code === 'empty_signature'
              ? 'empty_signature'
              : 'unknown'
  return new SessionError(mapped, err instanceof Error ? err.message : 'sign_failed')
}

export function messageForFailure(err: unknown, lang: Lang): string {
  if (err instanceof SessionError) return copy[lang][SESSION_KEY[err.code]]
  return copy[lang][WALLET_KEY[classifyWalletFailure(err)]]
}
