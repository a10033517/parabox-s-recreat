import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { drawBoardRecursive, indexPiecesByBoard, DEFAULT_RENDER_BUDGET, RenderBudget } from './CanvasRenderer'
import { CameraTransform, Viewport, worldToScreen } from './camera'
import { parseOfficialLevel } from '../engine/officialFormat'
import { World } from '../engine/types'

// Third-party example levels (docs/differential/community-samples, no licence) are kept out of
// the public repository; tests that need one skip when it is not present locally.
const SAMPLE_DIR = join(__dirname, '../../../docs/differential/community-samples')
const hasSample = (name: string) => existsSync(join(SAMPLE_DIR, name))


// Model confirmed by iwVerve/Parafox's own GameMaker source (objRef/Create_0.gml — a
// third-party official-format editor, not the game itself; see docs/engine-official-audit.md
// for the full evidence trail, including why this SUPERSEDES an earlier reading of a single
// real-game screenshot that assumed a depth-cutoff-then-one-glyph model):
//   - a level-authored infExit/infEnter Ref draws its real recursive content UNCONDITIONALLY,
//     governed only by the ordinary pixel/depth budget — exactly like any other container;
//   - it ADDITIONALLY overlays (infExitNum ?? 0) + 1 copies of its glyph, stacked in equal
//     vertical bands filling its own cell ("0 = 1 infinity", "0 = 1 epsilon" — the editor's own
//     tooltips), regardless of degree or remaining budget.
// iiexit_intro.txt (docs/differential/community-samples/): three self-loop Refs to root, all
// targeting root (so each one's own recursion re-embeds copies of all three, including itself)
// — (1,5) exitblock=1, unflagged; (7,5) infExit, infExitNum=0 (1 badge); (4,1) infExit,
// infExitNum=1 (2 badges). Coordinates quoted here are the FILE's (y counts up from the bottom);
// the importer flips y, so the engine cell is (x, 8 - y).
//
// Because every Ref here is a self-loop, a piece's own recursive interior contains scaled-down
// copies of ALL THREE siblings again — so "how many glyphs land inside piece X's bounding box"
// is NOT a safe test (nested copies of OTHER pieces, drawn small inside X's own recursion,
// legitimately fall inside X's rect too). Every assertion below instead checks an EXACT
// depth-0 (unscaled) screen coordinate, which no deeper (strictly smaller, repositioned)
// nested copy can coincide with.

const DIR = join(__dirname, '../../../docs/differential/community-samples')
const CELL_SIZE = 256

function render(budget: RenderBudget = DEFAULT_RENDER_BUDGET, mutate?: (world: World) => void) {
  const world = parseOfficialLevel(readFileSync(join(DIR, 'iiexit_intro.txt'), 'utf8'))
  mutate?.(world)
  const root = world.boards.b0
  const camera: CameraTransform = { anchor: 'root', centerX: root.size / 2, centerY: root.size / 2, pixelsPerRootUnit: CELL_SIZE }
  const viewport: Viewport = { width: root.size * CELL_SIZE, height: root.size * CELL_SIZE }
  const glyphs: { x: number; y: number; glyph: string }[] = []
  const ctx = {
    fillRect: () => {}, fillStyle: '', strokeRect: () => {}, strokeStyle: '', lineWidth: 0,
    save: () => {}, restore: () => {}, font: '', textAlign: '', textBaseline: '',
    fillText: (glyph: string, x: number, y: number) => { glyphs.push({ x, y, glyph }) },
    beginPath: () => {}, rect: () => {}, arc: () => {}, moveTo: () => {}, fill: () => {},
  } as unknown as CanvasRenderingContext2D
  const dc = { ctx, world, camera, viewport, budget, piecesByBoard: indexPiecesByBoard(world), cellsDrawnSoFar: { count: 0 } }
  drawBoardRecursive(dc, root, { boardId: 'b0', originX: 0, originY: 0, scale: 1 }, 0, 0, false)

  // Exact band-center coordinates for a depth-0 (unscaled) cell split into `bands` equal bands.
  const bandCenters = (x: number, y: number, bands: number) => {
    const p = worldToScreen(x, y, camera, viewport)
    const bandHeight = CELL_SIZE / bands
    const cx = p.x + CELL_SIZE / 2
    return Array.from({ length: bands }, (_, i) => ({ x: cx, y: p.y + bandHeight * (i + 0.5) }))
  }
  const glyphsAtExact = (points: { x: number; y: number }[]) =>
    points.map((pt) => glyphs.find((g) => Math.abs(g.x - pt.x) < 0.01 && Math.abs(g.y - pt.y) < 0.01))

  return { glyphs, bandCenters, glyphsAtExact }
}

describe.skipIf(!hasSample('iiexit_intro.txt'))('static paradox badge stack (Parafox-source-confirmed model)', () => {
  it('infexitnum=0 Ref (7,5): exactly one ∞ badge, at the exact center of its own cell', () => {
    const { bandCenters, glyphsAtExact } = render()
    const found = glyphsAtExact(bandCenters(7, 8 - 5, 1))
    expect(found).toHaveLength(1)
    expect(found[0]?.glyph).toBe('∞')
  })

  it('infexitnum=1 Ref (4,1): exactly two ∞ badges, at the exact centers of the top and bottom halves', () => {
    const { bandCenters, glyphsAtExact } = render()
    const found = glyphsAtExact(bandCenters(4, 8 - 1, 2))
    expect(found.every((g) => g?.glyph === '∞')).toBe(true)
    expect(found).toHaveLength(2)
  })

  it('unflagged Ref (1,5): no badge at its own cell center, at any pixel budget', () => {
    expect(render().glyphsAtExact(render().bandCenters(1, 8 - 5, 1))[0]).toBeUndefined()
    const tight = render({ ...DEFAULT_RENDER_BUDGET, minCellPixels: 1000 })
    expect(tight.glyphsAtExact(tight.bandCenters(1, 8 - 5, 1))[0]).toBeUndefined()
  })

  it('a flagged Ref keeps recursing its real content as the budget loosens — the badge does not replace or cut off recursion', () => {
    // 256/9 ≈ 28.4 (depth0->1 always allowed); 28.4/9 ≈ 3.16 (depth1->2 only if minCellPixels <= 3.16).
    const oneLevelOnly = render({ ...DEFAULT_RENDER_BUDGET, minCellPixels: 20 }).glyphs.length
    const twoLevels = render({ ...DEFAULT_RENDER_BUDGET, minCellPixels: 3 }).glyphs.length
    expect(twoLevels).toBeGreaterThan(oneLevelOnly) // more recursion depth -> strictly more nested badge occurrences
  })

  it('degree scales the badge count generally: infExitNum=3 on (4,1) shows 4 stacked badges at its own cell', () => {
    const { bandCenters, glyphsAtExact } = render(DEFAULT_RENDER_BUDGET, (world) => {
      const ref = Object.values(world.pieces).find((p) => p.infExit === true && p.infExitNum === 1)!
      ref.infExitNum = 3
    })
    const found = glyphsAtExact(bandCenters(4, 8 - 1, 4))
    expect(found.every((g) => g?.glyph === '∞')).toBe(true)
    expect(found).toHaveLength(4)
  })
})
