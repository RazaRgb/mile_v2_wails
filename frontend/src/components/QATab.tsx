import { useState } from 'react'

interface QAItem {
  id: string
  question: string
  answer: string
}

// Static demo data — will be replaced with API calls later
const DEMO_QA: QAItem[] = [
  {
    id: '1',
    question: 'Where is this note from?',
    answer:
      'This note is sourced from your active learning stream. The content was generated based on the topic and reference materials you provided when creating the stream.',
  },
  {
    id: '2',
    question: 'Where is this note from?',
    answer:
      'The note originates from the curated knowledge base associated with your stream subscription.',
  },
  {
    id: '3',
    question: 'What does the note say?',
    answer:
      'The note says that No one shall be subjected to arbitrary arrest, detention or exile. It says that everyone is entitled in full equality to a fair and public hearing by an independent and impartial tribunal, in the determination of his rights and obligations and of any criminal charge against him.',
  },
  {
    id: '4',
    question: 'Where is this note from?',
    answer:
      'This section discusses fundamental human rights and their historical origins in international law.',
  },
  {
    id: '5',
    question: 'What does the note say?',
    answer:
      'The note says that No one shall be subjected to arbitrary arrest, detention or exile. It says that everyone is entitled in full equality to a fair and public hearing by an independent and impartial tribunal, in the determination of his rights and obligations and of any criminal charge against him.',
  }
]

export default function QATab() {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [inputValue, setInputValue] = useState('')

  function toggleItem(id: string) {
    setExpandedId((prev) => (prev === id ? null : id))
  }

  function handleSend() {
    if (!inputValue.trim()) return
    // TODO: send to API
    setInputValue('')
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="qa-container">
      <div className="qa-list">
        {DEMO_QA.map((item) => {
          const isExpanded = expandedId === item.id
          return (
            <div key={item.id} className="qa-item">
              <button
                className="qa-item-header"
                onClick={() => toggleItem(item.id)}
                aria-expanded={isExpanded}
              >
                <span className={`qa-chevron ${isExpanded ? 'expanded' : ''}`}>
                  ▶
                </span>
                {item.question}
              </button>
              {isExpanded && (
                <div className="qa-item-body">{item.answer}</div>
              )}
            </div>
          )
        })}
      </div>

      <div className="qa-input-wrapper">
        <div className="qa-input-icon">A</div>
        <div className="qa-input-box">
          <input
            placeholder="// Ask your doubts"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
      </div>
    </div>
  )
}
