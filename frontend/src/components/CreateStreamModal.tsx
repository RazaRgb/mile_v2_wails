import { useState, type FormEvent } from 'react'

interface CreateStreamModalProps {
  open: boolean
  onClose: () => void
  onCreate: (topic: string, instructions: string, files: File[]) => Promise<void>
}

export default function CreateStreamModal({ open, onClose, onCreate }: CreateStreamModalProps) {
  const [topic, setTopic] = useState('')
  const [instructions, setInstructions] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) return null

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) {
      setFiles((prev) => [...prev, ...Array.from(e.target.files!)])
    }
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!topic.trim()) {
      setError('Stream Name is required')
      return
    }
    setError(null)
    setLoading(true)
    try {
      await onCreate(topic, instructions, files)
      setTopic('')
      setInstructions('')
      setFiles([])
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create stream')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={`modal-backdrop ${open ? 'open' : ''}`}>
      <div className="modal">
        <h2 className="modal-title">Create a New Stream</h2>
        
        {error && <div style={{ color: 'var(--accent-cancel)', marginBottom: '16px' }}>{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="modal-field">
            <input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="// Stream Name"
              disabled={loading}
            />
          </div>

          <div className="modal-field">
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="// Instructions"
              disabled={loading}
              rows={3}
            />
          </div>

          <div className="modal-field">
            <div style={{ color: 'var(--text-muted)', marginBottom: '8px', fontSize: '0.9rem' }}>// Add files</div>
            
            {files.length > 0 && (
              <div style={{ marginBottom: '12px' }}>
                {files.map((f, i) => (
                  <div key={i} className="file-item">
                    <span>{f.name}</span>
                    <button 
                      type="button" 
                      className="file-item-remove" 
                      onClick={() => removeFile(i)}
                    >
                      X
                    </button>
                  </div>
                ))}
              </div>
            )}
            
            <label className="add-file-btn" style={{ cursor: 'pointer' }}>
              Add a file
              <input 
                type="file" 
                multiple 
                onChange={handleFileChange} 
                style={{ display: 'none' }}
                disabled={loading}
              />
            </label>
          </div>

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
              disabled={loading}
            >
              {loading ? '...' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
