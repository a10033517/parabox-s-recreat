import { Capacitor, CapacitorHttp } from '@capacitor/core'
import { parseLevel, serializeLevel } from '../game/engine/levelSchema'
import { parseOfficialLevel } from '../game/engine/officialFormat'
import { World } from '../game/engine/types'
import { listCustomLevels, saveCustomLevel } from '../storage/progress'

// Importing levels the PLAYER brings (like the original game's custom_levels folder): a level
// file in the official Custom Levels text format (version 4) or this game's own JSON. Imported
// levels live only on the player's device (see storage/progress.ts) — the app itself never
// ships anyone else's levels.

export interface ImportInput {
  name: string // file name, URL, or what the player typed
  text: string
}

export interface ImportResult {
  imported: string[] // the names they were saved under
  failed: { name: string; error: string }[]
}

// Turns the parser's technical messages into ones a player can act on.
function friendly(message: string): string {
  if (/only supports square blocks/.test(message)) return '这个关卡用了长方形的箱子,本游戏只支持正方形'
  if (/unknown object/.test(message)) return `这个关卡用了本游戏还不支持的物件(${message})`
  if (/Only official level format "version 4"/.test(message)) return '不是官方关卡格式 version 4'
  if (/Expected exactly one top-level Block/.test(message)) return '关卡最外层必须刚好有一个 Block'
  if (/exactly one player/.test(message)) return '关卡必须刚好有一个玩家'
  if (/Unsupported attempt_order/.test(message)) return `不支持的 attempt_order 设定(${message})`
  return message
}

// A level file's text -> World: the official format when it starts with "version", else JSON.
export function parseLevelText(text: string): World {
  const trimmed = text.replace(/^﻿/, '').trim()
  if (trimmed === '') throw new Error('内容是空的')
  if (/^version\s+\d/i.test(trimmed)) return parseOfficialLevel(trimmed)
  if (trimmed.startsWith('{')) return parseLevel(JSON.parse(trimmed))
  throw new Error('看不出是关卡档:官方格式的第一行应该是「version 4」,或是本游戏的 JSON')
}

export function levelNameOf(source: string): string {
  const last = source.split(/[?#]/)[0].split(/[\\/]/).filter((s) => s !== '').pop() ?? source
  const name = decodeURIComponent(last).replace(/\.(txt|json)$/i, '').trim()
  return name === '' ? '汇入的关卡' : name.slice(0, 60)
}

function uniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name
  for (let i = 2; ; i++) if (!taken.has(`${name} (${i})`)) return `${name} (${i})`
}

export function importLevels(inputs: ImportInput[]): ImportResult {
  const taken = new Set(listCustomLevels().map((l) => l.id))
  const result: ImportResult = { imported: [], failed: [] }
  for (const input of inputs) {
    try {
      const world = parseLevelText(input.text)
      const name = uniqueName(levelNameOf(input.name), taken)
      saveCustomLevel(name, JSON.stringify(serializeLevel(world)))
      taken.add(name)
      result.imported.push(name)
    } catch (error) {
      result.failed.push({ name: input.name, error: friendly(error instanceof Error ? error.message : String(error)) })
    }
  }
  return result
}

// Share links -> the raw file behind them (GitHub, Gist, Pastebin).
export function rawUrl(url: string): string {
  const u = url.trim()
  const github = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/.exec(u)
  if (github) return `https://raw.githubusercontent.com/${github[1]}/${github[2]}/${github[3]}`
  const pastebin = /^https?:\/\/pastebin\.com\/(?!raw\/)([A-Za-z0-9]+)\/?$/.exec(u)
  if (pastebin) return `https://pastebin.com/raw/${pastebin[1]}`
  const gist = /^https?:\/\/gist\.github\.com\/([^/]+)\/([0-9a-f]+)\/?$/.exec(u)
  if (gist) return `https://gist.githubusercontent.com/${gist[1]}/${gist[2]}/raw`
  return u
}

export async function fetchLevelText(url: string): Promise<string> {
  const target = rawUrl(url)
  if (!/^https?:\/\//.test(target)) throw new Error('网址要以 http:// 或 https:// 开头')
  try {
    // The native app is not bound by the browser's cross-site rules.
    if (Capacitor.isNativePlatform()) {
      const res = await CapacitorHttp.get({ url: target, responseType: 'text' })
      if (res.status >= 400) throw new Error(`HTTP ${res.status}`)
      return typeof res.data === 'string' ? res.data : JSON.stringify(res.data)
    }
    const res = await fetch(target)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.text()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(/HTTP \d/.test(message) ? `读取失败(${message})` : '这个网站不允许网页直接读取档案。请先下载关卡档,再用「选择档案」汇入。')
  }
}
