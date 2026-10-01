import { render, screen } from '@testing-library/react'
import { InspectView } from './InspectView'
import { makeFloorBoard, makeWorld, setWall } from '../game/engine/testFixtures'
import { PLAYER_ID } from '../game/engine/types'

test('describes the box: what it is and what is in its room', () => {
  const inside = makeFloorBoard('inside', 3)
  setWall(inside, 0, 0)
  inside.cells[1][1] = { type: 'floor', requirement: 'box' }
  const world = makeWorld(
    [makeFloorBoard('root', 5), inside],
    [
      { id: PLAYER_ID, kind: 'player' },
      { id: 'box', kind: 'container', boardRef: 'inside', fliph: true },
      { id: 'b', kind: 'normal' },
    ],
    { [PLAYER_ID]: { board: 'root', x: 0, y: 0 }, box: { board: 'root', x: 2, y: 2 }, b: { board: 'inside', x: 2, y: 2 } },
  )
  render(<InspectView world={world} pieceId="box" onClose={() => {}} />)
  expect(screen.getByText('翻转(内部左右相反,穿过会被翻转)')).toBeInTheDocument()
  expect(screen.getByText('3×3 的房间 · 1 个实心箱 · 1 个箱子目标 · 1 个墙')).toBeInTheDocument()
})

test('a self-loop box is called out', () => {
  const world = makeWorld(
    [makeFloorBoard('root', 5)],
    [{ id: PLAYER_ID, kind: 'player' }, { id: 'loop', kind: 'container', boardRef: 'root' }],
    { [PLAYER_ID]: { board: 'root', x: 0, y: 0 }, loop: { board: 'root', x: 2, y: 2 } },
  )
  render(<InspectView world={world} pieceId="loop" onClose={() => {}} />)
  expect(screen.getByText('自包箱(房间就是它所在的地方)')).toBeInTheDocument()
})
