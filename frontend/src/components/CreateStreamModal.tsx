import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { api } from '../lib/api'

interface CreateStreamModalProps {
  open: boolean
  token: string
  onClose: () => void
  /** Called exactly once, when the backend confirms the stream was created. */
  onCreated: () => void
}

// The clarifying-questionnaire flow (backend asking cross-questions before
// creating a stream) is not implemented yet — it's a placeholder. For now a
// stream is created directly from its topic + optional instructions.
function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong'
}

export default function CreateStreamModal({ open, token, onClose, onCreated }: CreateStreamModalProps) {
  const [topic, setTopic] = useState('')
  const [instructions, setInstructions] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset the form every time the modal is opened.
  useEffect(() => {
    if (!open) return
    setTopic('')
    setInstructions('')
    setLoading(false)
    setError(null)
  }, [open])

  if (!open) return null

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmedTopic = topic.trim()
    if (!trimmedTopic || loading) return
    setError(null)
    setLoading(true)
    try {
      await api.createStream(trimmedTopic, instructions.trim(), token)
      onCreated()
    } catch (err) {
      setError(errMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-backdrop open">
      <div className="modal">
        <h2 className="modal-title">Create a New Stream</h2>

        {error && (
          <div style={{ color: 'var(--accent-cancel)', marginBottom: '16px' }}>{error}</div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="modal-field">
            <input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="// Stream Name"
              disabled={loading}
              autoFocus
              maxLength={255}
            />
          </div>

          <div className="modal-field">
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="// Instructions (optional) — e.g. focus on practical examples, assume I know the basics…"
              rows={4}
              disabled={loading}
              maxLength={2000}
            />
          </div>

          <p className="modal-hint">
            These instructions will steer what content is generated for this
            stream.
          </p>

          <div className="modal-actions">
            <button
              type="button"
              className="modal-btn modal-btn--cancel"
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="modal-btn modal-btn--create"
              disabled={loading || !topic.trim()}
            >
              {loading ? '…' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
