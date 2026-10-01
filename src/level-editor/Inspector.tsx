import { useEffect, useState } from 'react'
import { Attempt, BoardId, PLAYER_ID, Piece, PieceId, World } from '../game/engine/types'
import { Result, resizeBoard, setAttemptOrder, updateBoard, updatePiece, deletePiece, uniqueId } from './editOps'
import { ToolId, ToolOptions } from './tools'

export type Selection = { kind: 'piece'; id: PieceId } | { kind: 'cell'; board: BoardId; x: number; y: number } | null

const ORDERS: { label: string; order?: Attempt[] }[] = [
  { label: '默认(push, enter, eat)' },
  { label: 'push, eat, enter', order: ['push', 'eat', 'enter'] },
  { label: 'enter, eat, push', order: ['enter', 'eat', 'push'] },
  { label: 'eat, enter, push', order: ['eat', 'enter', 'push'] },
]

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="le-field">
      <span>{label}</span>
      {children}
    </label>
  )
}

function Check({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="le-check" title={hint}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

function ColorField({ value, onChange, fallback }: { value: string | undefined; onChange: (v: string | undefined) => void; fallback: string }) {
  return (
    <div className="le-color">
      <input type="color" value={value ?? fallback} onChange={(e) => onChange(e.target.value)} />
      <span className="le-muted">{value ?? '自动'}</span>
      {value !== undefined && <button className="le-mini" onClick={() => onChange(undefined)}>自动</button>}
    </div>
  )
}

function boardLabel(world: World, board: BoardId, top: BoardId): string {
  const owners = Object.values(world.pieces).filter((p) => p.boardRef === board).length
  return `${board}${board === top ? '(最外层)' : ''} · ${world.boards[board]?.size ?? '?'}×${world.boards[board]?.size ?? '?'}${owners > 1 ? ` · ${owners} 个箱子通往` : ''}`
}

export function Inspector({
  world,
  topBoard,
  currentBoard,
  selection,
  tool,
  toolOptions,
  setToolOptions,
  edit,
  enterBoard,
  select,
}: {
  world: World
  topBoard: BoardId
  currentBoard: BoardId
  selection: Selection
  tool: ToolId
  toolOptions: ToolOptions
  setToolOptions: (o: ToolOptions) => void
  edit: (result: Result) => void
  enterBoard: (board: BoardId) => void
  select: (s: Selection) => void
}) {
  const board = world.boards[currentBoard]
  const [sizeDraft, setSizeDraft] = useState(String(board?.size ?? 5))
  useEffect(() => setSizeDraft(String(board?.size ?? 5)), [board?.size, currentBoard])
  const boards = Object.keys(world.boards).filter((b) => b !== 'void')
  const piece = selection?.kind === 'piece' ? world.pieces[selection.id] : undefined
  const patch = (p: Partial<Piece>) => piece && edit(updatePiece(world, piece.id, p, topBoard))

  return (
    <div className="le-inspector">
      {(tool === 'container' || tool === 'reference' || tool === 'infinity') && (
        <section className="le-card">
          <h3>工具设定</h3>
          {tool === 'container' && (
            <Field label="新房间大小(奇数:进入时落在一边的正中央)">
              <select value={toolOptions.containerSize} onChange={(e) => setToolOptions({ ...toolOptions, containerSize: Number(e.target.value) })}>
                {[1, 3, 5, 7, 9, 11, 13, 15].map((n) => <option key={n} value={n}>{n}×{n}</option>)}
              </select>
            </Field>
          )}
          {(tool === 'reference' || tool === 'infinity') && (
            <Field label="通往房间">
              <select value={toolOptions.referenceBoard} onChange={(e) => setToolOptions({ ...toolOptions, referenceBoard: e.target.value })}>
                {boards.map((b) => <option key={b} value={b}>{boardLabel(world, b, topBoard)}</option>)}
              </select>
            </Field>
          )}
          {tool === 'infinity' && (
            <Field label="层数(∞ 的个数)">
              <select value={toolOptions.infinityDegree} onChange={(e) => setToolOptions({ ...toolOptions, infinityDegree: Number(e.target.value) })}>
                {[0, 1, 2, 3].map((d) => <option key={d} value={d}>{'∞'.repeat(d + 1)}</option>)}
              </select>
            </Field>
          )}
        </section>
      )}

      {piece !== undefined && (
        <section className="le-card">
          <h3>物件 <code>{piece.id}</code></h3>
          <Field label="种类">
            <select
              value={piece.kind}
              disabled={piece.id === PLAYER_ID}
              onChange={(e) => {
                const kind = e.target.value as Piece['kind']
                patch(kind === 'container' ? { kind, boardRef: piece.boardRef ?? uniqueId(Object.keys(world.boards), 'room') } : { kind, boardRef: undefined })
              }}
            >
              <option value="normal">实心箱</option>
              <option value="container">箱子(有内部)</option>
              {piece.id === PLAYER_ID && <option value="player">玩家</option>}
            </select>
          </Field>
          {piece.id === PLAYER_ID && (
            <Check label="玩家也是箱子(有内部)" checked={piece.boardRef !== undefined} onChange={(v) => patch({ boardRef: v ? uniqueId(Object.keys(world.boards), 'room') : undefined })} />
          )}
          {piece.boardRef !== undefined && (
            <>
              <Field label="通往房间">
                <select value={piece.boardRef} onChange={(e) => patch({ boardRef: e.target.value })}>
                  {boards.map((b) => <option key={b} value={b}>{boardLabel(world, b, topBoard)}</option>)}
                </select>
              </Field>
              <button onClick={() => enterBoard(piece.boardRef as BoardId)}>进入这个房间编辑 →</button>
            </>
          )}
          <Field label="颜色">
            <ColorField value={piece.color} onChange={(color) => patch({ color })} fallback={piece.kind === 'player' ? '#c4006f' : piece.kind === 'container' ? '#3d9bff' : '#ffb236'} />
          </Field>
          <div className="le-checks">
            {piece.boardRef !== undefined && <Check label="翻转 (fliph)" checked={piece.fliph === true} onChange={(v) => patch({ fliph: v || undefined })} hint="内部左右镜像;穿过的东西会被翻转" />}
            {piece.boardRef !== undefined && <Check label="出口 (exitblock)" checked={piece.exitBlock === true} onChange={(v) => patch({ exitBlock: v || undefined })} hint="多个箱子通往同一房间时,离开房间走这一个" />}
            {piece.id !== PLAYER_ID && <Check label="可附身" checked={piece.possessable === true} onChange={(v) => patch({ possessable: v || undefined })} hint="推不动时玩家可以附身控制" />}
            {piece.id === PLAYER_ID && <Check label="可被再次附身" checked={piece.possessable === true} onChange={(v) => patch({ possessable: v || undefined })} />}
            {piece.kind === 'normal' && <Check label="墙方块" checked={piece.wall === true} onChange={(v) => patch({ wall: v || undefined })} hint="像墙一样推不动,附身后才能移动" />}
          </div>
          {piece.boardRef !== undefined && (
            <div className="le-sub">
              <Check label="∞ 无限大出口 (infexit)" checked={piece.infExit === true} onChange={(v) => patch({ infExit: v || undefined, infExitNum: v ? piece.infExitNum ?? 0 : undefined })} />
              {piece.infExit && (
                <Field label="层数">
                  <select value={piece.infExitNum ?? 0} onChange={(e) => patch({ infExitNum: Number(e.target.value) })}>
                    {[0, 1, 2, 3, 4].map((d) => <option key={d} value={d}>{'∞'.repeat(d + 1)}</option>)}
                  </select>
                </Field>
              )}
              <Check label="ε 无限小入口 (infenter)" checked={piece.infEnter === true} onChange={(v) => patch({ infEnter: v || undefined, infEnterNum: v ? piece.infEnterNum ?? 0 : undefined, infEnterId: v ? piece.infEnterId ?? 0 : undefined })} />
              {piece.infEnter && (
                <>
                  <Field label="ε 层数"><input type="number" min={0} value={piece.infEnterNum ?? 0} onChange={(e) => patch({ infEnterNum: Number(e.target.value) || 0 })} /></Field>
                  <Field label="infenterid"><input type="number" value={piece.infEnterId ?? 0} onChange={(e) => patch({ infEnterId: Number(e.target.value) || 0 })} /></Field>
                  <p className="le-muted">ε 入口要通往一个「漂浮」房间(在房间设定勾选)。</p>
                </>
              )}
            </div>
          )}
          {piece.id !== PLAYER_ID && (
            <button className="le-danger" onClick={() => { edit(deletePiece(world, piece.id, topBoard)); select(null) }}>删除物件</button>
          )}
        </section>
      )}

      {selection?.kind === 'cell' && (
        <section className="le-card">
          <h3>格子 ({selection.x}, {selection.y})</h3>
          <p className="le-muted">
            {world.boards[selection.board]?.cells[selection.y]?.[selection.x]?.type === 'wall' ? '墙' : '地板'}
            {world.boards[selection.board]?.cells[selection.y]?.[selection.x]?.requirement === 'box' ? ' · 箱子目标' : ''}
            {world.boards[selection.board]?.cells[selection.y]?.[selection.x]?.requirement === 'player' ? ' · 玩家目标' : ''}
          </p>
        </section>
      )}

      {board !== undefined && (
        <section className="le-card">
          <h3>房间 <code>{currentBoard}</code>{currentBoard === topBoard ? '(最外层)' : ''}</h3>
          <Field label="大小">
            <div className="le-row">
              <input type="number" min={1} max={30} value={sizeDraft} onChange={(e) => setSizeDraft(e.target.value)} />
              <button className="le-mini" disabled={Number(sizeDraft) === board.size} onClick={() => edit(resizeBoard(world, currentBoard, Number(sizeDraft), topBoard))}>套用</button>
            </div>
          </Field>
          <Field label="颜色">
            <ColorField value={board.color} onChange={(color) => edit(updateBoard(world, currentBoard, { color }))} fallback="#d4d4d4" />
          </Field>
          {board.size % 2 === 0 && Object.values(world.pieces).some((p) => p.boardRef === currentBoard) && (
            <p className="le-warn">这个房间是箱子的内部,但边长是偶数:进入箱子会落在一边的正中央,偶数边没有正中央那一格,箱子会进不去。建议改成奇数。</p>
          )}
          <Check label="漂浮房间 (floatinspace)" checked={board.floatInSpace === true} onChange={(v) => edit(updateBoard(world, currentBoard, { floatInSpace: v }))} hint="没有外层的房间,给 ε 入口使用" />
        </section>
      )}

      <section className="le-card">
        <h3>关卡规则</h3>
        <Field label="尝试顺序 (attempt_order)">
          <select
            value={ORDERS.findIndex((o) => JSON.stringify(o.order) === JSON.stringify(world.attemptOrder))}
            onChange={(e) => edit(setAttemptOrder(world, ORDERS[Number(e.target.value)].order))}
          >
            {ORDERS.map((o, i) => <option key={o.label} value={i}>{o.label}</option>)}
          </select>
        </Field>
        <p className="le-muted">推动永远最先尝试;这里决定推不动时先进入还是先吃。</p>
      </section>
    </div>
  )
}
