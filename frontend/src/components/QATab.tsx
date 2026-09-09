import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../lib/api'
import type { ChatMessage, StreamItem } from '../lib/api'
import type { FeedCardContext } from './FeedPage'

interface QATabProps {
  token: string
  /** The card currently on screen in the feed (if its stream is selected, new
   *  questions are tagged to it). */
  context: FeedCardContext | null
}

interface QAItem {
  key: string
  question?: string
  answer?: string
  cardType?: string
}

const NIL = '00000000-0000-0000-0000-000000000000'

// Pair the flat message log (user/assistant rows) into accordion Q&A entries.
function toItems(messages: ChatMessage[]): QAItem[] {
  const items: QAItem[] = []
  for (const m of messages) {
    if (m.role === 'user') {
      items.push({
        key: m.id,
        question: m.content,
        cardType: m.card_type || undefined,
      })
    } else if (m.role === 'assistant') {
      const last = items[items.length - 1]
      if (last && last.answer === undefined) last.answer = m.content
      else items.push({ key: m.id, answer: m.content })
    }
  }
  return items
}

function kindLabel(t: string | undefined): string {
  if (t === 'flash') return 'flash card'
  if (t === 'question') return 'quiz card'
  if (t === 'info') return 'lesson'
  return ''
}

export default function QATab({ token, context }: QATabProps) {
  const [streams, setStreams] = useState<StreamItem[]>([])
  const [selectedId, setSelectedId] = useState<string>('')
  const manualStreamRef = useRef({ value: false })
  const [tag, setTag] = useState<{ cardType: 'info' | 'flash' | 'question'; cardId: string } | null>(null)

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  // Load the user's streams once.
  useEffect(() => {
    if (!token) return
    api
      .listStreams(token)
      .then((list) => {
        setStreams(list)
        if (list.length > 0 && !manualStreamRef.current.value) {
          setSelectedId((prev) => prev || list[0].id)
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load streams'))
  }, [token])

  // Follow the card currently being viewed in the feed (unless the user
  // explicitly picked a different stream).
  useEffect(() => {
    if (!context?.streamId || manualStreamRef.current.value) return
    if (streams.some((s) => s.id === context.streamId)) {
      setSelectedId(context.streamId)
    }
  }, [context, streams])

  // Sync the card tag with the feed context (only while its stream is shown).
  useEffect(() => {
    if (context?.streamId && context.streamId === selectedId) {
      const cardId = context.cardId ?? ''
      setTag(cardId && cardId !== NIL ? { cardType: context.cardType, cardId } : null)
    } else {
      setTag(null)
    }
  }, [context, selectedId])

  const selectedStream = useMemo(
    () => streams.find((s) => s.id === selectedId) ?? null,
    [streams, selectedId],
  )

  // Load history whenever the selected stream changes.
  useEffect(() => {
    if (!token || !selectedId) return
    let cancelled = false
    setMessages([])
    api
      .getChat(selectedId, token)
      .then((msgs) => {
        if (!cancelled) setMessages(msgs)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load chat')
      })
    return () => {
      cancelled = true
    }
  }, [selectedId, token])

  // Keep the newest messages in view, and auto-expand a fresh Q&A pair.
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
    if (messages.length > 0) {
      const lastUser = [...messages].reverse().find((m) => m.role === 'user')
      if (lastUser) setExpanded((prev) => ({ ...prev, [lastUser.id]: true }))
    }
  }, [messages.length, messages])

  const items = useMemo(() => toItems(messages), [messages])

  function toggleItem(key: string) {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  async function handleSend() {
    const question = input.trim()
    if (!question || !token || !selectedId || sending) return
    setSending(true)
    setError(null)
    try {
      const updated = tag ? await api.askChat(selectedId, question, token, tag) : await api.askChat(selectedId, question, token)
      setMessages(updated)
      setInput('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to ask')
    } finally {
      setSending(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  return (
    <div className="qa-container">
      <div className="chat-topbar">
        <select
          className="chat-select"
          value={selectedStream?.id ?? ''}
          onChange={(e) => {
            manualStreamRef.current.value = true
            setSelectedId(e.target.value)
          }}
        >
          {streams.length === 0 && <option value="">No streams yet</option>}
          {streams.map((s) => (
            <option key={s.id} value={s.id}>
              {s.topic}
            </option>
          ))}
        </select>

        {tag && (
          <button
            className="chat-context-chip"
            onClick={() => setTag(null)}
            title="Click to ask without a card reference"
          >
            Asking about {kindLabel(tag.cardType)}
            <span className="chat-context-clear">✕</span>
          </button>
        )}
      </div>

      {error && <div className="chat-error">{error}</div>}

      <div className="qa-list" ref={listRef}>
        {!selectedStream && <p className="chat-empty">Create a stream to start asking questions.</p>}
        {selectedStream && messages.length === 0 && (
          <p className="chat-empty">
            No questions yet for “{selectedStream.topic}”. Ask anything about a lesson or card — the
            answer is grounded in your content.
          </p>
        )}

        {items.map((it) => {
          const isOpen = it.question === undefined || expanded[it.key]
          return (
            <div key={it.key} className="qa-item">
              {it.question !== undefined && (
                <button
                  className="qa-item-header"
                  onClick={() => toggleItem(it.key)}
                  aria-expanded={isOpen}
                >
                  <span className={`qa-chevron ${isOpen ? 'expanded' : ''}`}>▶</span>
                  <span className="qa-question-text">{it.question}</span>
                  {it.cardType && <span className="qa-chip">{kindLabel(it.cardType)}</span>}
                </button>
              )}
              {it.answer !== undefined && isOpen && (
                <div className="qa-item-body">{it.answer}</div>
              )}
            </div>
          )
        })}
      </div>

      <div className="qa-input-wrapper">
        <div className="qa-input-box">
          <input
            placeholder={tag ? `Ask about this ${kindLabel(tag.cardType)}…` : 'Ask anything about this stream…'}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={sending || !selectedStream}
          />
        </div>
        <button
          className="qa-send"
          onClick={() => void handleSend()}
          disabled={sending || !input.trim() || !selectedStream}
        >
          ➤
        </button>
      </div>
    </div>
  )
}
