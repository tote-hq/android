/** Wire types the shop screen reads from /api/chat. Identifiers and display strings only. */

export type Money = { centavos: number; display: string }

export type Product = {
  skuId: string
  productId: string
  name: string
  brand?: string
  price: Money
  available: boolean
  imageUrl?: string
}

export type CartLine = {
  index: number
  skuId: string
  name: string
  quantity: number
  lineTotal: Money
  available: boolean
}

export type Cart = {
  retailer: string
  cartId: string
  lines: CartLine[]
  total: Money
  messages: string[]
}

export type UiEvent =
  | { t: 'status'; stage: 'received' | 'thinking' | 'fallback'; hop?: number }
  | { t: 'text'; delta: string }
  | { t: 'thinking'; delta: string }
  | { t: 'tool_start'; id: string; name: string }
  | { t: 'tool_end'; id: string; ok: boolean; ms: number }
  | { t: 'products'; items: Product[]; note?: string }
  | { t: 'cart'; cart: Cart; handoffUrl?: string }
  | { t: 'error'; message: string; recoverable: boolean }
  | { t: 'done'; stopReason: string; snapshot: unknown }

export type TranscriptItem =
  | { id: string; kind: 'user'; text: string }
  | { id: string; kind: 'assistant'; text: string }
  | { id: string; kind: 'products'; items: Product[] }
  | { id: string; kind: 'cart'; cart: Cart; handoffUrl?: string }
  | { id: string; kind: 'notice'; text: string }

export type TurnView = {
  items: TranscriptItem[]
  snapshot: unknown
  status: string | null
  assistantId: string | null
  seq: number
}

export function emptyTurn(): TurnView {
  return { items: [], snapshot: undefined, status: null, assistantId: null, seq: 0 }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function asEvent(value: unknown): UiEvent | null {
  if (!isRecord(value) || typeof value.t !== 'string') return null
  return value as UiEvent
}

/** Split an SSE buffer. A frame cut in half stays in `rest`. Heartbeats are ignored. */
export function parseEvents(buffer: string): { events: UiEvent[]; rest: string } {
  const frames = buffer.split('\n\n')
  const rest = frames.pop() ?? ''
  const events: UiEvent[] = []
  for (const frame of frames) {
    const line = frame.split('\n').find((part) => part.startsWith('data: '))
    if (!line) continue
    try {
      const event = asEvent(JSON.parse(line.slice(6)))
      if (event) events.push(event)
    } catch {
      /* a bad frame is dropped so the rest of the turn can still render */
    }
  }
  return { events, rest }
}

export function postalCodeFromSnapshot(snapshot: unknown): string | null {
  if (!isRecord(snapshot)) return null
  const location = snapshot.location
  if (!isRecord(location) || typeof location.postalCode !== 'string') return null
  return /^[A-Za-z0-9]{4,8}$/.test(location.postalCode) ? location.postalCode : null
}

function nextId(state: TurnView): string {
  return `b${state.seq + 1}`
}

export function reduceEvent(state: TurnView, event: UiEvent): TurnView {
  const seq = state.seq + 1
  if (event.t === 'status') {
    const status = event.stage === 'thinking' ? 'thinking' : event.stage
    return { ...state, seq, status }
  }
  if (event.t === 'text') {
    const id = state.assistantId
    if (!id) {
      const itemId = nextId(state)
      return {
        ...state,
        seq,
        status: null,
        assistantId: itemId,
        items: [...state.items, { id: itemId, kind: 'assistant', text: event.delta }],
      }
    }
    return {
      ...state,
      seq,
      status: null,
      items: state.items.map((item) =>
        item.id === id && item.kind === 'assistant' ? { ...item, text: item.text + event.delta } : item,
      ),
    }
  }
  if (event.t === 'products') {
    return {
      ...state,
      seq,
      status: null,
      assistantId: null,
      items: [...state.items, { id: nextId(state), kind: 'products', items: event.items }],
    }
  }
  if (event.t === 'cart') {
    return {
      ...state,
      seq,
      status: null,
      assistantId: null,
      items: [
        ...state.items,
        { id: nextId(state), kind: 'cart', cart: event.cart, handoffUrl: event.handoffUrl },
      ],
    }
  }
  if (event.t === 'error') {
    return {
      ...state,
      seq,
      status: null,
      assistantId: null,
      items: [...state.items, { id: nextId(state), kind: 'notice', text: event.message }],
    }
  }
  if (event.t === 'done') {
    return { ...state, seq, status: null, assistantId: null, snapshot: event.snapshot }
  }
  return { ...state, seq }
}

export function appendUser(state: TurnView, text: string): TurnView {
  const id = nextId(state)
  return { ...state, seq: state.seq + 1, assistantId: null, items: [...state.items, { id, kind: 'user', text }] }
}
