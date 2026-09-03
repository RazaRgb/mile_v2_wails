import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { StreamItem } from '../lib/api'

interface StreamsMenuProps {
  open: boolean
  onClose: () => void
  token: string
  onShowProgress: (stream: StreamItem) => void
}

export default function StreamsMenu({ open, onClose, token, onShowProgress }: StreamsMenuProps) {
  const [streams, setStreams] = useState<StreamItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setError(null)
    api
      .listStreams(token)
      .then(setStreams)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load streams'))
      .finally(() => setLoading(false))
  }, [open, token])

  useEffect(() => {
    if (!confirmingId) return
    const t = window.setTimeout(() => setConfirmingId(null), 4000)
    return () => window.clearTimeout(t)
  }, [confirmingId])

  async function handleDelete(stream: StreamItem) {
    try {
      await api.deleteStream(stream.id, token)
      setStreams((prev) => prev.filter((s) => s.id !== stream.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete stream')
    } finally {
      setConfirmingId(null)
    }
  }

  return (
    <>
      <div 
        className={`drawer-backdrop ${open ? 'open' : ''}`} 
        onClick={onClose} 
      />

      <aside className={`drawer ${open ? 'open' : ''}`}>
        <div className="drawer-header">
          <h2 className="drawer-title">Streams</h2>
          <button
            onClick={onClose}
            aria-label="Close menu"
            className="drawer-close"
          >
            ✕
          </button>
        </div>

        <div className="drawer-body">
          {loading && <div className="stream-loading">Loading…</div>}
          
          {error && <div className="stream-error">{error}</div>}

          {!loading && streams.length === 0 && !error && (
            <div className="stream-empty">
              No streams yet. Add one from the + button below.
            </div>
          )}

          {streams.map((stream) => (
            <div key={stream.id} className="stream-card">
              <h3 className="stream-card-title">{stream.topic}</h3>
              <div className="stream-card-actions">
                <button
                  onClick={() => onShowProgress(stream)}
                  className="stream-btn stream-btn--progress"
                >
                  Progress
                </button>
                
                {confirmingId === stream.id ? (
                  <>
                    <button
                      onClick={() => handleDelete(stream)}
                      className="stream-btn stream-btn--confirm"
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => setConfirmingId(null)}
                      className="stream-btn stream-btn--cancel"
                      aria-label="Cancel delete"
                    >
                      ✕
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setConfirmingId(stream.id)}
                    className="stream-btn stream-btn--delete"
                    aria-label={`Delete stream ${stream.topic}`}
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </aside>
    </>
  )
}
