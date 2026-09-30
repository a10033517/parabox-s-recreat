import { applyMove } from '../../src/game/engine/rules'
import { EngineEvent, withEngineContext } from '../../src/game/engine/events'
import { infiniteEnterRegistry } from '../../src/game/engine/officialFormat'
import { World } from '../../src/game/engine/types'
import { solveDetailed } from './solver'

// `infiniteEnterRequired` is a GENERATOR CONSTRAINT: "this level needs an Infinite Enter to
// be solvable". It never creates an ε; it only checks that one is really used.
//
//   structure : an authored infenter Ref exists (informational; the engine can also spawn a
//               null-space ε with no authored Ref)
//   reachable : the level is solvable at all
//   triggered : replaying the found solution really produces an Infinite Enter
//   necessary : with Infinite Enter disabled (mechanic removal) the level becomes unsolvable
// valid = reachable && triggered && necessary. Merely CONTAINING an ε is never enough.
export interface InfiniteEnterValidationResult {
  required: boolean
  foundRef: boolean
  reachable: boolean
  triggered: boolean
  necessary: boolean
  valid: boolean
  degree?: number
  refId?: string
  error?: string
}

export function validateInfiniteEnter(
  world: World,
  required: boolean,
  maxSolveDepth: number,
  maxExpandedStates: number,
): InfiniteEnterValidationResult {
  const registry = infiniteEnterRegistry(world)
  const result: InfiniteEnterValidationResult = {
    required,
    foundRef: registry.length > 0,
    reachable: false,
    triggered: false,
    necessary: false,
    valid: !required,
    degree: registry[0]?.degree,
    refId: registry[0]?.refId,
  }
  if (!required) return result

  const solved = solveDetailed(world, maxSolveDepth, maxExpandedStates)
  if (solved.status !== 'SOLVED') {
    result.error = `not solvable (${solved.status})`
    return result
  }
  result.reachable = true

  const directions = solved.result.moves
  const events: EngineEvent[] = []
  withEngineContext({ events }, () => {
    let current = world
    for (const direction of directions) {
      const next = applyMove(current, direction)
      if (next === null) break
      current = next
    }
  })
  result.triggered = events.some((e) => e.type === 'SpawnEpsilonEvent')
  if (!result.triggered) {
    result.error = 'the solution never triggers an Infinite Enter'
    return result
  }

  const without = withEngineContext({ disableInfiniteEnter: true }, () =>
    solveDetailed(world, maxSolveDepth, maxExpandedStates),
  )
  result.necessary = without.status === 'UNSOLVABLE'
  if (!result.necessary) {
    result.error = without.status === 'SOLVED'
      ? 'solvable without Infinite Enter: the mechanic is not required'
      : `could not prove necessity (${without.status})`
    return result
  }
  result.valid = true
  return result
}
