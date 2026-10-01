import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { parseOfficialLevel, infiniteEnterRegistry } from './officialFormat'
import { applyMove } from './rules'
import { PLAYER_ID } from './types'

// Third-party example levels (docs/differential/community-samples, no licence) are kept out of
// the public repository; tests that need one skip when it is not present locally.
const SAMPLE_DIR = join(__dirname, '../../../docs/differential/community-samples')
const hasSample = (name: string) => existsSync(join(SAMPLE_DIR, name))


// Regression fixtures: real official-format (version 4) files, provided by the user, matching
// byte-for-byte (CRLF aside) what docs/differential/community-samples/README.md attributes to
// the Parafox editor's own example set. Not gameplay-verified against the original game (no
// emulator/video access) — these confirm only that parseOfficialLevel handles real external
// files correctly, not that this engine reproduces the original's exact solve behavior.

const DIR = join(__dirname, '../../../docs/differential/community-samples')
const load = (name: string) => parseOfficialLevel(readFileSync(join(DIR, name), 'utf8'))

describe.skipIf(!hasSample('file_format_example.txt'))('community sample: file_format_example.txt (verbatim from the official docs)', () => {
  it('parses: two self-loop Refs to root plus a nested Block with a goal, and a separate player Block', () => {
    const w = load('file_format_example.txt')
    expect(Object.keys(w.boards).sort()).toEqual(['b0', 'b1'].sort())
    // Two Refs inside root both target root itself (id 0) -> both share root's own board.
    const selfLoopRefs = Object.values(w.pieces).filter((p) => p.kind === 'container' && p.boardRef === 'b0')
    expect(selfLoopRefs).toHaveLength(2)
    expect(w.pieces[PLAYER_ID]).toBeDefined()
  })
})

describe.skipIf(!hasSample('iiexit_intro.txt'))('community sample: iiexit_intro.txt (Infinite Exit demo)', () => {
  it('parses the self-loop-via-Ref shape without the cloneOf-to-nonexistent-piece bug, and moves without throwing', () => {
    const w = load('iiexit_intro.txt')
    const selfLoopRefs = Object.values(w.pieces).filter((p) => p.kind === 'container' && p.boardRef === 'b0')
    expect(selfLoopRefs.length).toBeGreaterThanOrEqual(1)
    for (const p of selfLoopRefs) expect(p.cloneOf).toBeUndefined()
    for (const dir of ['up', 'down', 'left', 'right'] as const) expect(() => applyMove(w, dir)).not.toThrow()
  })

  it('two of the three self-loop Refs are flagged infexit with DIFFERENT infexitnum (evidence infexitnum differentiates destinations)', () => {
    const w = load('iiexit_intro.txt')
    const infExitPieces = Object.values(w.pieces).filter((p) => p.infExit === true)
    expect(infExitPieces).toHaveLength(2)
    expect(new Set(infExitPieces.map((p) => p.infExitNum))).toEqual(new Set([0, 1]))
  })
})

describe.skipIf(!hasSample('infenter_line.txt'))('community sample: infenter_line.txt (Infinite Enter demo)', () => {
  it('parses and registers exactly one authored Infinite Enter destination', () => {
    const w = load('infenter_line.txt')
    const registry = infiniteEnterRegistry(w)
    expect(registry).toHaveLength(1)
    expect(registry[0].isExitBlock).toBe(true)
    expect(registry[0].floatingBoard).toBeDefined()
  })

  it('the level loads with the player placed and moves without throwing', () => {
    const w = load('infenter_line.txt')
    expect(w.locations[PLAYER_ID]).toBeDefined()
    for (const dir of ['up', 'down', 'left', 'right'] as const) expect(() => applyMove(w, dir)).not.toThrow()
  })
})

describe.skipIf(!hasSample('order_elbow_push.txt'))('community sample: order_elbow_push.txt (custom attempt_order)', () => {
  it('parses the header "attempt_order enter,eat,push,possess" as [enter, eat, push] (possess dropped: unsupported)', () => {
    const w = load('order_elbow_push.txt')
    expect(w.attemptOrder).toEqual(['enter', 'eat', 'push'])
  })
})

describe.skipIf(!hasSample('clone_rescue_ref_2.txt'))('community sample: clone_rescue_ref_2.txt and hungry_flip.txt (Reference / Flip)', () => {
  it('both parse and move without throwing', () => {
    for (const name of ['clone_rescue_ref_2.txt', 'hungry_flip.txt']) {
      const w = load(name)
      for (const dir of ['up', 'down', 'left', 'right'] as const) expect(() => applyMove(w, dir)).not.toThrow()
    }
  })

  it('hungry_flip.txt\'s Ref has fliph set', () => {
    const w = load('hungry_flip.txt')
    expect(Object.values(w.pieces).some((p) => p.fliph === true)).toBe(true)
  })
})

describe.skipIf(!hasSample('poswall_first.txt'))('community sample: poswall_first.txt (possessable wall — out of this engine\'s scope)', () => {
  it('parses (walls are structural only; this engine has no possess/player-as-box mechanic to exercise)', () => {
    expect(() => load('poswall_first.txt')).not.toThrow()
  })
})
