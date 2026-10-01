import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { serializeLevel } from '../../src/game/engine/levelSchema'
import { TUTORIAL, buildTutorialWorld, checkTutorialLevel } from './tutorial'

describe('tutorial levels', () => {
  it.each(TUTORIAL.map((l) => [l.id, l] as const))('%s is solvable and needs what it teaches', (_id, level) => {
    expect(checkTutorialLevel(level)).toMatchObject({ accepted: true })
  })

  it('the shipped files match the definitions (run npm run generate:tutorial after editing)', () => {
    for (const level of TUTORIAL) {
      const shipped = readFileSync(join('src', 'levels', 'builtin', 'tutorial', `${level.id}.json`), 'utf8')
      expect(JSON.parse(shipped)).toEqual(JSON.parse(JSON.stringify(serializeLevel(buildTutorialWorld(level)))))
    }
  })
})
