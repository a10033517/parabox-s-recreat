import { World, cloneWorld, PLAYER_ID } from '../../src/game/engine/types'
import { SeedGroup } from './seed'

// A group is untouched iff its box still sits exactly where the seed placed
// it, on its own interior board — a one-way-door check (see the full design
// spec's section 4.2): nothing but a real eat/inverse-eat move ever changes
// the box's board or position, and once it leaves its interior nothing ever
// puts it back. Exported because section 4.6's Approach-A invariant check
// reuses this exact condition rather than re-deriving it.
export function isGroupUntouched(world: World, group: SeedGroup): boolean {
  const loc = world.locations[group.boxId]
  return (
    loc.board === group.interiorId &&
    loc.x === group.boxOriginalPosition.x &&
    loc.y === group.boxOriginalPosition.y
  )
}

// Groups whose pieces and interior board still exist in `world` after
// pruning. Every metric that iterates groups against a post-pruning World
// must use this, not the original seed's full `groups` array — see section
// 4.6 for the crash this fixes.
export function getSurvivingGroups(world: World, groups: SeedGroup[]): SeedGroup[] {
  return groups.filter(
    (group) =>
      world.pieces[group.containerId] !== undefined &&
      world.pieces[group.boxId] !== undefined &&
      world.boards[group.interiorId] !== undefined,
  )
}

function removeGroup(world: World, group: SeedGroup): World {
  const next = cloneWorld(world)

  for (const [pieceId, loc] of Object.entries(next.locations)) {
    if (loc.board !== group.interiorId) continue
    if (pieceId === PLAYER_ID) {
      // Provably unreachable today (see the full design spec's section 4.2)
      // — kept as a loud failure rather than removed, so a future change to
      // inverseMoves.ts/generateLevel.ts that breaks that invariant
      // surfaces immediately instead of silently corrupting the World.
      throw new Error(
        `pruneUntouchedGoals: refusing to remove group ${group.containerId} — ` +
          'the player is inside its interior. This indicates isGroupUntouched ' +
          'incorrectly classified a live group as untouched.',
      )
    }
    delete next.pieces[pieceId]
    delete next.locations[pieceId]
  }
  delete next.boards[group.interiorId]
  delete next.pieces[group.boxId]
  delete next.locations[group.boxId]
  delete next.pieces[group.containerId]
  delete next.locations[group.containerId]

  return next
}

export function pruneUntouchedGoals(world: World, groups: SeedGroup[]): World {
  let next = world
  for (const group of groups) {
    if (!isGroupUntouched(next, group)) continue
    next = removeGroup(next, group)
  }
  return next
}
