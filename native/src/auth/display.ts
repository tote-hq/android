const SKR_NAME = /^[a-z0-9][a-z0-9-]{0,30}\.skr$/i

export function shortenAddress(address: string): string {
  if (address.length <= 11) return address
  return `${address.slice(0, 4)}…${address.slice(-4)}`
}

/**
 * The title is a .skr name when the wallet label is one. Anything else
 * (including the "Seeker ID" card title) stays off the title; the shopper
 * sees the shortened address.
 */
export function walletTitle(address: string, label?: string | null): { title: string; detail: string } {
  const short = shortenAddress(address)
  const trimmed = label?.trim() ?? ''
  if (trimmed && SKR_NAME.test(trimmed)) {
    return { title: trimmed, detail: short }
  }
  return { title: short, detail: '' }
}
