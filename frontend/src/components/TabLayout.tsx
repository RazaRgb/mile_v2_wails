import { useCallback, useState, useRef, memo } from 'react'
import NotesTab from './NotesTab'
import QATab from './QATab'
import CreateStreamModal from './CreateStreamModal'
import StreamsMenu from './StreamsMenu'
import ProgressView from './ProgressView'
import { type StreamItem } from '../lib/api'
import FeedPage, { type FeedCardContext, type FeedPageRef } from './FeedPage'

interface TabLayoutProps {
  token: string
  onLogout: () => void
}

// Tabs stay mounted (so their state/scroll is preserved) but are memoized so
// switching tabs only moves the slider instead of re-rendering every page
// (FeedPage renders heavy Markdown/KaTeX content per reel).
const NotesTabView = memo(NotesTab)
const QATabView = memo(QATab)

const CHAT_TAB = 2
const CHAT_PEEK_PERCENT = 20

// Percent by which to translate the slider to rest on a tab.
// When resting on Chat, keep ~20% of the Feed visible on the left edge.
function tabShiftPercent(tab: number): number {
  return -(tab * 100 - (tab === CHAT_TAB ? CHAT_PEEK_PERCENT : 0))
}

export default function TabLayout({ token, onLogout }: TabLayoutProps) {
  // 0: Notes, 1: Feed, 2: Q&A
  const [activeTab, setActiveTab] = useState(1)
  
  // Overlays
  const [menuOpen, setMenuOpen] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [progressStream, setProgressStream] = useState<StreamItem | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The card currently on screen in the feed — drives which stream/card the
  // chat tab is scoped to.
  const [chatCtx, setChatCtx] = useState<FeedCardContext | null>(null)
  const handleActiveCard = useCallback((ctx: FeedCardContext) => setChatCtx(ctx), [])
  
  // Swipe detection / drag-follow
  const sliderRef = useRef<HTMLDivElement | null>(null)
  const touchStartX = useRef<number | null>(null)
  const touchStartY = useRef<number | null>(null)
  const dragAxis = useRef<'h' | 'v' | null>(null)
  const touching = useRef(false)
  const rafRef = useRef<number | null>(null)
  const pendingDelta = useRef(0)

  //const feedRef = useRef<{ refill: () => void } | null>(null)
  const feedRef = useRef<FeedPageRef | null>(null)

  function handleTouchStart(e: React.TouchEvent) {
    const el = sliderRef.current
    if (!el) return
    touchStartX.current = e.targetTouches[0].clientX
    touchStartY.current = e.targetTouches[0].clientY
    dragAxis.current = null
    touching.current = true
    pendingDelta.current = 0
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    // Kill the CSS transition so the strip follows the finger 1:1
    el.style.transition = 'none'
  }

  function paintDrag() {
    rafRef.current = null
    const el = sliderRef.current
    if (!el || !touching.current) return
    el.style.transform = `translateX(calc(${tabShiftPercent(activeTab)}% + ${pendingDelta.current}px))`
  }

  function handleTouchMove(e: React.TouchEvent) {
    const el = sliderRef.current
    if (!touching.current || !el || touchStartX.current === null || touchStartY.current === null) return

    const x = e.targetTouches[0].clientX
    const y = e.targetTouches[0].clientY
    const dx = x - touchStartX.current
    const dy = y - touchStartY.current

    // Lock to horizontal or vertical once the gesture direction is clear,
    // so scrolling a panel vertically doesn't wobble the slider sideways.
    if (!dragAxis.current) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
      dragAxis.current = Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v'
    }
    if (dragAxis.current === 'v') return

    let delta = dx
    // Don't pull empty space past the first/last tab
    if (activeTab === 0) delta = Math.min(delta, 0)
    else if (activeTab === 2) delta = Math.max(delta, 0)

    pendingDelta.current = delta
    // Write the transform at most once per frame (touch events can fire faster)
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(paintDrag)
    }
  }

  function settleDrag(finalX: number | null) {
    const el = sliderRef.current
    const startX = touchStartX.current
    const wasVertical = dragAxis.current === 'v'
    touchStartX.current = null
    touchStartY.current = null
    dragAxis.current = null
    touching.current = false
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }

    if (!el) return

    const base = tabShiftPercent(activeTab)

    if (startX === null || finalX === null || wasVertical) {
      // Just a tap or a vertical scroll — make sure we rest on the current tab
      el.style.transition = ''
      el.style.transform = `translateX(${base}%)`
      return
    }

    // Flush the last finger position so the snap starts exactly where we let go
    el.style.transform = `translateX(calc(${base}% + ${pendingDelta.current}px))`
    el.style.transition = '' // Re-enable CSS transition for the snap

    const swipeThreshold = 50
    const diffX = startX - finalX // > 0 => swiped left => next tab

    let target = activeTab
    if (diffX > swipeThreshold) target = Math.min(activeTab + 1, 2)
    else if (diffX < -swipeThreshold) target = Math.max(activeTab - 1, 0)

    if (target === activeTab) {
      // Snap back to the original tab with a smooth animation
      el.style.transform = `translateX(${base}%)`
    } else {
      setActiveTab(target)
    }
  }

  function handleTouchEnd(e: React.TouchEvent) {
    const finalX = e.changedTouches[0]?.clientX ?? null
    settleDrag(finalX)
  }

  function handleTouchCancel() {
    settleDrag(null)
  }

  async function handleCreated() {
    // Stream finished the Q&A rounds and was created on the backend.
    setModalOpen(false)
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
          <span className="header-brand">MILE</span>
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
        onTouchCancel={handleTouchCancel}
      >
        <div 
          className="tab-slider" 
          ref={sliderRef}
          style={{ transform: `translateX(${tabShiftPercent(activeTab)}%)` }}
        >
          <div className="tab-panel"><NotesTabView /></div>
          <div className="tab-panel tab-panel--feed">
            <FeedPage token={token} ref={feedRef} onError={setError} onActiveCard={handleActiveCard} />
          </div>
          <div className="tab-panel"><QATabView token={token} context={chatCtx} /></div>
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
            className={`bottom-bar-btn ${activeTab === 1 ? 'active' : ''}`}
            onClick={() => setActiveTab(1)}
            style={{
              borderTopRightRadius:0,
              borderBottomRightRadius:0,
              borderTopLeftRadius:0,
              borderBottomLeftRadius:0,
              }}
          >
            FEED
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
        onAddStream={() => {
          setMenuOpen(false)
          setModalOpen(true)
        }}
        onShowProgress={(s) => {
          setProgressStream(s)
          setMenuOpen(false)
        }}
      />
      
      <CreateStreamModal 
        open={modalOpen} 
        token={token}
        onClose={() => setModalOpen(false)} 
        onCreated={handleCreated}
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
