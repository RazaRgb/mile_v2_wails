import { memo, useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { api, loadReels, queueStatus, recordStatus, saveReels, takePendingStatuses } from '../lib/api'
import type { FeedItem } from '../lib/api'

const BUFFER_TARGET = 10
const WATCH_MS = 10_000

function normalizeLatex(md: string): string {
  return md
    .replace(/\\\[([\s\S]*?)\\\]/g, '$$$$$1$$$$')
    .replace(/\\\(([\s\S]*?)\\\)/g, '$$$1$')
}

interface FeedPageProps {
  token: string
  onError: (err: string | null) => void
}

export interface FeedPageRef {
  refill: () => Promise<void>
}

const FeedPage = memo(
  forwardRef<FeedPageRef, FeedPageProps>(({ token, onError }, ref) => {
  const [reels, setReels] = useState<FeedItem[]>(() => loadReels())
  const [activeIndex, setActiveIndex] = useState(0)

  const reelsRef = useRef(reels)
  reelsRef.current = reels
  const fetchingRef = useRef(false)
  const backoffUntilRef = useRef(0)
  const reportedRef = useRef<Set<string>>(new Set())
  const activeReelRef = useRef<FeedItem | null>(null)
  const timerRef = useRef<number | null>(null)

  useImperativeHandle(ref, () => ({
    refill: () => {
      backoffUntilRef.current = 0
      return refill()
    }
  }))

  useEffect(() => {
    saveReels(reels)
  }, [reels])

  function reportStatus(nodeId: string, status: 'watched' | 'skipped') {
    if (!token) return
    recordStatus(nodeId, status)
    api.setStatus(nodeId, status, token).catch(() => queueStatus(nodeId, status))
  }

  async function flushPendingStatuses() {
    if (!token) return
    for (const p of takePendingStatuses()) {
      try {
        await api.setStatus(p.nodeId, p.status, token)
      } catch {
        queueStatus(p.nodeId, p.status)
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

  async function refill() {
    if (fetchingRef.current || Date.now() < backoffUntilRef.current || !token) return
    fetchingRef.current = true
    try {
      const items = await api.feed(BUFFER_TARGET, token)
      if (items.length === 0) {
        backoffUntilRef.current = Date.now() + 15_000
      }
      merge(items)
      await flushPendingStatuses()
    } catch (err) {
      backoffUntilRef.current = Date.now() + 15_000
      if (reelsRef.current.length === 0) {
        onError(err instanceof Error ? err.message : 'Failed to load feed')
      }
    } finally {
      fetchingRef.current = false
    }
  }

  useEffect(() => {
    if (reels.length - activeIndex < BUFFER_TARGET) {
      void refill()
    }
  }, [reels.length, activeIndex])

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
  }, [activeIndex, token])

  useEffect(() => {
    // We attach scroll listener to the parent tab-panel if possible, or just use intersection observer
    // But since it's vertical scroll snap inside tab-panel--feed, let's select that.
    const panel = document.querySelector('.tab-panel--feed')
    if (!panel) return
    
    function onScroll() {
      if (!panel) return
      setActiveIndex(Math.round(panel.scrollTop / panel.clientHeight))
    }
    
    panel.addEventListener('scroll', onScroll, { passive: true })
    return () => panel.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <div className="feed-container">
      {reels.length === 0 && (
        <div className="feed-loading">
          Loading reels…
        </div>
      )}
      {reels.map((reel) => (
        <section key={reel.node_id} className="reel-section">
          <article className="reel-card">
            <h2 className="reel-topic">{reel.topic}</h2>
            <div className="prose-reel reel-body">
              <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                {normalizeLatex(reel.content)}
              </ReactMarkdown>
            </div>
          </article>
        </section>
      ))}
    </div>
  )
  })
)

export default FeedPage
