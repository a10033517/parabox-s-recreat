import { World, cloneWorld, PLAYER_ID } from '../../src/game/engine/types'
import { SeedGroup } from './seed'
import { GenerationEvent } from './generateLevel'

export function computeTouchedGroups(events: GenerationEvent[], groups: SeedGroup[]): Set<string> {
  const touchedPieceIds = new Set<string>()
  for (const event of events) {
    for (const id of event.affectedPieceIds) touchedPieceIds.add(id)
  }

  const touched = new Set<string>()
  for (const group of groups) {
    if (touchedPieceIds.has(group.containerId) || touchedPieceIds.has(group.boxId)) {
      touched.add(group.containerId)
    }
  }
  return touched
}

function removeGroup(world: World, group: SeedGroup): World {
  const next = cloneWorld(world)

  for (const [pieceId, loc] of Object.entries(next.locations)) {
    if (loc.board !== group.interiorId) continue
    if (pieceId === PLAYER_ID) {
      // Provably unreachable today: the player's board never leaves
      // 'root' for the whole reverse walk (none of the three reverse
      // functions can put the player on an interior board starting from
      // a root-seeded walk), so this branch should never execute in
      // practice. Kept as a loud failure rather than removed, so that if
      // a future change to inverseMoves.ts/generateLevel.ts ever breaks
      // that invariant, it surfaces immediately instead of silently
      // corrupting the World.
      throw new Error(
        `pruneUntouchedGoals: refusing to remove group ${group.containerId} — ` +
          'the player is inside its interior. This indicates computeTouchedGroups ' +
          'failed to mark this group as touched.',
      )
    }
    delete next.pieces[pieceId]
    delete next.locations[pieceId]
  }
  delete next.boards[group.interiorId]

  const containerLoc = next.locations[group.containerId]
  const board = next.boards[containerLoc.board]
  board.cells[containerLoc.y][containerLoc.x] = { type: board.cells[containerLoc.y][containerLoc.x].type }
  delete next.pieces[group.containerId]
  delete next.locations[group.containerId]

  return next
}

export function pruneUntouchedGoals(world: World, groups: SeedGroup[], touchedGroups: ReadonlySet<string>): World {
  let next = world
  for (const group of groups) {
    if (touchedGroups.has(group.containerId)) continue
    next = removeGroup(next, group)
  }
  return next
}
