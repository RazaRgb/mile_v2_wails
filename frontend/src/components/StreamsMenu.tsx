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
  // Stream awaiting a second tap to confirm deletion (replaces window.confirm,
  // which the wails WebView doesn't support).
  const [confirmingId, setConfirmingId] = useState<string | null>(null)

  // Fetch the user's streams each time the menu opens.
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

  // If the user doesn't follow through, drop the confirm state after a few seconds.
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
      {/* Backdrop */}
      {open && <div className="fixed inset-0 z-20 bg-black/60" onClick={onClose} />}

      {/* Drawer */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 w-80 max-w-[85vw] transform bg-slate-900 shadow-2xl transition-transform duration-200 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <h2 className="font-semibold text-white">Your streams</h2>
          <button
            onClick={onClose}
            aria-label="Close menu"
            className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            ✕
          </button>
        </div>

        <div className="max-h-[calc(100vh-4rem)] overflow-y-auto p-3">
          {loading && <p className="px-2 py-4 text-sm text-slate-400">Loading…</p>}
          {error && <p className="mb-3 rounded-lg bg-red-950/60 px-3 py-2 text-sm text-red-300">{error}</p>}

          {!loading && streams.length === 0 && !error && (
            <p className="px-2 py-4 text-sm text-slate-400">
              No streams yet. Add one from the bottom bar.
            </p>
          )}

          <ul className="space-y-2">
            {streams.map((stream) => (
              <li
                key={stream.id}
                className="flex items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-200">{stream.topic}</p>
                  <p className="text-xs text-slate-500">{new Date(stream.created_at).toLocaleDateString()}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => onShowProgress(stream)}
                    className="rounded-lg px-2 py-1 text-sm text-indigo-400 hover:bg-indigo-950/50 hover:text-indigo-300"
                  >
                    Progress
                  </button>
                  {confirmingId === stream.id ? (
                  <span className="flex shrink-0 items-center gap-1">
                    <button
                      onClick={() => handleDelete(stream)}
                      className="rounded-lg bg-red-900/70 px-2 py-1 text-xs font-semibold text-red-200 hover:bg-red-900"
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => setConfirmingId(null)}
                      aria-label="Cancel delete"
                      className="rounded-lg px-1.5 py-1 text-xs text-slate-400 hover:bg-slate-800"
                    >
                      ✕
                    </button>
                  </span>
                ) : (
                  <button
                    onClick={() => setConfirmingId(stream.id)}
                    aria-label={`Delete stream ${stream.topic}`}
                    className="shrink-0 rounded-lg px-2 py-1 text-sm text-red-400 hover:bg-red-950/50 hover:text-red-300"
                  >
                    Delete
                  </button>
                )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </>
  )
}
