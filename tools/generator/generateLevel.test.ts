import { checkWin } from '../../src/game/engine/rules'
import { createSeedGrid } from './seed'
import { generateLevel } from './generateLevel'

function fixedRng(sequence: number[]): () => number {
  let i = 0
  return () => sequence[i++ % sequence.length]
}

test('the seed grid itself is already solved', () => {
  expect(checkWin(createSeedGrid())).toBe(true)
})

test('generateLevel with zero steps returns an equivalent (still solved) grid', () => {
  const seed = createSeedGrid()
  const level = generateLevel(seed, 0, fixedRng([0]))
  expect(checkWin(level)).toBe(true)
})

test('generateLevel with several steps produces a grid that is no longer pre-solved', () => {
  const seed = createSeedGrid()
  // Direction picks: 0.5->left, 0.75->right, 0.0->up, 0.25->down (indices into
  // ['up','down','left','right']); 0.9 always keeps preferNest false so
  // inverseTranslate is tried first each iteration.
  // Steps 1-2 walk the player next to the goal box and pull it off its target
  // (left moves the player from x=3 to x=4, right then drags the box from
  // x=5 to x=4 while the player retreats to x=3). Steps 3-6 just shuffle the
  // player up/down without touching the box again, so the box stays off-target.
  const level = generateLevel(
    seed,
    6,
    fixedRng([0.5, 0.9, 0.75, 0.9, 0.0, 0.9, 0.25, 0.9, 0.0, 0.9, 0.25, 0.9])
  )
  expect(checkWin(level)).toBe(false)
})
