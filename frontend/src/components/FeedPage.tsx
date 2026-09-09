import { memo, useEffect, useMemo, useRef, useState, forwardRef, useImperativeHandle } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import {
  api,
  loadReels,
  loadStoredCardAnswers,
  queueCardResponse,
  queueStatus,
  recordStatus,
  saveReels,
  storeCardAnswer,
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
  /** Reports the card/group currently on screen so the chat tab can follow it. */
  onActiveCard?: (ctx: FeedCardContext) => void
}

export interface FeedPageRef {
  refill: () => Promise<void>
}

// Context of the card currently being viewed — used to scope chat questions.
export interface FeedCardContext {
  streamId: string
  nodeId: string
  topic: string
  cardType: 'info' | 'flash' | 'question'
  cardId?: string
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

// hasSupplementalCards reports whether a group carries flash/quiz cards (and is
// therefore "finished only when all of them are answered").
function hasSupplementalCards(reel: FeedItem): boolean {
  return (reel.flash_cards?.length ?? 0) + (reel.question_cards?.length ?? 0) > 0
}

// isGroupComplete reports whether every flash and question card in the group
// has been answered (right or wrong).
function isGroupComplete(
  reel: FeedItem,
  flashAnswered: Record<string, boolean>,
  questionAnswered: Record<string, string>,
): boolean {
  const flashesAll = (reel.flash_cards ?? []).every((f) => flashAnswered[f.id] !== undefined)
  const questionsAll = (reel.question_cards ?? []).every((q) => questionAnswered[q.id] !== undefined)
  return flashesAll && questionsAll
}

const FeedPage = memo(
  forwardRef<FeedPageRef, FeedPageProps>(({ token, onError, onActiveCard }, ref) => {
  const [reels, setReels] = useState<FeedItem[]>(() => loadReels())
  const [activeIndex, setActiveIndex] = useState(0)
  const [flipped, setFlipped] = useState<Record<string, boolean>>({})

  // Hydrated from the persistent answer store so a resumed group re-opens with
  // previously answered cards locked as answered.
  const [flashAnswered, setFlashAnswered] = useState<Record<string, boolean>>(() => {
    const all = loadStoredCardAnswers()
    const out: Record<string, boolean> = {}
    for (const [id, a] of Object.entries(all)) {
      if (a.kind === 'flash' && a.correct !== undefined) out[id] = a.correct
    }
    return out
  })
  const [questionAnswered, setQuestionAnswered] = useState<Record<string, string>>(() => {
    const all = loadStoredCardAnswers()
    const out: Record<string, string> = {}
    for (const [id, a] of Object.entries(all)) {
      if (a.kind === 'question' && a.selected !== undefined) out[id] = a.selected
    }
    return out
  })

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
  // node_ids that reached "watched" (group complete, or timer fired on a group
  // without supplementary cards)
  const watchedRef = useRef<Set<string>>(new Set())
  const activeGroupRef = useRef<number>(-1)
  const timerRef = useRef<number | null>(null)
  const lastTapRef = useRef<Record<string, number>>({})
  const activeCardKeyRef = useRef<string>('')

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

  // Called after every answer; watches the group once ALL of its flash and
  // question cards are answered.
  function considerGroupWatched(
    nodeId: string,
    flashMap: Record<string, boolean>,
    questionMap: Record<string, string>,
  ) {
    if (watchedRef.current.has(nodeId) || reportedRef.current.has(nodeId)) return
    const reel = reelsRef.current.find((r) => r.node_id === nodeId)
    if (!reel) return
    // A group with no supplementary cards is not governed by answers.
    if (!hasSupplementalCards(reel)) return
    if (isGroupComplete(reel, flashMap, questionMap)) {
      markGroupWatched(nodeId)
    }
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

  // Finalize the verdict of the group we just left and watch it while resting
  // on its info page.
  useEffect(() => {
    if (pages.length === 0) return

    const group = groupIndexOfPage(reels, activeIndex)
    const prev = activeGroupRef.current
    if (prev >= 0 && prev !== group) {
      const reel = reels[prev]
      if (reel && !reportedRef.current.has(reel.node_id)) {
        if (hasSupplementalCards(reel)) {
          // Groups with flash/quiz cards are only "watched" when fully
          // answered. Leaving early does NOT report anything — the group stays
          // so the user can resume and finish it.
        } else if (!watchedRef.current.has(reel.node_id)) {
          reportNodeStatus(reel.node_id, 'skipped')
        }
      }
    }
    activeGroupRef.current = group

    if (group < 0) return
    const page = pages[activeIndex]
    const reel = reels[group]
    if (!reel) return

    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    // The 10s watch timer only applies to groups WITHOUT flash/quiz cards
    // (groups with cards are watched by completing them).
    if (
      page?.kind === 'info' &&
      !hasSupplementalCards(reel) &&
      !watchedRef.current.has(reel.node_id) &&
      !reportedRef.current.has(reel.node_id)
    ) {
      timerRef.current = window.setTimeout(() => {
        markGroupWatched(reel.node_id)
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

  // Tell the chat tab what card is on screen (stream-scoped context).
  useEffect(() => {
    const page = pages[activeIndex]
    if (!page) return
    const reel = reels.find((r) => r.node_id === page.nodeId)
    if (!reel) return

    let cardId: string | undefined
    let cardType: FeedCardContext['cardType'] = 'info'
    if (page.kind === 'flash') cardType = 'flash'
    else if (page.kind === 'question') cardType = 'question'

    if (cardType === 'info') cardId = reel.info_card_id || undefined
    else if (cardType === 'flash') cardId = page.flash?.id
    else cardId = page.question?.id

    const key = `${reel.stream_id}|${cardType}|${cardId ?? ''}`
    if (key === activeCardKeyRef.current) return
    activeCardKeyRef.current = key

    onActiveCard?.({ streamId: reel.stream_id, nodeId: reel.node_id, topic: reel.topic, cardType, cardId })
  }, [activeIndex, pages, reels, onActiveCard])

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
    storeCardAnswer(card.id, { kind: 'flash', correct: knewIt })
    const next = { ...flashAnswered, [card.id]: knewIt }
    setFlashAnswered(next)
    sendCardResponse('flash', card.id, knewIt)
    considerGroupWatched(nodeId, next, questionAnswered)
  }

  function answerQuestion(nodeId: string, card: QuestionCard, selected: string) {
    if (questionAnswered[card.id] !== undefined) return
    storeCardAnswer(card.id, { kind: 'question', selected })
    const next = { ...questionAnswered, [card.id]: selected }
    setQuestionAnswered(next)
    sendCardResponse('question', card.id, selected === card.correct)
    considerGroupWatched(nodeId, flashAnswered, next)
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
