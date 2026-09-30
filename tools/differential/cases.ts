import { makeFloorBoard, makeWorld, setWall } from '../../src/game/engine/testFixtures'
import { Input } from '../../src/game/engine/replayHarness'
import { PLAYER_ID, World } from '../../src/game/engine/types'
import { parseOfficialLevel } from '../../src/game/engine/officialFormat'

export interface DiffCase {
  id: string
  title: string
  question: string // what the original game must answer
  world: World
  inputs: Input[]
  // When present this IS the official-format file (hand-written, includes floatinspace /
  // exitblock / infenter, which the World exporter cannot express); `world` is parsed from it.
  officialText?: string
}

const T = '\t'
const H = 'version 4\n#\n'

// A (id 1) at (1,1) with a wall behind it; A's interior holds a clone O of itself on the entry
// cell with a wall behind it -> entering A loops inward forever (Infinite Enter).
const LOOP_ROOT = `Block 0 0 0 3 3 0 0 1 1 0 0 0 0 0 0 0
${T}Wall 2 1 0 0 0
${T}Wall 1 2 0 0 0
${T}Block 0 1 2 1 1 0.9 0.8 1 1 0 1 0 0 0 0 0
${T}Block 1 1 1 3 3 0.4 0.8 1 1 0 0 0 0 0 0 0
${T}${T}Wall 1 1 0 0 0
${T}${T}Ref 0 1 1 0 0 0 0 0 -1 0 0 0 0 0 0
`

function textCase(c: Omit<DiffCase, 'world'> & { officialText: string }): DiffCase {
  return { ...c, world: parseOfficialLevel(c.officialText) }
}

function infiniteEnterCases(): DiffCase[] {
  return [
    textCase({
      id: 'case5-infenter-authored',
      title: 'Infinite Enter 進入既有(authored)ε:floating Block + exitblock Ref + infenter',
      question: '按 R 進入 A 後,玩家是否落在 floating Block F(有 PlayerButton 目標)內、關卡是否過關?沒有多生成 null-space ε?(引擎:進入 F,過關,不建 Void)',
      inputs: ['R'],
      officialText: H + LOOP_ROOT + `${T}Block 0 0 9 1 1 0.5 0.8 1 1 0 0 0 0 0 1 0
${T}${T}Floor 0 0 PlayerButton
${T}Ref 2 2 9 1 0 0 1 1 1 0 0 0 0 0 0
`,
    }),
    textCase({
      id: 'case6-infinite-enter-null-space',
      title: 'Infinite Enter 沒有既有 ε(null-space ε)',
      question: '同 case5 但沒有 floating Block / Ref。按 R 後原版發生什麼?玩家進入哪裡、Void 裡是否出現 ε、能否走出來、走出來落在哪?(原版實測(使用者):ε 在 Void 中心,玩家在 ε 內、左邊緣中間(小方塊);一路往右推會被推出 ε 進入 Void 並變成鎖定箱;Void 7x7,邊緣是看不見的牆),之後在內部可走動但出不去;interior 大小是暫定)',
      inputs: ['R', 'R'],
      officialText: H + LOOP_ROOT,
    }),
    textCase({
      id: 'case7-infenterid-matching',
      title: 'infenterid 比對:兩個候選 ε',
      question: '兩個 exitblock Ref:F9 的 infenterid=1、F10 的 infenterid=2。進入 A(level 1)的 Infinite Enter 進入哪一個?(引擎:只比 id,進入 F9)。之後再把 F9 的 infenternum 改成 2 重錄,看 degree 是否影響選擇。',
      inputs: ['R'],
      officialText:
        H + LOOP_ROOT +
        `${T}Block 0 0 9 1 1 0.5 0.8 1 1 0 0 0 0 0 1 0
${T}${T}Floor 0 0 PlayerButton
` +
        `${T}Block 0 0 10 1 1 0.55 0.8 1 1 0 0 0 0 0 1 0
` +
        `${T}Ref 2 2 9 1 0 0 1 1 1 0 0 0 0 0 0
${T}Ref 2 0 10 1 0 0 1 1 2 0 0 0 0 0 0
`,
    }),
  ]
}

export function cases(): DiffCase[] {
  const c1root = makeFloorBoard('root', 3)
  setWall(c1root, 2, 1)

  const c2root = makeFloorBoard('root', 5)
  setWall(c2root, 2, 1)
  setWall(c2root, 2, 3)

  const c3root = makeFloorBoard('root', 3)
  setWall(c3root, 2, 1)

  const c4root = makeFloorBoard('root', 3)
  setWall(c4root, 2, 1)

  return [
    ...infiniteEnterCases(),
    {
      id: 'case1-single-ref',
      title: '1 Block + 1 Ref (calibration)',
      question: 'y 軸方向是否需 flipY;進入後落點;退出後落點。先跑這關確認匯出格式可載入。',
      world: makeWorld(
        [c1root, makeFloorBoard('inside', 3)],
        [{ id: PLAYER_ID, kind: 'player' }, { id: 'a', kind: 'container', boardRef: 'inside' }],
        { [PLAYER_ID]: { board: 'root', x: 0, y: 1 }, a: { board: 'root', x: 1, y: 1 } },
      ),
      inputs: ['R', 'L'],
    },
    {
      id: 'case2-two-refs-shared',
      title: '2 Ref → same Block:從 b 進入,退出回到哪個 Ref?',
      question: '從下方(較低)的 Ref 進入後按 L 離開,玩家出現在上方 Ref 旁,還是下方 Ref 旁?(引擎暫定:回到 canonical 上方 a)',
      world: makeWorld(
        [c2root, makeFloorBoard('inside', 3)],
        [
          { id: PLAYER_ID, kind: 'player' },
          { id: 'a', kind: 'container', boardRef: 'inside' },
          { id: 'b', kind: 'container', boardRef: 'inside' },
        ],
        {
          [PLAYER_ID]: { board: 'root', x: 0, y: 3 },
          a: { board: 'root', x: 1, y: 1 },
          b: { board: 'root', x: 1, y: 3 },
        },
      ),
      inputs: ['R', 'L'],
    },
    {
      id: 'case3-clone-enter',
      title: 'Clone 進入落點',
      question: '推 clone 進入後落在 source interior 的哪一格?退出後回到 source 旁還是 clone 旁?(引擎:進入格同直接進入 source;退出回 source)',
      world: makeWorld(
        [c3root, makeFloorBoard('inside', 3)],
        [
          { id: PLAYER_ID, kind: 'player' },
          { id: 'a', kind: 'container', boardRef: 'inside' },
          { id: 'c', kind: 'container', cloneOf: 'a' },
        ],
        {
          [PLAYER_ID]: { board: 'root', x: 0, y: 1 },
          c: { board: 'root', x: 1, y: 1 },
          a: { board: 'root', x: 1, y: 2 },
        },
      ),
      inputs: ['R', 'L'],
    },
    {
      id: 'case4-self-loop-infinite',
      title: 'Self-loop 貼邊推出(Infinite Exit)',
      question: '把自我包含箱推出邊界後:是否生成 ∞ 箱、箱子從哪一側被推出、玩家是否仍前進一格。',
      world: makeWorld(
        [c4root],
        [{ id: PLAYER_ID, kind: 'player' }, { id: 'loop', kind: 'container', boardRef: 'root' }],
        { [PLAYER_ID]: { board: 'root', x: 0, y: 0 }, loop: { board: 'root', x: 1, y: 0 } },
      ),
      inputs: ['R', 'R'],
    },
  ]
}
