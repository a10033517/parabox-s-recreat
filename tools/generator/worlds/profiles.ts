import { EngineEvent } from '../../../src/game/engine/events'
import { Board, PieceId, World, findContainerFor } from '../../../src/game/engine/types'
import { Ablation, WorldProfile } from './verify'
import { Rng, addPlayer, cycleLengthThrough, emptyWorld, goal, oddInt, pick, place, randInt, room, strippedCopy, withPiece } from './build'

// World profiles (docs: parabox_level_generator_world_profiles.md §5, §14). Each one builds
// candidate structures around its signature mechanic; verify.ts then keeps only candidates whose
// optimal solution uses the mechanic and which become unsolvable without it.

const flat = (events: EngineEvent[][]) => events.flat()

const containers = (world: World) => Object.values(world.pieces).filter((p) => p.kind === 'container')

// Boards with more than one box leading into them (Ref instances sharing a definition).
function sharedBoards(world: World): string[] {
  const count = new Map<string, number>()
  for (const p of containers(world)) if (p.boardRef !== undefined) count.set(p.boardRef, (count.get(p.boardRef) ?? 0) + 1)
  return [...count.entries()].filter(([, n]) => n > 1).map(([b]) => b)
}

// Nothing from later worlds (the doc's "forbidden" lists): keeps a world's levels about its own idea.
function noAdvanced(world: World, allow: { selfLoop?: boolean; cycle?: boolean; clone?: boolean; flip?: boolean; possess?: boolean; wall?: boolean; infExit?: boolean } = {}): boolean {
  for (const p of Object.values(world.pieces)) {
    if (p.fliph && !allow.flip) return false
    if (p.possessable && p.kind !== 'player' && !(p.wall ? allow.wall : allow.possess)) return false
    if (p.wall && !allow.wall) return false
    if (p.infExit && !allow.infExit) return false
    if (p.cloneOf !== undefined || p.infEnter) return false
    if (p.kind === 'container') {
      const cycle = cycleLengthThrough(world, p.id)
      if (cycle === 1 && !allow.selfLoop) return false
      if (cycle !== undefined && cycle >= 2 && !allow.cycle) return false
    }
  }
  if (sharedBoards(world).length > 0 && !allow.clone && !allow.infExit) return false
  return true
}

function boxesAndGoals(world: World, rng: Rng, boards: string[], count: number, goalBoards: string[] = boards): boolean {
  for (let i = 0; i < count; i++) {
    const home = pick(rng, boards) as string
    if (!place(world, rng, home, { id: `box${i}`, kind: 'normal' })) return false
    if (!goal(world, rng, pick(rng, goalBoards) as string, 'box')) return false
  }
  return true
}

function redirectToCopy(world: World, containerId: PieceId, suffix: string): World {
  const board = world.pieces[containerId].boardRef as string
  const copyId = `${board}~${suffix}`
  const copied = strippedCopy(world, board, copyId)
  return withPiece(copied, containerId, { boardRef: copyId, exitBlock: undefined })
}

// ---------------------------------------------------------------------------------------------

export const INTRO: WorldProfile = {
  id: 'intro', order: 1, name: '入门 Intro', signature: 'nested_box', minSolutionLength: 14,
  generate(rng) {
    const w = emptyWorld()
    w.boards.root = room('root', oddInt(rng, 7, 9), 0.1 + rng() * 0.2, rng)
    w.boards.in = room('in', oddInt(rng, 3, 7), rng() * 0.25, rng, { openings: true })
    if (!place(w, rng, 'root', { id: 'box', kind: 'container', boardRef: 'in' })) return null
    if (!addPlayer(w, rng, 'root')) return null
    if (!boxesAndGoals(w, rng, ['root', 'in'], randInt(rng, 2, 3), ['root', 'in'])) return null
    if (!goal(w, rng, pick(rng, ['root', 'in']) as string, 'player')) return null
    return w
  },
  presence: (w) => containers(w).length > 0 && noAdvanced(w),
  usage: (ev) => flat(ev).some((e) => (e.type === 'EnterEvent' && !e.selfLoop) || e.type === 'ExitEvent' || e.type === 'EatEvent'),
  ablations: (w) => [{ world: w, disabled: ['enter', 'eat'] }],
}

export const ENTER: WorldProfile = {
  id: 'enter', order: 2, name: '进入 Enter', signature: '1_loop_recursion', minSolutionLength: 12,
  generate(rng) {
    const w = emptyWorld()
    // Openings in the room's own border: leaving the room climbs out through the box that
    // contains it — the room itself — so the self-loop can actually be walked through.
    w.boards.root = room('root', oddInt(rng, 7, 9), 0.1 + rng() * 0.25, rng, { openings: true })
    if (!place(w, rng, 'root', { id: 'loop', kind: 'container', boardRef: 'root' })) return null
    if (!addPlayer(w, rng, 'root')) return null
    if (!boxesAndGoals(w, rng, ['root'], randInt(rng, 2, 3))) return null
    if (!goal(w, rng, 'root', 'player')) return null
    return w
  },
  presence: (w) => containers(w).some((p) => cycleLengthThrough(w, p.id) === 1) && noAdvanced(w, { selfLoop: true }),
  usage: (ev) => flat(ev).some((e) => (e.type === 'EnterEvent' || e.type === 'ExitEvent') && e.selfLoop),
  // A self-loop box turned into a box with its own ordinary room (same walls, empty).
  ablations: (w) => {
    let out = w
    for (const p of containers(w)) if (cycleLengthThrough(w, p.id) === 1) out = redirectToCopy(out, p.id, 'own')
    return [{ world: out }]
  },
}

function isOpenEmpty(w: World, boardId: string): boolean {
  const board: Board = w.boards[boardId]
  if (board.cells.some((row) => row.some((c) => c.type === 'wall' || c.requirement !== undefined))) return false
  return !Object.values(w.locations).some((l) => l.board === boardId)
}

export const EMPTY: WorldProfile = {
  id: 'empty', order: 3, name: '空箱 Empty', signature: 'empty_open_box', minSolutionLength: 14,
  generate(rng) {
    const w = emptyWorld()
    w.boards.root = room('root', oddInt(rng, 7, 9), 0.1 + rng() * 0.2, rng)
    w.boards.hollow = room('hollow', oddInt(rng, 3, 7), 0, rng, { border: false })
    if (!place(w, rng, 'root', { id: 'empty', kind: 'container', boardRef: 'hollow' })) return null
    if (!addPlayer(w, rng, 'root')) return null
    if (!boxesAndGoals(w, rng, ['root'], randInt(rng, 2, 3))) return null
    if (!goal(w, rng, 'root', 'player')) return null
    return w
  },
  presence: (w) => containers(w).some((p) => p.boardRef !== undefined && isOpenEmpty(w, p.boardRef)) && noAdvanced(w),
  usage: (ev, w) => {
    const empties = new Set(containers(w).filter((p) => p.boardRef !== undefined && isOpenEmpty(w, p.boardRef)).map((p) => p.id))
    return flat(ev).some((e) => e.type === 'EnterEvent' && empties.has(e.intoId))
  },
  // The empty box closed up: its room filled with wall, so nothing can go in.
  ablations: (w) => {
    let out = w
    for (const p of containers(w)) {
      if (p.boardRef === undefined || !isOpenEmpty(w, p.boardRef)) continue
      const b = out.boards[p.boardRef]
      out = { ...out, boards: { ...out.boards, [b.id]: { ...b, cells: b.cells.map((row) => row.map(() => ({ type: 'wall' as const }))) } } }
    }
    return [{ world: out }]
  },
}

export const EAT: WorldProfile = {
  id: 'eat', order: 4, name: '吞噬 Eat', signature: 'eat_transition', minSolutionLength: 12,
  generate(rng) {
    const w = emptyWorld()
    w.boards.root = room('root', oddInt(rng, 7, 9), 0.1 + rng() * 0.2, rng)
    w.boards.in = room('in', oddInt(rng, 3, 7), rng() * 0.2, rng, { openings: true })
    if (!place(w, rng, 'root', { id: 'mouth', kind: 'container', boardRef: 'in' })) return null
    if (!addPlayer(w, rng, 'root')) return null
    if (!boxesAndGoals(w, rng, ['root'], randInt(rng, 2, 3), ['in', 'in', 'root'])) return null
    if (!goal(w, rng, pick(rng, ['root', 'in']) as string, 'player')) return null
    return w
  },
  presence: (w) => containers(w).length > 0 && noAdvanced(w),
  usage: (ev) => flat(ev).some((e) => e.type === 'EatEvent'),
  ablations: (w) => [{ world: w, disabled: ['eat'] }],
}

export const REFERENCE: WorldProfile = {
  id: 'reference', order: 5, name: '互相包含 Reference', signature: 'multi_loop_reference', minSolutionLength: 12,
  generate(rng) {
    const w = emptyWorld()
    w.boards.a = room('a', oddInt(rng, 7, 9), 0.1 + rng() * 0.2, rng, { openings: true })
    w.boards.b = room('b', oddInt(rng, 3, 7), rng() * 0.2, rng, { openings: true })
    if (!place(w, rng, 'a', { id: 'toB', kind: 'container', boardRef: 'b' })) return null
    if (!place(w, rng, 'b', { id: 'toA', kind: 'container', boardRef: 'a' })) return null
    if (!addPlayer(w, rng, 'a')) return null
    if (!boxesAndGoals(w, rng, ['a', 'b'], randInt(rng, 2, 3), ['a', 'b'])) return null
    if (!goal(w, rng, pick(rng, ['a', 'b']) as string, 'player')) return null
    return w
  },
  presence: (w) => containers(w).some((p) => (cycleLengthThrough(w, p.id) ?? 0) >= 2) && noAdvanced(w, { cycle: true }),
  usage: (ev, w) => {
    const inCycle = (id: string) => (cycleLengthThrough(w, id) ?? 0) >= 2
    return flat(ev).some((e) => (e.type === 'EnterEvent' && inCycle(e.intoId)) || (e.type === 'ExitEvent' && inCycle(e.throughId)))
  },
  // Break the cycle at each of its boxes in turn: every broken version must be unsolvable.
  ablations: (w) =>
    containers(w).filter((p) => (cycleLengthThrough(w, p.id) ?? 0) >= 2).map((p): Ablation => ({ world: redirectToCopy(w, p.id, 'own') })),
}

export const CLONE: WorldProfile = {
  id: 'clone', order: 8, name: '分身 Clone', signature: 'clone', minSolutionLength: 14,
  generate(rng) {
    const w = emptyWorld()
    w.boards.root = room('root', oddInt(rng, 7, 9), 0.1 + rng() * 0.2, rng)
    w.boards.in = room('in', oddInt(rng, 3, 7), rng() * 0.2, rng, { openings: true })
    if (!place(w, rng, 'root', { id: 'orig', kind: 'container', boardRef: 'in', exitBlock: true })) return null
    if (!place(w, rng, 'root', { id: 'copy', kind: 'container', boardRef: 'in' })) return null
    if (!addPlayer(w, rng, 'root')) return null
    if (!boxesAndGoals(w, rng, ['root', 'in'], randInt(rng, 2, 3), ['root', 'in'])) return null
    if (!goal(w, rng, pick(rng, ['root', 'in']) as string, 'player')) return null
    return w
  },
  presence: (w) => sharedBoards(w).length > 0 && noAdvanced(w, { clone: true }),
  usage: (ev) => flat(ev).some((e) => e.type === 'EnterEvent' && e.clone),
  // Every clone gets a room of its own instead of leading into the original's.
  ablations: (w) => {
    let out = w
    for (const board of sharedBoards(w)) {
      const canonical = findContainerFor(w, board)
      for (const p of containers(w)) if (p.boardRef === board && p.id !== canonical) out = redirectToCopy(out, p.id, p.id)
    }
    return [{ world: out }]
  },
}

export const FLIP: WorldProfile = {
  id: 'flip', order: 11, name: '翻转 Flip', signature: 'flip', minSolutionLength: 12,
  generate(rng) {
    const w = emptyWorld()
    w.boards.root = room('root', oddInt(rng, 7, 9), 0.1 + rng() * 0.2, rng)
    w.boards.in = room('in', oddInt(rng, 3, 7), 0.15 + rng() * 0.2, rng, { openings: true })
    if (!place(w, rng, 'root', { id: 'mirror', kind: 'container', boardRef: 'in', fliph: true })) return null
    if (!addPlayer(w, rng, 'root')) return null
    if (!boxesAndGoals(w, rng, ['root', 'in'], randInt(rng, 2, 3), ['root', 'in'])) return null
    if (!goal(w, rng, pick(rng, ['root', 'in']) as string, 'player')) return null
    return w
  },
  presence: (w) => containers(w).some((p) => p.fliph === true) && noAdvanced(w, { flip: true }),
  usage: (ev) => flat(ev).some((e) => e.type === 'FlipEvent'),
  ablations: (w) => [{
    world: { ...w, pieces: Object.fromEntries(Object.entries(w.pieces).map(([id, p]) => [id, { ...p, fliph: undefined }])) },
  }],
}

export const POSSESS: WorldProfile = {
  id: 'possess', order: 14, name: '附身 Possess', signature: 'possess', minSolutionLength: 10,
  generate(rng) {
    const w = emptyWorld()
    w.boards.root = room('root', oddInt(rng, 7, 9), 0.15 + rng() * 0.2, rng)
    if (!place(w, rng, 'root', { id: 'player', kind: 'player', possessable: true })) return null
    for (let i = 0, n = randInt(rng, 1, 3); i < n; i++) {
      if (!place(w, rng, 'root', { id: `host${i}`, kind: 'normal', possessable: true })) return null
    }
    if (!goal(w, rng, 'root', 'player')) return null
    if (rng() < 0.6 && !goal(w, rng, 'root', 'box')) return null
    return w
  },
  presence: (w) => Object.values(w.pieces).some((p) => p.kind !== 'player' && p.possessable && !p.wall) && noAdvanced(w, { possess: true }),
  usage: (ev) => flat(ev).some((e) => e.type === 'PossessEvent'),
  ablations: (w) => [{ world: w, disabled: ['possess'] }],
}

export const WALL: WorldProfile = {
  id: 'wall', order: 15, name: '墙壁 Wall', signature: 'possess_wall', minSolutionLength: 10,
  generate(rng) {
    const w = emptyWorld()
    w.boards.root = room('root', oddInt(rng, 7, 9), 0.15 + rng() * 0.2, rng)
    if (!place(w, rng, 'root', { id: 'player', kind: 'player', possessable: true })) return null
    for (let i = 0, n = randInt(rng, 1, 2); i < n; i++) {
      if (!place(w, rng, 'root', { id: `wall${i}`, kind: 'normal', wall: true, possessable: true })) return null
    }
    if (rng() < 0.6 && !place(w, rng, 'root', { id: 'box0', kind: 'normal' })) return null
    if (!goal(w, rng, 'root', 'player')) return null
    if (w.pieces.box0 !== undefined && !goal(w, rng, 'root', 'box')) return null
    return w
  },
  presence: (w) => Object.values(w.pieces).some((p) => p.wall && p.possessable) && noAdvanced(w, { wall: true }),
  usage: (ev) => flat(ev).some((e) => e.type === 'PossessEvent'),
  ablations: (w) => [{ world: w, disabled: ['possess'] }],
}

export const INFINITE_EXIT: WorldProfile = {
  id: 'infinite-exit', order: 16, name: '无限大 Infinite Exit', signature: 'infinite_paradox_exit', minSolutionLength: 12,
  generate(rng) {
    const w = emptyWorld()
    w.boards.root = room('root', oddInt(rng, 7, 9), 0.1 + rng() * 0.2, rng, { openings: true })
    if (!place(w, rng, 'root', { id: 'loop', kind: 'container', boardRef: 'root', exitBlock: true })) return null
    if (!place(w, rng, 'root', { id: 'inf', kind: 'container', boardRef: 'root', infExit: true, infExitNum: 0 })) return null
    if (!addPlayer(w, rng, 'root')) return null
    if (!boxesAndGoals(w, rng, ['root'], randInt(rng, 2, 3))) return null
    if (!goal(w, rng, 'root', 'player')) return null
    return w
  },
  presence: (w) => Object.values(w.pieces).some((p) => p.infExit) && noAdvanced(w, { selfLoop: true, infExit: true }),
  usage: (ev) => flat(ev).some((e) => e.type === 'InfiniteExitEvent'),
  ablations: (w) => [{ world: w, disabled: ['infiniteExit'] }],
}

export const WORLD_PROFILES: WorldProfile[] = [INTRO, ENTER, EMPTY, EAT, REFERENCE, CLONE, FLIP, POSSESS, WALL, INFINITE_EXIT]
