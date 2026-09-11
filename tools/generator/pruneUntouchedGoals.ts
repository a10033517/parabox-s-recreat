import { World, cloneWorld, PLAYER_ID } from '../../src/game/engine/types'
import { SeedGroup } from './seed'

// A group is untouched iff every one of its boxes still sits exactly where
// the seed placed it, on its own interior board — a one-way-door check (see
// the full design spec's section 4.2): nothing but a real eat/inverse-eat
// move ever changes a box's board or position, and once it leaves its
// interior nothing ever puts it back. For a multi-box group (see the
// multi-box groups spec), *every* box must be untouched for the whole group
// to be pruned — if even one moved, the entire group survives, including
// whichever box(es) never moved (their requirement is already satisfied,
// see that spec's §2 for why this is the intended source of variety).
// Exported because section 4.6's Approach-A invariant check reuses this
// exact condition rather than re-deriving it.
export function isGroupUntouched(world: World, group: SeedGroup): boolean {
  return group.boxes.every((box) => {
    const loc = world.locations[box.boxId]
    // A missing location means this box was already deleted (e.g. by a
    // caller that ran pruning twice, or a malformed group) — treat that as
    // "not untouched" rather than crashing or silently mispruning: a
    // missing box is never legitimately "still at its seed position".
    if (!loc) return false
    return (
      loc.board === group.interiorId &&
      loc.x === box.originalPosition.x &&
      loc.y === box.originalPosition.y
    )
  })
}

// Groups whose pieces and interior board still exist in `world` after
// pruning. Every metric that iterates groups against a post-pruning World
// must use this, not the original seed's full `groups` array — see section
// 4.6 for the crash this fixes. For a multi-box group, every box's piece
// must exist, not just one.
export function getSurvivingGroups(world: World, groups: SeedGroup[]): SeedGroup[] {
  return groups.filter(
    (group) =>
      world.pieces[group.containerId] !== undefined &&
      world.boards[group.interiorId] !== undefined &&
      group.boxes.every((box) => world.pieces[box.boxId] !== undefined),
  )
}

function removeGroup(world: World, group: SeedGroup): World {
  const next = cloneWorld(world)

  // This loop already deletes every piece located on the interior board
  // generically — for any number of boxes, not just one — so no per-box
  // enumeration is needed here at all.
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
