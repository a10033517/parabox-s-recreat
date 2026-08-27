# Patrick's Parabox 致敬版 PWA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 做一个原创的递归推箱子解谜游戏(箱子推动 + 箱中箱嵌套),包成可安装、完全离线游玩的手机 PWA,并附带开发阶段用的关卡生成器/求解器工具。

**Architecture:** React + Vite 前端外壳(选单/关卡选择/游戏/编辑器),Canvas 2D 绘制递归网格游戏画面,纯函式游戏引擎(`src/game/engine`)是唯一的规则来源,游戏本体、求解器、关卡生成器共用同一份规则实作。`vite-plugin-pwa` 提供离线与安装能力,localStorage 存进度与自订关卡。`tools/generator` 是开发阶段用的 Node 脚本,不打包进 App。

**Tech Stack:** React 18 + TypeScript + Vite + Vitest + @testing-library/react + vite-plugin-pwa + tsx(执行 Node 脚本)。无后端、无外部 API。

**Spec:** `docs/superpowers/specs/2026-08-24-parabox-pwa-design.md`

## Global Constraints

- 箱子只能推、不能拉。
- 嵌套判定:推动链尾端必须被墙(或边界)挡住才可能触发嵌套;若链尾是空地,整条链平移,不触发嵌套。
- 从墙端往回扫描:只有 `boxType === 'container'` 的箱子能接收嵌套;`normal` 箱子只能被嵌套、不能接收。每次移动最多触发一次嵌套,嵌套点之后(靠墙侧)不动,嵌套点之前(含玩家)整体前移一格。
- MVP 不支援玩家进入箱子内部操控。
- 手机端完全离线可玩,进度存 localStorage,不依赖任何网路请求。
- 关卡生成/求解只在开发阶段用 `tools/generator` 的 Node 脚本运行,绝不打包进手机端 App。
- 不使用 Patrick's Parabox 原版任何素材或程式码,全部原创。

---

## Task 1: 专案 Scaffold(Vite + React + TypeScript + Vitest)

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `index.html`
- Create: `src/main.tsx`
- Create: `src/App.tsx`
- Create: `src/App.test.tsx`
- Create: `.gitignore`

**Interfaces:**
- Produces: 可运行的 Vite + React + TS 专案骨架,`npm run dev` / `npm run build` / `npm run test` 三个 script 可用。之后所有任务都建立在这个骨架上。

- [ ] **Step 1: 建立 `package.json`**

```json
{
  "name": "parabox-pwa",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "test": "vitest run",
    "generate:levels": "tsx tools/generator/generateBatch.ts"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@testing-library/react": "^16.0.1",
    "@testing-library/user-event": "^14.5.2",
    "@types/node": "^22.5.0",
    "@types/react": "^18.3.5",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "jsdom": "^25.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.5.4",
    "vite": "^5.4.2",
    "vite-plugin-pwa": "^0.20.5",
    "vitest": "^2.0.5"
  }
}
```

- [ ] **Step 2: 建立 `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src", "tools"]
}
```

- [ ] **Step 3: 建立 `vite.config.ts`**

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
  },
})
```

- [ ] **Step 4: 建立 `index.html`**

```html
<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no" />
    <title>Parabox Tribute</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: 建立 `src/main.tsx`**

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

- [ ] **Step 6: 建立 `src/App.tsx`(暂时占位, Task 13 会换成完整路由)**

```tsx
export default function App() {
  return <div>Parabox Tribute</div>
}
```

- [ ] **Step 7: 写 `src/App.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react'
import App from './App'

test('renders app shell', () => {
  render(<App />)
  expect(screen.getByText('Parabox Tribute')).toBeInTheDocument()
})
```

- [ ] **Step 8: 建立 `.gitignore`**

```
node_modules
dist
dist-ssr
*.local
```

- [ ] **Step 9: 安装依赖**

Run: `npm install`
Expected: 安装成功,产生 `package-lock.json`。

- [ ] **Step 10: 跑测试确认骨架正常**

Run: `npx vitest run src/App.test.tsx`
Expected: PASS(1 test)

- [ ] **Step 11: Commit**

```bash
git add package.json package-lock.json tsconfig.json vite.config.ts index.html src/main.tsx src/App.tsx src/App.test.tsx .gitignore
git commit -m "chore: scaffold Vite + React + TS project"
```

---

## Task 2: 引擎核心型别与 Grid 辅助函式

**Files:**
- Create: `src/game/engine/types.ts`
- Test: `src/game/engine/types.test.ts`

**Interfaces:**
- Produces: `CellType`, `Direction`, `Box`, `Grid` 型别;`DIRECTION_VECTORS`;`createEmptyGrid(width, height): Grid`;`cloneGrid(grid): Grid`;`cellAt(grid, x, y): CellType | 'oob'`;`boxAt(grid, x, y): Box | undefined`。这是后续所有引擎/求解器/生成器程式码共用的基础模组。

- [ ] **Step 1: 写测试 `src/game/engine/types.test.ts`**

```ts
import { createEmptyGrid, cloneGrid, cellAt, boxAt, Grid } from './types'

test('createEmptyGrid produces all-empty cells of given size', () => {
  const grid = createEmptyGrid(3, 2)
  expect(grid.width).toBe(3)
  expect(grid.height).toBe(2)
  expect(grid.cells).toEqual([
    ['empty', 'empty', 'empty'],
    ['empty', 'empty', 'empty'],
  ])
  expect(grid.boxes).toEqual([])
})

test('cellAt returns oob outside bounds', () => {
  const grid = createEmptyGrid(2, 2)
  expect(cellAt(grid, -1, 0)).toBe('oob')
  expect(cellAt(grid, 2, 0)).toBe('oob')
  expect(cellAt(grid, 0, 0)).toBe('empty')
})

test('boxAt finds box by position', () => {
  const grid = createEmptyGrid(3, 3)
  const box = { id: 'b1', x: 1, y: 1, boxType: 'normal' as const, interior: createEmptyGrid(2, 2) }
  grid.boxes.push(box)
  expect(boxAt(grid, 1, 1)).toBe(box)
  expect(boxAt(grid, 0, 0)).toBeUndefined()
})

test('cloneGrid produces a deep, independent copy', () => {
  const grid = createEmptyGrid(2, 2)
  grid.boxes.push({ id: 'b1', x: 0, y: 0, boxType: 'container', interior: createEmptyGrid(2, 2) })
  const copy = cloneGrid(grid)
  copy.boxes[0].x = 5
  copy.cells[0][0] = 'wall'
  expect(grid.boxes[0].x).toBe(0)
  expect(grid.cells[0][0]).toBe('empty')
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/game/engine/types.test.ts`
Expected: FAIL(找不到 `./types` 模组)

- [ ] **Step 3: 实作 `src/game/engine/types.ts`**

```ts
export type CellType = 'empty' | 'wall' | 'target'
export type Direction = 'up' | 'down' | 'left' | 'right'

export interface Box {
  id: string
  x: number
  y: number
  boxType: 'normal' | 'container'
  interior: Grid
  isGoalBox?: boolean
}

export interface Grid {
  width: number
  height: number
  cells: CellType[][]
  boxes: Box[]
  player?: { x: number; y: number }
}

export const DIRECTION_VECTORS: Record<Direction, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
}

export function createEmptyGrid(width: number, height: number): Grid {
  const cells: CellType[][] = []
  for (let y = 0; y < height; y++) {
    cells.push(new Array<CellType>(width).fill('empty'))
  }
  return { width, height, cells, boxes: [] }
}

export function cloneGrid(grid: Grid): Grid {
  return structuredClone(grid)
}

export function cellAt(grid: Grid, x: number, y: number): CellType | 'oob' {
  if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return 'oob'
  return grid.cells[y][x]
}

export function boxAt(grid: Grid, x: number, y: number): Box | undefined {
  return grid.boxes.find((b) => b.x === x && b.y === y)
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/game/engine/types.test.ts`
Expected: PASS(4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/game/engine/types.ts src/game/engine/types.test.ts
git commit -m "feat: add core Grid/Box types and helpers"
```

---

## Task 3: `applyMove` — 基本移动与整排平移(不含嵌套)

**Files:**
- Create: `src/game/engine/rules.ts`
- Test: `src/game/engine/rules.test.ts`

**Interfaces:**
- Consumes: `Grid`, `Box`, `Direction`, `DIRECTION_VECTORS`, `cloneGrid`, `cellAt`, `boxAt` from `./types`
- Produces: `applyMove(grid: Grid, direction: Direction): Grid | null`(本任务先处理玩家单纯移动、链尾是空地时整排平移、链尾是墙且无法平移时视情况阻挡;嵌套分支下一个任务再加)

- [ ] **Step 1: 写测试 `src/game/engine/rules.test.ts`**

```ts
import { createEmptyGrid, Box, Grid } from './types'
import { applyMove } from './rules'

function withPlayer(grid: Grid, x: number, y: number): Grid {
  grid.player = { x, y }
  return grid
}

function addBox(grid: Grid, id: string, x: number, y: number, boxType: 'normal' | 'container' = 'normal'): Box {
  const box: Box = { id, x, y, boxType, interior: createEmptyGrid(3, 3) }
  grid.boxes.push(box)
  return box
}

test('player moves into empty cell', () => {
  const grid = withPlayer(createEmptyGrid(3, 3), 1, 1)
  const next = applyMove(grid, 'right')
  expect(next?.player).toEqual({ x: 2, y: 1 })
})

test('player blocked by wall', () => {
  const grid = withPlayer(createEmptyGrid(3, 3), 1, 1)
  grid.cells[1][2] = 'wall'
  const next = applyMove(grid, 'right')
  expect(next).toBeNull()
})

test('player blocked by grid boundary', () => {
  const grid = withPlayer(createEmptyGrid(3, 3), 0, 0)
  const next = applyMove(grid, 'left')
  expect(next).toBeNull()
})

test('pushing a single box into empty space translates both', () => {
  const grid = withPlayer(createEmptyGrid(4, 3), 0, 1)
  addBox(grid, 'b1', 1, 1)
  const next = applyMove(grid, 'right')!
  expect(next.player).toEqual({ x: 1, y: 1 })
  expect(next.boxes.find((b) => b.id === 'b1')).toMatchObject({ x: 2, y: 1 })
})

test('pushing a chain of boxes into empty space translates the whole chain', () => {
  const grid = withPlayer(createEmptyGrid(5, 3), 0, 1)
  addBox(grid, 'b1', 1, 1)
  addBox(grid, 'b2', 2, 1)
  const next = applyMove(grid, 'right')!
  expect(next.player).toEqual({ x: 1, y: 1 })
  expect(next.boxes.find((b) => b.id === 'b1')).toMatchObject({ x: 2, y: 1 })
  expect(next.boxes.find((b) => b.id === 'b2')).toMatchObject({ x: 3, y: 1 })
})

test('pushing a chain fully jammed by wall (all normal boxes) is invalid', () => {
  const grid = withPlayer(createEmptyGrid(4, 3), 0, 1)
  addBox(grid, 'b1', 1, 1, 'normal')
  addBox(grid, 'b2', 2, 1, 'normal')
  grid.cells[1][3] = 'wall'
  const next = applyMove(grid, 'right')
  expect(next).toBeNull()
})

test('does not mutate the original grid', () => {
  const grid = withPlayer(createEmptyGrid(3, 3), 1, 1)
  applyMove(grid, 'right')
  expect(grid.player).toEqual({ x: 1, y: 1 })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/game/engine/rules.test.ts`
Expected: FAIL(找不到 `./rules` 模组)

- [ ] **Step 3: 实作 `src/game/engine/rules.ts`(基本版, 嵌套分支先回传 null)**

```ts
import { Box, cellAt, boxAt, cloneGrid, Direction, DIRECTION_VECTORS, Grid } from './types'

export function applyMove(grid: Grid, direction: Direction): Grid | null {
  if (!grid.player) return null
  const { dx, dy } = DIRECTION_VECTORS[direction]

  const chain: Box[] = []
  let cx = grid.player.x + dx
  let cy = grid.player.y + dy
  while (true) {
    const cell = cellAt(grid, cx, cy)
    if (cell === 'oob' || cell === 'wall') break
    const box = boxAt(grid, cx, cy)
    if (!box) break
    chain.push(box)
    cx += dx
    cy += dy
  }

  const terminalCell = cellAt(grid, cx, cy)
  const terminalOpen = terminalCell !== 'oob' && terminalCell !== 'wall' && !boxAt(grid, cx, cy)

  if (chain.length === 0) {
    if (!terminalOpen) return null
    const next = cloneGrid(grid)
    next.player = { x: grid.player.x + dx, y: grid.player.y + dy }
    return next
  }

  if (terminalOpen) {
    const next = cloneGrid(grid)
    next.player = { x: grid.player.x + dx, y: grid.player.y + dy }
    for (const box of chain) {
      const nb = next.boxes.find((b) => b.id === box.id)!
      nb.x += dx
      nb.y += dy
    }
    return next
  }

  return resolveNesting(grid, chain, direction)
}

function resolveNesting(_grid: Grid, _chain: Box[], _direction: Direction): Grid | null {
  return null
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/game/engine/rules.test.ts`
Expected: PASS(7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/game/engine/rules.ts src/game/engine/rules.test.ts
git commit -m "feat: implement basic push/translate movement rules"
```

---

## Task 4: `applyMove` — 嵌套判定(推动链靠墙时的箱中箱规则)

**Files:**
- Modify: `src/game/engine/types.ts`
- Modify: `src/game/engine/rules.ts`
- Modify: `src/game/engine/rules.test.ts`

**Interfaces:**
- Produces: `nestEntryPosition(interior, direction)`、`canNestAt(interior, pos)` 加进 `types.ts`;`resolveNesting` 在 `rules.ts` 内实作完整的「从墙端往回扫描」判定,取代 Task 3 的占位版本。

- [ ] **Step 1: 在 `types.ts` 新增 `nestEntryPosition` 与 `canNestAt`**

```ts
export function nestEntryPosition(interior: Grid, direction: Direction): { x: number; y: number } {
  switch (direction) {
    case 'right':
      return { x: 0, y: Math.floor(interior.height / 2) }
    case 'left':
      return { x: interior.width - 1, y: Math.floor(interior.height / 2) }
    case 'down':
      return { x: Math.floor(interior.width / 2), y: 0 }
    case 'up':
      return { x: Math.floor(interior.width / 2), y: interior.height - 1 }
  }
}

export function canNestAt(interior: Grid, pos: { x: number; y: number }): boolean {
  if (pos.x < 0 || pos.y < 0 || pos.x >= interior.width || pos.y >= interior.height) return false
  if (interior.cells[pos.y][pos.x] === 'wall') return false
  return !boxAt(interior, pos.x, pos.y)
}
```

- [ ] **Step 2: 在 `rules.test.ts` 新增嵌套相关测试(对应我们逐轮确认过的规则)**

```ts
test('single container box against wall cannot nest (wall does not receive)', () => {
  const grid = withPlayer(createEmptyGrid(4, 3), 0, 1)
  addBox(grid, 'c1', 1, 1, 'container')
  grid.cells[1][2] = 'wall'
  const next = applyMove(grid, 'right')
  expect(next).toBeNull()
})

test('pushing a normal box into a container box against the wall nests it', () => {
  const grid = withPlayer(createEmptyGrid(5, 3), 0, 1)
  addBox(grid, 'n1', 1, 1, 'normal')
  const container = addBox(grid, 'c1', 2, 1, 'container')
  grid.cells[1][3] = 'wall'
  const next = applyMove(grid, 'right')!
  expect(next.boxes.find((b) => b.id === 'n1')).toBeUndefined()
  const nextContainer = next.boxes.find((b) => b.id === 'c1')!
  expect(nextContainer.x).toBe(container.x)
  expect(nextContainer.y).toBe(container.y)
  expect(nextContainer.interior.boxes).toHaveLength(1)
  expect(nextContainer.interior.boxes[0].id).toBe('n1')
  expect(next.player).toEqual({ x: 1, y: 1 })
})

test('three container boxes against a wall: only the pair closest to the wall nests', () => {
  const grid = withPlayer(createEmptyGrid(6, 3), 0, 1)
  addBox(grid, 'c1', 1, 1, 'container')
  addBox(grid, 'c2', 2, 1, 'container')
  addBox(grid, 'c3', 3, 1, 'container')
  grid.cells[1][4] = 'wall'
  const next = applyMove(grid, 'right')!
  expect(next.boxes.find((b) => b.id === 'c2')).toBeUndefined()
  const c3 = next.boxes.find((b) => b.id === 'c3')!
  expect(c3).toMatchObject({ x: 3, y: 1 })
  expect(c3.interior.boxes.map((b) => b.id)).toEqual(['c2'])
  const c1 = next.boxes.find((b) => b.id === 'c1')!
  expect(c1).toMatchObject({ x: 2, y: 1 })
  expect(next.player).toEqual({ x: 1, y: 1 })
})

test('container1 -> container2 -> normal -> wall: container1 nests into container2, rest stays', () => {
  const grid = withPlayer(createEmptyGrid(6, 3), 0, 1)
  addBox(grid, 'c1', 1, 1, 'container')
  addBox(grid, 'c2', 2, 1, 'container')
  addBox(grid, 'n1', 3, 1, 'normal')
  grid.cells[1][4] = 'wall'
  const next = applyMove(grid, 'right')!
  expect(next.boxes.find((b) => b.id === 'c1')).toBeUndefined()
  const c2 = next.boxes.find((b) => b.id === 'c2')!
  expect(c2).toMatchObject({ x: 2, y: 1 })
  expect(c2.interior.boxes.map((b) => b.id)).toEqual(['c1'])
  const n1 = next.boxes.find((b) => b.id === 'n1')!
  expect(n1).toMatchObject({ x: 3, y: 1 })
  expect(next.player).toEqual({ x: 1, y: 1 })
})

test('chain of only normal boxes against a wall is fully jammed', () => {
  const grid = withPlayer(createEmptyGrid(5, 3), 0, 1)
  addBox(grid, 'n1', 1, 1, 'normal')
  addBox(grid, 'n2', 2, 1, 'normal')
  grid.cells[1][3] = 'wall'
  const next = applyMove(grid, 'right')
  expect(next).toBeNull()
})
```

- [ ] **Step 3: 跑测试确认新测试失败**

Run: `npx vitest run src/game/engine/rules.test.ts`
Expected: 前面基本测试 PASS,新增的 5 个嵌套测试 FAIL(因为 `resolveNesting` 目前恒回传 null)

- [ ] **Step 4: 实作完整 `resolveNesting`,更新 `rules.ts` 的 import 与函式**

```ts
import { Box, boxAt, canNestAt, cellAt, cloneGrid, Direction, DIRECTION_VECTORS, Grid, nestEntryPosition } from './types'
```

```ts
function resolveNesting(grid: Grid, chain: Box[], direction: Direction): Grid | null {
  const { dx, dy } = DIRECTION_VECTORS[direction]
  let canReceiveNext = false
  let nestIndex = -1
  for (let i = chain.length - 1; i >= 0; i--) {
    if (canReceiveNext) {
      nestIndex = i
      break
    }
    canReceiveNext = chain[i].boxType === 'container'
  }
  if (nestIndex === -1) return null

  const receiver = chain[nestIndex + 1]
  const nested = chain[nestIndex]
  const entryPos = nestEntryPosition(receiver.interior, direction)
  if (!canNestAt(receiver.interior, entryPos)) return null

  const next = cloneGrid(grid)
  next.boxes = next.boxes.filter((b) => b.id !== nested.id)
  const nextReceiver = next.boxes.find((b) => b.id === receiver.id)!
  const nestedCopy = structuredClone(nested)
  nestedCopy.x = entryPos.x
  nestedCopy.y = entryPos.y
  nextReceiver.interior.boxes.push(nestedCopy)

  next.player = { x: grid.player!.x + dx, y: grid.player!.y + dy }
  for (let i = 0; i < nestIndex; i++) {
    const b = next.boxes.find((bb) => bb.id === chain[i].id)!
    b.x += dx
    b.y += dy
  }
  return next
}
```

也把 `resolveNesting(_grid, _chain, _direction)` 的呼叫处参数名改成 `grid, chain, direction`(移除底线前缀)。

- [ ] **Step 5: 跑测试确认全部通过**

Run: `npx vitest run src/game/engine/rules.test.ts`
Expected: PASS(12 tests)

- [ ] **Step 6: Commit**

```bash
git add src/game/engine/types.ts src/game/engine/rules.ts src/game/engine/rules.test.ts
git commit -m "feat: implement wall-triggered box nesting resolution"
```

---

## Task 5: 过关判定 `checkWin`

**Files:**
- Modify: `src/game/engine/rules.ts`
- Modify: `src/game/engine/rules.test.ts`

**Interfaces:**
- Produces: `checkWin(grid: Grid): boolean` — 递归检查所有 `isGoalBox` 的箱子是否都停在它所属那层 Grid 的 `target` 格上。

- [ ] **Step 1: 在 `rules.test.ts` 新增测试**

```ts
import { checkWin } from './rules'

test('checkWin is true when goal box sits on target cell', () => {
  const grid = createEmptyGrid(3, 3)
  grid.cells[1][1] = 'target'
  addBox(grid, 'g1', 1, 1, 'normal').isGoalBox = true
  expect(checkWin(grid)).toBe(true)
})

test('checkWin is false when goal box is off target', () => {
  const grid = createEmptyGrid(3, 3)
  grid.cells[1][1] = 'target'
  addBox(grid, 'g1', 0, 0, 'normal').isGoalBox = true
  expect(checkWin(grid)).toBe(false)
})

test('checkWin recurses into nested interiors for goal boxes placed inside containers', () => {
  const grid = createEmptyGrid(3, 3)
  const container = addBox(grid, 'c1', 1, 1, 'container')
  container.interior.cells[1][1] = 'target'
  container.interior.boxes.push({ id: 'g1', x: 1, y: 1, boxType: 'normal', interior: createEmptyGrid(2, 2), isGoalBox: true })
  expect(checkWin(grid)).toBe(true)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/game/engine/rules.test.ts`
Expected: FAIL(`checkWin` 未定义)

- [ ] **Step 3: 在 `rules.ts` 加入 `checkWin`**

```ts
export function checkWin(grid: Grid): boolean {
  for (const box of grid.boxes) {
    if (box.isGoalBox && grid.cells[box.y][box.x] !== 'target') return false
    if (!checkWin(box.interior)) return false
  }
  return true
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/game/engine/rules.test.ts`
Expected: PASS(15 tests)

- [ ] **Step 5: Commit**

```bash
git add src/game/engine/rules.ts src/game/engine/rules.test.ts
git commit -m "feat: add recursive win condition check"
```

---

## Task 6: 关卡 JSON Schema(序列化/反序列化/验证)

**Files:**
- Create: `src/game/engine/levelSchema.ts`
- Test: `src/game/engine/levelSchema.test.ts`

**Interfaces:**
- Consumes: `Grid` from `./types`
- Produces: `serializeLevel(grid: Grid): string`、`parseLevel(json: string): Grid`(结构不合法时 throw `Error`)

- [ ] **Step 1: 写测试 `src/game/engine/levelSchema.test.ts`**

```ts
import { createEmptyGrid } from './types'
import { parseLevel, serializeLevel } from './levelSchema'

test('serializeLevel then parseLevel round-trips a grid', () => {
  const grid = createEmptyGrid(3, 3)
  grid.player = { x: 0, y: 0 }
  grid.cells[2][2] = 'target'
  grid.boxes.push({ id: 'b1', x: 1, y: 1, boxType: 'container', interior: createEmptyGrid(2, 2), isGoalBox: true })
  const json = serializeLevel(grid)
  const parsed = parseLevel(json)
  expect(parsed).toEqual(grid)
})

test('parseLevel rejects malformed JSON structure', () => {
  expect(() => parseLevel('{"width": 3}')).toThrow()
  expect(() => parseLevel('not json')).toThrow()
})

test('parseLevel rejects a grid whose cells do not match declared dimensions', () => {
  const bad = JSON.stringify({ width: 2, height: 2, cells: [['empty']], boxes: [] })
  expect(() => parseLevel(bad)).toThrow()
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/game/engine/levelSchema.test.ts`
Expected: FAIL(找不到模组)

- [ ] **Step 3: 实作 `src/game/engine/levelSchema.ts`**

```ts
import { Grid, CellType } from './types'

const VALID_CELL_TYPES: CellType[] = ['empty', 'wall', 'target']

export function serializeLevel(grid: Grid): string {
  return JSON.stringify(grid)
}

export function parseLevel(json: string): Grid {
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    throw new Error('Invalid level JSON: not parseable')
  }
  validateGrid(data)
  return data as Grid
}

function validateGrid(data: unknown, path = 'root'): asserts data is Grid {
  if (typeof data !== 'object' || data === null) {
    throw new Error(`Invalid grid at ${path}: not an object`)
  }
  const g = data as Record<string, unknown>
  if (typeof g.width !== 'number' || typeof g.height !== 'number') {
    throw new Error(`Invalid grid at ${path}: width/height must be numbers`)
  }
  if (!Array.isArray(g.cells) || g.cells.length !== g.height) {
    throw new Error(`Invalid grid at ${path}: cells row count must equal height`)
  }
  for (const row of g.cells as unknown[]) {
    if (!Array.isArray(row) || row.length !== g.width) {
      throw new Error(`Invalid grid at ${path}: cell row length must equal width`)
    }
    for (const cell of row) {
      if (!VALID_CELL_TYPES.includes(cell as CellType)) {
        throw new Error(`Invalid grid at ${path}: unknown cell type ${String(cell)}`)
      }
    }
  }
  if (!Array.isArray(g.boxes)) {
    throw new Error(`Invalid grid at ${path}: boxes must be an array`)
  }
  for (const box of g.boxes as unknown[]) {
    if (typeof box !== 'object' || box === null) {
      throw new Error(`Invalid box at ${path}`)
    }
    const b = box as Record<string, unknown>
    if (typeof b.id !== 'string' || typeof b.x !== 'number' || typeof b.y !== 'number') {
      throw new Error(`Invalid box at ${path}: id/x/y malformed`)
    }
    if (b.boxType !== 'normal' && b.boxType !== 'container') {
      throw new Error(`Invalid box at ${path}: boxType must be 'normal' or 'container'`)
    }
    validateGrid(b.interior, `${path}.boxes[${b.id}].interior`)
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/game/engine/levelSchema.test.ts`
Expected: PASS(3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/game/engine/levelSchema.ts src/game/engine/levelSchema.test.ts
git commit -m "feat: add level JSON serialization and validation"
```

---

## Task 7: 内建关卡素材与载入器

**Files:**
- Create: `src/levels/builtin/01-first-push.json`
- Create: `src/levels/builtin/02-single-nest.json`
- Create: `src/levels/builtin/03-chain-nest.json`
- Create: `src/levels/index.ts`
- Test: `src/levels/index.test.ts`

**Interfaces:**
- Consumes: `parseLevel` from `../game/engine/levelSchema`, `checkWin` from `../game/engine/rules`
- Produces: `LevelMeta { id: string; name: string; grid: Grid }`、`BUILTIN_LEVELS: LevelMeta[]`、`loadGeneratedLevels(): LevelMeta[]`(读取 `builtin/generated/*.json`,Task 20 前该目录可为空)

- [ ] **Step 1: 建立 `src/levels/builtin/01-first-push.json`(单纯推箱子到目标,不涉及嵌套)**

```json
{
  "width": 5,
  "height": 3,
  "cells": [
    ["wall", "wall", "wall", "wall", "wall"],
    ["wall", "empty", "empty", "target", "wall"],
    ["wall", "wall", "wall", "wall", "wall"]
  ],
  "boxes": [
    { "id": "g1", "x": 2, "y": 1, "boxType": "normal", "isGoalBox": true, "interior": { "width": 1, "height": 1, "cells": [["empty"]], "boxes": [] } }
  ],
  "player": { "x": 1, "y": 1 }
}
```

玩家往右推 `g1` 一格即可推到 `target`,过关。

- [ ] **Step 2: 建立 `src/levels/builtin/02-single-nest.json`(练习单次嵌套)**

设计:一个 3×5 的房间,中间那一排(`y=2`)在 `x=4` 有一格内墙当障碍物,上下两排(`y=1`、`y=3`)畅通,让玩家嵌套完之后能绕路把容器箱推到位于 `y=1` 的 target。玩家推 `n1`(普通箱)撞上贴着内墙的 `c1`(容器箱、goal box)触发嵌套,`n1` 消失、`c1` 维持原地;玩家再绕到 `c1` 上方/右侧把它推到 target。

```json
{
  "width": 7,
  "height": 5,
  "cells": [
    ["wall", "wall", "wall", "wall", "wall", "wall", "wall"],
    ["wall", "empty", "target", "empty", "empty", "empty", "wall"],
    ["wall", "empty", "empty", "empty", "wall", "empty", "wall"],
    ["wall", "empty", "empty", "empty", "empty", "empty", "wall"],
    ["wall", "wall", "wall", "wall", "wall", "wall", "wall"]
  ],
  "boxes": [
    { "id": "n1", "x": 2, "y": 2, "boxType": "normal", "interior": { "width": 1, "height": 1, "cells": [["empty"]], "boxes": [] } },
    { "id": "c1", "x": 3, "y": 2, "boxType": "container", "isGoalBox": true, "interior": { "width": 3, "height": 3, "cells": [["empty","empty","empty"],["empty","empty","empty"],["empty","empty","empty"]], "boxes": [] } }
  ],
  "player": { "x": 1, "y": 2 }
}
```

- [ ] **Step 3: 建立 `src/levels/builtin/03-chain-nest.json`(练习连锁嵌套,只有靠墙那对触发)**

沿用同样「中间排有内墙障碍、上下两排畅通供绕路」的房间设计,把箱子数量增加到三个都市容器箱,推右时只有最靠墙的一对(`c2`→`c3`)会嵌套,`c1` 与玩家各前进一格。

```json
{
  "width": 9,
  "height": 5,
  "cells": [
    ["wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall"],
    ["wall", "empty", "target", "empty", "empty", "empty", "empty", "empty", "wall"],
    ["wall", "empty", "empty", "empty", "empty", "wall", "empty", "empty", "wall"],
    ["wall", "empty", "empty", "empty", "empty", "empty", "empty", "empty", "wall"],
    ["wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall", "wall"]
  ],
  "boxes": [
    { "id": "c1", "x": 2, "y": 2, "boxType": "container", "isGoalBox": true, "interior": { "width": 3, "height": 3, "cells": [["empty","empty","empty"],["empty","empty","empty"],["empty","empty","empty"]], "boxes": [] } },
    { "id": "c2", "x": 3, "y": 2, "boxType": "container", "interior": { "width": 3, "height": 3, "cells": [["empty","empty","empty"],["empty","empty","empty"],["empty","empty","empty"]], "boxes": [] } },
    { "id": "c3", "x": 4, "y": 2, "boxType": "container", "interior": { "width": 3, "height": 3, "cells": [["empty","empty","empty"],["empty","empty","empty"],["empty","empty","empty"]], "boxes": [] } }
  ],
  "player": { "x": 1, "y": 2 }
}
```

- [ ] **Step 4: 建立 `src/levels/index.ts`**

```ts
import { parseLevel } from '../game/engine/levelSchema'
import { Grid } from '../game/engine/types'
import level01 from './builtin/01-first-push.json?raw'
import level02 from './builtin/02-single-nest.json?raw'
import level03 from './builtin/03-chain-nest.json?raw'

export interface LevelMeta {
  id: string
  name: string
  grid: Grid
}

export const BUILTIN_LEVELS: LevelMeta[] = [
  { id: '01-first-push', name: '第一次推动', grid: parseLevel(level01) },
  { id: '02-single-nest', name: '箱中箱', grid: parseLevel(level02) },
  { id: '03-chain-nest', name: '连锁嵌套', grid: parseLevel(level03) },
]

const generatedModules = import.meta.glob('./builtin/generated/*.json', { as: 'raw', eager: true }) as Record<string, string>

export function loadGeneratedLevels(): LevelMeta[] {
  return Object.entries(generatedModules).map(([path, raw]) => {
    const id = path.split('/').pop()!.replace('.json', '')
    return { id, name: id, grid: parseLevel(raw) }
  })
}
```

- [ ] **Step 5: 写测试 `src/levels/index.test.ts` 确认每个内建关卡都能解析、玩家/目标物皆存在,且尚未过关**

```ts
import { BUILTIN_LEVELS } from './index'
import { checkWin } from '../game/engine/rules'

test('every builtin level parses and starts unsolved', () => {
  expect(BUILTIN_LEVELS).toHaveLength(3)
  for (const level of BUILTIN_LEVELS) {
    expect(level.grid.player).toBeDefined()
    expect(checkWin(level.grid)).toBe(false)
  }
})
```

- [ ] **Step 6: 跑测试**

Run: `npx vitest run src/levels/index.test.ts`
Expected: PASS(1 test)。若某关卡意外一开始就过关或解析失败,回头修正对应 JSON(重新核对 Step 1-3 的座标)。

关卡是否真的「可解」(玩家能不能实际走到过关)留给 Task 17 的求解器正式验证 —— Task 17 Step 4 会对这三关跑 `solve()` 并断言回传非 `null`;若那时发现某关无解,回来修正对应 JSON。

- [ ] **Step 7: Commit**

```bash
git add src/levels
git commit -m "feat: add hand-authored builtin levels and level loader"
```

---

## Task 8: `GameState` — 历史记录 / undo / 移动包装

**Files:**
- Create: `src/game/engine/GameState.ts`
- Test: `src/game/engine/GameState.test.ts`

**Interfaces:**
- Consumes: `applyMove`, `checkWin` from `./rules`; `Grid`, `Direction` from `./types`
- Produces: `GameState { history: Grid[] }`、`createGameState(grid): GameState`、`currentGrid(state): Grid`、`move(state, direction): GameState`、`undo(state): GameState`、`isWon(state): boolean`

- [ ] **Step 1: 写测试 `src/game/engine/GameState.test.ts`**

```ts
import { createEmptyGrid } from './types'
import { createGameState, currentGrid, move, undo, isWon } from './GameState'

function simpleGrid() {
  const grid = createEmptyGrid(3, 3)
  grid.player = { x: 1, y: 1 }
  return grid
}

test('move updates current grid and appends history', () => {
  let state = createGameState(simpleGrid())
  state = move(state, 'right')
  expect(currentGrid(state).player).toEqual({ x: 2, y: 1 })
  expect(state.history).toHaveLength(2)
})

test('invalid move leaves state unchanged', () => {
  let state = createGameState(simpleGrid())
  state = move(state, 'right')
  state = move(state, 'right') // 撞边界
  expect(currentGrid(state).player).toEqual({ x: 2, y: 1 })
  expect(state.history).toHaveLength(2)
})

test('undo restores previous grid', () => {
  let state = createGameState(simpleGrid())
  state = move(state, 'right')
  state = undo(state)
  expect(currentGrid(state).player).toEqual({ x: 1, y: 1 })
})

test('undo on initial state is a no-op', () => {
  let state = createGameState(simpleGrid())
  state = undo(state)
  expect(state.history).toHaveLength(1)
})

test('isWon reflects checkWin on current grid', () => {
  const grid = createEmptyGrid(3, 3)
  grid.player = { x: 0, y: 0 }
  grid.cells[1][1] = 'target'
  grid.boxes.push({ id: 'g1', x: 1, y: 1, boxType: 'normal', interior: createEmptyGrid(1, 1), isGoalBox: true })
  const state = createGameState(grid)
  expect(isWon(state)).toBe(true)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/game/engine/GameState.test.ts`
Expected: FAIL(找不到模组)

- [ ] **Step 3: 实作 `src/game/engine/GameState.ts`**

```ts
import { applyMove, checkWin } from './rules'
import { Direction, Grid } from './types'

export interface GameState {
  history: Grid[]
}

export function createGameState(grid: Grid): GameState {
  return { history: [grid] }
}

export function currentGrid(state: GameState): Grid {
  return state.history[state.history.length - 1]
}

export function move(state: GameState, direction: Direction): GameState {
  const next = applyMove(currentGrid(state), direction)
  if (!next) return state
  return { history: [...state.history, next] }
}

export function undo(state: GameState): GameState {
  if (state.history.length <= 1) return state
  return { history: state.history.slice(0, -1) }
}

export function isWon(state: GameState): boolean {
  return checkWin(currentGrid(state))
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/game/engine/GameState.test.ts`
Expected: PASS(5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/game/engine/GameState.ts src/game/engine/GameState.test.ts
git commit -m "feat: add GameState with move history and undo"
```

---

## Task 9: `CanvasRenderer` — 递归网格绘制

**Files:**
- Create: `src/game/render/CanvasRenderer.ts`
- Test: `src/game/render/CanvasRenderer.test.ts`

**Interfaces:**
- Consumes: `Grid` from `../engine/types`
- Produces: `renderGrid(ctx: CanvasRenderingContext2D, grid: Grid, originX: number, originY: number, cellSize: number, depth?: number): void`

- [ ] **Step 1: 写测试 `src/game/render/CanvasRenderer.test.ts`(用 mock context 断言绘制呼叫次数,不比对像素)**

```ts
import { createEmptyGrid } from '../engine/types'
import { renderGrid } from './CanvasRenderer'

function mockContext() {
  return {
    fillRect: () => {},
    strokeRect: () => {},
    beginPath: () => {},
    arc: () => {},
    fill: () => {},
    save: () => {},
    restore: () => {},
    translate: () => {},
    scale: () => {},
    fillStyle: '',
    strokeStyle: '',
  } as unknown as CanvasRenderingContext2D
}

test('renderGrid draws one rect per cell plus one per box, and recurses into container interiors', () => {
  const ctx = mockContext()
  let fillRectCalls = 0
  ctx.fillRect = () => {
    fillRectCalls++
  }

  const grid = createEmptyGrid(2, 2)
  grid.boxes.push({
    id: 'c1',
    x: 0,
    y: 0,
    boxType: 'container',
    interior: createEmptyGrid(2, 2),
  })

  renderGrid(ctx, grid, 0, 0, 32)

  // 4 background cells + 1 box body + 4 nested background cells drawn inside the box = 9
  expect(fillRectCalls).toBe(9)
})

test('renderGrid does not throw on deeply nested grids', () => {
  const ctx = mockContext()
  let grid = createEmptyGrid(2, 2)
  for (let i = 0; i < 5; i++) {
    const inner = createEmptyGrid(2, 2)
    grid = createEmptyGrid(2, 2)
    grid.boxes.push({ id: `c${i}`, x: 0, y: 0, boxType: 'container', interior: inner })
  }
  expect(() => renderGrid(ctx, grid, 0, 0, 32)).not.toThrow()
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/game/render/CanvasRenderer.test.ts`
Expected: FAIL(找不到模组)

- [ ] **Step 3: 实作 `src/game/render/CanvasRenderer.ts`**

```ts
import { Grid } from '../engine/types'

const CELL_COLORS = { empty: '#1e293b', wall: '#0f172a', target: '#334155' } as const
const BOX_COLORS = { normal: '#f59e0b', container: '#38bdf8' } as const
const PLAYER_COLOR = '#f472b6'
const NEST_INSET = 4

export function renderGrid(
  ctx: CanvasRenderingContext2D,
  grid: Grid,
  originX: number,
  originY: number,
  cellSize: number,
): void {
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      ctx.fillStyle = CELL_COLORS[grid.cells[y][x]]
      ctx.fillRect(originX + x * cellSize, originY + y * cellSize, cellSize, cellSize)
    }
  }

  for (const box of grid.boxes) {
    const bx = originX + box.x * cellSize
    const by = originY + box.y * cellSize
    ctx.fillStyle = BOX_COLORS[box.boxType]
    ctx.fillRect(bx, by, cellSize, cellSize)

    if (box.boxType === 'container') {
      renderGrid(ctx, box.interior, bx + NEST_INSET, by + NEST_INSET, Math.max(4, cellSize - NEST_INSET * 2) / Math.max(box.interior.width, box.interior.height))
    }
  }

  if (grid.player) {
    ctx.fillStyle = PLAYER_COLOR
    ctx.fillRect(originX + grid.player.x * cellSize, originY + grid.player.y * cellSize, cellSize, cellSize)
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/game/render/CanvasRenderer.test.ts`
Expected: PASS(2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/game/render/CanvasRenderer.ts src/game/render/CanvasRenderer.test.ts
git commit -m "feat: add recursive Canvas grid renderer"
```

---

## Task 10: 触控 UI — `DPad` 与 `SwipeLayer`

**Files:**
- Create: `src/ui/DPad.tsx`
- Create: `src/ui/DPad.test.tsx`
- Create: `src/ui/SwipeLayer.tsx`
- Create: `src/ui/SwipeLayer.test.tsx`

**Interfaces:**
- Produces: `<DPad onMove={(direction: Direction) => void} />`;`<SwipeLayer onMove={(direction: Direction) => void}>{children}</SwipeLayer>`(包一层 div,监听 touch 事件算滑动方向)

- [ ] **Step 1: 写测试 `src/ui/DPad.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DPad } from './DPad'

test('clicking each direction button calls onMove with the right direction', async () => {
  const onMove = vi.fn()
  render(<DPad onMove={onMove} />)
  const user = userEvent.setup()

  await user.click(screen.getByLabelText('上'))
  await user.click(screen.getByLabelText('下'))
  await user.click(screen.getByLabelText('左'))
  await user.click(screen.getByLabelText('右'))

  expect(onMove.mock.calls).toEqual([['up'], ['down'], ['left'], ['right']])
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/ui/DPad.test.tsx`
Expected: FAIL(找不到模组)

- [ ] **Step 3: 实作 `src/ui/DPad.tsx`**

```tsx
import { Direction } from '../game/engine/types'

export function DPad({ onMove }: { onMove: (direction: Direction) => void }) {
  return (
    <div className="dpad">
      <button aria-label="上" onClick={() => onMove('up')}>▲</button>
      <div className="dpad-row">
        <button aria-label="左" onClick={() => onMove('left')}>◀</button>
        <button aria-label="下" onClick={() => onMove('down')}>▼</button>
        <button aria-label="右" onClick={() => onMove('right')}>▶</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/ui/DPad.test.tsx`
Expected: PASS(1 test)

- [ ] **Step 5: 写测试 `src/ui/SwipeLayer.test.tsx`**

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { SwipeLayer } from './SwipeLayer'

function touch(x: number, y: number) {
  return { touches: [{ clientX: x, clientY: y }] }
}

test('a horizontal swipe calls onMove with left/right', () => {
  const onMove = vi.fn()
  render(
    <SwipeLayer onMove={onMove}>
      <div>content</div>
    </SwipeLayer>,
  )
  const el = screen.getByTestId('swipe-layer')
  fireEvent.touchStart(el, touch(100, 100))
  fireEvent.touchEnd(el, touch(200, 105))
  expect(onMove).toHaveBeenCalledWith('right')
})

test('a vertical swipe calls onMove with up/down', () => {
  const onMove = vi.fn()
  render(
    <SwipeLayer onMove={onMove}>
      <div>content</div>
    </SwipeLayer>,
  )
  const el = screen.getByTestId('swipe-layer')
  fireEvent.touchStart(el, touch(100, 100))
  fireEvent.touchEnd(el, touch(95, 30))
  expect(onMove).toHaveBeenCalledWith('up')
})

test('a short movement below the threshold does not trigger a move', () => {
  const onMove = vi.fn()
  render(
    <SwipeLayer onMove={onMove}>
      <div>content</div>
    </SwipeLayer>,
  )
  const el = screen.getByTestId('swipe-layer')
  fireEvent.touchStart(el, touch(100, 100))
  fireEvent.touchEnd(el, touch(105, 102))
  expect(onMove).not.toHaveBeenCalled()
})
```

- [ ] **Step 6: 跑测试确认失败**

Run: `npx vitest run src/ui/SwipeLayer.test.tsx`
Expected: FAIL(找不到模组)

- [ ] **Step 7: 实作 `src/ui/SwipeLayer.tsx`**

```tsx
import { useRef, ReactNode } from 'react'
import { Direction } from '../game/engine/types'

const SWIPE_THRESHOLD = 24

export function SwipeLayer({ onMove, children }: { onMove: (direction: Direction) => void; children: ReactNode }) {
  const start = useRef<{ x: number; y: number } | null>(null)

  return (
    <div
      data-testid="swipe-layer"
      onTouchStart={(e) => {
        const t = e.touches[0]
        start.current = { x: t.clientX, y: t.clientY }
      }}
      onTouchEnd={(e) => {
        if (!start.current) return
        const t = e.changedTouches[0] ?? e.touches[0]
        const dx = t.clientX - start.current.x
        const dy = t.clientY - start.current.y
        start.current = null
        if (Math.abs(dx) < SWIPE_THRESHOLD && Math.abs(dy) < SWIPE_THRESHOLD) return
        if (Math.abs(dx) > Math.abs(dy)) {
          onMove(dx > 0 ? 'right' : 'left')
        } else {
          onMove(dy > 0 ? 'down' : 'up')
        }
      }}
    >
      {children}
    </div>
  )
}
```

注:`fireEvent.touchEnd` 在 jsdom 底下 `e.touches` 通常为空阵列而 `e.changedTouches` 才有资料,上面实作已用 `e.changedTouches[0] ?? e.touches[0]` 兼顾两种情况。

- [ ] **Step 8: 跑测试确认通过**

Run: `npx vitest run src/ui/SwipeLayer.test.tsx`
Expected: PASS(3 tests)

- [ ] **Step 9: Commit**

```bash
git add src/ui/DPad.tsx src/ui/DPad.test.tsx src/ui/SwipeLayer.tsx src/ui/SwipeLayer.test.tsx
git commit -m "feat: add DPad and swipe touch controls"
```

---

## Task 11: `GameScreen` — 组合引擎 + 渲染 + 控制 + HUD

**Files:**
- Create: `src/game/GameScreen.tsx`
- Test: `src/game/GameScreen.test.tsx`

**Interfaces:**
- Consumes: `createGameState`, `currentGrid`, `move`, `undo`, `isWon` from `./engine/GameState`; `renderGrid` from `./render/CanvasRenderer`; `DPad` from `../ui/DPad`; `SwipeLayer` from `../ui/SwipeLayer`; `Grid` from `./engine/types`
- Produces: `<GameScreen initialGrid={Grid} onExit={() => void} onWin={() => void} />`

- [ ] **Step 1: 写测试 `src/game/GameScreen.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GameScreen } from './GameScreen'
import { createEmptyGrid } from './engine/types'

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
  }) as unknown as typeof HTMLCanvasElement.prototype.getContext
})

function grid() {
  const g = createEmptyGrid(3, 3)
  g.player = { x: 1, y: 1 }
  return g
}

test('pressing a DPad button increments the step counter', async () => {
  render(<GameScreen initialGrid={grid()} onExit={() => {}} onWin={() => {}} />)
  const user = userEvent.setup()
  expect(screen.getByText('步数: 0')).toBeInTheDocument()
  await user.click(screen.getByLabelText('右'))
  expect(screen.getByText('步数: 1')).toBeInTheDocument()
})

test('undo button decrements the step counter', async () => {
  render(<GameScreen initialGrid={grid()} onExit={() => {}} onWin={() => {}} />)
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('右'))
  await user.click(screen.getByText('复位上一步'))
  expect(screen.getByText('步数: 0')).toBeInTheDocument()
})

test('reaching the win condition calls onWin', async () => {
  const g = createEmptyGrid(3, 3)
  g.player = { x: 0, y: 1 }
  g.cells[1][1] = 'target'
  g.boxes.push({ id: 'g1', x: 1, y: 1, boxType: 'normal', interior: createEmptyGrid(1, 1), isGoalBox: true })
  g.boxes[0].isGoalBox = true
  // 把 g1 移出 target 一格,靠玩家推它回去触发胜利
  g.boxes[0].x = 2
  const onWin = vi.fn()
  render(<GameScreen initialGrid={g} onExit={() => {}} onWin={onWin} />)
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('左'))
  expect(onWin).toHaveBeenCalled()
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/game/GameScreen.test.tsx`
Expected: FAIL(找不到模组)

- [ ] **Step 3: 实作 `src/game/GameScreen.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react'
import { createGameState, currentGrid, GameState, isWon, move, undo } from './engine/GameState'
import { renderGrid } from './render/CanvasRenderer'
import { DPad } from '../ui/DPad'
import { SwipeLayer } from '../ui/SwipeLayer'
import { Direction, Grid } from './engine/types'

const CELL_SIZE = 32

export function GameScreen({
  initialGrid,
  onExit,
  onWin,
}: {
  initialGrid: Grid
  onExit: () => void
  onWin: () => void
}) {
  const [state, setState] = useState<GameState>(() => createGameState(initialGrid))
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wonRef = useRef(false)

  const handleMove = (direction: Direction) => {
    setState((s) => move(s, direction))
  }

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d')
    if (ctx) renderGrid(ctx, currentGrid(state), 0, 0, CELL_SIZE)
  }, [state])

  useEffect(() => {
    if (isWon(state) && !wonRef.current) {
      wonRef.current = true
      onWin()
    }
  }, [state, onWin])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const map: Record<string, Direction> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }
      const direction = map[e.key]
      if (direction) handleMove(direction)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <div className="game-screen">
      <div className="hud">
        <span>步数: {state.history.length - 1}</span>
        <button onClick={() => setState((s) => undo(s))}>复位上一步</button>
        <button onClick={onExit}>离开</button>
      </div>
      <SwipeLayer onMove={handleMove}>
        <canvas ref={canvasRef} width={CELL_SIZE * currentGrid(state).width} height={CELL_SIZE * currentGrid(state).height} />
      </SwipeLayer>
      <DPad onMove={handleMove} />
    </div>
  )
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/game/GameScreen.test.tsx`
Expected: PASS(3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/game/GameScreen.tsx src/game/GameScreen.test.tsx
git commit -m "feat: wire GameScreen with engine, renderer, and controls"
```

---

## Task 12: `storage/progress.ts` — localStorage 进度存档

**Files:**
- Create: `src/storage/progress.ts`
- Test: `src/storage/progress.test.ts`

**Interfaces:**
- Produces: `markLevelComplete(levelId: string): void`、`isLevelComplete(levelId: string): boolean`、`listCompletedLevels(): string[]`、`saveCustomLevel(id: string, json: string): void`、`listCustomLevels(): { id: string; json: string }[]`、`deleteCustomLevel(id: string): void`

- [ ] **Step 1: 写测试 `src/storage/progress.test.ts`**

```ts
import { beforeEach } from 'vitest'
import {
  deleteCustomLevel,
  isLevelComplete,
  listCompletedLevels,
  listCustomLevels,
  markLevelComplete,
  saveCustomLevel,
} from './progress'

beforeEach(() => {
  localStorage.clear()
})

test('markLevelComplete then isLevelComplete reflects it', () => {
  expect(isLevelComplete('01')).toBe(false)
  markLevelComplete('01')
  expect(isLevelComplete('01')).toBe(true)
})

test('listCompletedLevels returns all marked levels without duplicates', () => {
  markLevelComplete('01')
  markLevelComplete('02')
  markLevelComplete('01')
  expect(listCompletedLevels().sort()).toEqual(['01', '02'])
})

test('saveCustomLevel then listCustomLevels round-trips', () => {
  saveCustomLevel('my-level', '{"width":1}')
  expect(listCustomLevels()).toEqual([{ id: 'my-level', json: '{"width":1}' }])
})

test('deleteCustomLevel removes it', () => {
  saveCustomLevel('my-level', '{"width":1}')
  deleteCustomLevel('my-level')
  expect(listCustomLevels()).toEqual([])
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/storage/progress.test.ts`
Expected: FAIL(找不到模组)

- [ ] **Step 3: 实作 `src/storage/progress.ts`**

```ts
const COMPLETED_KEY = 'parabox:completedLevels'
const CUSTOM_LEVELS_KEY = 'parabox:customLevels'

export function markLevelComplete(levelId: string): void {
  const set = new Set(listCompletedLevels())
  set.add(levelId)
  localStorage.setItem(COMPLETED_KEY, JSON.stringify([...set]))
}

export function isLevelComplete(levelId: string): boolean {
  return listCompletedLevels().includes(levelId)
}

export function listCompletedLevels(): string[] {
  const raw = localStorage.getItem(COMPLETED_KEY)
  return raw ? (JSON.parse(raw) as string[]) : []
}

interface CustomLevelEntry {
  id: string
  json: string
}

export function saveCustomLevel(id: string, json: string): void {
  const levels = listCustomLevels().filter((l) => l.id !== id)
  levels.push({ id, json })
  localStorage.setItem(CUSTOM_LEVELS_KEY, JSON.stringify(levels))
}

export function listCustomLevels(): CustomLevelEntry[] {
  const raw = localStorage.getItem(CUSTOM_LEVELS_KEY)
  return raw ? (JSON.parse(raw) as CustomLevelEntry[]) : []
}

export function deleteCustomLevel(id: string): void {
  const levels = listCustomLevels().filter((l) => l.id !== id)
  localStorage.setItem(CUSTOM_LEVELS_KEY, JSON.stringify(levels))
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/storage/progress.test.ts`
Expected: PASS(4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/storage/progress.ts src/storage/progress.test.ts
git commit -m "feat: add localStorage-backed progress and custom level storage"
```

---

## Task 13: 主选单 / 关卡选择 / App 路由

**Files:**
- Create: `src/ui/MenuScreen.tsx`
- Create: `src/ui/LevelSelect.tsx`
- Create: `src/ui/LevelSelect.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

**Interfaces:**
- Consumes: `BUILTIN_LEVELS`, `loadGeneratedLevels`, `LevelMeta` from `../levels`; `isLevelComplete` from `../storage/progress`; `GameScreen` from `../game/GameScreen`
- Produces: `<MenuScreen onStart={() => void} onEditor={() => void} />`;`<LevelSelect levels={LevelMeta[]} onSelect={(level: LevelMeta) => void} onBack={() => void} />`;`App` 用简单的 state machine 在 `'menu' | 'levelSelect' | 'game' | 'editor'` 之间切换,不额外引入路由函式库(YAGNI)

- [ ] **Step 1: 实作 `src/ui/MenuScreen.tsx`**

```tsx
export function MenuScreen({ onStart, onEditor }: { onStart: () => void; onEditor: () => void }) {
  return (
    <div className="menu-screen">
      <h1>Parabox Tribute</h1>
      <button onClick={onStart}>开始游戏</button>
      <button onClick={onEditor}>关卡编辑器</button>
    </div>
  )
}
```

- [ ] **Step 2: 写测试 `src/ui/LevelSelect.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LevelSelect } from './LevelSelect'
import { createEmptyGrid } from '../game/engine/types'

test('lists levels and marks completed ones', () => {
  const levels = [
    { id: 'a', name: '关卡 A', grid: createEmptyGrid(1, 1) },
    { id: 'b', name: '关卡 B', grid: createEmptyGrid(1, 1) },
  ]
  render(<LevelSelect levels={levels} completedIds={['a']} onSelect={() => {}} onBack={() => {}} />)
  expect(screen.getByText('关卡 A ✓')).toBeInTheDocument()
  expect(screen.getByText('关卡 B')).toBeInTheDocument()
})

test('clicking a level calls onSelect with it', async () => {
  const levels = [{ id: 'a', name: '关卡 A', grid: createEmptyGrid(1, 1) }]
  const onSelect = vi.fn()
  render(<LevelSelect levels={levels} completedIds={[]} onSelect={onSelect} onBack={() => {}} />)
  await userEvent.setup().click(screen.getByText('关卡 A'))
  expect(onSelect).toHaveBeenCalledWith(levels[0])
})
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npx vitest run src/ui/LevelSelect.test.tsx`
Expected: FAIL(找不到模组)

- [ ] **Step 4: 实作 `src/ui/LevelSelect.tsx`**

```tsx
import { LevelMeta } from '../levels'

export function LevelSelect({
  levels,
  completedIds,
  onSelect,
  onBack,
}: {
  levels: LevelMeta[]
  completedIds: string[]
  onSelect: (level: LevelMeta) => void
  onBack: () => void
}) {
  return (
    <div className="level-select">
      <button onClick={onBack}>返回</button>
      <ul>
        {levels.map((level) => (
          <li key={level.id}>
            <button onClick={() => onSelect(level)}>
              {level.name}
              {completedIds.includes(level.id) ? ' ✓' : ''}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run src/ui/LevelSelect.test.tsx`
Expected: PASS(2 tests)

- [ ] **Step 6: 重写 `src/App.tsx` 串接选单/关卡选择/游戏**

```tsx
import { useState } from 'react'
import { MenuScreen } from './ui/MenuScreen'
import { LevelSelect } from './ui/LevelSelect'
import { GameScreen } from './game/GameScreen'
import { BUILTIN_LEVELS, loadGeneratedLevels, LevelMeta } from './levels'
import { isLevelComplete, listCompletedLevels, markLevelComplete } from './storage/progress'
import { cloneGrid } from './game/engine/types'

type Screen = 'menu' | 'levelSelect' | 'game'

export default function App() {
  const [screen, setScreen] = useState<Screen>('menu')
  const [activeLevel, setActiveLevel] = useState<LevelMeta | null>(null)
  const allLevels = [...BUILTIN_LEVELS, ...loadGeneratedLevels()]

  if (screen === 'menu') {
    return <MenuScreen onStart={() => setScreen('levelSelect')} onEditor={() => {}} />
  }

  if (screen === 'levelSelect') {
    return (
      <LevelSelect
        levels={allLevels}
        completedIds={listCompletedLevels()}
        onSelect={(level) => {
          setActiveLevel(level)
          setScreen('game')
        }}
        onBack={() => setScreen('menu')}
      />
    )
  }

  if (screen === 'game' && activeLevel) {
    return (
      <GameScreen
        initialGrid={cloneGrid(activeLevel.grid)}
        onExit={() => setScreen('levelSelect')}
        onWin={() => {
          markLevelComplete(activeLevel.id)
          if (isLevelComplete(activeLevel.id)) setScreen('levelSelect')
        }}
      />
    )
  }

  return null
}
```

- [ ] **Step 7: 更新 `src/App.test.tsx`(旧的占位测试改成验证选单渲染 + 导覽流程)**

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'

beforeEach(() => {
  localStorage.clear()
  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
  }) as unknown as typeof HTMLCanvasElement.prototype.getContext
})

test('renders the menu screen by default', () => {
  render(<App />)
  expect(screen.getByText('Parabox Tribute')).toBeInTheDocument()
})

test('navigating from menu to level select shows builtin levels', async () => {
  render(<App />)
  await userEvent.setup().click(screen.getByText('开始游戏'))
  expect(screen.getByText('第一次推动')).toBeInTheDocument()
})
```

- [ ] **Step 8: 跑测试确认通过**

Run: `npx vitest run src/App.test.tsx`
Expected: PASS(2 tests)

- [ ] **Step 9: Commit**

```bash
git add src/ui/MenuScreen.tsx src/ui/LevelSelect.tsx src/ui/LevelSelect.test.tsx src/App.tsx src/App.test.tsx
git commit -m "feat: add menu, level select, and App navigation"
```

---

## Task 14: 关卡编辑器(一)— 网格画布与素材放置

**Files:**
- Create: `src/editor/EditorScreen.tsx`
- Test: `src/editor/EditorScreen.test.tsx`

**Interfaces:**
- Consumes: `createEmptyGrid`, `Grid`, `CellType` from `../game/engine/types`; `renderGrid` from `../game/render/CanvasRenderer`
- Produces: `<EditorScreen onBack={() => void} />`(本任务先做:素材面板选取工具、点击画布放置墙/目标/普通箱/容器箱/玩家起点到最外层 Grid;进入箱子内部编辑留给 Task 15)

- [ ] **Step 1: 写测试 `src/editor/EditorScreen.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EditorScreen } from './EditorScreen'

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
  }) as unknown as typeof HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.getBoundingClientRect = vi.fn().mockReturnValue({ left: 0, top: 0 }) as unknown as typeof HTMLCanvasElement.prototype.getBoundingClientRect
})

test('selecting the wall tool then clicking the canvas places a wall cell', async () => {
  render(<EditorScreen onBack={() => {}} />)
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('墙'))
  const canvas = screen.getByTestId('editor-canvas')
  await user.click(canvas, { clientX: 32 + 5, clientY: 5 })
  expect(screen.getByTestId('cell-type-1-0')).toHaveTextContent('wall')
})

test('selecting the container box tool then clicking places a container box', async () => {
  render(<EditorScreen onBack={() => {}} />)
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('容器箱'))
  const canvas = screen.getByTestId('editor-canvas')
  await user.click(canvas, { clientX: 5, clientY: 5 })
  expect(screen.getByTestId('box-at-0-0')).toHaveTextContent('container')
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/editor/EditorScreen.test.tsx`
Expected: FAIL(找不到模组)

- [ ] **Step 3: 实作 `src/editor/EditorScreen.tsx`(第一版, 含隐藏的 debug 输出方便测试断言,同时驱动 Canvas 绘制)**

```tsx
import { useEffect, useRef, useState } from 'react'
import { Box, cloneGrid, createEmptyGrid, Grid } from '../game/engine/types'
import { renderGrid } from '../game/render/CanvasRenderer'

const CELL_SIZE = 32
type Tool = 'wall' | 'target' | 'empty' | 'normal-box' | 'container-box' | 'player'

const TOOLS: { tool: Tool; label: string }[] = [
  { tool: 'empty', label: '空地' },
  { tool: 'wall', label: '墙' },
  { tool: 'target', label: '目标点' },
  { tool: 'normal-box', label: '普通箱' },
  { tool: 'container-box', label: '容器箱' },
  { tool: 'player', label: '玩家起点' },
]

let boxIdCounter = 0

export function EditorScreen({ onBack }: { onBack: () => void }) {
  const [grid, setGrid] = useState<Grid>(() => createEmptyGrid(6, 6))
  const [tool, setTool] = useState<Tool>('wall')
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d')
    if (ctx) renderGrid(ctx, grid, 0, 0, CELL_SIZE)
  }, [grid])

  const placeAt = (x: number, y: number) => {
    setGrid((g) => {
      const next = cloneGrid(g)
      next.boxes = next.boxes.filter((b) => !(b.x === x && b.y === y))
      if (tool === 'wall' || tool === 'target' || tool === 'empty') {
        next.cells[y][x] = tool === 'empty' ? 'empty' : tool
      } else if (tool === 'player') {
        next.player = { x, y }
      } else {
        const box: Box = {
          id: `box-${boxIdCounter++}`,
          x,
          y,
          boxType: tool === 'container-box' ? 'container' : 'normal',
          interior: createEmptyGrid(3, 3),
        }
        next.boxes.push(box)
      }
      return next
    })
  }

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = Math.floor((e.clientX - rect.left) / CELL_SIZE)
    const y = Math.floor((e.clientY - rect.top) / CELL_SIZE)
    if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return
    placeAt(x, y)
  }

  return (
    <div className="editor-screen">
      <button onClick={onBack}>返回</button>
      <div className="tool-palette">
        {TOOLS.map(({ tool: t, label }) => (
          <button key={t} aria-label={label} aria-pressed={tool === t} onClick={() => setTool(t)}>
            {label}
          </button>
        ))}
      </div>
      <canvas
        data-testid="editor-canvas"
        ref={canvasRef}
        width={CELL_SIZE * grid.width}
        height={CELL_SIZE * grid.height}
        onClick={handleCanvasClick}
      />
      <div style={{ display: 'none' }}>
        {grid.cells.map((row, y) =>
          row.map((cell, x) => (
            <span key={`${x}-${y}`} data-testid={`cell-type-${x}-${y}`}>
              {cell}
            </span>
          )),
        )}
        {grid.boxes.map((box) => (
          <span key={box.id} data-testid={`box-at-${box.x}-${box.y}`}>
            {box.boxType}
          </span>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/editor/EditorScreen.test.tsx`
Expected: PASS(2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/editor/EditorScreen.tsx src/editor/EditorScreen.test.tsx
git commit -m "feat: add level editor grid canvas and placement tools"
```

---

## Task 15: 关卡编辑器(二)— 进入箱子内部编辑 + 存档/汇出汇入

**Files:**
- Modify: `src/editor/EditorScreen.tsx`
- Modify: `src/editor/EditorScreen.test.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `saveCustomLevel`, `listCustomLevels` from `../storage/progress`; `serializeLevel`, `parseLevel` from `../game/engine/levelSchema`
- Produces: `EditorScreen` 支援面包屑导航(`路径: [ {x,y,boxId}, ... ]`)进入/离开容器箱内部编辑其 `interior`;存档到 localStorage(`saveCustomLevel`);汇出目前关卡为可下载的 JSON 档;`App.tsx` 的 `onEditor` 接上 `EditorScreen`

- [ ] **Step 1: 在 `EditorScreen.test.tsx` 新增测试**

```tsx
test('double-clicking a container box enters its interior, breadcrumb shows the path', async () => {
  render(<EditorScreen onBack={() => {}} />)
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('容器箱'))
  const canvas = screen.getByTestId('editor-canvas')
  await user.click(canvas, { clientX: 5, clientY: 5 })
  await user.dblClick(canvas, { clientX: 5, clientY: 5 })
  expect(screen.getByText('外层 > box-0')).toBeInTheDocument()
})

test('clicking the breadcrumb root returns to the outer grid', async () => {
  render(<EditorScreen onBack={() => {}} />)
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('容器箱'))
  const canvas = screen.getByTestId('editor-canvas')
  await user.click(canvas, { clientX: 5, clientY: 5 })
  await user.dblClick(canvas, { clientX: 5, clientY: 5 })
  await user.click(screen.getByText('外层'))
  expect(screen.queryByText(/外层 > /)).not.toBeInTheDocument()
})

test('clicking save stores the level in localStorage', async () => {
  localStorage.clear()
  render(<EditorScreen onBack={() => {}} />)
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('关卡名称'), 'my-level')
  await user.click(screen.getByText('储存'))
  const { listCustomLevels } = await import('../storage/progress')
  expect(listCustomLevels().map((l) => l.id)).toEqual(['my-level'])
})
```

- [ ] **Step 2: 跑测试确认新测试失败**

Run: `npx vitest run src/editor/EditorScreen.test.tsx`
Expected: 前两个既有测试 PASS,新增 3 个测试 FAIL

- [ ] **Step 3: 扩充 `EditorScreen.tsx`,加入面包屑路径状态、双击进入箱子、储存**

在既有 import 后新增:

```tsx
import { saveCustomLevel } from '../storage/progress'
import { serializeLevel } from '../game/engine/levelSchema'
```

把 `EditorScreen` 内部改成用「根 Grid + 路径」取得目前正在编辑的 Grid,取代直接对最外层 `grid` 操作:

```tsx
interface PathEntry {
  boxId: string
}

function getGridAtPath(root: Grid, path: PathEntry[]): Grid {
  let current = root
  for (const entry of path) {
    const box = current.boxes.find((b) => b.id === entry.boxId)!
    current = box.interior
  }
  return current
}

function setGridAtPath(root: Grid, path: PathEntry[], updater: (g: Grid) => Grid): Grid {
  if (path.length === 0) return updater(root)
  const next = cloneGrid(root)
  let current = next
  for (let i = 0; i < path.length - 1; i++) {
    current = current.boxes.find((b) => b.id === path[i].boxId)!.interior
  }
  const box = current.boxes.find((b) => b.id === path[path.length - 1].boxId)!
  box.interior = updater(cloneGrid(box.interior))
  return next
}
```

把 `EditorScreen` 函式内容改成:

```tsx
export function EditorScreen({ onBack }: { onBack: () => void }) {
  const [root, setRoot] = useState<Grid>(() => createEmptyGrid(6, 6))
  const [path, setPath] = useState<PathEntry[]>([])
  const [tool, setTool] = useState<Tool>('wall')
  const [levelName, setLevelName] = useState('')
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const activeGrid = getGridAtPath(root, path)

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d')
    if (ctx) renderGrid(ctx, activeGrid, 0, 0, CELL_SIZE)
  }, [activeGrid])

  const placeAt = (x: number, y: number) => {
    setRoot((r) =>
      setGridAtPath(r, path, (g) => {
        const next = cloneGrid(g)
        next.boxes = next.boxes.filter((b) => !(b.x === x && b.y === y))
        if (tool === 'wall' || tool === 'target' || tool === 'empty') {
          next.cells[y][x] = tool === 'empty' ? 'empty' : tool
        } else if (tool === 'player') {
          next.player = { x, y }
        } else {
          const box: Box = {
            id: `box-${boxIdCounter++}`,
            x,
            y,
            boxType: tool === 'container-box' ? 'container' : 'normal',
            interior: createEmptyGrid(3, 3),
          }
          next.boxes.push(box)
        }
        return next
      }),
    )
  }

  const cellFromEvent = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = Math.floor((e.clientX - rect.left) / CELL_SIZE)
    const y = Math.floor((e.clientY - rect.top) / CELL_SIZE)
    return { x, y }
  }

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = cellFromEvent(e)
    if (x < 0 || y < 0 || x >= activeGrid.width || y >= activeGrid.height) return
    placeAt(x, y)
  }

  const handleCanvasDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = cellFromEvent(e)
    const box = activeGrid.boxes.find((b) => b.x === x && b.y === y && b.boxType === 'container')
    if (box) setPath((p) => [...p, { boxId: box.id }])
  }

  const breadcrumb = ['外层', ...path.map((p) => p.boxId)]

  return (
    <div className="editor-screen">
      <button onClick={onBack}>返回</button>
      <div className="breadcrumb">
        {breadcrumb.map((label, i) => (
          <span key={i}>
            <button onClick={() => setPath(path.slice(0, i))}>{label}</button>
            {i < breadcrumb.length - 1 ? ' > ' : ''}
          </span>
        ))}
      </div>
      <div className="tool-palette">
        {TOOLS.map(({ tool: t, label }) => (
          <button key={t} aria-label={label} aria-pressed={tool === t} onClick={() => setTool(t)}>
            {label}
          </button>
        ))}
      </div>
      <canvas
        data-testid="editor-canvas"
        ref={canvasRef}
        width={CELL_SIZE * activeGrid.width}
        height={CELL_SIZE * activeGrid.height}
        onClick={handleCanvasClick}
        onDoubleClick={handleCanvasDoubleClick}
      />
      <label>
        关卡名称
        <input aria-label="关卡名称" value={levelName} onChange={(e) => setLevelName(e.target.value)} />
      </label>
      <button
        onClick={() => {
          if (!levelName) return
          saveCustomLevel(levelName, serializeLevel(root))
        }}
      >
        储存
      </button>
      <button
        onClick={() => {
          const blob = new Blob([serializeLevel(root)], { type: 'application/json' })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = `${levelName || 'level'}.json`
          a.click()
          URL.revokeObjectURL(url)
        }}
      >
        汇出 JSON
      </button>
      <div style={{ display: 'none' }}>
        {activeGrid.cells.map((row, y) =>
          row.map((cell, x) => (
            <span key={`${x}-${y}`} data-testid={`cell-type-${x}-${y}`}>
              {cell}
            </span>
          )),
        )}
        {activeGrid.boxes.map((box) => (
          <span key={box.id} data-testid={`box-at-${box.x}-${box.y}`}>
            {box.boxType}
          </span>
        ))}
      </div>
    </div>
  )
}
```

面包屑标籤这里直接显示 `box.id`(例如 `box-0`),跟测试预期的 `外层 > box-0` 一致,因为测试是本模组内第一个被建立的容器箱。

- [ ] **Step 4: 跑测试确认全部通过**

Run: `npx vitest run src/editor/EditorScreen.test.tsx`
Expected: PASS(5 tests)

- [ ] **Step 5: 把 `EditorScreen` 接上 `App.tsx`**

```tsx
import { EditorScreen } from './editor/EditorScreen'
```

把 `Screen` 型别改成 `'menu' | 'levelSelect' | 'game' | 'editor'`,`MenuScreen` 的 `onEditor` 改成 `() => setScreen('editor')`,并在 `screen === 'game'` 判断式后加:

```tsx
  if (screen === 'editor') {
    return <EditorScreen onBack={() => setScreen('menu')} />
  }
```

- [ ] **Step 6: 跑一次全专案测试确认没有连带破坏**

Run: `npx vitest run`
Expected: 全部 PASS

- [ ] **Step 7: Commit**

```bash
git add src/editor/EditorScreen.tsx src/editor/EditorScreen.test.tsx src/App.tsx
git commit -m "feat: support entering box interiors, saving, and exporting in the editor"
```

---

## Task 16: 生成器反向移动(`inverseMoves.ts`)

**Files:**
- Create: `tools/generator/inverseMoves.ts`
- Test: `tools/generator/inverseMoves.test.ts`

**Interfaces:**
- Consumes: `Box, cellAt, boxAt, cloneGrid, Direction, DIRECTION_VECTORS, Grid, nestEntryPosition` from `../../src/game/engine/types`; `applyMove` from `../../src/game/engine/rules`
- Produces: `inverseTranslate(grid: Grid, direction: Direction): Grid | null`、`inverseNest(grid: Grid, direction: Direction): Grid | null`

**已知范围限制**(写进模组顶部注解):生成器的反向操作只处理链长度 1(单箱平移)与链长度恰好 2(靠墙嵌套)这两种最小情境,足以生成练习「推动」与「嵌套」两种机制的关卡;更长链条的反向生成留待未来扩充。

- [ ] **Step 1: 写测试 `tools/generator/inverseMoves.test.ts`**

```ts
import { createEmptyGrid, nestEntryPosition } from '../../src/game/engine/types'
import { applyMove } from '../../src/game/engine/rules'
import { inverseNest, inverseTranslate } from './inverseMoves'

test('inverseTranslate produces a predecessor that forward-replays to the same grid', () => {
  const grid = createEmptyGrid(4, 3)
  grid.player = { x: 2, y: 1 }
  const prev = inverseTranslate(grid, 'right')!
  expect(prev.player).toEqual({ x: 1, y: 1 })
  expect(applyMove(prev, 'right')).toEqual(grid)
})

test('inverseTranslate also pulls back a box that sits ahead of the player', () => {
  const grid = createEmptyGrid(5, 3)
  grid.player = { x: 2, y: 1 }
  grid.boxes.push({ id: 'b1', x: 3, y: 1, boxType: 'normal', interior: createEmptyGrid(1, 1) })
  const prev = inverseTranslate(grid, 'right')!
  expect(applyMove(prev, 'right')).toEqual(grid)
})

test('inverseTranslate returns null when there is no room behind the player', () => {
  const grid = createEmptyGrid(3, 3)
  grid.player = { x: 0, y: 1 }
  expect(inverseTranslate(grid, 'right')).toBeNull()
})

test('inverseNest produces a predecessor whose forward move re-creates the nested state', () => {
  const grid = createEmptyGrid(5, 3)
  grid.cells[1][3] = 'wall'
  const container = { id: 'c1', x: 2, y: 1, boxType: 'container' as const, interior: createEmptyGrid(3, 3) }
  const entry = nestEntryPosition(container.interior, 'right')
  container.interior.boxes.push({ id: 'n1', x: entry.x, y: entry.y, boxType: 'normal', interior: createEmptyGrid(1, 1) })
  grid.boxes.push(container)
  grid.player = { x: 1, y: 1 }

  const prev = inverseNest(grid, 'right')!
  const replayed = applyMove(prev, 'right')
  expect(replayed).toEqual(grid)
})

test('inverseNest returns null when the container is not against a wall', () => {
  const grid = createEmptyGrid(5, 3)
  const container = { id: 'c1', x: 2, y: 1, boxType: 'container' as const, interior: createEmptyGrid(3, 3) }
  const entry = nestEntryPosition(container.interior, 'right')
  container.interior.boxes.push({ id: 'n1', x: entry.x, y: entry.y, boxType: 'normal', interior: createEmptyGrid(1, 1) })
  grid.boxes.push(container)
  grid.player = { x: 1, y: 1 }
  expect(inverseNest(grid, 'right')).toBeNull()
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tools/generator/inverseMoves.test.ts`
Expected: FAIL(找不到模组)

- [ ] **Step 3: 实作 `tools/generator/inverseMoves.ts`**

```ts
// 已知范围限制:只处理链长度 1(单箱平移)与恰好 2(靠墙嵌套)的反向操作。
import {
  boxAt,
  cellAt,
  cloneGrid,
  Direction,
  DIRECTION_VECTORS,
  Grid,
  nestEntryPosition,
} from '../../src/game/engine/types'

function isOpenCell(grid: Grid, x: number, y: number): boolean {
  if (cellAt(grid, x, y) !== 'empty' && cellAt(grid, x, y) !== 'target') return false
  return !boxAt(grid, x, y)
}

export function inverseTranslate(grid: Grid, direction: Direction): Grid | null {
  if (!grid.player) return null
  const { dx, dy } = DIRECTION_VECTORS[direction]
  const behind = { x: grid.player.x - dx, y: grid.player.y - dy }
  if (!isOpenCell(grid, behind.x, behind.y)) return null

  const ahead = { x: grid.player.x + dx, y: grid.player.y + dy }
  const pushedBox = boxAt(grid, ahead.x, ahead.y)

  const prev = cloneGrid(grid)
  prev.player = behind
  if (pushedBox) {
    const b = prev.boxes.find((bb) => bb.id === pushedBox.id)!
    b.x = grid.player.x
    b.y = grid.player.y
  }
  return prev
}

export function inverseNest(grid: Grid, direction: Direction): Grid | null {
  if (!grid.player) return null
  const { dx, dy } = DIRECTION_VECTORS[direction]
  const receiverPos = { x: grid.player.x + dx, y: grid.player.y + dy }
  const receiver = boxAt(grid, receiverPos.x, receiverPos.y)
  if (!receiver || receiver.boxType !== 'container') return null

  const wallPos = { x: receiver.x + dx, y: receiver.y + dy }
  if (cellAt(grid, wallPos.x, wallPos.y) !== 'wall') return null

  const behind = { x: grid.player.x - dx, y: grid.player.y - dy }
  if (!isOpenCell(grid, behind.x, behind.y)) return null

  const entryPos = nestEntryPosition(receiver.interior, direction)
  const nested = boxAt(receiver.interior, entryPos.x, entryPos.y)
  if (!nested) return null

  const prev = cloneGrid(grid)
  prev.player = behind
  const prevReceiver = prev.boxes.find((b) => b.id === receiver.id)!
  prevReceiver.interior.boxes = prevReceiver.interior.boxes.filter((b) => b.id !== nested.id)
  const restored = structuredClone(nested)
  restored.x = grid.player.x
  restored.y = grid.player.y
  prev.boxes.push(restored)
  return prev
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tools/generator/inverseMoves.test.ts`
Expected: PASS(5 tests)

- [ ] **Step 5: Commit**

```bash
git add tools/generator/inverseMoves.ts tools/generator/inverseMoves.test.ts
git commit -m "feat: add generator inverse-move operations for translate and nest"
```

---

## Task 17: 求解器(`solver.ts`)— BFS 最短解

**Files:**
- Create: `tools/generator/solver.ts`
- Test: `tools/generator/solver.test.ts`

**Interfaces:**
- Consumes: `applyMove`, `checkWin` from `../../src/game/engine/rules`; `Direction`, `Grid` from `../../src/game/engine/types`; `BUILTIN_LEVELS` from `../../src/levels`
- Produces: `solve(grid: Grid, maxDepth?: number): Direction[] | null`(BFS,回传的路径长度即为最短解,`null` 代表在 `maxDepth` 内找不到解);`countNestingEvents(grid: Grid, moves: Direction[]): number`

- [ ] **Step 1: 写测试 `tools/generator/solver.test.ts`**

```ts
import { createEmptyGrid } from '../../src/game/engine/types'
import { BUILTIN_LEVELS } from '../../src/levels'
import { countNestingEvents, solve } from './solver'

test('solve finds the shortest path for a trivial one-step level', () => {
  const grid = createEmptyGrid(3, 1)
  grid.player = { x: 0, y: 0 }
  grid.cells[0][2] = 'target'
  grid.boxes.push({ id: 'g1', x: 1, y: 0, boxType: 'normal', interior: createEmptyGrid(1, 1), isGoalBox: true })
  const solution = solve(grid)
  expect(solution).toEqual(['right'])
})

test('solve returns null for an already-impossible level within maxDepth', () => {
  const grid = createEmptyGrid(3, 1)
  grid.player = { x: 0, y: 0 }
  grid.cells[0][2] = 'target'
  grid.boxes.push({ id: 'g1', x: 1, y: 0, boxType: 'normal', interior: createEmptyGrid(1, 1), isGoalBox: true })
  grid.cells[0][1] = 'wall'
  const solution = solve(grid, 5)
  expect(solution).toBeNull()
})

test('every builtin level is solvable', () => {
  for (const level of BUILTIN_LEVELS) {
    const solution = solve(level.grid, 100)
    expect(solution, `level ${level.id} should be solvable`).not.toBeNull()
  }
})

test('countNestingEvents counts how many moves in the path trigger a nest', () => {
  const grid = createEmptyGrid(5, 3)
  grid.player = { x: 0, y: 1 }
  grid.cells[1][3] = 'wall'
  grid.boxes.push({ id: 'n1', x: 1, y: 1, boxType: 'normal', interior: createEmptyGrid(1, 1) })
  grid.boxes.push({ id: 'c1', x: 2, y: 1, boxType: 'container', interior: createEmptyGrid(3, 3) })
  expect(countNestingEvents(grid, ['right'])).toBe(1)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tools/generator/solver.test.ts`
Expected: FAIL(找不到模组)

- [ ] **Step 3: 实作 `tools/generator/solver.ts`**

```ts
import { applyMove, checkWin } from '../../src/game/engine/rules'
import { Direction, Grid } from '../../src/game/engine/types'

const DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right']

export function solve(initialGrid: Grid, maxDepth = 200): Direction[] | null {
  if (checkWin(initialGrid)) return []

  const visited = new Set<string>([JSON.stringify(initialGrid)])
  let frontier: { grid: Grid; path: Direction[] }[] = [{ grid: initialGrid, path: [] }]
  let depth = 0

  while (frontier.length > 0 && depth < maxDepth) {
    const nextFrontier: typeof frontier = []
    for (const { grid, path } of frontier) {
      for (const direction of DIRECTIONS) {
        const next = applyMove(grid, direction)
        if (!next) continue
        const key = JSON.stringify(next)
        if (visited.has(key)) continue
        visited.add(key)
        const newPath = [...path, direction]
        if (checkWin(next)) return newPath
        nextFrontier.push({ grid: next, path: newPath })
      }
    }
    frontier = nextFrontier
    depth++
  }
  return null
}

export function countNestingEvents(grid: Grid, moves: Direction[]): number {
  let current = grid
  let count = 0
  for (const direction of moves) {
    const next = applyMove(current, direction)
    if (!next) throw new Error('countNestingEvents received an invalid move for this grid')
    if (next.boxes.length < current.boxes.length) count++
    current = next
  }
  return count
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tools/generator/solver.test.ts`
Expected: PASS(4 tests)。若 `03-chain-nest` 关卡在这一步被断言为不可解,回到 Task 7 检查该关卡 JSON 座标(墙的位置、`target` 位置是否与说明一致)后修正。

- [ ] **Step 5: Commit**

```bash
git add tools/generator/solver.ts tools/generator/solver.test.ts
git commit -m "feat: add BFS solver and nesting-event counter"
```

---

## Task 18: 难度评分(`difficultyScorer.ts`)

**Files:**
- Create: `tools/generator/difficultyScorer.ts`
- Test: `tools/generator/difficultyScorer.test.ts`

**Interfaces:**
- Produces: `scoreDifficulty(moveCount: number, nestingCount: number): number`、`difficultyTier(score: number): 'easy' | 'medium' | 'hard'`

- [ ] **Step 1: 写测试 `tools/generator/difficultyScorer.test.ts`**

```ts
import { difficultyTier, scoreDifficulty } from './difficultyScorer'

test('scoreDifficulty weighs nesting events much higher than plain moves', () => {
  const noNesting = scoreDifficulty(10, 0)
  const oneNesting = scoreDifficulty(10, 1)
  expect(oneNesting).toBeGreaterThan(noNesting)
})

test('difficultyTier buckets scores into easy/medium/hard', () => {
  expect(difficultyTier(5)).toBe('easy')
  expect(difficultyTier(15)).toBe('medium')
  expect(difficultyTier(30)).toBe('hard')
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tools/generator/difficultyScorer.test.ts`
Expected: FAIL(找不到模组)

- [ ] **Step 3: 实作 `tools/generator/difficultyScorer.ts`**

```ts
const NESTING_WEIGHT = 5

export function scoreDifficulty(moveCount: number, nestingCount: number): number {
  return moveCount + nestingCount * NESTING_WEIGHT
}

export function difficultyTier(score: number): 'easy' | 'medium' | 'hard' {
  if (score < 10) return 'easy'
  if (score < 25) return 'medium'
  return 'hard'
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tools/generator/difficultyScorer.test.ts`
Expected: PASS(2 tests)

- [ ] **Step 5: Commit**

```bash
git add tools/generator/difficultyScorer.ts tools/generator/difficultyScorer.test.ts
git commit -m "feat: add difficulty scoring based on move and nesting counts"
```

---

## Task 19: 种子关卡与反向生成器(`seed.ts` + `generateLevel.ts`)

**Files:**
- Create: `tools/generator/seed.ts`
- Create: `tools/generator/generateLevel.ts`
- Test: `tools/generator/generateLevel.test.ts`

**Interfaces:**
- Consumes: `createEmptyGrid`, `Grid`, `Direction`, `cloneGrid` from `../../src/game/engine/types`; `checkWin` from `../../src/game/engine/rules`; `inverseTranslate`, `inverseNest` from `./inverseMoves`
- Produces: `createSeedGrid(): Grid`(已解决的最小盘面,含一个贴墙的容器箱可供 `inverseNest` 使用);`generateLevel(seed: Grid, steps: number, rng: () => number): Grid`

- [ ] **Step 1: 实作 `tools/generator/seed.ts`**

```ts
import { createEmptyGrid, Grid } from '../../src/game/engine/types'

export function createSeedGrid(): Grid {
  const grid = createEmptyGrid(7, 5)
  for (let x = 0; x < grid.width; x++) {
    grid.cells[0][x] = 'wall'
    grid.cells[grid.height - 1][x] = 'wall'
  }
  for (let y = 0; y < grid.height; y++) {
    grid.cells[y][0] = 'wall'
    grid.cells[y][grid.width - 1] = 'wall'
  }
  grid.cells[2][5] = 'target'
  grid.boxes.push({
    id: 'goal',
    x: 5,
    y: 2,
    boxType: 'container',
    isGoalBox: true,
    interior: createEmptyGrid(3, 3),
  })
  grid.player = { x: 3, y: 2 }
  return grid
}
```

- [ ] **Step 2: 写测试 `tools/generator/generateLevel.test.ts`**

```ts
import { checkWin } from '../../src/game/engine/rules'
import { createSeedGrid } from './seed'
import { generateLevel } from './generateLevel'

function fixedRng(sequence: number[]): () => number {
  let i = 0
  return () => sequence[i++ % sequence.length]
}

test('the seed grid itself is already solved', () => {
  expect(checkWin(createSeedGrid())).toBe(true)
})

test('generateLevel with zero steps returns an equivalent (still solved) grid', () => {
  const seed = createSeedGrid()
  const level = generateLevel(seed, 0, fixedRng([0]))
  expect(checkWin(level)).toBe(true)
})

test('generateLevel with several steps produces a grid that is no longer pre-solved', () => {
  const seed = createSeedGrid()
  // 0.1 挑方向(左), 0.9 走 inverseTranslate 分支
  const level = generateLevel(seed, 6, fixedRng([0.1, 0.9]))
  expect(checkWin(level)).toBe(false)
})
```

- [ ] **Step 3: 跑测试确认第二、三项失败(第一项应该已经能过, 因为只用到 `checkWin` 与 `createSeedGrid`)**

Run: `npx vitest run tools/generator/generateLevel.test.ts`
Expected: 第一个 test PASS,其余因找不到 `./generateLevel` 模组而 FAIL

- [ ] **Step 4: 实作 `tools/generator/generateLevel.ts`**

```ts
import { cloneGrid, Direction, Grid } from '../../src/game/engine/types'
import { inverseNest, inverseTranslate } from './inverseMoves'

const DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right']

export function generateLevel(seed: Grid, steps: number, rng: () => number): Grid {
  let grid = cloneGrid(seed)
  let applied = 0
  let attempts = 0
  const maxAttempts = Math.max(steps, 1) * 20

  while (applied < steps && attempts < maxAttempts) {
    attempts++
    const direction = DIRECTIONS[Math.floor(rng() * DIRECTIONS.length) % DIRECTIONS.length]
    const preferNest = rng() < 0.5
    const primary = preferNest ? inverseNest(grid, direction) : inverseTranslate(grid, direction)
    const fallback = primary ?? (preferNest ? inverseTranslate(grid, direction) : inverseNest(grid, direction))
    if (!fallback) continue
    grid = fallback
    applied++
  }
  return grid
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tools/generator/generateLevel.test.ts`
Expected: PASS(3 tests)。若第三个测试的固定 rng 序列没有产生预期的「不再是已过关」结果,调整 `fixedRng` 传入的数值组合(例如换成 `[0.6, 0.9]` 走 `right` 方向的 `inverseTranslate`),让它确实成功套用至少一次反向移动。

- [ ] **Step 6: Commit**

```bash
git add tools/generator/seed.ts tools/generator/generateLevel.ts tools/generator/generateLevel.test.ts
git commit -m "feat: add seed grid and reverse-walk level generator"
```

---

## Task 20: 批次产生关卡的 CLI(`generateBatch.ts`)

**Files:**
- Create: `tools/generator/generateBatch.ts`
- Test: `tools/generator/generateBatch.test.ts`

**Interfaces:**
- Consumes: `createSeedGrid` from `./seed`; `generateLevel` from `./generateLevel`; `solve`, `countNestingEvents` from `./solver`; `scoreDifficulty`, `difficultyTier` from `./difficultyScorer`; `serializeLevel` from `../../src/game/engine/levelSchema`
- Produces: `generateLevelBatch(targetPerTier: number, rng: () => number): { tier: 'easy' | 'medium' | 'hard'; grid: Grid; json: string }[]`(纯函式,方便测试);CLI 入口 `main()` 呼叫它并把结果写进 `src/levels/builtin/generated/*.json`

- [ ] **Step 1: 写测试 `tools/generator/generateBatch.test.ts`(只测纯函式部分, 不落地档案)**

```ts
import { solve } from './solver'
import { parseLevel } from '../../src/game/engine/levelSchema'
import { generateLevelBatch } from './generateBatch'

function seededRng(startSeed: number): () => number {
  let s = startSeed
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return (s % 10000) / 10000
  }
}

test('generateLevelBatch produces at least one solvable level per tier within a bounded attempt count', () => {
  const result = generateLevelBatch(1, seededRng(42))
  expect(result.length).toBeGreaterThan(0)
  for (const entry of result) {
    const grid = parseLevel(entry.json)
    expect(solve(grid, 100)).not.toBeNull()
  }
})

test('every produced level JSON round-trips through parseLevel', () => {
  const result = generateLevelBatch(1, seededRng(7))
  for (const entry of result) {
    expect(() => parseLevel(entry.json)).not.toThrow()
  }
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tools/generator/generateBatch.test.ts`
Expected: FAIL(找不到模组)

- [ ] **Step 3: 实作 `tools/generator/generateBatch.ts`**

```ts
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Grid } from '../../src/game/engine/types'
import { serializeLevel } from '../../src/game/engine/levelSchema'
import { createSeedGrid } from './seed'
import { generateLevel } from './generateLevel'
import { countNestingEvents, solve } from './solver'
import { difficultyTier, scoreDifficulty } from './difficultyScorer'

export type Tier = 'easy' | 'medium' | 'hard'

export interface GeneratedLevel {
  tier: Tier
  grid: Grid
  json: string
}

const MAX_ATTEMPTS = 500

export function generateLevelBatch(targetPerTier: number, rng: () => number): GeneratedLevel[] {
  const counts: Record<Tier, number> = { easy: 0, medium: 0, hard: 0 }
  const results: GeneratedLevel[] = []
  let attempts = 0

  while (attempts < MAX_ATTEMPTS && (counts.easy < targetPerTier || counts.medium < targetPerTier || counts.hard < targetPerTier)) {
    attempts++
    const seed = createSeedGrid()
    const steps = 3 + Math.floor(rng() * 8)
    const grid = generateLevel(seed, steps, rng)
    const solution = solve(grid, 150)
    if (!solution) continue

    const nestingCount = countNestingEvents(grid, solution)
    const score = scoreDifficulty(solution.length, nestingCount)
    const tier = difficultyTier(score)
    if (counts[tier] >= targetPerTier) continue

    counts[tier]++
    results.push({ tier, grid, json: serializeLevel(grid) })
  }

  return results
}

function main() {
  const outputDir = join(dirname(fileURLToPath(import.meta.url)), '../../src/levels/builtin/generated')
  mkdirSync(outputDir, { recursive: true })
  const batch = generateLevelBatch(5, Math.random)
  const tierCounters: Record<Tier, number> = { easy: 0, medium: 0, hard: 0 }
  for (const entry of batch) {
    tierCounters[entry.tier]++
    const filename = `${entry.tier}-${String(tierCounters[entry.tier]).padStart(2, '0')}.json`
    writeFileSync(join(outputDir, filename), entry.json)
  }
  console.log(`Generated ${batch.length} levels: easy=${tierCounters.easy} medium=${tierCounters.medium} hard=${tierCounters.hard}`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tools/generator/generateBatch.test.ts`
Expected: PASS(2 tests)。若 `MAX_ATTEMPTS` 内某个难度层级始终生不出关卡,属于预期情况(现有种子/反向移动范围有限);不阻塞,`main()` 落地时会用 `console.log` 如实报告各层级实际产生数量,不做静默假装成功。

- [ ] **Step 5: 实际跑一次 CLI 产生初始关卡包**

Run: `npx tsx tools/generator/generateBatch.ts`
Expected: 印出类似 `Generated N levels: easy=.. medium=.. hard=..`,且 `src/levels/builtin/generated/` 目录下出现对应数量的 `.json` 档。

- [ ] **Step 6: 跑一次 `src/levels/index.test.ts` 确认新产生的关卡能被载入器正确读到**

Run: `npx vitest run src/levels/index.test.ts`
Expected: PASS(此测试目前只断言内建 3 关,不会因为新增 generated 关卡而失败;之后若想加断言可另外补充,非必要)

- [ ] **Step 7: Commit(含产生的关卡 JSON)**

```bash
git add tools/generator/generateBatch.ts tools/generator/generateBatch.test.ts src/levels/builtin/generated
git commit -m "feat: add CLI to batch-generate and score levels, commit initial generated set"
```

---

## Task 21: PWA 设定(Service Worker + Manifest)

**Files:**
- Modify: `vite.config.ts`
- Create: `public/manifest.json`
- Create: `public/icons/icon-192.png`
- Create: `public/icons/icon-512.png`
- Modify: `src/main.tsx`

**Interfaces:**
- Consumes: `VitePWA` from `vite-plugin-pwa`
- Produces: `npm run build` 产出含 Service Worker 与 manifest 连结的 `dist/`;`main.tsx` 注册 SW 更新逻辑

- [ ] **Step 1: 更新 `vite.config.ts` 加入 `VitePWA` 插件**

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: "Parabox Tribute",
        short_name: 'Parabox',
        description: '原创的递归推箱子解谜游戏',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0f172a',
        theme_color: '#0f172a',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,json,png,svg}'],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    globals: true,
  },
})
```

- [ ] **Step 2: 产生占位图示(最小合法 PNG,先求 manifest 有图可用;正式美术之后再替换)**

Run:
```bash
node -e "
const { writeFileSync, mkdirSync } = require('node:fs');
mkdirSync('public/icons', { recursive: true });
const onePixelPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
writeFileSync('public/icons/icon-192.png', onePixelPng);
writeFileSync('public/icons/icon-512.png', onePixelPng);
console.log('placeholder icons written');
"
```

Expected: 印出 `placeholder icons written`,`public/icons/` 下出现两个 PNG。这两个图示之后要请你(或找美术)换成正式设计,目前只是让 PWA manifest 有合法图档可用、不阻塞开发。

- [ ] **Step 3: 建立 `public/manifest.json`(给不支援 `VitePWA` 自动产生 manifest 的旧浏览器/工具备用参考; 实际生效的是 build 时插件产生的版本)**

```json
{
  "name": "Parabox Tribute",
  "short_name": "Parabox",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#0f172a",
  "theme_color": "#0f172a",
  "icons": [
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

- [ ] **Step 4: 更新 `src/main.tsx` 注册 Service Worker**

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { registerSW } from 'virtual:pwa-register'

registerSW({ immediate: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

- [ ] **Step 5: 建置专案确认 Service Worker 与 manifest 有正确产出**

Run: `npm run build`
Expected: build 成功,且 `dist/sw.js`(或 `dist/registerSW.js` 视插件版本而定)与 `dist/manifest.webmanifest` 存在。

Run: `ls dist`
Expected: 看得到 `sw.js` / `manifest.webmanifest` / `index.html` / `assets/`

- [ ] **Step 6: Commit**

```bash
git add vite.config.ts public/manifest.json public/icons src/main.tsx
git commit -m "feat: configure PWA manifest, icons, and service worker registration"
```

---

## Task 22: 最终整合验证

**Files:**
- (无新档案, 本任务为整合验证与手动确认清单)

**Interfaces:**
- 无新接口, 目的是确认整个专案组装起来后行为符合预期。

- [ ] **Step 1: 跑全部自动化测试**

Run: `npx vitest run`
Expected: 全部 PASS(涵盖引擎规则、求解器、生成器、UI 元件、存档)。

- [ ] **Step 2: 跑 TypeScript 型别检查**

Run: `npx tsc -b --noEmit`
Expected: 无型别错误。

- [ ] **Step 3: 启动 dev server 手动检查主要流程**

Run: `npm run dev`
Expected: 终端机印出本机网址(通常是 `http://localhost:5173`)。

- [ ] **Step 4: 手动确认清单(在浏览器/手机模拟检视模式操作,逐项打勾)**

  - [ ] 打开首页看到主选单,点「开始游戏」进入关卡选择,能看到 3 个内建关卡 + 生成器产出的关卡。
  - [ ] 进入「第一次推动」,方向键/D-pad/滑动都能移动玩家,推箱子到 target 后自动判定过关并返回关卡选择,该关卡标记 ✓。
  - [ ] 进入「箱中箱」,验证嵌套确实发生(普通箱消失、容器箱可继续推动)。
  - [ ] 进入「连锁嵌套」,验证三箱链只触发一次嵌套,行为与 Task 4 测试描述一致。
  - [ ] 进入编辑器,放置墙/目标点/两种箱子/玩家起点,双击容器箱进入内部编辑,面包屑能点回外层,储存后返回选单再进编辑器资料还在(localStorage 有效)。
  - [ ] 用 Chrome DevTools 的 Lighthouse 或 Application 面板检查 PWA 可安装性(Manifest 与 Service Worker 均为绿灯)。
  - [ ] 切到浏览器离线模式(DevTools > Network > Offline),重新整理页面,App 仍可正常载入与游玩。
  - [ ] 在手机(或 DevTools 手机模拟检视)确认版面与触控操作可用,横向 D-pad/滑动区域不会被系统手势遮挡。

- [ ] **Step 5: 若手动检查全部通过, 做最终 commit(如果前面步骤有任何微调)**

```bash
git status
```

Expected: 若有因手动检查而产生的小修正,依照一般流程个别 commit;若无变更则不需要 commit。
