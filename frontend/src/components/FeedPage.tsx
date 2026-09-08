import { memo, useEffect, useMemo, useRef, useState, forwardRef, useImperativeHandle } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import {
  api,
  loadReels,
  queueCardResponse,
  queueStatus,
  recordStatus,
  saveReels,
  takePendingCardResponses,
  takePendingStatuses,
} from '../lib/api'
import type { FeedItem, FlashCard, QuestionCard } from '../lib/api'

const BUFFER_TARGET = 10
const WATCH_MS = 10_000
// Double-tap window (ms) used to flip a flash card.
const DOUBLE_TAP_MS = 300

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

type PageKind = 'info' | 'flash' | 'question'

// One full-screen page inside a feed group.
interface Page {
  key: string
  kind: PageKind
  nodeId: string
  topic: string
  content?: string
  flash?: FlashCard
  question?: QuestionCard
}

function buildPages(reels: FeedItem[]): Page[] {
  const pages: Page[] = []
  for (const reel of reels) {
    pages.push({
      key: `${reel.node_id}:info`,
      kind: 'info',
      nodeId: reel.node_id,
      topic: reel.topic,
      content: reel.content,
    })
    for (const f of reel.flash_cards ?? []) {
      pages.push({ key: `f:${f.id}`, kind: 'flash', nodeId: reel.node_id, topic: reel.topic, flash: f })
    }
    for (const q of reel.question_cards ?? []) {
      pages.push({
        key: `q:${q.id}`,
        kind: 'question',
        nodeId: reel.node_id,
        topic: reel.topic,
        question: q,
      })
    }
  }
  return pages
}

// groupIndexOfPage maps a page index to its reel group index (0-based).
function groupIndexOfPage(reels: FeedItem[], pageIdx: number): number {
  if (pageIdx < 0) return -1
  let acc = 0
  for (let g = 0; g < reels.length; g++) {
    const size = 1 + (reels[g].flash_cards?.length ?? 0) + (reels[g].question_cards?.length ?? 0)
    if (pageIdx < acc + size) return g
    acc += size
  }
  return -1
}

const FeedPage = memo(
  forwardRef<FeedPageRef, FeedPageProps>(({ token, onError }, ref) => {
  const [reels, setReels] = useState<FeedItem[]>(() => loadReels())
  const [activeIndex, setActiveIndex] = useState(0)
  const [flipped, setFlipped] = useState<Record<string, boolean>>({})
  // flash card id -> whether the user knew it
  const [flashAnswered, setFlashAnswered] = useState<Record<string, boolean>>({})
  // question card id -> the option the user picked
  const [questionAnswered, setQuestionAnswered] = useState<Record<string, string>>({})

  const reelsRef = useRef(reels)
  reelsRef.current = reels
  const fetchingRef = useRef(false)
  const backoffUntilRef = useRef(0)
  // how many consecutive refills returned nothing (empty or errored); used to
  // grow the retry backoff so we don't hammer a backend that can't produce
  // content (e.g. quota exhausted / model overloaded).
  const emptyStreakRef = useRef(0)
  // node_ids whose final watched/skipped verdict has been reported already
  const reportedRef = useRef<Set<string>>(new Set())
  // node_ids marked watched (timer fired or a card was answered)
  const watchedRef = useRef<Set<string>>(new Set())
  const activeGroupRef = useRef<number>(-1)
  const timerRef = useRef<number | null>(null)
  const lastTapRef = useRef<Record<string, number>>({})

  const pages = useMemo(() => buildPages(reels), [reels])

  useImperativeHandle(ref, () => ({
    refill: () => {
      backoffUntilRef.current = 0
      emptyStreakRef.current = 0
      return refill()
    },
  }))

  useEffect(() => {
    saveReels(reels)
  }, [reels])

  // --- backend reporting ---------------------------------------------------

  function reportNodeStatus(nodeId: string, status: 'watched' | 'skipped') {
    if (!token) return
    reportedRef.current.add(nodeId)
    recordStatus(nodeId, status)
    api.setStatus(nodeId, status, token).catch(() => queueStatus(nodeId, status))
  }

  // A group counts as watched once the user spent the watch window on its info
  // page or answered at least one of its cards.
  function markGroupWatched(nodeId: string) {
    watchedRef.current.add(nodeId)
    if (!reportedRef.current.has(nodeId)) {
      reportNodeStatus(nodeId, 'watched')
    }
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  function sendCardResponse(cardType: 'flash' | 'question', cardId: string, correct: boolean) {
    if (!token) return
    api.recordCardResponse(cardType, cardId, correct, token).catch(() => {
      queueCardResponse(cardType, cardId, correct)
    })
  }

  async function flushPending() {
    if (!token) return
    for (const p of takePendingStatuses()) {
      try {
        await api.setStatus(p.nodeId, p.status, token)
      } catch {
        queueStatus(p.nodeId, p.status)
      }
    }
    for (const p of takePendingCardResponses()) {
      try {
        await api.recordCardResponse(p.cardType, p.cardId, p.correct, token)
      } catch {
        queueCardResponse(p.cardType, p.cardId, p.correct)
      }
    }
  }

  // Grows the retry delay on consecutive fruitless refills: 15s, 30s, 60s,
  // then caps at 120s until content actually arrives.
  function scheduleRetry() {
    emptyStreakRef.current += 1
    const n = emptyStreakRef.current
    const delay = Math.min(15_000 * Math.pow(2, n - 1), 120_000)
    backoffUntilRef.current = Date.now() + delay
  }

  async function refill() {
    if (fetchingRef.current || Date.now() < backoffUntilRef.current || !token) return
    fetchingRef.current = true
    try {
      const items = await api.feed(BUFFER_TARGET, token)
      if (items.length > 0) {
        emptyStreakRef.current = 0
      } else {
        scheduleRetry()
      }
      merge(items)
      await flushPending()
    } catch (err) {
      scheduleRetry()
      if (reelsRef.current.length === 0) {
        onError(err instanceof Error ? err.message : 'Failed to load feed')
      }
    } finally {
      fetchingRef.current = false
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

  // Keep the local buffer topped up while the user approaches its end. This
  // also covers the fresh-mount case (empty buffer) and keeps retrying after a
  // transient empty/error response instead of stalling at the last page: while
  // the condition holds we poll, and refill() self-throttles with its own
  // in-flight/backoff guards.
  useEffect(() => {
    const g = groupIndexOfPage(reels, activeIndex)
    const wantMore = g < 0 ? reels.length === 0 : reels.length - g < BUFFER_TARGET
    if (!wantMore) return

    let cancelled = false
    const attempt = () => {
      if (!cancelled) void refill()
    }
    attempt()
    const id = window.setInterval(attempt, 6000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, reels.length])

  // Finalize the verdict of the group we just left, and mark a watched timer
  // while the user rests on a group's info page.
  useEffect(() => {
    if (pages.length === 0) return

    const group = groupIndexOfPage(reels, activeIndex)
    const prev = activeGroupRef.current
    if (prev >= 0 && prev !== group) {
      const nodeId = reels[prev]?.node_id
      if (nodeId && !reportedRef.current.has(nodeId)) {
        // Left the group without the watch window or any answer: skipped.
        reportNodeStatus(nodeId, 'skipped')
      }
    }
    activeGroupRef.current = group

    if (group < 0) return
    const page = pages[activeIndex]
    const nodeId = reels[group]?.node_id
    if (!nodeId) return

    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    // The watch timer only runs while resting on the group's info page.
    if (page?.kind === 'info' && !watchedRef.current.has(nodeId) && !reportedRef.current.has(nodeId)) {
      timerRef.current = window.setTimeout(() => {
        markGroupWatched(nodeId)
      }, WATCH_MS)
    }
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, pages.length, reels])

  useEffect(() => {
    const panel = document.querySelector('.tab-panel--feed')
    if (!panel) return

    function onScroll() {
      if (!panel) return
      setActiveIndex(Math.round(panel.scrollTop / panel.clientHeight))
    }

    panel.addEventListener('scroll', onScroll, { passive: true })
    return () => panel.removeEventListener('scroll', onScroll)
  }, [])

  // --- card interactions ----------------------------------------------------

  function handleFlashTap(cardId: string) {
    const now = Date.now()
    const last = lastTapRef.current[cardId] ?? 0
    if (last !== 0 && now - last < DOUBLE_TAP_MS) {
      lastTapRef.current[cardId] = 0
      setFlipped((prev) => ({ ...prev, [cardId]: !prev[cardId] }))
    } else {
      lastTapRef.current[cardId] = now
    }
  }

  function answerFlash(nodeId: string, card: FlashCard, knewIt: boolean) {
    if (flashAnswered[card.id] !== undefined) return
    setFlashAnswered((prev) => ({ ...prev, [card.id]: knewIt }))
    markGroupWatched(nodeId)
    sendCardResponse('flash', card.id, knewIt)
  }

  function answerQuestion(nodeId: string, card: QuestionCard, selected: string) {
    if (questionAnswered[card.id] !== undefined) return
    setQuestionAnswered((prev) => ({ ...prev, [card.id]: selected }))
    markGroupWatched(nodeId)
    sendCardResponse('question', card.id, selected === card.correct)
  }

  function renderInfoPage(page: Page) {
    return (
      <section key={page.key} className="reel-section">
        <article className="reel-card">
          <h2 className="reel-topic">{page.topic}</h2>
          <div className="prose-reel reel-body">
            <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
              {normalizeLatex(page.content ?? '')}
            </ReactMarkdown>
          </div>
        </article>
      </section>
    )
  }

  function renderFlashPage(page: Page) {
    const card = page.flash!
    const isFlipped = !!flipped[card.id]
    const answered = flashAnswered[card.id]
    const answeredState = answered === undefined ? null : answered ? 'right' : 'wrong'

    return (
      <section key={page.key} className="reel-section">
        <div className="flash-page">
          <div
            className={`flash-card ${isFlipped ? 'flipped' : ''}`}
            onClick={() => handleFlashTap(card.id)}
          >
            <div className="flash-face flash-front">
              <p className="flash-label">Flash card — double-tap to flip</p>
              <p className="flash-text">{card.front}</p>
            </div>
            <div className="flash-face flash-back">
              <p className="flash-label">Answer</p>
              <p className="flash-text">{card.back}</p>
            </div>
          </div>

          {answeredState === null ? (
            <div className="card-actions">
              <button
                className="card-action-btn card-action-btn--good"
                onClick={() => answerFlash(page.nodeId, card, true)}
                disabled={!isFlipped}
              >
                ✓ I knew it
              </button>
              <button
                className="card-action-btn card-action-btn--bad"
                onClick={() => answerFlash(page.nodeId, card, false)}
                disabled={!isFlipped}
              >
                ✗ Missed it
              </button>
            </div>
          ) : (
            <p className={`card-verdict ${answeredState === 'right' ? 'verdict-right' : 'verdict-wrong'}`}>
              {answeredState === 'right' ? 'Nice! Marked as known.' : 'Marked as missed — keep it in mind.'}
            </p>
          )}
        </div>
      </section>
    )
  }

  function renderQuestionPage(page: Page) {
    const card = page.question!
    const selected = questionAnswered[card.id]
    const answered = selected !== undefined

    return (
      <section key={page.key} className="reel-section">
        <div className="mcq-page">
          <h2 className="reel-topic">{page.topic}</h2>
          <p className="mcq-question">{card.question}</p>
          <div className="mcq-options">
            {card.options.map((opt) => {
              const isSelected = selected === opt
              const isCorrect = opt === card.correct
              let cls = 'mcq-option'
              if (answered) {
                if (isCorrect) cls += ' mcq-option--correct'
                else if (isSelected) cls += ' mcq-option--wrong'
                else cls += ' mcq-option--dim'
              }
              return (
                <button
                  key={opt}
                  className={cls}
                  disabled={answered}
                  onClick={() => answerQuestion(page.nodeId, card, opt)}
                >
                  {opt}
                </button>
              )
            })}
          </div>
          {answered && (
            <p className={`card-verdict ${selected === card.correct ? 'verdict-right' : 'verdict-wrong'}`}>
              {selected === card.correct ? 'Correct!' : 'Incorrect.'}
            </p>
          )}
        </div>
      </section>
    )
  }

  return (
    <div className="feed-container">
      {reels.length === 0 && (
        <div className="feed-loading">
          Loading reels…
        </div>
      )}
      {pages.map((page) =>
        page.kind === 'info'
          ? renderInfoPage(page)
          : page.kind === 'flash'
            ? renderFlashPage(page)
            : renderQuestionPage(page),
      )}
    </div>
  )
  }),
)

export default FeedPage
