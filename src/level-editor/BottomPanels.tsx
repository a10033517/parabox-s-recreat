import { useState } from 'react'
import { applyMove } from '../game/engine/rules'
import { Direction, World } from '../game/engine/types'
import { ClassifyResponse, SolveResponse, api } from './api'

const ARROW: Record<Direction, string> = { up: '↑', down: '↓', left: '←', right: '→' }

export function worldAtStep(world: World, moves: Direction[], step: number): World {
  let current = world
  for (const dir of moves.slice(0, step)) current = applyMove(current, dir) ?? current
  return current
}

const STATUS: Record<SolveResponse['status'], string> = {
  SOLVED: '有解',
  UNSOLVABLE: '无解(已搜遍所有状态)',
  EXPANSION_CAP: '搜索太大,未能判定',
  DEPTH_CAP: '超过步数上限,未能判定',
}

export function SolverPanel({ world, onPreview }: { world: World; onPreview: (w: World | null, label?: string) => void }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<SolveResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState(0)
  const run = async () => {
    setBusy(true)
    setError(null)
    onPreview(null)
    try {
      const r = await api.solve(world)
      setResult(r)
      setStep(0)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const show = (s: number) => {
    if (result === null) return
    setStep(s)
    onPreview(worldAtStep(world, result.moves, s), `解法第 ${s} / ${result.moves.length} 步`)
  }
  return (
    <div className="le-panel-body">
      <div className="le-row">
        <button className="btn-primary" disabled={busy} onClick={run}>{busy ? '求解中…' : '求解'}</button>
        {result !== null && (
          <span className={`le-status ${result.status === 'SOLVED' ? 'ok' : 'bad'}`}>
            {STATUS[result.status]}
            {result.status === 'SOLVED' && ` · 最短 ${result.moves.length} 步`}
            {result.expandedStates !== undefined && ` · 搜索 ${result.expandedStates.toLocaleString()} 个状态`}
            {` · ${result.seconds.toFixed(1)} 秒`}
          </span>
        )}
      </div>
      {error !== null && <p className="le-error">{error}</p>}
      {result?.status === 'SOLVED' && result.moves.length > 0 && (
        <>
          <div className="le-moves">
            {result.moves.map((m, i) => (
              <button key={i} className={`le-move${i < step ? ' done' : ''}`} onClick={() => show(i + 1)} title={`第 ${i + 1} 步`}>{ARROW[m]}</button>
            ))}
          </div>
          <div className="le-row">
            <input type="range" min={0} max={result.moves.length} value={step} onChange={(e) => show(Number(e.target.value))} />
            <button className="le-mini" onClick={() => show(Math.max(0, step - 1))}>◀</button>
            <button className="le-mini" onClick={() => show(Math.min(result.moves.length, step + 1))}>▶</button>
            <button className="le-mini" onClick={() => { setStep(0); onPreview(null) }}>结束预览</button>
          </div>
        </>
      )}
    </div>
  )
}

const mark = (v: boolean | 'unproven') => (v === true ? '✓' : v === 'unproven' ? '?' : '✗')

export function ClassifyPanel({ world, canFile, filedWorld, onFile }: { world: World; canFile: boolean; filedWorld?: string; onFile: (worldId: string | null) => void }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ClassifyResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      setResult(await api.classify(world))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="le-panel-body">
      <div className="le-row">
        <button className="btn-primary" disabled={busy} onClick={run}>{busy ? '验证中…(可能要几十秒)' : '验证属于哪个 World'}</button>
        {result !== null && <span className="le-muted">求解:{result.solveStatus}{result.solutionLength !== undefined ? ` · ${result.solutionLength} 步` : ''}</span>}
      </div>
      <p className="le-muted">三层验证:<b>存在</b>(关卡有这个机制)· <b>使用</b>(最短解有用到)· <b>必要</b>(拿掉机制后证明无解)。三个都 ✓ 才属于该 World。</p>
      {error !== null && <p className="le-error">{error}</p>}
      {result !== null && (
        <table className="le-table">
          <thead><tr><th>World</th><th>存在</th><th>使用</th><th>必要</th><th /></tr></thead>
          <tbody>
            {result.worlds.map((w) => {
              const pass = w.presence && w.usage && w.necessity === true
              return (
                <tr key={w.id} className={pass ? 'pass' : ''}>
                  <td>{w.name}</td>
                  <td>{mark(w.presence)}</td>
                  <td>{mark(w.usage)}</td>
                  <td>{mark(w.necessity)}</td>
                  <td>
                    {pass && canFile && (filedWorld === w.id
                      ? <button className="le-mini" onClick={() => onFile(null)}>已放入 · 取消</button>
                      : <button className="le-mini" onClick={() => onFile(w.id)}>放入这个 World</button>)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      {!canFile && result !== null && <p className="le-muted">要把关卡放进 World,先把它存成「编辑器关卡」。</p>}
    </div>
  )
}

export function OfficialPanel({ world, onImport }: { world: World; onImport: (w: World) => void }) {
  const [text, setText] = useState('')
  const [warnings, setWarnings] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const exportNow = async () => {
    setError(null)
    try {
      const r = await api.exportOfficial(world)
      setText(r.text)
      setWarnings(r.warnings)
    } catch (e) {
      setError((e as Error).message)
    }
  }
  const importNow = async () => {
    setError(null)
    try {
      onImport(await api.importOfficial(text))
    } catch (e) {
      setError((e as Error).message)
    }
  }
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'level.txt'
    a.click()
    URL.revokeObjectURL(url)
  }
  return (
    <div className="le-panel-body">
      <div className="le-row">
        <button onClick={exportNow}>把目前关卡转成官方格式</button>
        <button onClick={importNow} disabled={text.trim() === ''}>把下面的文字汇入成关卡</button>
        <button onClick={download} disabled={text.trim() === ''}>下载 .txt</button>
        <label className="le-file">
          读取 .txt 档
          <input type="file" accept=".txt" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()) }} />
        </label>
      </div>
      {error !== null && <p className="le-error">{error}</p>}
      {warnings.map((w) => <p key={w} className="le-warn">{w}</p>)}
      <textarea className="le-textarea" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} placeholder="version 4&#10;#&#10;Block -1 -1 0 7 7 …" />
    </div>
  )
}
