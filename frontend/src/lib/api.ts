// Minimal typed API client for the Go backend.

// API base: defaults to the same-origin path (dev proxy on the website);
// mobile builds set VITE_API_URL to the backend base URL, e.g.
// https://your-domain.duckdns.org/api/v1  — must include the /api/v1 prefix!
// concatenation never produces "//path").
const API_BASE = (import.meta.env.VITE_API_URL ?? '/api/v1').replace(/\/+$/, '')

export interface AuthUser {
  id: string
  email: string
  username: string
}

export interface AuthResponse {
  token: string
  user: AuthUser
}

export interface FeedItem {
  stream_id: string
  node_id: string
  topic: string
  path: string
  content: string
  info_card_id: string
  flash_cards: FlashCard[]
  question_cards: QuestionCard[]
}

// Flash card as served by the feed. Users reveal the back (double-tap) and
// self-grade. answered → responses history '1' (knew it) / '0' (missed).
export interface FlashCard {
  id: string
  front: string
  back: string
}

// MCQ as served by the feed. The client grades instantly against `correct`
// (offline friendly) and reports the 1/0 result to the backend.
export interface QuestionCard {
  id: string
  question: string
  options: string[]
  correct: string
}

export interface StreamItem {
  id: string
  user_id: string
  topic: string
  feedback: string
  created_at: string
}

// --- stream chat ----------------------------------------------------------

export type ChatRole = 'user' | 'assistant'
export type ChatCardType = '' | 'info' | 'flash' | 'question'

// UUID used by the backend when a chat message has no card reference.
export const NIL_UUID = '00000000-0000-0000-0000-000000000000'

export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  card_type: ChatCardType
  card_id: string
  created_at: string
}

export interface TreeNode {
  node_id: string
  topic: string
  path: string
  is_leaf: boolean
  generated: boolean
  status: 'watched' | 'skipped' | 'unwatched' | null
}

async function request<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const res = await fetch(API_BASE + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  })

  if (res.status === 401) {
    // Session is no longer valid (e.g. user deleted / DB reset): log out.
    clearToken()
    window.dispatchEvent(new Event('auth-expired'))
  }

  if (!res.ok) {
    let message = `Request failed (${res.status})`
    try {
      const body = await res.json()
      if (body.error) message = body.error
    } catch {
      // keep the generic message
    }
    throw new Error(message)
  }

  return res.json() as Promise<T>
}

export const api = {
  register: (email: string, username: string, password: string) =>
    request<AuthResponse>('/register', {
      method: 'POST',
      body: JSON.stringify({ email, username, password }),
    }),

  login: (email: string, password: string) =>
    request<AuthResponse>('/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  feed: (count: number, token: string) => request<FeedItem[]>(`/feed?count=${count}`, {}, token),

  // Creates a stream and seeds its roadmap. `instructions` (optional free-form
  // text) steer the content generation. The clarifying-questionnaire flow is
  // not implemented yet — this is the direct create call.
  createStream: (topic: string, instructions: string, token: string) =>
    request<{ stream: unknown; nodes: unknown[] }>('/stream', {
      method: 'POST',
      body: JSON.stringify({ topic, instructions }),
    }, token),

  listStreams: (token: string) => request<StreamItem[]>('/streams', {}, token),

  getChat: (streamId: string, token: string) =>
    request<ChatMessage[]>(`/stream/${streamId}/chat`, {}, token),

  // Appends the learner's question (optionally tagged to a card) and returns
  // the updated history once the assistant reply is generated.
  askChat: (
    streamId: string,
    question: string,
    token: string,
    card?: { cardType: Exclude<ChatCardType, ''>; cardId: string },
  ) =>
    request<ChatMessage[]>(`/stream/${streamId}/chat`, {
      method: 'POST',
      body: JSON.stringify({
        question,
        ...(card ? { card_type: card.cardType, card_id: card.cardId } : {}),
      }),
    }, token),

  streamTree: (streamId: string, token: string) =>
    request<TreeNode[]>(`/stream/${streamId}/tree`, {}, token),

  deleteStream: (streamId: string, token: string) =>
    request<{ deleted: boolean }>(`/stream/${streamId}`, { method: 'DELETE' }, token),

  setStatus: (nodeId: string, status: 'watched' | 'skipped', token: string) =>
    request<{ status: string }>(`/article/${nodeId}/status`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    }, token),

  // Records one user attempt on a flash or question card. `correct` = knew it
  // (flash) / answered right (question). Each card is answered once per
  // viewing; the backend appends a 1/0 to the card's responses history.
  recordCardResponse: (cardType: 'flash' | 'question', cardId: string, correct: boolean, token: string) =>
    request<{ recorded: boolean }>('/card/response', {
      method: 'POST',
      body: JSON.stringify({ card_type: cardType, card_id: cardId, correct }),
    }, token),
}

// --- token storage -------------------------------------------------------

const TOKEN_KEY = 'mile.token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

// --- offline cache -------------------------------------------------------

const REELS_CACHE_KEY = 'mile.reels.v1'
const STATUS_CACHE_KEY = 'mile.statuses.v1'
const PENDING_STATUS_KEY = 'mile.pendingStatus.v1'
const PENDING_CARD_RESPONSE_KEY = 'mile.pendingCardResponse.v1'
const CARD_ANSWER_KEY = 'mile.cardAnswers.v1'

export type ReelStatus = 'watched' | 'skipped'

// --- answered-card persistence (resume support) ---------------------------

// What the user answered on a flash or question card, stored locally so a
// partially finished group can be resumed with answered cards still locked.
export interface StoredCardAnswer {
  kind: 'flash' | 'question'
  correct?: boolean // flash: knew it?
  selected?: string // question: option picked
}

export function loadStoredCardAnswers(): Record<string, StoredCardAnswer> {
  try {
    return JSON.parse(localStorage.getItem(CARD_ANSWER_KEY) ?? '{}')
  } catch {
    return {}
  }
}

export function storeCardAnswer(cardId: string, answer: StoredCardAnswer): void {
  try {
    const all = loadStoredCardAnswers()
    all[cardId] = answer
    localStorage.setItem(CARD_ANSWER_KEY, JSON.stringify(all))
  } catch {
    // ignore
  }
}

export interface PendingCardResponse {
  cardType: 'flash' | 'question'
  cardId: string
  correct: boolean
}

// saveReels persists the reel buffer (trimmed to the most recent items) so
// previously loaded articles survive app restarts and work offline.
export function saveReels(items: FeedItem[]): void {
  try {
    localStorage.setItem(REELS_CACHE_KEY, JSON.stringify(items.slice(-100)))
  } catch {
    // storage full/unavailable — cache is best-effort
  }
}

// loadReels returns the cached reels, dropping any the user already watched.
export function loadReels(): FeedItem[] {
  try {
    const raw = localStorage.getItem(REELS_CACHE_KEY)
    if (!raw) return []
    const statuses = loadStatuses()
    const items = JSON.parse(raw) as FeedItem[]
    return items.filter((it) => statuses[it.node_id] !== 'watched')
  } catch {
    return []
  }
}

// recordStatus stores the user's verdict locally so cached reels can be
// filtered, even before the server has acknowledged it.
export function recordStatus(nodeId: string, status: ReelStatus): void {
  try {
    const statuses = loadStatuses()
    statuses[nodeId] = status
    localStorage.setItem(STATUS_CACHE_KEY, JSON.stringify(statuses))
  } catch {
    // ignore
  }
}

function loadStatuses(): Record<string, ReelStatus> {
  try {
    return JSON.parse(localStorage.getItem(STATUS_CACHE_KEY) ?? '{}')
  } catch {
    return {}
  }
}

// queueStatus remembers a status update that failed (e.g. offline) so it can
// be replayed once the network is back.
export function queueStatus(nodeId: string, status: ReelStatus): void {
  try {
    const pending: { nodeId: string; status: ReelStatus }[] = JSON.parse(
      localStorage.getItem(PENDING_STATUS_KEY) ?? '[]',
    )
    if (!pending.some((p) => p.nodeId === nodeId)) {
      pending.push({ nodeId, status })
      localStorage.setItem(PENDING_STATUS_KEY, JSON.stringify(pending))
    }
  } catch {
    // ignore
  }
}

export function takePendingStatuses(): { nodeId: string; status: ReelStatus }[] {
  try {
    const pending = JSON.parse(localStorage.getItem(PENDING_STATUS_KEY) ?? '[]')
    localStorage.removeItem(PENDING_STATUS_KEY)
    return pending
  } catch {
    return []
  }
}

// queueCardResponse remembers a card response that failed to send (e.g.
// offline) so it can be replayed once the network is back. A card that
// already has a queued response is not queued twice (cards are answered once).
export function queueCardResponse(cardType: 'flash' | 'question', cardId: string, correct: boolean): void {
  try {
    const pending: PendingCardResponse[] = JSON.parse(
      localStorage.getItem(PENDING_CARD_RESPONSE_KEY) ?? '[]',
    )
    if (!pending.some((p) => p.cardId === cardId)) {
      pending.push({ cardType, cardId, correct })
      localStorage.setItem(PENDING_CARD_RESPONSE_KEY, JSON.stringify(pending))
    }
  } catch {
    // ignore
  }
}

export function takePendingCardResponses(): PendingCardResponse[] {
  try {
    const pending = JSON.parse(localStorage.getItem(PENDING_CARD_RESPONSE_KEY) ?? '[]')
    localStorage.removeItem(PENDING_CARD_RESPONSE_KEY)
    return pending
  } catch {
    return []
  }
}

// clearLocalState wipes all per-account local data (cached reels, local status
// verdicts, offline queues). Called when the user logs out or a (possibly
// different) account authenticates, so one account's reels/statuses never leak
// into another account's session.
export function clearLocalState(): void {
  for (const key of [REELS_CACHE_KEY, STATUS_CACHE_KEY, PENDING_STATUS_KEY, PENDING_CARD_RESPONSE_KEY, CARD_ANSWER_KEY]) {
    try {
      localStorage.removeItem(key)
    } catch {
      // ignore
    }
  }
}
