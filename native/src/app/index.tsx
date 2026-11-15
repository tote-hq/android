import { getBase64EncodedWireTransaction, getBase64Encoder, getTransactionDecoder } from '@solana/kit'
import { useMobileWallet } from '@wallet-ui/react-native-kit'

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
          const signed = await wallet.signMessages(new TextEncoder().encode(message))
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
