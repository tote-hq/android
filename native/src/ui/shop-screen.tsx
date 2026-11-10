import { useMemo, useRef, useState } from 'react'
import { Image, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'

import { copy, type Lang } from '../auth/i18n.ts'
import { API_ORIGIN } from '../auth/identity.ts'
import { type ThemeColors } from '../auth/theme.ts'
import { payForCart, sendChat, ShopError, type ShopErrorCode } from '../shop/client.ts'
import {
  appendUser,
  emptyTurn,
  reduceEvent,
  type Cart,
  type Product,
  type TranscriptItem,
} from '../shop/protocol.ts'

const LINKS = [
  { key: 'privacy' as const, url: 'https://www.changuito.me/privacy' },
  { key: 'terms' as const, url: 'https://www.changuito.me/terms' },
  { key: 'deleteAccount' as const, url: 'https://www.changuito.me/delete-account' },
]

function newSessionId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function ShopScreen({
  colors,
  lang,
  token,
  signTransaction,
}: {
  colors: ThemeColors
  lang: Lang
  token: string
  signTransaction: (txBase64: string) => Promise<string>
}) {
  const text = copy[lang]
  const [turn, setTurn] = useState(emptyTurn)
  const turnRef = useRef(turn)
  function updateTurn(recipe: (current: typeof turn) => typeof turn): void {
    setTurn((current) => {
      const next = recipe(current)
      turnRef.current = next
      return next
    })
  }
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState<'chat' | 'pay' | null>(null)
  const [errorCode, setErrorCode] = useState<ShopErrorCode | null>(null)
  const [paidAmount, setPaidAmount] = useState<string | null>(null)
  const sessionId = useMemo(() => newSessionId(), [])

  function remember(err: unknown): void {
    setErrorCode(err instanceof ShopError ? err.code : 'server')
  }

  const errorText =
    errorCode === 'refused'
      ? text.shopRefused
      : errorCode === 'unauthorized'
        ? text.shopUnauthorized
        : errorCode === 'postal'
          ? text.needPostal
          : errorCode === 'network'
            ? text.errorNetwork
            : errorCode
              ? text.shopFailed
              : null

  async function onSend(): Promise<void> {
    const message = draft.trim()
    if (!message || busy) return
    setDraft('')
    setErrorCode(null)
    setPaidAmount(null)
    updateTurn((current) => appendUser(current, message))
    setBusy('chat')
    try {
      await sendChat({
        baseUrl: API_ORIGIN,
        token,
        sessionId,
        message,
        snapshot: turnRef.current.snapshot,
        lang,
        onEvent: (event) => updateTurn((current) => reduceEvent(current, event)),
      })
    } catch (err) {
      remember(err)
    } finally {
      setBusy(null)
    }
  }

  async function onPay(cart: Cart, handoffUrl?: string): Promise<void> {
    if (busy) return
    setErrorCode(null)
    setPaidAmount(null)
    setBusy('pay')
    try {
      const result = await payForCart({
        baseUrl: API_ORIGIN,
        token,
        cart,
        handoffUrl,
        snapshot: turnRef.current.snapshot,
        signTransaction,
      })
      setPaidAmount(result.amountDisplay)
    } catch (err) {
      remember(err)
    } finally {
      setBusy(null)
    }
  }

  return (
    <View style={styles.fill}>
      <ScrollView contentContainerStyle={styles.transcript} style={styles.fill}>
        {turn.items.length === 0 ? <Text style={[styles.lead, { color: colors.muted }]}>{text.chatEmpty}</Text> : null}
        {turn.items.map((item) => (
          <Item
            key={item.id}
            colors={colors}
            item={item}
            lang={lang}
            paying={busy === 'pay'}
            onPay={(cart, handoffUrl) => void onPay(cart, handoffUrl)}
          />
        ))}
        {turn.status ? (
          <Text accessibilityLiveRegion="polite" style={[styles.lead, { color: colors.muted }]}>
            {turn.status === 'thinking' ? text.chatSending : text.chatSending}
          </Text>
        ) : null}
      </ScrollView>
      {paidAmount ? (
        <Text accessibilityLiveRegion="polite" style={[styles.notice, { color: colors.text }]}>
          {text.paid} {paidAmount} USDC
        </Text>
      ) : null}
      {errorText ? (
        <Text accessibilityLiveRegion="polite" accessibilityRole="alert" style={[styles.notice, { color: colors.error }]}>
          {errorText}
        </Text>
      ) : null}
      <View style={styles.composer}>
        <TextInput
          accessibilityLabel={text.chatPlaceholder}
          editable={!busy}
          multiline
          onChangeText={setDraft}
          placeholder={text.chatPlaceholder}
          placeholderTextColor={colors.muted}
          style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
          value={draft}
        />
        <Pressable
          accessibilityLabel={text.chatSend}
          accessibilityRole="button"
          accessibilityState={{ disabled: busy !== null || draft.trim().length === 0, busy: busy === 'chat' }}
          disabled={busy !== null || draft.trim().length === 0}
          onPress={() => void onSend()}
          style={[styles.send, { backgroundColor: colors.gold, opacity: busy || !draft.trim() ? 0.7 : 1 }]}
        >
          <Text style={[styles.sendLabel, { color: colors.onGold }]}>{busy === 'chat' ? text.chatSending : text.chatSend}</Text>
        </Pressable>
      </View>
      <View style={styles.links}>
        {LINKS.map((link) => (
          <Pressable
            key={link.key}
            accessibilityLabel={text[link.key]}
            accessibilityRole="link"
            onPress={() => void Linking.openURL(link.url)}
            style={styles.linkHit}
          >
            <Text style={[styles.link, { color: colors.coral }]}>{text[link.key]}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  )
}

function Item({
  colors,
  item,
  lang,
  onPay,
  paying,
}: {
  colors: ThemeColors
  item: TranscriptItem
  lang: Lang
  onPay: (cart: Cart, handoffUrl?: string) => void
  paying: boolean
}) {
  const text = copy[lang]
  if (item.kind === 'user' || item.kind === 'assistant' || item.kind === 'notice') {
    return (
      <Text style={[styles.bubble, { color: item.kind === 'notice' ? colors.error : colors.text }]}>{item.text}</Text>
    )
  }
  if (item.kind === 'products') {
    return (
      <View accessibilityLabel={text.productsHeading} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.cardLabel, { color: colors.muted }]}>{text.productsHeading}</Text>
        {item.items.map((product) => (
          <ProductRow key={product.skuId} colors={colors} lang={lang} product={product} />
        ))}
      </View>
    )
  }
  return (
    <View accessibilityLabel={text.cartHeading} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.cardLabel, { color: colors.muted }]}>{text.cartHeading}</Text>
      {item.cart.lines.map((line) => (
        <Text key={`${line.index}-${line.skuId}`} style={[styles.line, { color: colors.text }]}>
          {line.quantity} × {line.name} · {line.lineTotal.display}
        </Text>
      ))}
      <Text style={[styles.total, { color: colors.text }]}>{item.cart.total.display}</Text>
      <Pressable
        accessibilityLabel={text.pay}
        accessibilityRole="button"
        accessibilityState={{ disabled: paying, busy: paying }}
        disabled={paying}
        onPress={() => onPay(item.cart, item.handoffUrl)}
        style={[styles.send, { backgroundColor: colors.coral }]}
      >
        <Text style={[styles.sendLabel, { color: colors.onCoral }]}>{paying ? text.paying : text.pay}</Text>
      </Pressable>
    </View>
  )
}

function ProductRow({ colors, lang, product }: { colors: ThemeColors; lang: Lang; product: Product }) {
  const label = `${product.name}, ${product.price.display}${product.available ? '' : `, ${copy[lang].unavailable}`}`
  return (
    <View accessibilityLabel={label} style={styles.product}>
      {product.imageUrl ? (
        <Image accessibilityIgnoresInvertColors source={{ uri: product.imageUrl }} style={styles.image} />
      ) : null}
      <View style={styles.fill}>
        <Text style={[styles.line, { color: colors.text }]}>{product.name}</Text>
        <Text style={[styles.meta, { color: colors.muted }]}>
          {product.price.display}
          {product.available ? '' : ` · ${copy[lang].unavailable}`}
        </Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  transcript: { gap: 12, paddingBottom: 12 },
  lead: { fontSize: 16, lineHeight: 22 },
  bubble: { fontSize: 17, lineHeight: 24 },
  card: { borderRadius: 16, borderWidth: 1, gap: 8, padding: 12 },
  cardLabel: { fontSize: 14, fontWeight: '700', lineHeight: 20 },
  line: { fontSize: 16, lineHeight: 22 },
  meta: { fontSize: 15, lineHeight: 20 },
  total: { fontSize: 18, fontWeight: '700', lineHeight: 24 },
  product: { flexDirection: 'row', gap: 12, minHeight: 48 },
  image: { borderRadius: 8, height: 48, width: 48 },
  composer: { gap: 8, paddingTop: 8 },
  input: { borderRadius: 12, borderWidth: 1, fontSize: 16, lineHeight: 22, minHeight: 48, paddingHorizontal: 12, paddingVertical: 12 },
  send: { alignItems: 'center', borderRadius: 12, justifyContent: 'center', minHeight: 48, paddingHorizontal: 16 },
  sendLabel: { fontSize: 17, fontWeight: '700', lineHeight: 22, textAlign: 'center' },
  notice: { fontSize: 16, lineHeight: 22, paddingTop: 8 },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 8 },
  linkHit: { justifyContent: 'center', minHeight: 48, paddingHorizontal: 4 },
  link: { fontSize: 16, fontWeight: '700', lineHeight: 22, textDecorationLine: 'underline' },
})
