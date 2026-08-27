import { useEffect, useRef, useState } from 'react'
import { Box, cloneGrid, createEmptyGrid, Grid } from '../game/engine/types'
import { renderGrid } from '../game/render/CanvasRenderer'
import { saveCustomLevel } from '../storage/progress'
import { serializeLevel } from '../game/engine/levelSchema'

const CELL_SIZE = 32
type Tool = 'wall' | 'target' | 'empty' | 'normal-box' | 'container-box' | 'player'

const TOOLS: { tool: Tool; label: string }[] = [
  { tool: 'empty', label: '空地' },
  { tool: 'wall', label: '墙' },
  { tool: 'target', label: '目标点' },
  { tool: 'normal-box', label: '普通箱' },
  { tool: 'container-box', label: '容器箱' },
  { tool: 'player', label: '玩家起点' },
]

interface PathEntry {
  boxId: string
}

function getGridAtPath(root: Grid, path: PathEntry[]): Grid {
  let current = root
  for (const entry of path) {
    const box = current.boxes.find((b) => b.id === entry.boxId)!
    current = box.interior
  }
  return current
}

function setGridAtPath(root: Grid, path: PathEntry[], updater: (g: Grid) => Grid): Grid {
  if (path.length === 0) return updater(root)
  const next = cloneGrid(root)
  let current = next
  for (let i = 0; i < path.length - 1; i++) {
    current = current.boxes.find((b) => b.id === path[i].boxId)!.interior
  }
  const box = current.boxes.find((b) => b.id === path[path.length - 1].boxId)!
  box.interior = updater(cloneGrid(box.interior))
  return next
}

export function EditorScreen({ onBack }: { onBack: () => void }) {
  const [root, setRoot] = useState<Grid>(() => createEmptyGrid(6, 6))
  const [path, setPath] = useState<PathEntry[]>([])
  const [tool, setTool] = useState<Tool>('wall')
  const [levelName, setLevelName] = useState('')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const boxIdCounter = useRef(0)
  const lastClickRef = useRef<{ x: number; y: number; time: number } | null>(null)

  const activeGrid = getGridAtPath(root, path)

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d')
    if (ctx) renderGrid(ctx, activeGrid, 0, 0, CELL_SIZE)
  }, [activeGrid])

  const placeAt = (x: number, y: number) => {
    setRoot((r) =>
      setGridAtPath(r, path, (g) => {
        if (tool === 'normal-box' || tool === 'container-box') {
          // A double-click delivers its two constituent `click` events (plus the
          // final `dblclick`) to this same handler. Without this guard, the second
          // click of a double-click on an already-placed box of the same type would
          // delete and recreate it (new id, freshly emptied interior) right before
          // the double-click handler enters it — silently wiping any edited interior.
          const desiredType = tool === 'container-box' ? 'container' : 'normal'
          const existing = g.boxes.find((b) => b.x === x && b.y === y)
          if (existing && existing.boxType === desiredType) return g
        }
        const next = cloneGrid(g)
        next.boxes = next.boxes.filter((b) => !(b.x === x && b.y === y))
        if (tool === 'wall' || tool === 'target' || tool === 'empty') {
          next.cells[y][x] = tool === 'empty' ? 'empty' : tool
        } else if (tool === 'player') {
          next.player = { x, y }
        } else {
          const box: Box = {
            id: `box-${boxIdCounter.current++}`,
            x,
            y,
            boxType: tool === 'container-box' ? 'container' : 'normal',
            interior: createEmptyGrid(3, 3),
          }
          next.boxes.push(box)
        }
        return next
      }),
    )
  }

  const cellFromEvent = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = Math.floor((e.clientX - rect.left) / CELL_SIZE)
    const y = Math.floor((e.clientY - rect.top) / CELL_SIZE)
    return { x, y }
  }

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = cellFromEvent(e)
    if (x < 0 || y < 0 || x >= activeGrid.width || y >= activeGrid.height) return
    // A real double-click (and userEvent's simulation of one) delivers two `click`
    // events to this handler before the `dblclick` event fires. Without this guard,
    // the second click of a double-click on an existing box would replace it with
    // whatever tool is currently selected — regardless of which tool that is —
    // deleting the box (and its edited interior) right before handleCanvasDoubleClick
    // gets a chance to look for it and navigate in. Treat a same-cell click within
    // 400ms of the previous click as "the second click of a double-click" and skip
    // placement, leaving whatever was at that cell untouched.
    const now = Date.now()
    const last = lastClickRef.current
    const isLikelySecondClickOfDoubleClick = last !== null && last.x === x && last.y === y && now - last.time < 400
    lastClickRef.current = { x, y, time: now }
    if (isLikelySecondClickOfDoubleClick) return
    placeAt(x, y)
  }

  const handleCanvasDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = cellFromEvent(e)
    const box = activeGrid.boxes.find((b) => b.x === x && b.y === y && b.boxType === 'container')
    if (box) setPath((p) => [...p, { boxId: box.id }])
  }

  const breadcrumb = ['外层', ...path.map((p) => p.boxId)]

  return (
    <div className="editor-screen">
      <button onClick={onBack}>返回</button>
      <div className="breadcrumb">
        {breadcrumb.map((_, i) => (
          // Each crumb shows the cumulative path label (e.g. "外层 > box-0") as a
          // single text node rather than splitting labels/separators across nested
          // elements — Testing Library's getByText only matches an element's own
          // direct text-node children, not text concatenated across descendants.
          <button key={i} onClick={() => setPath(path.slice(0, i))}>
            {breadcrumb.slice(0, i + 1).join(' > ')}
          </button>
        ))}
      </div>
      <div className="tool-palette">
        {TOOLS.map(({ tool: t, label }) => (
          <button key={t} aria-label={label} aria-pressed={tool === t} onClick={() => setTool(t)}>
            {label}
          </button>
        ))}
      </div>
      <canvas
        data-testid="editor-canvas"
        ref={canvasRef}
        width={CELL_SIZE * activeGrid.width}
        height={CELL_SIZE * activeGrid.height}
        onClick={handleCanvasClick}
        onDoubleClick={handleCanvasDoubleClick}
      />
      <label>
        关卡名称
        <input aria-label="关卡名称" value={levelName} onChange={(e) => setLevelName(e.target.value)} />
      </label>
      <button
        onClick={() => {
          if (!levelName) return
          saveCustomLevel(levelName, serializeLevel(root))
        }}
      >
        储存
      </button>
      <button
        onClick={() => {
          const blob = new Blob([serializeLevel(root)], { type: 'application/json' })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = `${levelName || 'level'}.json`
          a.click()
          URL.revokeObjectURL(url)
        }}
      >
        汇出 JSON
      </button>
      <div style={{ display: 'none' }}>
        {activeGrid.cells.map((row, y) =>
          row.map((cell, x) => (
            <span key={`${x}-${y}`} data-testid={`cell-type-${x}-${y}`}>
              {cell}
            </span>
          )),
        )}
        {activeGrid.boxes.map((box) => (
          <span key={box.id} data-testid={`box-at-${box.x}-${box.y}`}>
            {box.boxType}
          </span>
        ))}
      </div>
    </div>
  )
}
