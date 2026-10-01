import { useState } from 'react'
import { ImportInput, ImportResult, fetchLevelText, importLevels } from '../levels/importLevel'

type Mode = 'file' | 'paste' | 'url'

// Import levels the player brings: official Custom Levels .txt files (the same files the
// original game reads from its custom_levels folder) or this game's JSON. Saved on this device.
export function ImportDialog({ onClose }: { onClose: (importedAny: boolean) => void }) {
  const [mode, setMode] = useState<Mode>('file')
  const [text, setText] = useState('')
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [importedAny, setImportedAny] = useState(false)

  const run = async (inputs: ImportInput[]) => {
    const r = importLevels(inputs)
    setResult(r)
    if (r.imported.length > 0) setImportedAny(true)
  }

  const fromFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setBusy(true)
    await run(await Promise.all([...files].map(async (f) => ({ name: f.name, text: await f.text() }))))
    setBusy(false)
  }

  const fromUrl = async () => {
    setBusy(true)
    try {
      await run([{ name: url, text: await fetchLevelText(url) }])
    } catch (e) {
      setResult({ imported: [], failed: [{ name: url, error: (e as Error).message }] })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="win-overlay" role="dialog" aria-label="汇入关卡">
      <div className="win-card import-card">
        <div className="import-title">汇入关卡</div>
        <p className="import-hint">
          支持原版 Patrick&apos;s Parabox 的自制关卡档(.txt,第一行是 <code>version 4</code>)和本游戏的 JSON。关卡只存在这台装置上,放在「汇入与自制关卡」里。
        </p>
        <div className="import-tabs" role="tablist">
          {([['file', '选择档案'], ['paste', '贴上文字'], ['url', '网址']] as const).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={mode === id} className={mode === id ? 'is-active' : ''} onClick={() => { setMode(id); setResult(null) }}>{label}</button>
          ))}
        </div>

        {mode === 'file' && (
          <label className="import-drop">
            <input type="file" accept=".txt,.json,text/plain,application/json" multiple onChange={(e) => fromFiles(e.target.files)} />
            <span>{busy ? '读取中…' : '点这里选择关卡档(可以一次选很多个)'}</span>
          </label>
        )}

        {mode === 'paste' && (
          <>
            <input className="import-input" placeholder="关卡名称" value={name} onChange={(e) => setName(e.target.value)} />
            <textarea className="import-text" placeholder={'version 4\n#\nBlock -1 -1 0 7 7 …'} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
            <button className="btn-primary" disabled={text.trim() === ''} onClick={() => run([{ name: name.trim() === '' ? '贴上的关卡' : name, text }])}>汇入</button>
          </>
        )}

        {mode === 'url' && (
          <>
            <input className="import-input" placeholder="https://… (GitHub、Pastebin 的分享网址也可以)" value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" />
            <button className="btn-primary" disabled={busy || url.trim() === ''} onClick={fromUrl}>{busy ? '下载中…' : '下载并汇入'}</button>
          </>
        )}

        {result !== null && (
          <div className="import-result">
            {result.imported.map((n) => <div key={n} className="import-ok">✓ 已汇入「{n}」</div>)}
            {result.failed.map((f) => <div key={f.name} className="import-bad">✗ {f.name}:{f.error}</div>)}
          </div>
        )}

        <p className="import-hint">别人做的关卡请只在自己的装置上游玩;要公开分享前,先取得作者同意。</p>
        <button className="btn-secondary" onClick={() => onClose(importedAny)}>完成</button>
      </div>
    </div>
  )
}
