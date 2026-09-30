import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { parseLevel, serializeLevel } from '../game/engine/levelSchema'
import { exportRootBoard } from '../game/engine/officialExport'
import { BoardId, PLAYER_ID, World, occupantAt } from '../game/engine/types'
import { PIECE_COLORS } from '../game/render/CanvasRenderer'
import { GameScreen } from '../game/GameScreen'
import { LevelEntry, LevelGroup, api } from './api'
import { BoardView, CellRef } from './BoardView'
import { ClassifyPanel, OfficialPanel, SolverPanel } from './BottomPanels'
import { EditError, Result, clearCell } from './editOps'
import { Inspector, Selection } from './Inspector'
import { NewLevelDialog } from './NewLevelDialog'
import { ALL_TOOLS, TOOL_GROUPS, ToolId, ToolOptions, applyTool } from './tools'

interface Doc {
  path?: string // undefined: not saved yet
  name: string
  world: World
  topBoard: BoardId
  note?: string
  authored: boolean
  worldId?: string
}

type Tab = 'solve' | 'classify' | 'official'

function validate(world: World): string | null {
  try {
    parseLevel(JSON.parse(JSON.stringify(serializeLevel(world))))
    return null
  } catch (e) {
    return (e as Error).message
  }
}

function hostColorOf(world: World, board: BoardId, top: BoardId): string | undefined {
  if (board === top) return world.boards[board]?.color
  const owner = Object.values(world.pieces).find((p) => p.boardRef === board)
  return owner?.color ?? world.boards[board]?.color ?? (owner?.kind === 'player' ? PIECE_COLORS.player : PIECE_COLORS.container)
}

export function EditorApp() {
  const [groups, setGroups] = useState<LevelGroup[]>([])
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [doc, setDoc] = useState<Doc | null>(null)
  const [past, setPast] = useState<World[]>([])
  const [future, setFuture] = useState<World[]>([])
  const [dirty, setDirty] = useState(false)
  const [view, setView] = useState<BoardId[]>([])
  const [selection, setSelection] = useState<Selection>(null)
  const [tool, setTool] = useState<ToolId>('select')
  const [toolOptions, setToolOptions] = useState<ToolOptions>({ containerSize: 5, referenceBoard: 'root', infinityDegree: 0 })
  const [preview, setPreview] = useState<{ world: World; label: string } | null>(null)
  const [tab, setTab] = useState<Tab>('solve')
  const [showNew, setShowNew] = useState(false)
  const [playing, setPlaying] = useState(0)
  const [toast, setToast] = useState<{ text: string; bad?: boolean } | null>(null)
  const painting = useRef(false)

  const notify = useCallback((text: string, bad = false) => {
    setToast({ text, bad })
    window.setTimeout(() => setToast((t) => (t?.text === text ? null : t)), 3500)
  }, [])

  const reloadGroups = useCallback(() => api.levels().then(setGroups).catch((e: Error) => notify(`读取关卡列表失败:${e.message}`, true)), [notify])
  useEffect(() => { void reloadGroups() }, [reloadGroups])

  const open = (next: Doc) => {
    setDoc(next)
    setPast([])
    setFuture([])
    setDirty(false)
    setView([next.topBoard])
    setSelection(null)
    setPreview(null)
    setToolOptions((o) => ({ ...o, referenceBoard: next.topBoard }))
  }

  const confirmDiscard = () => !dirty || window.confirm('目前的修改还没保存,确定要放弃吗?')

  const loadEntry = async (entry: LevelEntry, group: LevelGroup) => {
    if (!confirmDiscard()) return
    try {
      const world = parseLevel(await api.level(entry.path))
      open({ path: entry.path, name: entry.name, world, topBoard: exportRootBoard(world), note: group.note, authored: group.id === 'authored', worldId: entry.worldId })
    } catch (e) {
      notify(`无法打开:${(e as Error).message}`, true)
    }
  }

  // Applies an edit result as one undoable step (or, mid-stroke, as part of the current one).
  const commit = useCallback((result: Result | null, newStep = true) => {
    if (result === null) return
    if (result instanceof EditError) {
      notify(result.message, true)
      return
    }
    setDoc((d) => {
      if (d === null) return d
      if (newStep) {
        setPast((p) => [...p.slice(-199), d.world])
        setFuture([])
      }
      return { ...d, world: result }
    })
    setDirty(true)
  }, [notify])

  const undo = useCallback(() => {
    if (doc === null || past.length === 0) return
    setFuture((f) => [doc.world, ...f])
    setDoc({ ...doc, world: past[past.length - 1] })
    setPast((p) => p.slice(0, -1))
    setDirty(true)
  }, [doc, past])

  const redo = useCallback(() => {
    if (doc === null || future.length === 0) return
    setPast((p) => [...p, doc.world])
    setDoc({ ...doc, world: future[0] })
    setFuture((f) => f.slice(1))
    setDirty(true)
  }, [doc, future])

  const world = doc?.world
  const currentBoard = doc !== null && world !== undefined && world.boards[view[view.length - 1]] !== undefined ? view[view.length - 1] : doc?.topBoard
  const problem = useMemo(() => (world ? validate(world) : null), [world])
  // Rooms a box leads into must be odd-sized: entering lands on the centre cell of a side.
  const evenRooms = useMemo(
    () => (world ? Object.keys(world.boards).filter((b) => world.boards[b].size % 2 === 0 && Object.values(world.pieces).some((p) => p.boardRef === b)) : []),
    [world],
  )

  const save = useCallback(async (asNew = false) => {
    if (doc === null) return
    if (problem !== null) {
      notify(`关卡有问题,不能保存:${problem}`, true)
      return
    }
    try {
      if (doc.path !== undefined && !asNew) {
        if (doc.note !== undefined && !doc.authored && !window.confirm(`${doc.note}\n\n仍然要保存吗?`)) return
        await api.save(doc.path, doc.world)
        notify(`已保存 ${doc.path}`)
      } else {
        const name = asNew ? window.prompt('新关卡名称', `${doc.name} 副本`) : doc.name
        if (name === null) return
        const path = await api.create(name, doc.world)
        setDoc({ ...doc, path, name, authored: true, note: undefined, worldId: undefined })
        notify(`已存成新关卡 ${path}`)
      }
      setDirty(false)
      void reloadGroups()
    } catch (e) {
      notify(`保存失败:${(e as Error).message}`, true)
    }
  }, [doc, problem, notify, reloadGroups])

  // Tutorial levels are imported by name in the game's code, so they cannot be deleted here.
  const deletable = (path: string) => path.includes('/')

  const removeLevel = async (path: string, name: string) => {
    const regenerated = path.startsWith('worlds/') ? '\n(重新执行 generate:worlds 会产生新的一批关卡)' : path.startsWith('community-samples/') ? '\n(重新转换 .txt 会再产生这一关)' : ''
    if (!window.confirm(`确定删除「${name}」?\n会删除档案 src/levels/builtin/${path}${regenerated}`)) return
    try {
      await api.deleteLevel(path)
      if (doc?.path === path) {
        setDoc(null)
        setDirty(false)
      }
      notify(`已删除 ${name}`)
    } catch (e) {
      notify(`删除失败:${(e as Error).message}`, true)
    }
    void reloadGroups()
  }

  const fileUnderWorld = async (worldId: string | null) => {
    if (doc?.path === undefined) return
    await api.updateAuthored(doc.path, { worldId })
    setDoc({ ...doc, worldId: worldId ?? undefined })
    notify(worldId === null ? '已从 World 移出' : '已放入 World(游戏的关卡列表会显示在该 World 里)')
    void reloadGroups()
  }

  // ---- board interaction ----
  const toolDef = ALL_TOOLS.find((t) => t.id === tool)
  const cellDown = (cell: CellRef, button: number) => {
    if (doc === null || currentBoard === undefined || preview !== null) return
    if (button === 2) {
      commit(clearCell(doc.world, currentBoard, cell.x, cell.y, doc.topBoard))
      return
    }
    if (tool === 'select') {
      const occupant = occupantAt(doc.world, { board: currentBoard, x: cell.x, y: cell.y })
      setSelection(occupant !== undefined ? { kind: 'piece', id: occupant } : { kind: 'cell', board: currentBoard, x: cell.x, y: cell.y })
      return
    }
    painting.current = toolDef?.paint === true
    const result = applyTool(doc.world, tool, currentBoard, cell.x, cell.y, toolOptions, doc.topBoard)
    commit(result, true)
    // The piece just placed becomes the selection, so its properties are right there.
    if (!toolDef?.paint && result !== null && !(result instanceof EditError)) {
      const placed = occupantAt(result, { board: currentBoard, x: cell.x, y: cell.y })
      if (placed !== undefined) setSelection({ kind: 'piece', id: placed })
    }
  }
  const cellEnter = (cell: CellRef) => {
    if (!painting.current || doc === null || currentBoard === undefined) return
    setDoc((d) => {
      if (d === null) return d
      const r = applyTool(d.world, tool, currentBoard, cell.x, cell.y, toolOptions, d.topBoard)
      if (r === null || r instanceof EditError) return d
      setDirty(true)
      return { ...d, world: r }
    })
  }
  const cellDouble = (cell: CellRef) => {
    if (doc === null || currentBoard === undefined) return
    const occupant = occupantAt(doc.world, { board: currentBoard, x: cell.x, y: cell.y })
    const inner = occupant !== undefined ? doc.world.pieces[occupant].boardRef : undefined
    if (inner !== undefined && inner !== currentBoard) setView((v) => [...v, inner])
  }

  // A deleted piece can no longer be selected.
  useEffect(() => {
    if (selection?.kind === 'piece' && world !== undefined && world.pieces[selection.id] === undefined) setSelection(null)
  }, [world, selection])

  // ---- keyboard ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (playing > 0 || showNew) return
      const target = e.target as HTMLElement
      const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT'
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); void save(); return }
      if (typing) return
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return }
      if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); redo(); return }
      if (e.key === 'Escape') { setPreview(null); setSelection(null); return }
      const t = ALL_TOOLS.find((x) => x.key === e.key.toLowerCase())
      if (t !== undefined && !mod) setTool(t.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [save, undo, redo, playing, showNew])

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const shown = preview?.world ?? world
  const shownBoard = preview !== null && shown !== undefined ? shown.locations[PLAYER_ID]?.board ?? currentBoard : currentBoard
  const q = search.trim().toLowerCase()

  return (
    <div className="le-app">
      <header className="le-header">
        <div className="le-brand">Parabox <span>关卡编辑器</span></div>
        {doc !== null && (
          <>
            <input className="le-name" value={doc.name} onChange={(e) => { setDoc({ ...doc, name: e.target.value }); setDirty(true) }} aria-label="关卡名称" />
            <span className="le-path" title={doc.note}>{doc.path ?? '尚未保存'}{dirty ? ' ●' : ''}</span>
          </>
        )}
        <div className="le-header-actions">
          <button onClick={() => { if (confirmDiscard()) setShowNew(true) }}>＋ 新增关卡</button>
          <button disabled={doc === null} onClick={() => save()} title="Ctrl+S">保存</button>
          <button disabled={doc === null} onClick={() => save(true)}>另存新关卡</button>
          <button disabled={past.length === 0} onClick={undo} title="Ctrl+Z">↶</button>
          <button disabled={future.length === 0} onClick={redo} title="Ctrl+Y">↷</button>
          <button className="btn-primary" disabled={doc === null || problem !== null} onClick={() => setPlaying((n) => n + 1)}>▶ 试玩</button>
          {doc?.path !== undefined && deletable(doc.path) && <button className="le-danger" onClick={() => removeLevel(doc.path as string, doc.name)}>删除关卡</button>}
        </div>
      </header>

      <aside className="le-sidebar">
        <input className="le-search" placeholder="搜索关卡…" value={search} onChange={(e) => setSearch(e.target.value)} />
        {groups.map((group) => {
          const levels = group.levels.filter((l) => q === '' || l.name.toLowerCase().includes(q) || l.path.toLowerCase().includes(q))
          if (levels.length === 0 && q !== '') return null
          const isCollapsed = collapsed[group.id] ?? (q === '' && group.id !== 'authored' && group.id !== 'tutorial')
          return (
            <div key={group.id} className="le-group">
              <button className="le-group-title" onClick={() => setCollapsed({ ...collapsed, [group.id]: !isCollapsed })}>
                <span>{isCollapsed ? '▸' : '▾'} {group.title}</span>
                <span className="le-count">{levels.length}</span>
              </button>
              {!isCollapsed && (
                <ul>
                  {levels.length === 0 && <li className="le-muted le-empty">(还没有)</li>}
                  {levels.map((l) => (
                    <li key={l.path} className="le-level-row">
                      <button className={`le-level${doc?.path === l.path ? ' is-active' : ''}`} onClick={() => loadEntry(l, group)}>
                        {l.name}
                        {l.worldId !== undefined && <span className="le-tag">{l.worldId}</span>}
                      </button>
                      {deletable(l.path) && (
                        <button className="le-level-delete" title="删除这一关" aria-label={`删除 ${l.name}`} onClick={() => removeLevel(l.path, l.name)}>🗑</button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </aside>

      <main className="le-main">
        {doc === null || world === undefined || currentBoard === undefined || shown === undefined || shownBoard === undefined ? (
          <div className="le-welcome">
            <h1>关卡编辑器</h1>
            <p>从左边选一个关卡编辑,或建立新关卡。</p>
            <button className="btn-primary" onClick={() => setShowNew(true)}>＋ 新增关卡</button>
          </div>
        ) : (
          <>
            <nav className="le-crumbs">
              {view.filter((b) => world.boards[b] !== undefined).map((b, i, arr) => (
                <button key={`${b}-${i}`} className={i === arr.length - 1 ? 'is-current' : ''} onClick={() => setView(arr.slice(0, i + 1))}>
                  {i === 0 ? '最外层' : b} <small>{world.boards[b].size}×{world.boards[b].size}</small>
                </button>
              ))}
              <span className="le-muted">双击有内部的箱子可以进入编辑</span>
            </nav>
            {doc.note !== undefined && <div className="le-banner">{doc.note}</div>}
            {preview !== null && (
              <div className="le-banner is-preview">
                预览:{preview.label}(不能编辑)<button className="le-mini" onClick={() => setPreview(null)}>返回编辑</button>
              </div>
            )}
            <BoardView
              world={shown}
              boardId={shownBoard}
              hostColor={hostColorOf(shown, shownBoard, doc.topBoard)}
              readOnly={preview !== null}
              selected={
                selection?.kind === 'cell' && selection.board === currentBoard
                  ? selection
                  : selection?.kind === 'piece' && world.locations[selection.id]?.board === currentBoard
                    ? world.locations[selection.id]
                    : undefined
              }
              onCellDown={cellDown}
              onCellEnter={cellEnter}
              onCellDouble={cellDouble}
              onPointerUp={() => { painting.current = false }}
            />
            <div className={`le-statusbar ${problem === null ? 'ok' : 'bad'}`}>
              {problem === null ? '✓ 关卡结构正确,可以保存和试玩' : `✗ ${problem}`}
              {evenRooms.length > 0 && <span className="le-warn">⚠ 偶数大小的箱子房间:{evenRooms.join(', ')}(进不去,建议改成奇数)</span>}
              <span className="le-muted">{toolDef?.hint}</span>
            </div>
          </>
        )}
      </main>

      <aside className="le-right">
        <div className="le-palette">
          {TOOL_GROUPS.map((g) => (
            <div key={g.title} className="le-palette-group">
              <div className="le-palette-title">{g.title}</div>
              <div className="le-palette-tools">
                {g.tools.map((t) => (
                  <button key={t.id} className={`le-tool${tool === t.id ? ' is-active' : ''}`} onClick={() => setTool(t.id)} title={`${t.hint}${t.key ? `(快捷键 ${t.key.toUpperCase()})` : ''}`}>
                    <span className={`le-tool-icon i-${t.id}`} aria-hidden="true" />
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        {doc !== null && world !== undefined && currentBoard !== undefined && (
          <Inspector
            world={world}
            topBoard={doc.topBoard}
            currentBoard={currentBoard}
            selection={selection}
            tool={tool}
            toolOptions={toolOptions}
            setToolOptions={setToolOptions}
            edit={(r) => commit(r)}
            enterBoard={(b) => setView((v) => [...v, b])}
            select={setSelection}
          />
        )}
      </aside>

      <section className="le-bottom">
        <div className="le-tabs">
          {([['solve', '求解'], ['classify', 'World 分类验证'], ['official', '官方格式']] as const).map(([id, label]) => (
            <button key={id} className={tab === id ? 'is-active' : ''} onClick={() => setTab(id)}>{label}</button>
          ))}
        </div>
        {doc !== null && world !== undefined ? (
          <>
            <div hidden={tab !== 'solve'}><SolverPanel world={world} onPreview={(w, label) => setPreview(w === null ? null : { world: w, label: label ?? '' })} /></div>
            <div hidden={tab !== 'classify'}><ClassifyPanel world={world} canFile={doc.authored && doc.path !== undefined && !dirty} filedWorld={doc.worldId} onFile={fileUnderWorld} /></div>
            <div hidden={tab !== 'official'}>
              <OfficialPanel world={world} onImport={(w) => { if (confirmDiscard()) open({ name: '汇入的关卡', world: w, topBoard: exportRootBoard(w), authored: false }) }} />
            </div>
          </>
        ) : (
          <p className="le-muted le-panel-body">打开一个关卡后可以求解、验证 World、转换官方格式。</p>
        )}
      </section>

      {showNew && (
        <NewLevelDialog
          onCancel={() => setShowNew(false)}
          onCreate={(w, name, note) => {
            setShowNew(false)
            open({ name, world: w, topBoard: exportRootBoard(w), authored: false, note })
            setDirty(true)
          }}
        />
      )}

      {playing > 0 && doc !== null && (
        <div className="le-play">
          <GameScreen key={playing} initialWorld={doc.world} levelName={`试玩:${doc.name}`} onExit={() => setPlaying(0)} onWin={() => {}} />
        </div>
      )}

      {toast !== null && <div className={`le-toast${toast.bad ? ' bad' : ''}`}>{toast.text}</div>}
    </div>
  )
}
