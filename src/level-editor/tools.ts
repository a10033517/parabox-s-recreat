import { BoardId, PLAYER_ID, Piece, World, occupantAt } from '../game/engine/types'
import { EditError, Result, clearCell, movePlayer, paintCell, placePiece, toggleGoal, uniqueId } from './editOps'

export type ToolId =
  | 'select' | 'floor' | 'wall' | 'goal-box' | 'goal-player' | 'erase'
  | 'player' | 'box' | 'box-possessable' | 'wall-block'
  | 'container' | 'self-loop' | 'reference' | 'infinity'

export interface ToolDef {
  id: ToolId
  label: string
  hint: string
  key?: string // keyboard shortcut
  paint?: boolean // applies while dragging
}

export const TOOL_GROUPS: { title: string; tools: ToolDef[] }[] = [
  {
    title: '地形',
    tools: [
      { id: 'select', label: '选取', hint: '点选物件或格子,在右侧编辑属性', key: 'v' },
      { id: 'floor', label: '地板', hint: '拖曳绘制地板', key: 'f', paint: true },
      { id: 'wall', label: '墙', hint: '拖曳绘制墙(会移除墙上的物件)', key: 'w', paint: true },
      { id: 'erase', label: '清除', hint: '清除格子:移除物件、目标和墙(右键也可以)', key: 'e', paint: true },
    ],
  },
  {
    title: '目标',
    tools: [
      { id: 'goal-box', label: '箱子目标', hint: '需要放箱子的格子(再点一次取消)', key: 'b', paint: true },
      { id: 'goal-player', label: '玩家目标', hint: '玩家最后要到达的格子(再点一次取消)', key: 'g' },
    ],
  },
  {
    title: '物件',
    tools: [
      { id: 'player', label: '玩家', hint: '移动玩家的起点', key: 'p' },
      { id: 'box', label: '实心箱', hint: '普通箱子,不能进入', key: '1' },
      { id: 'container', label: '箱中箱', hint: '有自己内部房间的箱子(双击进入编辑)', key: '2' },
      { id: 'self-loop', label: '自包箱', hint: '通往目前这个房间自己的箱子', key: '3' },
      { id: 'reference', label: '分身 / 引用', hint: '通往一个已存在房间的另一个箱子(分身、互相包含)', key: '4' },
      { id: 'infinity', label: '∞ 箱', hint: '无限大出口箱(infexit),通往选定的房间', key: '5' },
      { id: 'box-possessable', label: '可附身箱', hint: '推不动时玩家可以附身控制', key: '6' },
      { id: 'wall-block', label: '可附身墙', hint: '像墙一样推不动,玩家可以附身', key: '7' },
    ],
  },
]

export const ALL_TOOLS = TOOL_GROUPS.flatMap((g) => g.tools)

export interface ToolOptions {
  containerSize: number
  referenceBoard: BoardId // board a new reference / ∞ box leads into
  infinityDegree: number
}

const pieceIds = (world: World) => Object.keys(world.pieces)
const boardIds = (world: World) => Object.keys(world.boards)

// Applies a tool at a cell. `toggleGoalState` keeps a drag from flip-flopping a goal: the first
// cell decides whether this stroke adds or removes goals.
export function applyTool(world: World, tool: ToolId, boardId: BoardId, x: number, y: number, opts: ToolOptions, topBoard: BoardId): Result | null {
  const at = { board: boardId, x, y }
  switch (tool) {
    case 'select':
      return null
    case 'floor':
    case 'wall':
      if (world.boards[boardId].cells[y][x].type === tool && (tool === 'floor' || occupantAt(world, at) === undefined)) return null
      return paintCell(world, boardId, x, y, tool, topBoard)
    case 'erase': {
      const cell = world.boards[boardId].cells[y][x]
      const occupant = occupantAt(world, at)
      if (cell.type === 'floor' && cell.requirement === undefined && (occupant === undefined || occupant === PLAYER_ID)) return null
      return clearCell(world, boardId, x, y, topBoard)
    }
    case 'goal-box':
      return toggleGoal(world, boardId, x, y, 'box')
    case 'goal-player':
      return toggleGoal(world, boardId, x, y, 'player')
    case 'player':
      return movePlayer(world, boardId, x, y, topBoard)
  }
  let piece: Piece
  switch (tool) {
    case 'box':
      piece = { id: uniqueId(pieceIds(world), 'box'), kind: 'normal' }
      break
    case 'box-possessable':
      piece = { id: uniqueId(pieceIds(world), 'host'), kind: 'normal', possessable: true }
      break
    case 'wall-block':
      piece = { id: uniqueId(pieceIds(world), 'wallblock'), kind: 'normal', wall: true, possessable: true }
      break
    case 'container':
      piece = { id: uniqueId(pieceIds(world), 'box'), kind: 'container', boardRef: uniqueId(boardIds(world), 'room') }
      break
    case 'self-loop':
      piece = { id: uniqueId(pieceIds(world), 'loop'), kind: 'container', boardRef: boardId }
      break
    case 'reference':
      if (world.boards[opts.referenceBoard] === undefined) return new EditError('先在右侧选择要引用的房间')
      piece = { id: uniqueId(pieceIds(world), 'ref'), kind: 'container', boardRef: opts.referenceBoard }
      break
    case 'infinity':
      if (world.boards[opts.referenceBoard] === undefined) return new EditError('先在右侧选择 ∞ 箱通往的房间')
      piece = { id: uniqueId(pieceIds(world), 'inf'), kind: 'container', boardRef: opts.referenceBoard, infExit: true, infExitNum: opts.infinityDegree }
      break
    default:
      return null
  }
  return placePiece(world, boardId, x, y, piece, topBoard, opts.containerSize)
}
