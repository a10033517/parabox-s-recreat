import { useEffect, useRef, useState } from 'react'
import { GameState } from './engine/GameState'
import { possess } from './engine/rules'
import { BoardId, Direction, Location, PieceId, PLAYER_ID, VOID_BOARD_ID, World } from './engine/types'
import { DrawContext, DEFAULT_RENDER_BUDGET, drawBoardRecursive, drawPiece, indexPiecesByBoard } from './render/CanvasRenderer'
import { CrossBoardMove, crossBoardMoves, flipScaleAt, flippedPieces, interpolateCell } from './render/moveAnimation'
import { CameraTransform, Viewport, cameraForFocus, interpolateCamera } from './render/camera'
import { resolveAnchorBoardId, resolveDrawRoot } from './render/recursiveTransform'
import { classifyEpsilonVisuals, epsilonSpawnScale } from './render/epsilonAnimation'
import { DPad } from '../ui/DPad'
import { SwipeLayer } from '../ui/SwipeLayer'
import { SettingsPanel } from '../ui/SettingsPanel'
import { InspectView } from '../ui/InspectView'
import { containerAt } from './render/hitTest'
import { BoardTransform } from './render/recursiveTransform'
import { EyeAnimator } from './render/eyes'
import { MOVE_INTERVAL_MS, useSettings } from '../storage/settings'
import { moveFeedback } from '../native'

export type AnimationKind = 'move' | 'enter-leave' | 'teleport' | 'void-transition'

interface RenderAnimation {
  preWorld: World
  postWorld: World
  startTimeMs: number
  durationMs: number
  kind: AnimationKind
  sourceCamera: CameraTransform
  targetCamera: CameraTransform
  // The ε the engine says this move created; drives the one-shot spawn scale animation.
  spawnEpsilonId?: PieceId
  // Pieces that changed boards (glide between the two cells) and pieces that flipped.
  crossBoard: CrossBoardMove[]
  flipped: Set<PieceId>
}

const DURATIONS: Record<AnimationKind, number> = {
  move: 150,
  'enter-leave': 280,
  teleport: 400,
  'void-transition': 400,
}

// A move that spawns an ε plays longer, so the scale-up is readable after the world swap.
export const EPSILON_SPAWN_DURATION_MS = 700

// Moves that may wait for the move-rate limit; more than this and the extra input is dropped.
const MAX_QUEUED_MOVES = 2

// Exported (rather than module-private) so the animation layer's own logic can be
// unit-tested directly against real pre/post World pairs, instead of only indirectly
// through end-state assertions that would pass against a broken/no-op animation
// implementation too (final-review I5).
export function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t)
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function isSimpleContainmentStep(world: World, oldBoard: string, newBoard: string): boolean {
  const newOwner = Object.values(world.pieces).find((p) => (p.kind === 'container' || p.kind === 'player') && p.boardRef === newBoard)
  if (newOwner !== undefined && world.locations[newOwner.id]?.board === oldBoard) return true
  const oldOwner = Object.values(world.pieces).find((p) => (p.kind === 'container' || p.kind === 'player') && p.boardRef === oldBoard)
  if (oldOwner !== undefined && world.locations[oldOwner.id]?.board === newBoard) return true
  return false
}

// Two cameras share one coordinate space (so they can be interpolated) only when they are
// anchored on the same board.
export function sameCameraSpace(a: CameraTransform, b: CameraTransform): boolean {
  return a.anchor === b.anchor && a.anchorBoardId === b.anchorBoardId
}

// The board a camera's coordinates are measured from (and the scene is drawn from).
export function cameraAnchorBoard(camera: CameraTransform, world: World, rootAnchorBoardId: BoardId | undefined): BoardId | null {
  if (camera.anchorBoardId !== undefined) return camera.anchorBoardId
  return camera.anchor === 'root' && rootAnchorBoardId !== undefined ? rootAnchorBoardId : resolveAnchorBoardId(world, camera.anchor)
}

export function classifyMove(preWorld: World, postWorld: World): AnimationKind {
  const oldBoard = preWorld.locations[PLAYER_ID]?.board
  const newBoard = postWorld.locations[PLAYER_ID]?.board
  if (oldBoard === undefined || newBoard === undefined || oldBoard === newBoard) return 'move'
  if (oldBoard === VOID_BOARD_ID || newBoard === VOID_BOARD_ID) return 'void-transition'
  if (isSimpleContainmentStep(postWorld, oldBoard, newBoard)) return 'enter-leave'
  return 'teleport'
}

export function getRenderLocationFactory(preWorld: World, postWorld: World, t: number) {
  return (pieceId: PieceId): Location | undefined => {
    const pre = preWorld.locations[pieceId]
    const post = postWorld.locations[pieceId]
    if (post === undefined) return pre
    if (pre === undefined || pre.board !== post.board) return post
    return { board: post.board, x: lerp(pre.x, post.x, t), y: lerp(pre.y, post.y, t) }
  }
}

export function GameScreen({
  initialWorld,
  onExit,
  onWin,
  levelName,
  hint,
  onNext,
}: {
  initialWorld: World
  onExit: () => void
  onWin: () => void
  levelName?: string
  hint?: string // what this level teaches (tutorial), shown above the board
  onNext?: () => void // shown on the win card when there is a next level
}) {
  const stateRef = useRef<GameState>()
  if (!stateRef.current) stateRef.current = new GameState(initialWorld)
  const state = stateRef.current

  // Resolved ONCE per level load (from the level's initial World, same lazy-init idiom
  // as stateRef above), never re-derived from live/possibly-player-relocated World
  // snapshots on every frame or every move — see resolveCanonicalBoardTransform's and
  // cameraForFocus's own cachedRootAnchorBoardId doc (final-review I3). Undefined
  // sentinel distinguishes "not yet computed" from a legitimate null result (an
  // unreachable/malformed world), so a null result is still cached rather than retried.
  const rootAnchorBoardIdRef = useRef<BoardId | null | undefined>(undefined)
  if (rootAnchorBoardIdRef.current === undefined) {
    rootAnchorBoardIdRef.current = resolveAnchorBoardId(initialWorld, 'root')
  }
  const rootAnchorBoardId = rootAnchorBoardIdRef.current ?? undefined

  const [, setTick] = useState(0)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const wonRef = useRef(false)
  const viewportRef = useRef<Viewport>({ width: 320, height: 320 })
  const animationRef = useRef<RenderAnimation | null>(null)
  const eyesRef = useRef<EyeAnimator>()
  if (!eyesRef.current) eyesRef.current = new EyeAnimator(performance.now())
  const eyeAnimator = eyesRef.current
  const [settings] = useSettings()
  // The keyboard listener is registered once, so it reads the latest settings through a ref.
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const [showSettings, setShowSettings] = useState(false)
  // Looking inside a box: the game pauses (moves are ignored) while the inspect view is open.
  const [inspecting, setInspecting] = useState<PieceId | null>(null)
  const pausedRef = useRef(false)
  pausedRef.current = inspecting !== null || showSettings
  // What the last frame drew, so a tap can be matched to the box under the finger.
  const lastFrameRef = useRef<{ world: World; camera: CameraTransform; viewport: Viewport; root: BoardTransform } | null>(null)

  const inspectAt = (clientX: number, clientY: number) => {
    const frame = lastFrameRef.current
    const canvas = canvasRef.current
    if (!settingsRef.current.tapToInspect || frame === null || canvas === null) return
    const rect = canvas.getBoundingClientRect()
    const pieceId = containerAt(frame, clientX - rect.left, clientY - rect.top)
    if (pieceId !== null) setInspecting(pieceId)
  }

  // Move-rate limit (settings.moveRate): a move that comes sooner than the interval after the
  // last one waits; at most MAX_QUEUED wait, anything beyond is dropped.
  const moveQueueRef = useRef<{ pending: Direction[]; lastAt: number; timer?: number }>({ pending: [], lastAt: -Infinity })
  const clearMoveQueue = () => {
    window.clearTimeout(moveQueueRef.current.timer)
    moveQueueRef.current = { pending: [], lastAt: moveQueueRef.current.lastAt }
  }
  useEffect(() => clearMoveQueue, [])
  const drainMoveQueue = () => {
    const q = moveQueueRef.current
    q.timer = undefined
    const next = q.pending.shift()
    if (next === undefined) return
    q.lastAt = performance.now()
    performMove(next)
    if (q.pending.length > 0) q.timer = window.setTimeout(drainMoveQueue, MOVE_INTERVAL_MS[settingsRef.current.moveRate])
  }
  const handleMove = (direction: Direction) => {
    if (pausedRef.current) return
    const q = moveQueueRef.current
    const interval = MOVE_INTERVAL_MS[settingsRef.current.moveRate]
    const now = performance.now()
    if (interval <= 0 || (q.pending.length === 0 && q.timer === undefined && now - q.lastAt >= interval)) {
      q.lastAt = now
      performMove(direction)
      return
    }
    if (q.pending.length >= MAX_QUEUED_MOVES) return
    q.pending.push(direction)
    if (q.timer === undefined) q.timer = window.setTimeout(drainMoveQueue, Math.max(0, q.lastAt + interval - now))
  }

  const performMove = (direction: Direction) => {
    if (pausedRef.current) return
    // The eyes look the way the player goes, even when the move is blocked.
    eyeAnimator.look(direction, performance.now())
    const preMoveWorld = state.current
    const moved = state.move(direction)
    if (!moved) return
    if (settingsRef.current.haptics) moveFeedback()
    const postMoveWorld = state.current
    // A SpawnEpsilonEvent that CREATED a new ε plays the Void transition (the ε appears in the
    // Void and the camera follows); the decision comes from the engine's event, never from the
    // renderer inspecting topology.
    const spawnedEpsilon = state.lastEvents.some((e) => e.type === 'SpawnEpsilonEvent' && e.created)
    // Possess swaps the player's identity with the possessed block without moving anything:
    // animate from the pre-move world with that same swap applied, so no body glides.
    const possessEvent = state.lastEvents.find((e) => e.type === 'PossessEvent')
    const animPreWorld = possessEvent !== undefined ? possess(preMoveWorld, possessEvent.targetId) : preMoveWorld
    const kind = spawnedEpsilon ? 'void-transition' : classifyMove(preMoveWorld, postMoveWorld)
    const spawnEpsilonId = [...classifyEpsilonVisuals(preMoveWorld, postMoveWorld, state.lastEvents)]
      .find(([, visual]) => visual === 'Spawn')?.[0]
    const budget = { marginCells: DEFAULT_RENDER_BUDGET.marginCells }
    const sourceCamera = cameraForFocus(preMoveWorld, viewportRef.current, budget, rootAnchorBoardId)
    const targetCamera = cameraForFocus(postMoveWorld, viewportRef.current, budget, rootAnchorBoardId)
    // Pieces glide / flip only when both frames share one coordinate space (no Void swap).
    const sameSpace = kind !== 'void-transition' && sameCameraSpace(sourceCamera, targetCamera)
    const anchorBoardId = sameSpace ? cameraAnchorBoard(targetCamera, postMoveWorld, rootAnchorBoardId) : null
    animationRef.current = {
      preWorld: animPreWorld,
      postWorld: postMoveWorld,
      startTimeMs: performance.now(),
      durationMs: spawnedEpsilon ? EPSILON_SPAWN_DURATION_MS : DURATIONS[kind],
      spawnEpsilonId,
      kind,
      sourceCamera,
      targetCamera,
      crossBoard: anchorBoardId !== null ? crossBoardMoves(animPreWorld, postMoveWorld, anchorBoardId) : [],
      flipped: sameSpace ? flippedPieces(animPreWorld, postMoveWorld) : new Set(),
    }
    setTick((t) => t + 1)
  }

  const handleRestart = () => {
    clearMoveQueue()
    if (state.restart()) {
      wonRef.current = false
      animationRef.current = null
      setTick((t) => t + 1)
    }
  }

  const handleUndo = () => {
    clearMoveQueue()
    if (state.undo()) {
      wonRef.current = false
      animationRef.current = null // cancel any in-flight animation — undo settles instantly
      setTick((t) => t + 1)
    }
  }

  useEffect(() => {
    if (state.isWon && !wonRef.current) {
      wonRef.current = true
      onWin()
    }
  })

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const updateViewport = () => {
      viewportRef.current = { width: el.clientWidth || 320, height: el.clientHeight || 320 }
    }
    updateViewport()
    // jsdom (this project's test environment) does not implement ResizeObserver at all —
    // the initial size captured above still applies; a real browser gets live resizing.
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(updateViewport)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const map: Record<string, Direction> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }
      const direction = map[e.key]
      if (direction) handleMove(direction)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    let rafId: number

    const frame = () => {
      const viewport = viewportRef.current
      const dpr = window.devicePixelRatio || 1
      const targetWidth = Math.round(viewport.width * dpr)
      const targetHeight = Math.round(viewport.height * dpr)
      if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth
        canvas.height = targetHeight
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = '#0b0b0b' // outside every board: the dark backdrop of the original
      ctx.fillRect(0, 0, viewport.width, viewport.height)

      const anim = animationRef.current
      let world = state.current
      let camera: CameraTransform
      let dimAlpha = 0 // Void-transition darken overlay, 0..1

      if (anim !== null) {
        const rawT = (performance.now() - anim.startTimeMs) / anim.durationMs
        if (rawT >= 1) {
          animationRef.current = null
          world = state.current
          camera = cameraForFocus(world, viewport, { marginCells: DEFAULT_RENDER_BUDGET.marginCells }, rootAnchorBoardId)
        } else {
          const t = easeOut(Math.max(0, rawT))
          if (anim.kind === 'void-transition' || !sameCameraSpace(anim.sourceCamera, anim.targetCamera)) {
            // Anchors are never interpolated (§12) — two-phase darken/swap/fade instead.
            if (t < 0.5) {
              world = anim.preWorld
              camera = anim.sourceCamera
              dimAlpha = t / 0.5
            } else {
              world = anim.postWorld
              camera = anim.targetCamera
              dimAlpha = 1 - (t - 0.5) / 0.5
            }
          } else {
            world = anim.postWorld
            // Same progress (t) as the gliding pieces, so the zoom lands with them.
            camera = interpolateCamera(anim.sourceCamera, anim.targetCamera, t)
          }
        }
      } else {
        camera = cameraForFocus(world, viewport, { marginCells: DEFAULT_RENDER_BUDGET.marginCells }, rootAnchorBoardId)
      }

      // Same cached anchor id used for the camera above — the Void anchor case is
      // unaffected (VOID_BOARD_ID is always an unambiguous constant, no caching needed).
      const anchorBoardId = cameraAnchorBoard(camera, world, rootAnchorBoardId)
      if (anchorBoardId !== null && world.boards[anchorBoardId] !== undefined) {
        const currentAnim = animationRef.current
        const animT = currentAnim === null ? 1 : easeOut(Math.max(0, Math.min(1, (performance.now() - currentAnim.startTimeMs) / currentAnim.durationMs)))
        const gliding = currentAnim !== null && currentAnim.kind !== 'void-transition' && sameCameraSpace(currentAnim.sourceCamera, currentAnim.targetCamera)
        const crossBoard = gliding ? currentAnim.crossBoard : []
        const eyes = eyeAnimator.sample(performance.now())
        const dc: DrawContext = {
          ctx,
          world,
          camera,
          viewport,
          budget: DEFAULT_RENDER_BUDGET,
          piecesByBoard: indexPiecesByBoard(world),
          cellsDrawnSoFar: { count: 0 },
          getPieceScale:
            currentAnim !== null && currentAnim.spawnEpsilonId !== undefined
              ? (pieceId) => {
                  if (pieceId !== currentAnim.spawnEpsilonId) return 1
                  // The ε exists only in the post-move half of the two-phase transition.
                  const raw = (performance.now() - currentAnim.startTimeMs) / currentAnim.durationMs
                  return epsilonSpawnScale((raw - 0.5) / 0.5)
                }
              : undefined,
          getRenderLocation: gliding ? getRenderLocationFactory(currentAnim.preWorld, currentAnim.postWorld, animT) : undefined,
          getPieceFlipScale:
            gliding && currentAnim.flipped.size > 0
              ? (pieceId) => (currentAnim.flipped.has(pieceId) ? flipScaleAt(animT) : 1)
              : undefined,
          hiddenPieces: crossBoard.length > 0 ? new Set(crossBoard.map((m) => m.pieceId)) : undefined,
          getEyes: (pieceId) => (pieceId === PLAYER_ID ? eyes : undefined),
        }
        const drawRoot = resolveDrawRoot(world, anchorBoardId, 2, dc.getRenderLocation)
        drawBoardRecursive(dc, world.boards[drawRoot.boardId], drawRoot, 0, 0, false)
        lastFrameRef.current = { world, camera, viewport, root: drawRoot }
        // Pieces changing boards glide from their old cell to their new one, drawn on top.
        for (const move of crossBoard) {
          const onBoard = world.locations[move.pieceId]?.board
          if (onBoard === undefined) continue
          drawPiece(dc, move.pieceId, interpolateCell(move.from, move.to, animT), onBoard, 0, 0, animT < 0.5 ? move.from.mirrorH : move.to.mirrorH)
        }
      }

      if (dimAlpha > 0) {
        ctx.fillStyle = `rgba(0,0,0,${dimAlpha})`
        ctx.fillRect(0, 0, viewport.width, viewport.height)
      }

      rafId = requestAnimationFrame(frame)
    }
    // Call frame() synchronously once on mount, in addition to the RAF scheduling
    // inside frame() itself for every subsequent tick — found necessary during Task 6:
    // scheduling the very first call via requestAnimationFrame alone means the canvas
    // stays at its default/stale size for one frame after every mount (a real visible
    // flash in production, and what made Task 6's viewport-size test flaky under RTL,
    // since assertions run before that first deferred RAF callback ever fires).
    frame()
    return () => cancelAnimationFrame(rafId)
  }, [state])

  const showDPad = settings.controls === 'dpad' || settings.controls === 'swipe+dpad'
  // Swipes / taps count over the whole screen (outside the buttons) or over the board only.
  const wholeScreen = settings.controls !== 'dpad' && settings.swipeArea === 'screen'
  const stage = (
    <div className="game-stage">
      <div ref={containerRef} className="game-viewport">
        <canvas ref={canvasRef} />
      </div>
    </div>
  )

  const content = (
    <>
      <header className="topbar">
        <button className="icon-btn" onClick={onExit}>
          <span aria-hidden="true">‹</span>
          <span className="sr-only">离开</span>
        </button>
        <div className="topbar-title">
          {levelName !== undefined && <div className="topbar-name">{levelName}</div>}
          <div className="topbar-sub">步数: {state.moveCount}</div>
        </div>
        <div className="topbar-actions">
          <button className="icon-btn" onClick={handleUndo}>
            <span aria-hidden="true">↶</span>
            <span className="sr-only">复位上一步</span>
          </button>
          <button className="icon-btn" onClick={handleRestart}>
            <span aria-hidden="true">⟲</span>
            <span className="sr-only">重新开始</span>
          </button>
          <button className="icon-btn" onClick={() => setShowSettings(true)}>
            <span aria-hidden="true">⚙</span>
            <span className="sr-only">设定</span>
          </button>
        </div>
      </header>
      {hint !== undefined && <div className="level-hint">{hint}</div>}
      <SwipeLayer className="swipe-board" disabled={wholeScreen} onMove={handleMove} settings={settings} onTap={inspectAt} onLongPress={inspectAt}>{stage}</SwipeLayer>
      {showDPad ? <DPad onMove={handleMove} /> : <div className="controls-hint">{settings.controls === 'tap' ? '点画面的上、下、左、右边来移动' : '在画面上滑动来移动'}</div>}
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
      {inspecting !== null && <InspectView world={state.current} pieceId={inspecting} onClose={() => setInspecting(null)} />}
      {state.isWon && (
        <div className="win-overlay" role="dialog" aria-label="通关">
          <div className="win-card">
            <div className="win-title">通关！</div>
            <div className="win-steps">用了 {state.moveCount} 步</div>
            <div className="win-actions">
              {onNext !== undefined && <button className="btn-primary" onClick={onNext}>下一关</button>}
              <button className="btn-secondary" onClick={handleUndo}>撤销一步</button>
              <button className="btn-secondary" onClick={onExit}>关卡列表</button>
            </div>
          </div>
        </div>
      )}
    </>
  )

  // One element tree whatever the controls: switching where swipes count must not re-create the
  // canvas (the render loop holds on to it — a new one would stay black). Only which layer
  // listens changes.
  return (
    <SwipeLayer className="game-screen swipe-screen" disabled={!wholeScreen} onMove={handleMove} settings={settings} onTap={inspectAt} onLongPress={inspectAt}>{content}</SwipeLayer>
  )
}
