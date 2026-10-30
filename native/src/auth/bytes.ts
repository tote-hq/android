export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i] ?? 0)
  if (typeof globalThis.btoa === 'function') return globalThis.btoa(binary)
  return Buffer.from(bytes).toString('base64')
}

export function base64ToBytes(value: string): Uint8Array | null {
  try {
    const binary = typeof globalThis.atob === 'function' ? globalThis.atob(value) : Buffer.from(value, 'base64').toString('binary')
    const out = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
    return out
  } catch {
    return null
  }
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}
