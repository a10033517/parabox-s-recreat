# Parabox PWA — Solver & Level Generator Design Review

> Review target: `2026-09-05-parabox-solver-generator-design.md`  
> Review scope: internal consistency, algorithmic correctness, generation guarantees, solver correctness, difficulty measurement, testing completeness, and implementation risks.  
> This review is grounded in the supplied design document. Engine-specific claims that require the actual `rules.ts` / `types.ts` implementation are explicitly marked for verification.

---

## 1. Executive summary

這份設計的整體方向是合理的：

- 以「已解狀態 → 反向走」產生關卡。
- 用 BFS 對目前的 `World` / `applyMove` / `checkWin` 求解。
- 用 solution path 中的 board crossing 數量衡量進階 mechanic 的使用。
- 產生後再依 solution 的最短步數與 mechanic event 數量分級。
- 由 `loadGeneratedLevels()` 載入產生的 JSON。

但是目前**不建議直接照原 spec 實作**。主要問題不是架構本身，而是有幾個會影響「生成結果是否真的符合規格」的邏輯缺口。

### 必修正

1. **`inversePush` 的定義過寬**：目前會把任何同 board 的 piece chain 當成普通 push，卻沒有確認 `applyMove()` 對該 chain 真的會採取普通 push。
2. **`inverseEnter` / `inverseEat` 是否真的與 forward mechanic 一一對應，不能只靠文字推導**；必須用目前 engine 的 `applyMove()` 做 round-trip 驗證，而且測試必須覆蓋「不應匹配」的邊界。
3. **`generateLevel()` 可能沒有完成要求的 `steps` 卻照樣回傳**。目前 `maxAttempts` 到達後沒有錯誤，也沒有回報實際完成幾步。
4. **`generateLevel()` 的 `steps` 不等於關卡的實際解題難度**：reverse walk 可以重複狀態、互相抵消，也可能大量使用單純 walk，因此應明確把 `generationSteps` 與 `optimalSolutionLength` 分開。
5. **Batch generation 沒有保證真的產生 `targetPerTier` 個關卡**。500 次失敗後直接回傳不足數量，`main()` 仍會印出成功生成。
6. **沒有防止重複 / 近似重複關卡**。同一 seed + random walk 很容易產生等價或高度相似的 level。
7. **difficulty tier 的 hard 閾值與 generation 上限沒有做 feasibility analysis**。目前每個 level 最多 10 次 reverse step，因此 hard 主要依賴至少 3 次 board-crossing；這是否在 500 attempts 內穩定產生，spec 沒有證明。
8. **`countBoardCrossings()` 的定義需要更精確**：它現在是「一個 move 只要任一 piece 改變 board 就算 1」，這是可以採用的 metric，但它不等於「enter/eat 次數」。spec 不應把兩者混稱。
9. **`JSON.stringify(world)` 不能直接稱為 canonical state，除非確認 `World` 的所有等價狀態都具有穩定且一致的 object ordering / representation。** 最好建立明確的 canonical serializer。
10. **測試不足以證明 generator 真的產生可玩且符合難度要求的 level**。目前多數測試只測「函式跑得通」，缺少 end-to-end invariants。

---

# 2. 逐段檢查

## 2.1 Research basis

原文的結論是：

> reverse-generation-from-a-solved-state 已被 Sokoban 文獻與其他 generator 驗證，因此「No reason to change strategy」。

### 問題

這個引用只能支持：

> 「從 solved state 反向產生 puzzle 是一個合理的 generation strategy。」

不能直接支持：

> 「這套三種 `inversePush` / `inverseEnter` / `inverseEat` 的具體逆運算是正確的。」

Sokoban 的 reverse generation 與 Parabox 的 nested-board mechanics 並不是同一個 transition system。

### 建議修改

把結論改成：

> Reverse generation is retained as the generation strategy because it guarantees that every accepted reverse step is intended to correspond to a reachable forward move. However, the correctness of each Parabox-specific inverse must be established against the current engine's `applyMove()` by round-trip tests; Sokoban literature only validates the general generation strategy, not these engine-specific inverse functions.

另外：

> 「most-cited approach in the field」

不是這份 implementation spec 必須依賴的論點，而且若沒有正式 bibliography，容易變成不可驗證的敘述。建議刪掉「most-cited」。

---

# 3. `inversePush` — 最大的邏輯風險之一

目前：

```ts
while (inBounds(board, cursor.x, cursor.y)) {
  const occupant = occupantAt(world, { board: loc.board, x: cursor.x, y: cursor.y })
  if (!occupant) break
  chain.push(occupant)
  cursor = step(cursor.x, cursor.y, dir)
}
```

然後直接把整條 chain 往後移。

## 問題 1：它沒有確認 chain 是「可普通 push 的 chain」

`occupantAt()` 找到 piece 不代表 forward `applyMove()` 一定會把這個 piece 往前推。

尤其這個 engine 有：

- container
- enter
- eat
- nested boards

所以：

```text
player → piece → piece → empty
```

並不必然代表：

```text
applyMove(player, dir)
```

就是「所有 piece 同時前進一格」。

### 必修正

`inversePush()` 不應只根據幾何位置判斷。

最安全的規格是：

1. 建立候選 predecessor。
2. 執行：

```ts
const result = applyMove(candidate, dir)
```

3. 只有：

```ts
result !== null
&& canonicalKey(result) === canonicalKey(world)
```

才接受。

這會讓 `applyMove()` 成為唯一 forward oracle，而不是讓 inverse implementation 自己重新複製 engine 規則。

---

## 問題 2：`chain` 可以是 0

原 spec 明確允許：

> a chain of 0 is just the player walking into empty space

這在技術上可以是合法 inverse，但對 generator 很重要：

### 後果

`generateLevel()` 的一個「generation step」可能只是：

```text
player A
→
player B
```

完全沒有改變 puzzle structure。

因此：

```ts
steps = 10
```

不代表真的做了 10 個有意義的逆操作。

### 建議

把兩種概念分開：

```ts
generationSteps
structuralSteps
```

至少應記錄每個 reverse step 是：

```ts
'push'
'enter'
'eat'
```

而不是單純 `applied++`。

如果 generator 的目標是產生 puzzle complexity，建議設定：

```ts
minStructuralSteps
```

例如至少要求一定數量的 push / enter / eat。

---

# 4. `inverseEnter`

目前的核心判斷：

```ts
const { cell } = getEntryCell(board, dir, HALF)
if (cell === null || cell.x !== loc.x || cell.y !== loc.y) return null
```

這個設計的想法是合理的：從 interior state 找出玩家由哪個方向進入。

但有兩個問題。

## 問題 1：方向語意必須用 forward oracle 驗證

這裡最容易出現：

```text
getEntryCell(board, dir)
```

和：

```text
applyMove(parent, dir)
```

的方向定義相反或偏移一格。

spec 現在把：

> `getEntryCell` run backward-as-a-lookup

當成已確定事實，但沒有提供 engine 的實際定義。

### 必修正

測試必須至少包含：

```ts
const predecessor = ...
const post = applyMove(predecessor, dir)

expect(post).toEqual(world)
```

並且四個方向都要測：

```text
up
down
left
right
```

不能只測單一方向。

---

## 問題 2：只用 `findContainerFor(world, loc.board)` 不一定足夠

如果 engine 未來允許：

- 同一 interior board 被多個 container reference
- 或 board identity / container identity 有其他限制

那：

```ts
findContainerFor()
```

找到的 container 是否就是 forward move 的那一個，需要由 engine invariant 保證。

### 建議

在 spec 裡明確寫：

> `findContainerFor(world, loc.board)` must be guaranteed to return the unique containing container for every reachable non-root board.

如果目前 engine 已經有這個 invariant，就把它列入測試。

---

# 5. `inverseEat`

這一段需要特別修正文字。

目前寫：

> blocked by a wall directly behind it

但程式：

```ts
const behindContainerWall = step(containerPos.x, containerPos.y, dir)
```

其實是在**container 的前方 / push direction**。

也就是：

```text
player → container → wall
         dir →
```

不是一般語意中的「behind container」。

### 建議改名

```ts
const wallAhead = step(containerPos.x, containerPos.y, dir)
```

並把文字改成：

> player → container → wall, with the wall immediately ahead of the container in the push direction.

這會比 `behindContainerWall` 清楚很多。

---

## 問題 2：`eatenId` 的類型沒有驗證

目前：

```ts
const eatenId = occupantAt(...)
if (!eatenId) return null
```

但沒有確認 eaten piece 是否是 `applyMove()` 所允許被 eat 的 piece。

如果 engine 對：

- player
- container
- 某些特殊 piece

有額外規則，這裡可能產生一個幾何上看似合理、forward engine 卻不接受的 predecessor。

### 建議

同樣採用：

```ts
candidate → applyMove(candidate, dir) → world
```

作為最終驗證。

---

## 問題 3：`world.boards[container.boardRef as string]` 不應靠 cast 掩蓋 invariant

目前：

```ts
const interior = world.boards[container.boardRef as string]
```

如果 `boardRef` 在 type level 本來就是 optional，這裡應該明確處理不存在：

```ts
if (!container.boardRef) return null
const interior = world.boards[container.boardRef]
if (!interior) return null
```

如果 `container` 的 type 已經保證 `boardRef` 存在，則不需要 `as string`。

### 建議

不要用 cast 來掩蓋資料驗證。

---

# 6. 三個 inverse function 的共同設計應修改

目前 spec 是：

```text
手算 inverse
↓
相信 inverse 正確
```

建議改成：

```text
手算候選 predecessor
↓
檢查 candidate 的基本 invariant
↓
applyMove(candidate, dir)
↓
canonical(result) === canonical(world)
↓
成功才 return candidate
```

這樣 inverse function 的責任變成：

> 找一個 candidate predecessor。

而不是：

> 自己完整重現 forward engine 的所有規則。

這可以大幅降低 engine rule 演進後 generator 再次失同步的風險。

---

# 7. `generateLevel()` — steps 保證不足

目前：

```ts
while (applied < steps && attempts < maxAttempts) {
```

最後直接：

```ts
return world
```

因此可能：

```text
requested steps = 10
applied steps = 4
attempts = 200
```

最後還是正常回傳。

這會讓 caller 誤以為得到「10-step generated level」。

## 必修正

推薦：

```ts
export interface GenerationResult {
  world: World
  appliedSteps: number
  events: GenerationEvent[]
}
```

如果要求一定完成：

```ts
if (applied < steps) {
  throw new Error(...)
}
```

或者讓 caller 決定：

```ts
return null
```

至少不能無聲失敗。

---

# 8. Reverse walk 必須避免自我抵消

現在 generator 可以：

```text
A → B → A
```

甚至：

```text
A → B → C → B → A
```

因此：

```ts
steps = 10
```

可能最後只留下非常淺的 puzzle。

### 建議

至少加入：

```ts
visitedGenerationStates
```

避免重新產生最近已出現的 state。

更簡單可以先禁止：

```text
immediate inverse move
```

但這只能防止最直接的：

```text
A → B → A
```

不能防止更長的 cycle。

比較好的方法是：

```ts
const seen = new Set<string>()
seen.add(canonicalKey(seed))
```

每次 candidate：

```ts
if (seen.has(key)) reject
```

---

# 9. Generator 應該記錄 mechanic event

目前：

```ts
let applied = 0
```

不足以知道生成品質。

建議：

```ts
type GenerationEvent =
  | { kind: 'push'; direction: Direction }
  | { kind: 'enter'; direction: Direction }
  | { kind: 'eat'; direction: Direction }
```

然後：

```ts
interface GenerationResult {
  world: World
  events: GenerationEvent[]
}
```

這能讓測試直接確認：

```text
至少 1 enter
至少 1 eat
至少 N structural operations
```

也可以分析：

```text
requested steps
successful steps
unique states
push count
enter count
eat count
```

---

# 10. `solver.ts` — BFS 整體合理，但 canonical state 要修

目前：

```ts
function canonicalKey(world: World): string {
  return JSON.stringify(world)
}
```

## 問題

`JSON.stringify()` 是 serialization，不等於 canonicalization。

如果兩個 semantic-equivalent World：

```ts
A = { pieces: ..., locations: ... }
B = { locations: ..., pieces: ... }
```

在 object insertion order 上不同：

```ts
JSON.stringify(A) !== JSON.stringify(B)
```

即使它們代表相同 state。

### 建議

建立真正的 canonical serializer。

例如固定：

```text
boards
pieces
locations
```

的順序，並對 dynamic maps 的 keys：

```ts
Object.keys(...).sort()
```

後再輸出。

---

# 11. Solver 必須區分「找不到」與「超過 maxDepth」

目前：

```ts
return null
```

同時表示：

1. puzzle 無解
2. puzzle 有解但超過 `maxDepth`
3. search 因其他限制沒找到

這在 batch generator 很重要。

目前：

```ts
const solution = solve(world, 150)
if (!solution || solution.length === 0) continue
```

會把三種情況全部當成同一種。

### 建議

至少定義：

```ts
type SolveResult =
  | { status: 'solved'; moves: Direction[] }
  | { status: 'depth-limit' }
  | { status: 'exhausted' }
```

如果保持 `Direction[] | null` API，也應在 spec 明確寫：

> `null` means "no solution found within maxDepth", not necessarily mathematically unsolvable.

---

# 12. BFS memory design

目前 frontier 裡保存：

```ts
{ world, path }
```

每產生一個 node 都：

```ts
const newPath = [...path, direction]
```

對小 puzzle 可以接受，但 state space 一大會產生大量 array duplication。

### 建議

如果目前 Parabox level 很小，可以保留。

但 spec 應把它寫成：

> acceptable for current generator bounds; not intended as a general-purpose large-state solver.

如果未來 level 變大，再改成 predecessor map：

```text
visited state
→ parent state
→ move used
```

最後再回溯 solution。

---

# 13. `countBoardCrossings()` — 名稱可以，但語意要更精確

目前：

```ts
if (current.locations[pieceId].board !== next.locations[pieceId].board) {
  count++
  break
}
```

它實際計算的是：

> number of moves during which at least one piece changed board.

不是：

> number of board crossings.

因為一次 move 如果兩個 piece 同時跨 board，它仍然只算 1。

這是可以接受的 metric，但應明確命名。

### 建議二選一

如果想保留現在的 semantics：

```ts
countBoardCrossingEvents()
```

或：

```ts
countCrossingMoves()
```

如果真的想算 crossing 次數：

```ts
countBoardCrossings()
```

應該每個 piece 都：

```ts
count++
```

不要 `break`。

目前設計其實比較接近：

```ts
countCrossingMoves
```

---

# 14. Difficulty metric 的核心問題

目前：

```ts
score = moveCount + boardCrossingCount * 5
```

這個 metric 可以使用，但要注意：

> `moveCount` 是 optimal solution length，`boardCrossingCount` 也是 optimal solution 上的 event 數。

這很好，但前提是 BFS 找到的 solution 真的是 optimal。

BFS 在：

```text
每個 move cost = 1
```

的情況下可以保證 shortest path。

所以 spec 應明確寫：

> Because BFS explores moves in unit-cost order, the first returned solution is shortest in move count. The difficulty score therefore uses optimal move count, subject to the solver's `maxDepth`.

### 重要限制

如果真正 shortest solution：

```text
> maxDepth
```

那：

```ts
solve() === null
```

level 就直接被丟掉。

因此 `maxDepth = 150` 其實是 generator 的 hidden difficulty ceiling。

---

# 15. Hard tier 的 feasibility 沒有證明

目前：

```ts
score = moveCount + boardCrossingCount * 5
```

```ts
hard >= 25
```

而：

```ts
steps = 3 + floor(rng() * 8)
```

所以：

```text
3 ≤ steps ≤ 10
```

如果 optimal solution 不會比 reverse generation steps 更長，則 hard 至少需要：

```text
moveCount + 5 * crossingCount >= 25
```

例如：

```text
10 moves + 3 crossings = 25
```

但如果 reverse walk 很容易產生：

```text
8 moves + 0 crossings
```

那 hard 幾乎不會出現。

### 建議

在 spec 中加入 generation feasibility：

```text
Target:
easy:  ...
medium: ...
hard: ...
```

並透過 prototype / telemetry 統計：

```text
attempts
accepted
discarded
tier distribution
average solution length
average crossing count
```

否則 `targetPerTier = 5` 只是希望，而不是保證。

---

# 16. Batch generation 有明確 correctness bug

目前：

```ts
const MAX_ATTEMPTS = 500
```

到達 500 後：

```ts
return results
```

但沒有檢查：

```ts
counts.easy === targetPerTier
counts.medium === targetPerTier
counts.hard === targetPerTier
```

所以可能只產生：

```text
easy = 5
medium = 5
hard = 1
```

然後：

```ts
console.log(`Generated 11 levels...`)
```

看起來像成功，但實際上 batch 不符合要求。

## 必修正

```ts
const complete =
  counts.easy >= targetPerTier &&
  counts.medium >= targetPerTier &&
  counts.hard >= targetPerTier

if (!complete) {
  throw new Error(
    `Could not generate requested batch: ...`
  )
}
```

或者回傳：

```ts
{
  levels,
  complete: false,
  counts
}
```

讓 caller 明確處理。

---

# 17. Batch generation 沒有 duplicate detection

目前每個 accepted level 都直接：

```ts
results.push(...)
```

沒有：

```ts
seenLevels
```

因此可能產生：

```text
easy-01 == easy-02
```

或 semantic-equivalent levels。

### 建議

用 canonical state：

```ts
const levelKey = canonicalKey(world)
if (seenLevels.has(levelKey)) continue
seenLevels.add(levelKey)
```

如果要更強，可以同時去除：

- 完全相同
- player-only relocation
- symmetry-equivalent

但 symmetry 可以先不做，避免過度複雜。

---

# 18. `steps` 與 optimal solution 的關係要寫清楚

目前容易讓讀者誤以為：

```text
reverse 10 steps
=
10-step puzzle
```

這是不成立的。

例如 reverse walk：

```text
A → B → C → B
```

最後的 B 可能距離 solved state 只有 1 move。

因此真正應該寫：

```text
generationSteps ≠ optimalSolutionLength
```

Generator 的 `steps` 只是：

> number of accepted reverse transitions attempted during construction.

Difficulty 則使用：

> optimal forward solution length.

---

# 19. Seed design 的驗證責任不足

目前 seed：

```text
root 7×7
goal container
goal requirement
goalInside 3×3
```

並宣稱：

> seed genuinely satisfies checkWin

這不能只靠資料結構推斷。

### 必修正

`createSeedWorld()` 的 test 必須：

```ts
const seed = createSeedWorld()
expect(checkWin(seed)).toBe(true)
```

而不是只測：

```ts
expect(seed).toEqual(...)
```

這是整個 reverse-generation correctness 的起點。

---

# 20. `generateLevel.test.ts` 現在的測試太弱

目前：

> generated world differs from seed

這不足夠。

因為「不同」不代表：

> 每一步都是 forward-valid 的逆操作。

### 建議改成 property test

Generator 應回傳 events / intermediate states：

```ts
seed
→ S1
→ S2
→ ...
→ Sn
```

每一步都驗證：

```ts
applyMove(S[i], event.direction)
  === S[i - 1]
```

這才真正證明 reverse generator 產生的是 reachable state。

---

# 21. `generateBatch.test.ts` 的 solved-level 測試不應只測特例

目前要求：

> construct a seed/step combination that reverse-walks back to a solved state

這可以測，但還不夠。

應直接測：

```text
任何 accepted level:
    checkWin(level) === false
```

因為 generator 的最終 contract 就是：

> produce an unsolved playable level.

---

# 22. `levels/index.ts`

這一段本身方向合理：

```ts
const generatedModules = import.meta.glob(
  './builtin/generated/*.json',
  {
    query: '?raw',
    import: 'default',
    eager: true
  }
)
```

但測試應確認的不只是「可以 parse」。

還要確認：

```text
generated JSON
→ JSON.parse
→ parseLevel
→ World
→ checkWin === false
```

並確認：

```ts
loadGeneratedLevels()
```

沒有：

- duplicate IDs
- malformed JSON
- unexpected empty collection

如果 generated folder 可以為空，則 empty collection 是否合法也要明確定義。

---

# 23. Generator output filename 的問題

目前：

```ts
easy-01.json
medium-01.json
hard-01.json
```

每次執行 generator 都會從 01 開始。

這表示如果 output directory 已經有舊檔案：

```text
easy-01.json
...
easy-05.json
```

再次執行可能覆寫它們。

### 必須明確選一個 policy

### Option A — generator 先清空 output directory

適合「重新生成整批 builtin levels」。

### Option B — generator 產生 unique filenames

適合 append model。

目前看起來比較像 Option A，因此建議在 spec 明確寫：

```text
Before writing a batch, remove existing generated/*.json.
```

並測試。

---

# 24. `serializeLevel()` 的假設應降低耦合

目前 spec 強依賴：

> `serializeLevel(world)` currently returns structuredClone(world)

如果 `serializeLevel()` 的 contract 本來就是 serialization abstraction，未來很容易改成：

```ts
serializeLevel(world): string
```

而 generator 又壞掉。

### 建議

不要讓 generator 猜 `serializeLevel()` 的 return type。

最好統一 contract：

```ts
serializeLevel(world): SerializableLevel
```

再：

```ts
JSON.stringify(serializeLevel(world))
```

或者：

```ts
serializeLevel(world): string
```

然後所有 caller 統一。

重點是：**由 API contract 定義，而不是在 generator spec 中記住目前 implementation。**

---

# 25. Recommended architecture

建議最終 pipeline 改成：

```text
createSeedWorld()
       │
       ▼
reverse generator
       │
       ├── candidate predecessor
       │
       ├── applyMove(candidate, dir)
       │        │
       │        └── must equal current state
       │
       ├── reject duplicate state
       │
       └── record GenerationEvent
       │
       ▼
generated World
       │
       ├── checkWin(world) === false
       │
       ▼
BFS solver
       │
       ├── solved
       ├── depth-limit
       └── exhausted
       │
       ▼
optimal solution
       │
       ├── moveCount
       └── crossing-event count
       │
       ▼
difficulty score / tier
       │
       ├── duplicate check
       └── tier quota check
       │
       ▼
serialize
       │
       ▼
generated/*.json
```

---

# 26. Recommended revised interfaces

## `generateLevel.ts`

建議不要只回傳 `World`：

```ts
export type GenerationEvent = {
  kind: 'push' | 'enter' | 'eat'
  direction: Direction
}

export interface GenerationResult {
  world: World
  events: GenerationEvent[]
  appliedSteps: number
}
```

並保證：

```ts
result.appliedSteps === requestedSteps
```

否則回傳 `null` / throw。

---

## `solver.ts`

最低限度應保留：

```ts
export function solve(
  initialWorld: World,
  maxDepth = 200
): Direction[] | null
```

但 spec 必須明確定義：

> `null` means no solution was found within `maxDepth`; it does not prove mathematical unsolvability.

另外：

```ts
canonicalKey()
```

應變成真正 deterministic canonical serialization。

---

## Crossing metric

推薦：

```ts
export function countCrossingMoves(
  world: World,
  moves: Direction[]
): number
```

因為它的 semantics 正是：

> number of moves in which at least one piece changes board.

如果專案確實希望保留名稱 `countBoardCrossings`，則必須在文件中明確定義這個特殊語意。

---

# 27. Recommended test matrix

## Seed

```text
✓ createSeedWorld() is valid
✓ checkWin(seed) === true
✓ all referenced boards exist
✓ all referenced pieces exist
```

## inversePush

至少：

```text
✓ empty destination / walking
✓ one-piece push
✓ multi-piece push
✓ blocked destination → null
✓ blocked player-behind cell → null
✓ wall in chain → null
✓ container / special mechanic that is not ordinary push → null
✓ all four directions
✓ round-trip through applyMove
```

## inverseEnter

```text
✓ all four directions
✓ correct entry cell
✓ wrong entry cell → null
✓ root board → null
✓ invalid parent position → null
✓ occupied parent-behind cell → null
✓ round-trip through applyMove
```

## inverseEat

```text
✓ all four directions
✓ player → container → wall
✓ occupied interior entry cell
✓ no wall → null
✓ no eaten piece → null
✓ invalid interior board → null
✓ round-trip through applyMove
```

## Generator

```text
✓ steps = 0 returns seed
✓ exactly N steps are applied
✓ every reverse step round-trips through applyMove
✓ no generated state repeats
✓ final state is not solved
✓ event count matches applied steps
```

## Solver

```text
✓ solved → []
✓ one move → one direction
✓ BFS returns shortest solution
✓ state dedup works
✓ depth limit is respected
✓ invalid move is ignored
```

## Difficulty

```text
✓ score boundaries
✓ tier boundaries
✓ crossing count semantics
```

## Batch

```text
✓ exactly targetPerTier produced
✓ no duplicate level
✓ every level is unsolved
✓ every level is solvable
✓ every level belongs to correct tier
✓ failure to fill quotas is reported as failure
```

## Loading

```text
✓ generated JSON parses
✓ parseLevel accepts it
✓ returned level is playable
✓ returned level is unsolved
✓ IDs are unique
```

---

# 28. Implementation priority

如果要交給 Claude Code / developer 實作，建議順序：

### P0 — correctness blockers

1. 確認 `inversePush / inverseEnter / inverseEat` 對目前 `applyMove()` 的 round-trip。
2. 修正 `inversePush` 不應把特殊 mechanic 誤判成 ordinary push。
3. 修正 `generateLevel()` silent partial generation。
4. 修正 batch silent partial generation。
5. 建立 deterministic `canonicalKey()`。
6. 確認 seed `checkWin(seed) === true`。

### P1 — generation quality

7. 防止 generation state cycle / duplicate。
8. 記錄 generation events。
9. 明確區分 generation steps 與 optimal solution length。
10. 建立 hard-tier feasibility / generation statistics。
11. duplicate level detection。

### P2 — maintainability

12. `countBoardCrossings` 改成更精確的命名或重新定義。
13. 清楚定義 `solve(null)` 的 semantics。
14. 統一 `serializeLevel()` API contract。
15. 明確規定 generated output directory 的 overwrite policy。

---

# 29. 最重要的設計原則

這個 sub-project 最值得保留的核心原則是：

> **Forward engine is the source of truth.**

不要讓：

```text
applyMove()
```

和：

```text
inversePush()
inverseEnter()
inverseEat()
```

各自維護一套「我認為規則應該是什麼」。

正確關係應該是：

```text
              ┌───────────────┐
              │   applyMove   │
              │ source of truth│
              └───────┬───────┘
                      │
             round-trip oracle
                      │
        ┌─────────────┼─────────────┐
        ▼             ▼             ▼
 inversePush   inverseEnter   inverseEat
```

每一個 inverse function 只需要：

> 找出一個 candidate predecessor。

最後由：

```ts
applyMove(candidate, direction)
```

驗證它。

這樣即使之後 Sub-project 3 / 4 再修改 engine mechanics，也比較不容易出現「generator 看起來合理，但產生的 level 根本不是 engine 可以走到的 state」的問題。

---

# 30. Final verdict

| 部分 | 評價 | 動作 |
|---|---|---|
| Reverse-generation strategy | 🟢 合理 | 保留 |
| BFS solver | 🟢 基本合理 | 補 canonicalization / depth semantics |
| Difficulty formula | 🟡 可用 | 驗證 feasibility |
| `inversePush` | 🔴 風險高 | 必須由 forward oracle 驗證 |
| `inverseEnter` | 🟡 待驗證 | 四方向 round-trip |
| `inverseEat` | 🔴 風險高 | 修正文案 + round-trip + type validation |
| `generateLevel` | 🔴 有 silent partial bug | 必修 |
| Batch generation | 🔴 有 quota silent failure | 必修 |
| `countBoardCrossings` | 🟡 定義不精確 | 改名或重新定義 |
| `loadGeneratedLevels` | 🟢 方向合理 | 補 integration tests |
| Testing strategy | 🟡 不足 | 增加 property / end-to-end tests |
| Duplicate prevention | 🔴 缺失 | 建議加入 |
| Output overwrite policy | 🟡 未定義 | 明確規定 |

**結論：架構不用推翻，但這份 spec 目前比較像「implementation plan」，還不到可以直接當 correctness contract 的程度。**

尤其是：

> **inverse correctness、generation completion guarantee、batch quota guarantee、canonical state、difficulty feasibility**

這五項應在開始實作前先補齊。
