import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import ProgressView from './ProgressView'
import StreamsMenu from './StreamsMenu'
import { api, getToken, loadReels, queueStatus, recordStatus, saveReels, takePendingStatuses } from '../lib/api'
import type { FeedItem, StreamItem } from '../lib/api'

// Keep at least BUFFER_TARGET reels ahead of the active one; refill below that.
const BUFFER_TARGET = 10
// A reel must be watched for at least this long to count as watched.
const WATCH_MS = 10_000

// The model sometimes emits old-style LaTeX delimiters \(...\) / \[...\]
// which remark-math doesn't parse — normalize them to $...$ / $$...$$ so
// KaTeX can render them.
function normalizeLatex(md: string): string {
  return md
    .replace(/\\\[([\s\S]*?)\\\]/g, '$$$$$1$$$$') // \[...\] → $$...$$
    .replace(/\\\(([\s\S]*?)\\\)/g, '$$$1$') // \(...\) → $...$
}

interface FeedPageProps {
  onLogout: () => void
}

export default function FeedPage({ onLogout }: FeedPageProps) {
  const [reels, setReels] = useState<FeedItem[]>(() => loadReels())
  const [activeIndex, setActiveIndex] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [topic, setTopic] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [progressStream, setProgressStream] = useState<StreamItem | null>(null)

  // Refs keep async logic free of stale closures.
  const reelsRef = useRef(reels)
  reelsRef.current = reels
  const fetchingRef = useRef(false)
  const backoffUntilRef = useRef(0)
  const reportedRef = useRef<Set<string>>(new Set())
  const activeReelRef = useRef<FeedItem | null>(null)
  const timerRef = useRef<number | null>(null)

  const token = getToken()

  // Persist the buffer so previously loaded reels survive restarts (offline cache).
  useEffect(() => {
    saveReels(reels)
  }, [reels])

  // Append items to the buffer, de-duplicated by node_id.
  // Report a verdict: record it locally first (so cached reels can be filtered),
  // then send it to the server — queueing it if we're offline.
  function reportStatus(nodeId: string, status: 'watched' | 'skipped') {
    if (!token) return
    recordStatus(nodeId, status)
    api.setStatus(nodeId, status, token).catch(() => queueStatus(nodeId, status))
  }

  // Replay any status updates that failed while the app was offline.
  async function flushPendingStatuses() {
    if (!token) return
    for (const p of takePendingStatuses()) {
      try {
        await api.setStatus(p.nodeId, p.status, token)
      } catch {
        queueStatus(p.nodeId, p.status) // still offline — keep for later
      }
    }
  }

  function merge(items: FeedItem[]) {
    if (items.length === 0) return
    setReels((prev) => {
      const seen = new Set(prev.map((r) => r.node_id))
      const fresh = items.filter((it) => !seen.has(it.node_id))
      return fresh.length ? [...prev, ...fresh] : prev
    })
  }

  // Single call: the server serves existing unwatched reels and generates new
  // ones to fill the requested count. Empty/failed responses back off briefly
  // instead of permanently stopping.
  async function refill() {
    if (fetchingRef.current || Date.now() < backoffUntilRef.current || !token) return
    fetchingRef.current = true
    try {
      const items = await api.feed(BUFFER_TARGET, token)
      if (items.length === 0) {
        backoffUntilRef.current = Date.now() + 15_000 // nothing available; retry later
      }
      merge(items)
      await flushPendingStatuses() // replay offline verdicts now that we're online
    } catch (err) {
      backoffUntilRef.current = Date.now() + 15_000
      if (reelsRef.current.length === 0) {
        setError(err instanceof Error ? err.message : 'Failed to load feed')
      }
      // With cached reels available, stay quiet — the app keeps working offline.
    } finally {
      fetchingRef.current = false
    }
  }

  // Initial fill + refill whenever fewer than BUFFER_TARGET reels remain ahead.
  useEffect(() => {
    if (reels.length - activeIndex < BUFFER_TARGET) {
      void refill()
    }
  }, [reels.length, activeIndex])

  // The active reel drives a 10s watch timer: leaving early = skipped,
  // staying 10s = watched. Each reel is reported at most once.
  useEffect(() => {
    const prev = activeReelRef.current
    if (prev && !reportedRef.current.has(prev.node_id) && token) {
      reportedRef.current.add(prev.node_id)
      reportStatus(prev.node_id, 'skipped')
    }

    const current = reelsRef.current[activeIndex]
    activeReelRef.current = current ?? null
    if (!current) return

    timerRef.current = window.setTimeout(() => {
      if (!reportedRef.current.has(current.node_id) && token) {
        reportedRef.current.add(current.node_id)
        reportStatus(current.node_id, 'watched')
      }
    }, WATCH_MS)

    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
    }
  }, [activeIndex])

  // Scroll position → active reel index (each reel is one viewport).
  useEffect(() => {
    function onScroll() {
      setActiveIndex(Math.round(window.scrollY / window.innerHeight))
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  async function handleCreateStream(e: FormEvent) {
    e.preventDefault()
    if (!token || !topic.trim()) return
    setError(null)
    try {
      await api.createStream(topic.trim(), token)
      setTopic('')
      backoffUntilRef.current = 0 // new content may be available now
      void refill()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create stream')
    }
  }

  return (
    <div className="bg-slate-950 text-white">
      {/* Top bar */}
      <div className="top-bar fixed inset-x-0 top-0 z-10 flex items-center justify-between bg-slate-950/80 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setMenuOpen(true)}
            aria-label="Open streams menu"
            className="rounded-lg px-2.5 py-1.5 text-lg leading-none text-slate-300 hover:bg-slate-800"
          >
            ☰
          </button>
          <h1 className="text-lg font-bold">Mile</h1>
        </div>
        <button
          onClick={onLogout}
          className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
        >
          Log out
        </button>
      </div>

      {token && (
        <StreamsMenu
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          token={token}
          onShowProgress={setProgressStream}
        />
      )}

      {token && progressStream && (
        <ProgressView stream={progressStream} token={token} onClose={() => setProgressStream(null)} />
      )}

      {error && (
        <div className="fixed inset-x-0 top-14 z-10 mx-auto w-fit rounded-lg bg-red-950/80 px-4 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Reels */}
      {reels.length === 0 && !error && (
        <div className="flex min-h-dvh items-center justify-center text-slate-400">
          Loading reels…
        </div>
      )}
      {reels.map((reel) => (
        <section
          key={reel.node_id}
          className="feed-container flex min-h-dvh snap-start items-center justify-center px-4 pb-24 pt-16"
        >
          <article className="reel-container max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl bg-slate-900 p-6 shadow-xl">
            <p className="reel-topic text-xs">{reel.topic}</p>
            <div className="prose-reel mt-2 leading-relaxed text-slate-300">
              <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                {normalizeLatex(reel.content)}
              </ReactMarkdown>
            </div>
          </article>
        </section>
      ))}

      {/* Create stream */}
      <form
        onSubmit={handleCreateStream}
        className="fixed inset-x-0 bottom-0 z-10 flex gap-2 border-t border-slate-800 bg-slate-950/90 p-3 backdrop-blur"
      >
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="New stream topic…"
          className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm placeholder-slate-500 outline-none focus:border-indigo-500"
        />
        <button
          type="submit"
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold hover:bg-indigo-500"
        >
          Add
        </button>
      </form>
    </div>
  )
}
