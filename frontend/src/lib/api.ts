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
  node_id: string
  topic: string
  path: string
  content: string
  created_at: string
}

export interface StreamItem {
  id: string
  user_id: string
  topic: string
  feedback: string
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

  createStream: (topic: string, token: string) =>
    request<{ stream: unknown; nodes: unknown[] }>('/stream', {
      method: 'POST',
      body: JSON.stringify({ topic }),
    }, token),

  listStreams: (token: string) => request<StreamItem[]>('/streams', {}, token),

  streamTree: (streamId: string, token: string) =>
    request<TreeNode[]>(`/stream/${streamId}/tree`, {}, token),

  deleteStream: (streamId: string, token: string) =>
    request<{ deleted: boolean }>(`/stream/${streamId}`, { method: 'DELETE' }, token),

  setStatus: (nodeId: string, status: 'watched' | 'skipped', token: string) =>
    request<{ status: string }>(`/article/${nodeId}/status`, {
      method: 'POST',
      body: JSON.stringify({ status }),
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

export type ReelStatus = 'watched' | 'skipped'

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
