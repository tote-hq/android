import { getLocales } from 'expo-localization'
import * as SecureStore from 'expo-secure-store'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useColorScheme,
  View,
  type PressableProps,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { createDevWallet } from '../auth/dev-wallet.ts'
import { deserializeJar, serializeJar, type CookieJar } from '../auth/cookies.ts'
import { walletTitle } from '../auth/display.ts'
import { copy, deviceLanguage, type Lang } from '../auth/i18n.ts'
import { API_ORIGIN, USER_COOKIE } from '../auth/identity.ts'
import { createMemorySessionFetch } from '../auth/memory-session.ts'
import { messageForFailure, sessionErrorFromUnknown } from '../auth/messages.ts'
import { createSessionApi, SessionError, type SessionApi } from '../auth/session-client.ts'
import { themes, type ThemeName } from '../auth/theme.ts'

const COOKIE_KEY = 'changuito.session.cookies'
const LANG_KEY = 'changuito.lang'
const THEME_KEY = 'changuito.theme'
const MIN_TOUCH = 48

type Phase = 'connecting' | 'challenge' | 'signing' | 'finishing' | 'out' | null

type PhoneAccount = { address: string; label?: string | null }

type PhoneWallet = {
  connect: () => Promise<PhoneAccount>
  signMessage: (message: string) => Promise<Uint8Array>
  disconnect: () => Promise<void>
}

function mockWalletEnabled(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__ === true && process.env.EXPO_PUBLIC_MOCK_WALLET === '1'
}

async function readPreference<T extends string>(key: string, allowed: readonly T[]): Promise<T | null> {
  try {
    const value = await SecureStore.getItemAsync(key)
    return allowed.find((item) => item === value) ?? null
  } catch {
    return null
  }
}

async function writePreference(key: string, value: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(key, value)
  } catch {
    /* the choice still applies for this visit */
  }
}

export function HomeScreen({ wallet }: { wallet: PhoneWallet }) {
  const insets = useSafeAreaInsets()
  const system = useColorScheme()
  const mock = mockWalletEnabled()
  const [lang, setLang] = useState<Lang>(deviceLanguage(getLocales()[0]?.languageCode))
  const [themeChoice, setThemeChoice] = useState<'system' | ThemeName>('system')
  const [ready, setReady] = useState(false)
  const [address, setAddress] = useState<string | null>(null)
  const [label, setLabel] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>(null)
  const [error, setError] = useState<string | null>(null)
  const devWalletRef = useRef<Awaited<ReturnType<typeof createDevWallet>> | null>(null)

  const themeName: ThemeName = themeChoice === 'system' ? (system === 'dark' ? 'dark' : 'light') : themeChoice
  const colors = themes[themeName]
  const text = copy[lang]
  const busy = phase !== null

  const session = useMemo<SessionApi>(() => {
    const baseUrl = process.env.EXPO_PUBLIC_SESSION_BASE_URL || API_ORIGIN
    return createSessionApi({
      baseUrl,
      fetch: mock ? createMemorySessionFetch() : undefined,
    })
  }, [mock])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [storedLang, storedTheme, storedCookies] = await Promise.all([
        readPreference(LANG_KEY, ['es', 'en'] as const),
        readPreference(THEME_KEY, ['light', 'dark'] as const),
        SecureStore.getItemAsync(COOKIE_KEY).catch(() => null),
      ])
      if (cancelled) return
      if (storedLang) setLang(storedLang)
      if (storedTheme) setThemeChoice(storedTheme)
      const jar: CookieJar = deserializeJar(storedCookies)
      for (const [name, value] of jar) session.jar.set(name, value)
      try {
        const who = session.jar.has(USER_COOKIE) ? await session.current() : null
        if (!cancelled) setAddress(who)
      } catch {
        if (!cancelled) setAddress(null)
      } finally {
        if (!cancelled) setReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [session])

  async function persistJar(): Promise<void> {
    try {
      await SecureStore.setItemAsync(COOKIE_KEY, serializeJar(session.jar))
    } catch {
      /* the cookie still lives in memory for this visit */
    }
  }

  async function onSignIn(): Promise<void> {
    if (busy) return
    setError(null)
    setPhase('connecting')
    try {
      const account = mock ? await connectMock() : await wallet.connect()
      setPhase('challenge')
      const signed = await session.signIn({
        address: account.address,
        signMessage: async (message) => {
          setPhase('signing')
          try {
            return mock ? await connectMockSigner(message) : await wallet.signMessage(message)
          } catch (err) {
            throw sessionErrorFromUnknown(err)
          }
        },
      })
      setPhase('finishing')
      await persistJar()
      setLabel(account.label ?? null)
      setAddress(signed.address)
    } catch (err) {
      setError(messageForFailure(sessionErrorFromUnknown(err), lang))
      if (!mock) await wallet.disconnect().catch(() => undefined)
    } finally {
      setPhase(null)
    }
  }

  async function devAccount(): Promise<NonNullable<(typeof devWalletRef)['current']>> {
    if (!devWalletRef.current) devWalletRef.current = await createDevWallet()
    return devWalletRef.current
  }

  async function connectMock(): Promise<PhoneAccount> {
    const created = await devAccount()
    return { address: created.address, label: 'dev.skr' }
  }

  async function connectMockSigner(message: string): Promise<Uint8Array> {
    const created = await devAccount()
    return created.signMessage(message)
  }

  async function onSignOut(): Promise<void> {
    if (busy) return
    setPhase('out')
    setError(null)
    try {
      await session.logout()
    } catch (err) {
      if (!(err instanceof SessionError)) setError(messageForFailure(sessionErrorFromUnknown(err), lang))
    } finally {
      session.jar.clear()
      await persistJar()
      if (!mock) await wallet.disconnect().catch(() => undefined)
      setAddress(null)
      setLabel(null)
      setPhase(null)
    }
  }

  function toggleLanguage(): void {
    const next: Lang = lang === 'es' ? 'en' : 'es'
    setLang(next)
    void writePreference(LANG_KEY, next)
  }

  function toggleTheme(): void {
    const next: ThemeName = themeName === 'dark' ? 'light' : 'dark'
    setThemeChoice(next)
    void writePreference(THEME_KEY, next)
  }

  const shown = address ? walletTitle(address, label) : null
  const status =
    phase === 'connecting'
      ? text.statusConnecting
      : phase === 'challenge'
        ? text.statusChallenge
        : phase === 'signing'
          ? text.statusSigning
          : phase === 'finishing'
            ? text.statusFinishing
            : phase === 'out'
              ? text.disconnecting
              : null

  return (
    <ScrollView
      contentContainerStyle={[
        styles.content,
        {
          backgroundColor: colors.background,
          paddingTop: insets.top + 24,
          paddingBottom: insets.bottom + 24,
        },
      ]}
      style={{ backgroundColor: colors.background }}
    >
      <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>
        {text.appName}
      </Text>
      <Text style={[styles.lead, { color: colors.muted }]}>{address ? text.homeLead : text.signedOutLead}</Text>
      <Text style={[styles.network, { color: colors.muted }]}>{text.networkLabel}</Text>

      {shown ? (
        <View
          accessibilityLabel={`${text.accountHeading}. ${shown.title}`}
          style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <Text style={[styles.cardLabel, { color: colors.muted }]}>{text.accountHeading}</Text>
          <Text style={[styles.cardTitle, { color: colors.text }]}>{shown.title}</Text>
          {shown.detail ? <Text style={[styles.cardDetail, { color: colors.muted }]}>{shown.detail}</Text> : null}
        </View>
      ) : null}

      {address ? (
        <ActionButton
          accessibilityLabel={text.disconnect}
          background={colors.coral}
          color={colors.onCoral}
          busy={busy}
          disabled={!ready || busy}
          focus={colors.focus}
          label={busy ? text.disconnecting : text.disconnect}
          onPress={() => void onSignOut()}
        />
      ) : (
        <ActionButton
          accessibilityLabel={text.signIn}
          background={colors.gold}
          color={colors.onGold}
          busy={busy}
          disabled={!ready || busy}
          focus={colors.focus}
          label={busy ? text.signingIn : text.signIn}
          onPress={() => void onSignIn()}
        />
      )}

      {status ? (
        <Text accessibilityLiveRegion="polite" style={[styles.status, { color: colors.muted }]}>
          {status}
        </Text>
      ) : null}
      {error ? (
        <Text accessibilityLiveRegion="polite" accessibilityRole="alert" style={[styles.error, { color: colors.error }]}>
          {error}
        </Text>
      ) : null}

      <View style={styles.row}>
        <ActionButton
          accessibilityLabel={lang === 'es' ? text.languageToEnglish : text.languageToSpanish}
          background={colors.card}
          busy={busy}
          color={colors.text}
          disabled={busy}
          focus={colors.focus}
          fill
          label={lang === 'es' ? 'EN' : 'ES'}
          onPress={toggleLanguage}
          outline={colors.border}
        />
        <ActionButton
          accessibilityLabel={themeName === 'dark' ? text.themeLight : text.themeDark}
          background={colors.card}
          busy={busy}
          color={colors.text}
          disabled={busy}
          focus={colors.focus}
          fill
          label={themeName === 'dark' ? text.themeLight : text.themeDark}
          onPress={toggleTheme}
          outline={colors.border}
        />
      </View>
    </ScrollView>
  )
}

function ActionButton({
  accessibilityLabel,
  background,
  busy,
  color,
  disabled,
  focus,
  fill,
  label,
  onPress,
  outline,
}: {
  accessibilityLabel: string
  background: string
  busy: boolean
  color: string
  disabled: boolean
  fill?: boolean
  focus: string
  label: string
  onPress: PressableProps['onPress']
  outline?: string
}) {
  const [focused, setFocused] = useState(false)
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPress={onPress}
      style={[
        styles.button,
        { backgroundColor: background, borderColor: focused ? focus : outline ?? background },
        fill ? styles.fill : null,
        disabled ? styles.disabled : null,
      ]}
    >
      <Text style={[styles.buttonLabel, { color }]}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    paddingHorizontal: 16,
    gap: 16,
  },
  title: {
    fontSize: 36,
    fontWeight: '700',
    lineHeight: 42,
  },
  lead: {
    fontSize: 18,
    lineHeight: 26,
  },
  network: {
    fontSize: 16,
    lineHeight: 22,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 6,
  },
  cardLabel: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  cardTitle: {
    fontSize: 24,
    lineHeight: 32,
    fontWeight: '700',
  },
  cardDetail: {
    fontSize: 16,
    lineHeight: 22,
  },
  fill: {
    flex: 1,
  },
  button: {
    minHeight: MIN_TOUCH,
    borderRadius: 12,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  buttonLabel: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
    textAlign: 'center',
  },
  disabled: {
    opacity: 0.7,
  },
  status: {
    fontSize: 16,
    lineHeight: 22,
  },
  error: {
    fontSize: 16,
    lineHeight: 22,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
})
