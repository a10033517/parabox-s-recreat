import { useEffect, useRef, useState } from 'react'
import { Box, cloneGrid, createEmptyGrid, Grid } from '../game/engine/types'
import { renderGrid } from '../game/render/CanvasRenderer'

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

let boxIdCounter = 0

export function EditorScreen({ onBack }: { onBack: () => void }) {
  const [grid, setGrid] = useState<Grid>(() => createEmptyGrid(6, 6))
  const [tool, setTool] = useState<Tool>('wall')
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d')
    if (ctx) renderGrid(ctx, grid, 0, 0, CELL_SIZE)
  }, [grid])

  const placeAt = (x: number, y: number) => {
    setGrid((g) => {
      const next = cloneGrid(g)
      next.boxes = next.boxes.filter((b) => !(b.x === x && b.y === y))
      if (tool === 'wall' || tool === 'target' || tool === 'empty') {
        next.cells[y][x] = tool === 'empty' ? 'empty' : tool
      } else if (tool === 'player') {
        next.player = { x, y }
      } else {
        const box: Box = {
          id: `box-${boxIdCounter++}`,
          x,
          y,
          boxType: tool === 'container-box' ? 'container' : 'normal',
          interior: createEmptyGrid(3, 3),
        }
        next.boxes.push(box)
      }
      return next
    })
  }

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = Math.floor((e.clientX - rect.left) / CELL_SIZE)
    const y = Math.floor((e.clientY - rect.top) / CELL_SIZE)
    if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return
    placeAt(x, y)
  }

  return (
    <div className="editor-screen">
      <button onClick={onBack}>返回</button>
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
        width={CELL_SIZE * grid.width}
        height={CELL_SIZE * grid.height}
        onClick={handleCanvasClick}
      />
      <div style={{ display: 'none' }}>
        {grid.cells.map((row, y) =>
          row.map((cell, x) => (
            <span key={`${x}-${y}`} data-testid={`cell-type-${x}-${y}`}>
              {cell}
            </span>
          )),
        )}
        {grid.boxes.map((box) => (
          <span key={box.id} data-testid={`box-at-${box.x}-${box.y}`}>
            {box.boxType}
          </span>
        ))}
      </div>
    </div>
  )
}
