import { useState } from 'react'
import { World } from '../game/engine/types'
import { api } from './api'
import { newLevel } from './editOps'

const WORLD_CHOICES = [
  ['intro', '入门 Intro'], ['enter', '进入 Enter'], ['empty', '空箱 Empty'], ['eat', '吞噬 Eat'],
  ['reference', '互相包含 Reference'], ['clone', '分身 Clone'], ['flip', '翻转 Flip'],
  ['possess', '附身 Possess'], ['wall', '墙壁 Wall'], ['infinite-exit', '无限大 Infinite Exit'],
] as const

type Template = 'walled' | 'open' | 'draft'

// Starting points for a new level: an empty room (walled or open), or a generated draft for a
// chosen World that already passed that World's three-level check — a puzzle to refine.
export function NewLevelDialog({ onCreate, onCancel }: { onCreate: (world: World, name: string, note?: string) => void; onCancel: () => void }) {
  const [name, setName] = useState('新关卡')
  const [size, setSize] = useState(7)
  const [color, setColor] = useState('#d4d4d4')
  const [template, setTemplate] = useState<Template>('walled')
  const [worldId, setWorldId] = useState<string>('enter')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const create = async () => {
    setError(null)
    if (template !== 'draft') {
      onCreate(newLevel(size, { walled: template === 'walled', color: color === '#d4d4d4' ? undefined : color }), name)
      return
    }
    setBusy(true)
    try {
      const draft = await api.draft(worldId)
      onCreate(draft.world, name, draft.verified ? `World 草稿(种子 ${draft.seed},已通过验证,最短 ${draft.solutionLength} 步)` : `World 草稿(种子 ${draft.seed},未在时限内找到通过验证的版本)`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="le-modal" role="dialog" aria-label="新增关卡">
      <div className="le-dialog">
        <h2>新增关卡</h2>
        <label className="le-field"><span>名称</span><input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></label>

        <div className="le-templates">
          {([
            ['walled', '围墙房间', '四周是墙的空房间'],
            ['open', '空房间', '全部都是地板'],
            ['draft', 'World 草稿', '用生成器做一个已验证的起点'],
          ] as const).map(([id, title, desc]) => (
            <button key={id} className={`le-template${template === id ? ' is-active' : ''}`} onClick={() => setTemplate(id)}>
              <span className={`le-template-icon t-${id}`} aria-hidden="true" />
              <b>{title}</b>
              <span className="le-muted">{desc}</span>
            </button>
          ))}
        </div>

        {template !== 'draft' ? (
          <>
            <label className="le-field">
              <span>大小 {size}×{size}</span>
              <input type="range" min={3} max={15} value={size} onChange={(e) => setSize(Number(e.target.value))} />
            </label>
            <label className="le-field"><span>最外层颜色</span><input type="color" value={color} onChange={(e) => setColor(e.target.value)} /></label>
          </>
        ) : (
          <label className="le-field">
            <span>World</span>
            <select value={worldId} onChange={(e) => setWorldId(e.target.value)}>
              {WORLD_CHOICES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>
        )}

        {error !== null && <p className="le-error">{error}</p>}
        <div className="le-dialog-actions">
          <button onClick={onCancel}>取消</button>
          <button className="btn-primary" disabled={busy} onClick={create}>{busy ? '生成中…(最多 20 秒)' : '建立'}</button>
        </div>
      </div>
    </div>
  )
}
