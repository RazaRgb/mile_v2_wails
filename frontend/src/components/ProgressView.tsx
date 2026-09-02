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

// Builds the nested tree from flat nodes (paths are zero-padded, so sorting by
// path gives parents before children).
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

// Marker for a leaf node; branches get none.
function nodeMarker(n: TreeNodeItem): { symbol: string; className: string } {
  if (!n.is_leaf) return { symbol: '', className: '' }
  switch (n.status) {
    case 'watched':
      return { symbol: '●', className: 'text-green-400' }
    case 'skipped':
      return { symbol: '◐', className: 'text-amber-400' }
    case 'unwatched':
      return { symbol: '○', className: 'text-slate-400' }
    default:
      return { symbol: '·', className: 'text-slate-600' }
  }
}

// All paths at depth >= 2 (default-collapsed), for the "collapse all" reset.
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
        // Default: roots and their children visible, deeper branches collapsed.
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
            className="flex w-full items-center gap-1.5 py-0.5 text-left"
          >
            <span className="whitespace-pre font-mono text-slate-600">{connector}</span>
            {it.children.length > 0 && (
              <span className="w-3 shrink-0 text-xs text-slate-500">{isCollapsed ? '▸' : '▾'}</span>
            )}
            <span
              className={`truncate text-sm ${it.children.length === 0 ? 'text-slate-300' : 'font-semibold text-slate-200'}`}
            >
              {it.topic}
            </span>
            <span className={`ml-auto shrink-0 text-sm ${marker.className}`}>{marker.symbol}</span>
          </button>
          {!isCollapsed && renderTree(it.children, childPrefix)}
        </div>
      )
    })
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-slate-950">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-bold text-white">{stream.topic}</h2>
          <p className="text-xs text-slate-400">
            <span className="text-green-400">{counts.watched} watched</span>
            {' · '}
            <span className="text-amber-400">{counts.skipped} skipped</span>
            {' · '}
            <span className="text-slate-300">{counts.unwatched + counts.notStarted} to go</span>
          </p>
        </div>
        <button
          onClick={onClose}
          aria-label="Close progress view"
          className="shrink-0 rounded-lg px-2.5 py-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
        >
          ✕
        </button>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-800 px-4 py-2 text-xs text-slate-400">
        <span><span className="text-green-400">●</span> watched</span>
        <span><span className="text-amber-400">◐</span> skipped</span>
        <span><span className="text-slate-400">○</span> unwatched</span>
        <span><span className="text-slate-600">·</span> not started</span>
        <span className="ml-auto flex gap-2">
          <button onClick={() => setCollapsed(new Set())} className="text-slate-500 hover:text-slate-300">
            Expand all
          </button>
          <button
            onClick={() => setCollapsed(new Set(allCollapsible(roots)))}
            className="text-slate-500 hover:text-slate-300"
          >
            Collapse all
          </button>
        </span>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto p-4">
        {error && <p className="rounded-lg bg-red-950/60 px-3 py-2 text-sm text-red-300">{error}</p>}
        {nodes.length === 0 && !error && <p className="text-sm text-slate-400">Loading…</p>}
        {nodes.length > 0 && (
          <div className="space-y-0.5">
            {roots.map((r) => (
              <div key={r.node_id}>
                <button
                  onClick={() => r.children.length > 0 && toggle(r.path)}
                  className="flex w-full items-center gap-1.5 py-0.5 text-left"
                >
                  {r.children.length > 0 && (
                    <span className="w-3 shrink-0 text-xs text-slate-500">
                      {collapsed.has(r.path) ? '▸' : '▾'}
                    </span>
                  )}
                  <span className="truncate text-sm font-semibold text-white">{r.topic}</span>
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
