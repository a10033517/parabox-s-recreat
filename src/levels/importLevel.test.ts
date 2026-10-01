import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, beforeEach } from 'vitest'
import { importLevels, levelNameOf, parseLevelText, rawUrl } from './importLevel'
import { loadCustomLevels } from './index'
import { serializeLevel } from '../game/engine/levelSchema'
import { PLAYER_ID } from '../game/engine/types'

const OFFICIAL = readFileSync(join(__dirname, '../../docs/differential/community-samples/player_box_eat.txt'), 'utf8')

beforeEach(() => localStorage.clear())

describe('importing levels the player brings', () => {
  it('reads an official Custom Levels .txt and this game\'s JSON', () => {
    const world = parseLevelText(OFFICIAL)
    expect(world.pieces[PLAYER_ID]).toBeDefined()
    expect(parseLevelText(JSON.stringify(serializeLevel(world))).locations[PLAYER_ID]).toEqual(world.locations[PLAYER_ID])
  })

  it('saves imported levels on the device, where the level list finds them', () => {
    const result = importLevels([{ name: 'player_box_eat.txt', text: OFFICIAL }, { name: 'player_box_eat.txt', text: OFFICIAL }])
    expect(result.imported).toEqual(['player_box_eat', 'player_box_eat (2)'])
    expect(loadCustomLevels().map((l) => l.name)).toEqual(['player_box_eat', 'player_box_eat (2)'])
  })

  it('reports what is wrong with a file instead of importing it', () => {
    const rect = 'version 4\n#\nBlock -1 -1 0 5 4 0 0 0.8 1 0 0 0 0 0 0 0\n'
    const result = importLevels([
      { name: 'rect.txt', text: rect },
      { name: 'notes.txt', text: 'hello' },
      { name: 'empty.txt', text: '   ' },
    ])
    expect(result.imported).toEqual([])
    expect(result.failed.map((f) => f.error)).toEqual([
      '这个关卡用了长方形的箱子,本游戏只支持正方形',
      expect.stringContaining('看不出是关卡档'),
      '内容是空的',
    ])
    expect(loadCustomLevels()).toEqual([])
  })

  it('names a level after its file or URL', () => {
    expect(levelNameOf('C:\\levels\\Big Loop.txt')).toBe('Big Loop')
    expect(levelNameOf('https://example.com/packs/space%20walk.txt?dl=1')).toBe('space walk')
  })

  it('turns share links into the raw file behind them', () => {
    expect(rawUrl('https://github.com/a/b/blob/main/levels/x.txt')).toBe('https://raw.githubusercontent.com/a/b/main/levels/x.txt')
    expect(rawUrl('https://pastebin.com/AbC123')).toBe('https://pastebin.com/raw/AbC123')
    expect(rawUrl('https://gist.github.com/someone/0123abcd')).toBe('https://gist.githubusercontent.com/someone/0123abcd/raw')
    expect(rawUrl('https://example.com/x.txt')).toBe('https://example.com/x.txt')
  })
})
