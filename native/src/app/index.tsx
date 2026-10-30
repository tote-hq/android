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
        disconnect: () => wallet.disconnect(),
      }}
    />
  )
}
