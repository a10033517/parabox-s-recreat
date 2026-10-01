import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { EngineEvent, withEngineContext } from '../../../src/game/engine/events'
import { parseLevel } from '../../../src/game/engine/levelSchema'
import { applyMove, checkWin } from '../../../src/game/engine/rules'
import { makeFloorBoard, makeWorld, setWall } from '../../../src/game/engine/testFixtures'
import { Direction, PLAYER_ID, World } from '../../../src/game/engine/types'
import { solveDetailed } from '../solver'
import { WORLD_PROFILES } from './profiles'
import { LevelRecord, hasPlayerGoal, roomsAreOdd, solutionEvents, verifyWorldLevel } from './verify'
import { mulberry32 } from './build'

const WORLDS_DIR = join(__dirname, '../../../src/levels/builtin/worlds')

describe('engine events used by the world generator', () => {
  it('a failed branch leaves no events behind: pushing a box against a wall logs nothing', () => {
    const root = makeFloorBoard('root', 3)
    setWall(root, 2, 1)
    const world = makeWorld(
      [root, makeFloorBoard('in', 3)],
      [{ id: PLAYER_ID, kind: 'player' }, { id: 'box', kind: 'normal' }],
      { [PLAYER_ID]: { board: 'root', x: 0, y: 1 }, box: { board: 'root', x: 1, y: 1 } },
    )
    const events: EngineEvent[] = []
    expect(withEngineContext({ events }, () => applyMove(world, 'right'))).toBeNull()
    expect(events).toEqual([])
  })

  it('entering a self-loop box is logged as a self-loop enter; eating as an eat', () => {
    const root = makeFloorBoard('root', 4)
    setWall(root, 3, 1)
    const world = makeWorld(
      [root, makeFloorBoard('in', 3)],
      [{ id: PLAYER_ID, kind: 'player' }, { id: 'loop', kind: 'container', boardRef: 'root' }],
      { [PLAYER_ID]: { board: 'root', x: 1, y: 1 }, loop: { board: 'root', x: 2, y: 1 } },
    )
    const events: EngineEvent[] = []
    withEngineContext({ events }, () => applyMove(world, 'right'))
    expect(events).toContainEqual({ type: 'EnterEvent', pieceId: PLAYER_ID, intoId: 'loop', selfLoop: true, clone: false })
  })

  it('switched-off mechanics never happen', () => {
    const root = makeFloorBoard('root', 4)
    setWall(root, 3, 1)
    const world = makeWorld(
      [root, makeFloorBoard('in', 3)],
      [{ id: PLAYER_ID, kind: 'player' }, { id: 'c', kind: 'container', boardRef: 'in' }],
      { [PLAYER_ID]: { board: 'root', x: 1, y: 1 }, c: { board: 'root', x: 2, y: 1 } },
    )
    expect(applyMove(world, 'right')?.locations[PLAYER_ID].board).toBe('in')
    expect(withEngineContext({ disabledMechanics: new Set(['enter', 'eat']) }, () => applyMove(world, 'right'))).toBeNull()
  })
})

describe('verifyWorldLevel', () => {
  it('rejects an Intro candidate whose box is not needed', () => {
    // Goal right next to a box on the root: the container is decoration.
    const root = makeFloorBoard('root', 5)
    for (let i = 0; i < 5; i++) { setWall(root, i, 0); setWall(root, i, 4); setWall(root, 0, i); setWall(root, 4, i) }
    root.cells[1][3] = { type: 'floor', requirement: 'box' }
    root.cells[2][1] = { type: 'floor', requirement: 'player' }
    const world = makeWorld(
      [root, makeFloorBoard('in', 3)],
      [{ id: PLAYER_ID, kind: 'player' }, { id: 'b', kind: 'normal' }, { id: 'c', kind: 'container', boardRef: 'in' }],
      { [PLAYER_ID]: { board: 'root', x: 1, y: 1 }, b: { board: 'root', x: 2, y: 1 }, c: { board: 'root', x: 2, y: 3 } },
    )
    const intro = WORLD_PROFILES.find((p) => p.id === 'intro')!
    const verdict = verifyWorldLevel({ ...intro, minSolutionLength: 1 }, world, 0)
    expect(verdict.accepted).toBe(false)
    if (!verdict.accepted) expect(['unused', 'notNecessary']).toContain(verdict.reason)
  })

  it('rejects a candidate with no player goal', () => {
    const root = makeFloorBoard('root', 3)
    root.cells[0][2] = { type: 'floor', requirement: 'box' }
    const world = makeWorld([root], [{ id: PLAYER_ID, kind: 'player' }, { id: 'b', kind: 'normal' }], { [PLAYER_ID]: { board: 'root', x: 0, y: 0 }, b: { board: 'root', x: 1, y: 1 } })
    const intro = WORLD_PROFILES.find((p) => p.id === 'intro')!
    expect(verifyWorldLevel(intro, world, 0)).toEqual({ accepted: false, reason: 'noPlayerGoal' })
  })

  it('generation is deterministic per seed', () => {
    for (const profile of WORLD_PROFILES) {
      expect(JSON.stringify(profile.generate(mulberry32(42)))).toBe(JSON.stringify(profile.generate(mulberry32(42))))
    }
  })
})

interface Manifest { worlds: { id: string; levels: { file: string; record: LevelRecord }[] }[] }

describe('shipped world levels', () => {
  const manifest = JSON.parse(readFileSync(join(WORLDS_DIR, 'manifest.json'), 'utf8')) as Manifest
  const load = (file: string): World => parseLevel(JSON.parse(readFileSync(join(WORLDS_DIR, file), 'utf8')))

  it('every profile has levels', () => {
    for (const profile of WORLD_PROFILES) {
      expect(manifest.worlds.find((w) => w.id === profile.id)?.levels.length ?? 0, profile.id).toBeGreaterThan(0)
    }
  })

  for (const world of manifest.worlds) {
    const profile = WORLD_PROFILES.find((p) => p.id === world.id)!
    it(`${world.id}: each level's recorded solution wins, and uses the signature mechanic`, () => {
      for (const level of world.levels) {
        const w = load(level.file)
        expect(profile.presence(w), level.file).toBe(true)
        expect(hasPlayerGoal(w), `${level.file} has a player goal`).toBe(true)
        expect(roomsAreOdd(w), `${level.file}: every room a box leads into is odd-sized`).toBe(true)
        let current = w
        for (const dir of level.record.solver.moves as Direction[]) current = applyMove(current, dir)!
        expect(checkWin(current), level.file).toBe(true)
        expect(profile.usage(solutionEvents(w, level.record.solver.moves as Direction[]), w), level.file).toBe(true)
      }
    })

    it(`${world.id}: without the mechanic, the first level is proven unsolvable`, () => {
      const w = load(world.levels[0].file)
      for (const ablation of profile.ablations(w)) {
        const result = withEngineContext({ disabledMechanics: new Set(ablation.disabled ?? []) }, () =>
          solveDetailed(ablation.world, 400, 300_000),
        )
        expect(result.status, world.levels[0].file).toBe('UNSOLVABLE')
      }
    })
  }
})
