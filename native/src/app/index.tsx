import { getBase64EncodedWireTransaction, getBase64Encoder, getTransactionDecoder } from '@solana/kit'
import { transact, useMobileWallet } from '@wallet-ui/react-native-kit'

import { APP_IDENTITY, AUTHORIZED_CHAIN } from '../auth/identity.ts'
import { HomeScreen } from '../ui/home-screen.tsx'

export default function Index() {
  const wallet = useMobileWallet()
  return (
    <HomeScreen
      wallet={{
        connect: async () => {
          const account = await wallet.connect()
          return { address: account.address.toString(), label: account.label ?? null }
        },
        signMessage: async (message) => {
          // Read the token at call time. The hook still holds the value from
          // the render that started sign-in, which is before connect() stored
          // this authorization. A fresh authorize would be a different account
          // on wallets that mint one per session, and the challenge would not match.
          const authToken = wallet.store.$authToken.get()
          const signed = await transact(async (session) => {
            const authorized = await session.authorize({
              ...(authToken ? { auth_token: authToken } : {}),
              chain: AUTHORIZED_CHAIN,
              identity: APP_IDENTITY,
            })
            const address = authorized.accounts[0]?.address
            if (!address) throw new Error('The account did not return an address.')
            const payloads = await session.signMessages({
              addresses: [address],
              payloads: [new TextEncoder().encode(message)],
            })
            const first = payloads[0]
            if (!first) throw new Error('The account did not return a signature.')
            return first
          })
          return signed
        },
        signTransaction: async (txBase64) => {
          const tx = getTransactionDecoder().decode(getBase64Encoder().encode(txBase64))
          const signed = await wallet.signTransactions(tx)
          return getBase64EncodedWireTransaction(signed)
        },
        disconnect: () => wallet.disconnect(),
      }}
    />
  )
}
