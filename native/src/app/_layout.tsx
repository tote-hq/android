import { createSolanaDevnet, MobileWalletProvider, type AppIdentity } from '@wallet-ui/react-native-kit'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useColorScheme } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { APP_IDENTITY, AUTHORIZED_CHAIN } from '../auth/identity.ts'

const cluster = createSolanaDevnet()

if (cluster.id !== AUTHORIZED_CHAIN) {
  throw new Error(`This build authorizes ${AUTHORIZED_CHAIN} only.`)
}

const identity: AppIdentity = {
  name: APP_IDENTITY.name,
  uri: APP_IDENTITY.uri,
  icon: APP_IDENTITY.icon,
}

export default function Layout() {
  const scheme = useColorScheme()
  return (
    <SafeAreaProvider>
      <MobileWalletProvider cluster={cluster} identity={identity}>
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
        <Stack screenOptions={{ headerShown: false }} />
      </MobileWalletProvider>
    </SafeAreaProvider>
  )
}
