import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { serializeLevel } from '../../src/game/engine/levelSchema'
import { Board, Cell, Piece, PLAYER_ID, World } from '../../src/game/engine/types'
import { solveDetailed } from './solver'
import { CLONE, EAT, EMPTY, ENTER, FLIP, INTRO, POSSESS, REFERENCE, WALL } from './worlds/profiles'
import { Verdict, WorldProfile, verifyWorldLevel } from './worlds/verify'

// The tutorial: one small hand-made level per idea, in the order the official game teaches them.
// Each is drawn as text, then checked like a World level — solvable, and (when it teaches a
// mechanic) unsolvable without that mechanic. `npm run generate:tutorial` rewrites
// src/levels/builtin/tutorial/ from here.
//
// Room text: '#' wall, '.' floor, '_' box goal, '=' player goal, 'p' the player.
// Any other character is a piece from the level's `pieces` legend, standing on floor.

// Leaving a box: with every box turned into a solid one, the room the player starts in has no
// way out — so the level must be unsolvable that way.
const EXIT: WorldProfile = {
  ...INTRO,
  id: 'exit',
  usage: (events) => events.flat().some((e) => e.type === 'ExitEvent'),
  ablations: (world) => [{
    world: { ...world, pieces: Object.fromEntries(Object.entries(world.pieces).map(([id, p]) => [id, p.kind === 'container' ? { ...p, kind: 'normal' as const, boardRef: undefined } : p])) },
  }],
}

interface TutorialLevel {
  id: string
  name: string
  hint: string // one line shown before the level: what it teaches
  rooms: Record<string, string[]>
  pieces?: Record<string, Omit<Piece, 'id'> & { id?: string }>
  profile?: WorldProfile // the World whose mechanic this level must need
}

export const TUTORIAL: TutorialLevel[] = [
  {
    id: '01-push', name: '推箱子', hint: '把箱子推到虚线框上,再走到眼睛标记',
    rooms: { root: ['.....', '.pb._', '.....', '.....', '....='] },
    pieces: { b: { kind: 'normal' } },
  },
  {
    id: '02-enter', name: '走进箱子', hint: '箱子里面也是一个房间,直接走进去',
    rooms: { root: ['.....', '.....', 'p.A..', '.....', '.....'], a: ['...', '.=.', '...'] },
    pieces: { A: { kind: 'container', boardRef: 'a' } },
    profile: INTRO,
  },
  {
    id: '03-push-in', name: '推进箱子', hint: '箱子也可以被推进另一个箱子里',
    rooms: { root: ['#####', '#...=', 'pb.A#', '#...#', '#####'], a: ['...', '._.', '...'] },
    pieces: { b: { kind: 'normal' }, A: { kind: 'container', boardRef: 'a' } },
    profile: INTRO,
  },
  {
    id: '04-carry', name: '搬运房间', hint: '推动箱子时,里面的东西会跟着一起走',
    rooms: { root: ['.....', '.pA._', '.....', '.....', '.....'], a: ['...', '.=.', '...'] },
    pieces: { A: { kind: 'container', boardRef: 'a' } },
    profile: INTRO,
  },
  {
    id: '05-exit', name: '走出箱子', hint: '走到房间边缘再往外走,就会从箱子里出来',
    rooms: { root: ['##=##', '##.##', '..A..', '#####', '#####'], a: ['...', '.p.', '...'] },
    pieces: { A: { kind: 'container', boardRef: 'a' } },
    profile: EXIT,
  },
  {
    id: '06-self', name: '自己里面的自己', hint: '这个箱子就是你所在的房间,走出房间会出现在它旁边',
    rooms: { root: ['..#..', '.p#..', '..#.L', '..#..', '..#.='] },
    pieces: { L: { kind: 'container', boardRef: 'root' } },
    profile: ENTER,
  },
  {
    id: '07-empty', name: '空箱子', hint: '空的箱子可以用来收纳挡路的箱子',
    rooms: { root: ['##=##', '##.##', 'pb.E#', '#####', '#####'], e: ['...', '...', '...'] },
    pieces: { b: { kind: 'normal' }, E: { kind: 'container', boardRef: 'e' } },
    profile: EMPTY,
  },
  {
    id: '08-eat', name: '吞掉箱子', hint: '推不动的时候,箱子会把前面的东西吞进去',
    rooms: { root: ['#####', '#####', 'pAb##', '....=', '.....'], a: ['...', '.._', '...'] },
    pieces: { A: { kind: 'container', boardRef: 'a' }, b: { kind: 'normal' } },
    profile: EAT,
  },
  {
    id: '09-reference', name: '互相包含', hint: '两个房间互相装着对方,走出一个就进到另一个',
    rooms: {
      a: ['..#..', '..#..', 'p.#B.', '..#..', '..#..'],
      b: ['..#..', '..#..', 'A.#.=', '..#..', '..#..'],
    },
    pieces: { A: { kind: 'container', boardRef: 'a' }, B: { kind: 'container', boardRef: 'b' } },
    profile: REFERENCE,
  },
  {
    id: '10-clone', name: '分身', hint: '两个箱子通往同一个房间,出来时会从本体走出',
    rooms: { root: ['..#..', '..#..', 'pC#O.', '..#..', '..#.='], in: ['...', '...', '...'] },
    pieces: { C: { kind: 'container', boardRef: 'in' }, O: { kind: 'container', boardRef: 'in', exitBlock: true } },
    profile: CLONE,
  },
  {
    id: '11-flip', name: '翻转', hint: '翻转箱子里的左右是相反的',
    rooms: { root: ['.....', '...#.', 'p..F#', '...#.', '.....'], in: ['.#=', '.#.', '.#.'] },
    pieces: { F: { kind: 'container', boardRef: 'in', fliph: true } },
    profile: FLIP,
  },
  {
    id: '12-possess', name: '附身', hint: '走不过去时,可以附身到挡路的方块上',
    rooms: { root: ['..#.=', '..#..', '.p.H#', '..#..', '..#..'] },
    pieces: { p: { kind: 'player', possessable: true }, H: { kind: 'normal', possessable: true } },
    profile: POSSESS,
  },
  {
    id: '13-wall', name: '墙也能附身', hint: '有眼睛的墙可以被附身,附身后就能移动它',
    rooms: { root: ['..#.=', '..#..', '.pW..', '..#..', '..#..'] },
    pieces: { p: { kind: 'player', possessable: true }, W: { kind: 'normal', wall: true, possessable: true } },
    profile: WALL,
  },
]

export function buildTutorialWorld(level: TutorialLevel): World {
  const world: World = { boards: {}, pieces: {}, locations: {} }
  for (const [boardId, rows] of Object.entries(level.rooms)) {
    const size = rows.length
    const cells: Cell[][] = rows.map((row, y) => {
      if (row.length !== size) throw new Error(`${level.id}/${boardId}: row ${y} is ${row.length} wide, room is ${size}`)
      return [...row].map((ch, x): Cell => {
        if (ch === '#') return { type: 'wall' }
        if (ch === '_') return { type: 'floor', requirement: 'box' }
        if (ch === '=') return { type: 'floor', requirement: 'player' }
        if (ch !== '.') {
          const id = ch === 'p' ? PLAYER_ID : level.pieces?.[ch]?.id ?? ch
          const spec = ch === 'p' ? { kind: 'player' as const, ...level.pieces?.p } : level.pieces?.[ch]
          if (spec === undefined) throw new Error(`${level.id}/${boardId}: no piece for '${ch}'`)
          world.pieces[id] = { ...spec, id } as Piece
          world.locations[id] = { board: boardId, x, y }
        }
        return { type: 'floor' }
      })
    })
    world.boards[boardId] = { id: boardId, size, cells } as Board
  }
  return world
}

// Solvable, not already solved, and — for a level that teaches a mechanic — needing it.
export function checkTutorialLevel(level: TutorialLevel): Verdict | { accepted: true; moves: number } | { accepted: false; reason: string } {
  const world = buildTutorialWorld(level)
  if (level.profile !== undefined) {
    // Tutorial levels are short on purpose: no minimum solution length.
    return verifyWorldLevel({ ...level.profile, minSolutionLength: 1 }, world, 0)
  }
  const solved = solveDetailed(world, 80, 120_000)
  if (solved.status !== 'SOLVED') return { accepted: false, reason: 'unsolved' }
  if (solved.result.moves.length === 0) return { accepted: false, reason: 'alreadySolved' }
  return { accepted: true, moves: solved.result.moves.length }
}

function main() {
  const out = join('src', 'levels', 'builtin', 'tutorial')
  rmSync(out, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })
  let failed = false
  const manifest: { file: string; name: string; hint: string }[] = []
  for (const level of TUTORIAL) {
    const verdict = checkTutorialLevel(level)
    if (!verdict.accepted) {
      failed = true
      console.log(`✗ ${level.id} ${level.name}: ${verdict.reason}`)
      continue
    }
    const moves = 'record' in verdict ? verdict.record.solver.solutionLength : verdict.moves
    console.log(`✓ ${level.id} ${level.name}: ${moves} moves`)
    writeFileSync(join(out, `${level.id}.json`), JSON.stringify(serializeLevel(buildTutorialWorld(level))) + '\n')
    manifest.push({ file: `${level.id}.json`, name: level.name, hint: level.hint })
  }
  writeFileSync(join(out, 'manifest.json'), JSON.stringify({ levels: manifest }, null, 2) + '\n')
  if (failed) process.exitCode = 1
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('tools/generator/tutorial.ts')) main()
