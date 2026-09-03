import { useState, useRef } from 'react'
import FeedPage from './FeedPage'
import NotesTab from './NotesTab'
import QATab from './QATab'
import CreateStreamModal from './CreateStreamModal'
import StreamsMenu from './StreamsMenu'
import ProgressView from './ProgressView'
import { api, type StreamItem } from '../lib/api'

interface TabLayoutProps {
  token: string
  onLogout: () => void
}

export default function TabLayout({ token, onLogout }: TabLayoutProps) {
  // 0: Notes, 1: Feed, 2: Q&A
  const [activeTab, setActiveTab] = useState(1)
  
  // Overlays
  const [menuOpen, setMenuOpen] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [progressStream, setProgressStream] = useState<StreamItem | null>(null)
  const [error, setError] = useState<string | null>(null)
  
  // Swipe detection
  const touchStartX = useRef<number | null>(null)
  const touchEndX = useRef<number | null>(null)

  const feedRef = useRef<{ refill: () => void } | null>(null)

  function handleTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.targetTouches[0].clientX
    touchEndX.current = null
  }

  function handleTouchMove(e: React.TouchEvent) {
    touchEndX.current = e.targetTouches[0].clientX
  }

  function handleTouchEnd() {
    if (touchStartX.current === null || touchEndX.current === null) return
    
    const diffX = touchStartX.current - touchEndX.current
    const swipeThreshold = 50

    if (diffX > swipeThreshold) {
      setActiveTab((prev) => Math.min(prev + 1, 2))
    } else if (diffX < -swipeThreshold) {
      setActiveTab((prev) => Math.max(prev - 1, 0))
    }
    
    touchStartX.current = null
    touchEndX.current = null
  }

  async function handleCreateStream(topic: string, instructions: string, files: File[]) {
    await api.createStream(topic, token)
    if (feedRef.current) {
      feedRef.current.refill()
    }
  }

  return (
    <div style={{ height: '100%', width: '100%', overflow: 'hidden' }}>
      
      <header className="app-header">
        <div className="header-left">
          <button 
            className="header-hamburger" 
            onClick={() => setMenuOpen(true)}
          >
            ☰
          </button>
        </div>
        <div className="header-center">
          MILE
        </div>
        <div className="header-right">
          <button className="header-icon" onClick={onLogout}>
            ☼
          </button>
        </div>
      </header>

      {error && (
        <div style={{
          position: 'fixed', top: '70px', left: '20px', right: '20px',
          background: 'var(--accent-delete)', color: 'white', padding: '10px',
          borderRadius: '8px', zIndex: 150, textAlign: 'center'
        }}>
          {error}
        </div>
      )}

      <main 
        className="tab-layout"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div 
          className="tab-slider" 
          style={{ transform: `translateX(-${activeTab * 100}%)` }}
        >
          <div className="tab-panel"><NotesTab /></div>
          <div className="tab-panel tab-panel--feed">
            <FeedPage token={token} ref={feedRef} onError={setError} />
          </div>
          <div className="tab-panel"><QATab /></div>
        </div>
      </main>

      <div className="bottom-gradient" />

      <div className="bottom-bar-container">
        <nav className="bottom-bar">
          <button 
            className={`bottom-bar-btn ${activeTab === 0 ? 'active' : ''}`}
            onClick={() => setActiveTab(0)}
            style={{
              borderTopRightRadius:0,
              borderBottomRightRadius:0,
              }}
          >
            Notes
          </button>
          <button 
            className="bottom-bar-btn"
            onClick={() => setModalOpen(true)}
            style={{
              borderTopRightRadius:0,
              borderBottomRightRadius:0,
              borderTopLeftRadius:0,
              borderBottomLeftRadius:0,
              }}
          >
            ADD STREAM

          </button>
          <button 
            className={`bottom-bar-btn ${activeTab === 2 ? 'active' : ''}`}
            onClick={() => setActiveTab(2)}
            style={{
              borderTopLeftRadius:0,
              borderBottomLeftRadius:0,
              }}
          >
            CHAT
          </button>
        </nav>
      </div>

      <StreamsMenu 
        open={menuOpen} 
        onClose={() => setMenuOpen(false)} 
        token={token} 
        onShowProgress={(s) => {
          setProgressStream(s)
          setMenuOpen(false)
        }}
      />
      
      <CreateStreamModal 
        open={modalOpen} 
        onClose={() => setModalOpen(false)} 
        onCreate={handleCreateStream} 
      />

      {progressStream && (
        <ProgressView 
          stream={progressStream} 
          token={token} 
          onClose={() => setProgressStream(null)} 
        />
      )}
      
    </div>
  )
}
