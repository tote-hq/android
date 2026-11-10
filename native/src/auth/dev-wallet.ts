import { encodeBase58 } from './base58.ts'

const TEXT = new TextEncoder()

function bufferSource(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

/**
 * A devnet-shaped keypair that lives in this process. Release builds never
 * construct one. It exists so sign-in can be exercised without a phone wallet.
 */
export async function createDevWallet(): Promise<{
  address: string
  signMessage: (message: string) => Promise<Uint8Array>
}> {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign'])
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey))
  const raw = spki.slice(-32)
  if (raw.length !== 32) throw new Error('ed25519 public key was not 32 bytes')
  return {
    address: encodeBase58(raw),
    async signMessage(message: string) {
      const signature = await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, bufferSource(TEXT.encode(message)))
      return new Uint8Array(signature)
    },
  }
}
