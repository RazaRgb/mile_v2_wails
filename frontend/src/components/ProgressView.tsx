import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import type { StreamItem, TreeNode } from '../lib/api'

interface ProgressViewProps {
  stream: StreamItem
  token: string
  onClose: () => void
}

interface TreeNodeItem extends TreeNode {
  children: TreeNodeItem[]
  depth: number
}

function buildTree(nodes: TreeNode[]): TreeNodeItem[] {
  const sorted = [...nodes].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  const byPath = new Map<string, TreeNodeItem>()
  const roots: TreeNodeItem[] = []

  for (const n of sorted) {
    const item: TreeNodeItem = { ...n, children: [], depth: 0 }
    byPath.set(n.path, item)
    const idx = n.path.lastIndexOf('.')
    if (idx >= 0) {
      const parent = byPath.get(n.path.slice(0, idx))
      if (parent) {
        parent.children.push(item)
        item.depth = parent.depth + 1
        continue
      }
    }
    roots.push(item)
  }
  return roots
}

function nodeMarker(n: TreeNodeItem): { symbol: string; className: string } {
  if (!n.is_leaf) return { symbol: '', className: '' }
  switch (n.status) {
    case 'watched':
      return { symbol: '●', className: 'watched' }
    case 'skipped':
      return { symbol: '◐', className: 'skipped' }
    case 'unwatched':
      return { symbol: '○', className: 'unwatched' }
    default:
      return { symbol: '·', className: 'not-started' }
  }
}

function allCollapsible(items: TreeNodeItem[]): string[] {
  const out: string[] = []
  const walk = (list: TreeNodeItem[]) => {
    for (const it of list) {
      if (it.depth >= 2) out.push(it.path)
      walk(it.children)
    }
  }
  walk(items)
  return out
}

export default function ProgressView({ stream, token, onClose }: ProgressViewProps) {
  const [nodes, setNodes] = useState<TreeNode[]>([])
  const [error, setError] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  useEffect(() => {
    api
      .streamTree(stream.id, token)
      .then((tree) => {
        setNodes(tree)
        setCollapsed(new Set(allCollapsible(buildTree(tree))))
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load tree'))
  }, [stream.id, token])

  const roots = useMemo(() => buildTree(nodes), [nodes])

  const counts = useMemo(() => {
    const c = { watched: 0, skipped: 0, unwatched: 0, notStarted: 0 }
    for (const n of nodes) {
      if (!n.is_leaf) continue
      switch (n.status) {
        case 'watched':
          c.watched++
          break
        case 'skipped':
          c.skipped++
          break
        case 'unwatched':
          c.unwatched++
          break
        default:
          c.notStarted++
      }
    }
    return c
  }, [nodes])

  function toggle(path: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  function renderTree(items: TreeNodeItem[], prefix = ''): React.ReactNode[] {
    return items.map((it, i) => {
      const isLast = i === items.length - 1
      const connector = prefix === '' ? '' : isLast ? '└── ' : '├── '
      const childPrefix = prefix + (prefix === '' ? '' : isLast ? '    ' : '│   ')
      const isCollapsed = collapsed.has(it.path)
      const marker = nodeMarker(it)

      return (
        <div key={it.node_id}>
          <button
            onClick={() => it.children.length > 0 && toggle(it.path)}
            className="progress-tree-node"
          >
            <span className="progress-tree-connector">{connector}</span>
            {it.children.length > 0 && (
              <span className="progress-tree-toggle">{isCollapsed ? '▸' : '▾'}</span>
            )}
            <span
              className={`progress-tree-label ${it.children.length > 0 ? 'branch' : ''}`}
            >
              {it.topic}
            </span>
            <span className={`progress-tree-marker ${marker.className}`}>{marker.symbol}</span>
          </button>
          {!isCollapsed && renderTree(it.children, childPrefix)}
        </div>
      )
    })
  }

  return (
    <div className="progress-overlay">
      <div className="progress-header">
        <div className="progress-header-info">
          <h2 className="progress-title">{stream.topic}</h2>
          <p className="progress-stats">
            <span className="watched">{counts.watched} watched</span>
            {' · '}
            <span className="skipped">{counts.skipped} skipped</span>
            {' · '}
            <span>{counts.unwatched + counts.notStarted} to go</span>
          </p>
        </div>
        <button
          onClick={onClose}
          aria-label="Close progress view"
          className="progress-close"
        >
          ✕
        </button>
      </div>

      <div className="progress-legend">
        <span><span className="watched">●</span> watched</span>
        <span><span className="skipped">◐</span> skipped</span>
        <span><span className="unwatched">○</span> unwatched</span>
        <span><span className="not-started">·</span> not started</span>
        <span className="progress-legend-actions">
          <button onClick={() => setCollapsed(new Set())}>Expand all</button>
          <button onClick={() => setCollapsed(new Set(allCollapsible(roots)))}>Collapse all</button>
        </span>
      </div>

      <div className="progress-tree">
        {error && <div className="progress-error">{error}</div>}
        {nodes.length === 0 && !error && <p style={{ color: 'var(--text-muted)' }}>Loading…</p>}
        {nodes.length > 0 && (
          <div>
            {roots.map((r) => (
              <div key={r.node_id}>
                <button
                  onClick={() => r.children.length > 0 && toggle(r.path)}
                  className="progress-tree-node"
                >
                  {r.children.length > 0 && (
                    <span className="progress-tree-toggle">
                      {collapsed.has(r.path) ? '▸' : '▾'}
                    </span>
                  )}
                  <span className="progress-tree-label branch">{r.topic}</span>
                </button>
                {!collapsed.has(r.path) && renderTree(r.children, '')}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
