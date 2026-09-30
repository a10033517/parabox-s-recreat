# Parabox PWA — Core Engine Spec 修正事項

> 這份文件整理 `2026-09-04-parabox-official-engine-design.md` 在進入實作前建議修正的邏輯與資料模型問題。
>
> 目標：讓新的 Core Engine spec 與目前採用的 reference solver 模型一致，並避免後續實作出現隱含 invariant 或幾何計算錯誤。

---

## 1. 🔴 Board 資料模型：明確限制為正方形

### 目前問題

目前 `Board` 定義同時有：

```ts
interface Board {
  id: BoardId
  width: number
  height: number
  cells: Cell[][] // [y][x]
}
```

但目前的 fractional geometry 實際上大量以 `board.width` 作為單一尺寸使用，例如：

```ts
divideByInt(addInt(relativeCoord, offset), board.width)
```

以及：

```ts
const unit = makeFraction(1, board.width)
```

reference solver 的 board 幾何則是 square board，也就是 `width × width`。

因此目前 spec 宣稱支援 rectangular board，但 move-resolution 的幾何實際上並沒有完整支援 `width !== height`。

### 建議修改

如果本 sub-project 的目標是忠實對應 reference solver，建議直接將 Board 改成：

```ts
interface Board {
  id: BoardId
  size: number
  cells: Cell[][] // [y][x], exactly size × size
}
```

並明確加入 invariant：

```text
Every board is square:
width === height === size.
```

### 為什麼

這樣可以讓：

- `computeTarget()`
- `getEntryCell()`
- `relativeCoord`
- board boundary crossing

全部使用一致的幾何模型，也避免未來有人誤以為目前 engine 已經支援矩形 board。

### 實作要求

所有原本使用：

```ts
board.width
board.height
```

的地方，都應重新檢查。

如果改成 `size`：

```ts
board.size
```

則：

```ts
board.cells.length === board.size
board.cells[y].length === board.size
```

應視為必要 invariant。

---

## 2. 🔴 明確定義 Board ownership

### 目前問題

目前 `computeTarget()` 使用：

```ts
const containerId = findContainerFor(world, loc.board)
```

代表「離開某個 board 時，找到引用這個 board 的 container」。

但是 `Piece` 的資料模型：

```ts
interface Piece {
  id: PieceId
  kind: PieceKind
  boardRef?: BoardId
}
```

允許多個 container 同時引用同一個 `BoardId`。

如果：

```text
Container A → Board X
Container B → Board X
```

那麼：

```ts
findContainerFor(world, BoardX)
```

會無法唯一決定應該從哪一個 container 長出去。

### 建議修改

如果目前 engine 不打算支援 shared/cloned boards，請加入明確 invariant：

```text
World invariants:

- The root board is referenced by no container.
- Every non-root board is referenced by exactly one container.
- Every container.boardRef references an existing board.
- No two containers may reference the same BoardId.
```

也就是：

```text
root board
  └── no parent container

non-root board
  └── exactly one owning container
```

### `findContainerFor()` 要求

`findContainerFor(boardId)` 可以保留，但應該建立在上述 invariant 上。

如果實作時發現：

```text
0 containers reference board
```

或：

```text
2+ containers reference board
```

應視為 invalid world，而不是默默選第一個。

---

## 3. 🟠 `computeTarget()` 明確記錄目前沒有 orientation transformation

### 目前狀況

reference solver 在跨 board 時會處理 box orientation，例如 flipped/mirrored board 的方向轉換。

目前 spec 已經明確將：

- `FlippedHorizontal`
- `FlippedVertical`
- `FlippedBoth`

列為 out of scope。

因此目前：

```ts
return computeTarget(world, containerLoc, dir, newRelativeCoord)
```

直接沿用：

```ts
dir
```

是可以接受的。

### 建議修改

在 `computeTarget()` 附近加入：

```text
Orientation limitation:

Flipped/mirrored containers are out of scope for this sub-project.
Therefore board-boundary traversal currently preserves dir unchanged.

If orientation support is added later, the exit direction must be
transformed according to the container orientation, matching the
reference solver's flipIfNeeded behavior.
```

### 重要

這不是要求現在加入 flipped。

只是避免未來看到：

```ts
computeTarget(..., dir, ...)
```

時誤以為這已經完整支援所有官方 orientation。

---

## 4. 🟠 `getEntryCell()` 必須處理 boundary safety

### 目前問題

目前：

```ts
case 'left':
  return isZero(remainder)
    ? {
        cell: { x: board.width - 1, y: offset - 1 },
        newRelativeCoord: makeFraction(1, 1)
      }
    : {
        cell: { x: board.width - 1, y: offset },
        newRelativeCoord: scaled
      }

case 'right':
  return isZero(remainder)
    ? {
        cell: { x: 0, y: offset - 1 },
        newRelativeCoord: makeFraction(1, 1)
      }
    : {
        cell: { x: 0, y: offset },
        newRelativeCoord: scaled
      }
```

其中：

```ts
offset - 1
```

理論上可能得到：

```ts
-1
```

目前 spec 依賴「valid board 不會發生」的假設，但最好不要讓 array access 依賴這個假設。

### 建議修改

`getEntryCell()` 回傳結果後，應驗證：

```ts
inBounds(board, cell.x, cell.y)
```

如果超出範圍：

```ts
return {
  cell: null,
  newRelativeCoord: ...
}
```

並讓 type 明確表達：

```ts
{ cell: { x: number; y: number } | null; newRelativeCoord: Fraction }
```

`tryEnter()` 已經有：

```ts
if (cell === null) return null
```

因此可以自然接上這個安全檢查。

---

## 5. 🟡 明確定義 `box` requirement 的語義

### 目前實作

目前：

```ts
if (cell.requirement === 'box' && occupant.kind === 'player') {
  return false
}
```

代表：

```text
normal      → satisfies box
container   → satisfies box
player      → does not satisfy box
```

也就是：

```text
box = any non-player piece
```

### 建議修改文件文字

將：

```text
requirement: 'box' is satisfied by any non-player piece
```

改得更明確，例如：

```text
requirement: 'box' is satisfied by any supported non-player piece.
Currently this means kind === 'normal' or kind === 'container'.
Future piece kinds must explicitly define whether they satisfy this requirement.
```

這可以避免未來新增 piece kind 後，因為「只要不是 player 就算 box」而產生意外行為。

---

# 6. 🟢 不需要修改：Push → Enter → Eat

目前：

```ts
// 1. push
const pushed = tryMovePiece(...)

// 2. enter
const entered = tryEnter(...)

// 3. eat
const eaten = tryEnter(...)
```

這個順序應保留。

邏輯為：

```text
piece 被擋住
    ↓
1. 嘗試 push occupant
    ↓ push 成功
    └── move 成功

push 失敗
    ↓
2. 嘗試讓 piece enter occupant
    ↓ 成功
    └── move 成功

enter 失敗
    ↓
3. 嘗試讓 occupant eat into piece
    ↓ 成功
    └── move 成功

全部失敗
    ↓
move fail
```

不要把 enter 放到 push 前面，也不要在 push 失敗後直接進入 eat。

---

# 7. 🟢 不需要修改：`inMotion` loop detection

目前：

```ts
const already = inMotion.get(pieceId)

if (already !== undefined) {
  return already === dir ? world : null
}
```

邏輯應保留：

```text
same piece + same direction
    → consistent loop
    → succeed / no-op for this recursion

same piece + conflicting direction
    → invalid/conflicting loop
    → entire move fails
```

這與 reference solver 的 loop handling 相符。

---

# 8. 🟢 不需要修改：`beingEntered` 的 eat reset

目前：

```ts
const eaten = tryEnter(
  world,
  occupantId,
  pieceId,
  opposite(dir),
  HALF,
  nextInMotion,
  new Set(),
)
```

這裡：

```ts
new Set()
```

應保留。

原因是 eat 是一個新的「occupant 進入 mover」resolution，而不是原本 mover 的 enter chain 繼續向下。

不要改成：

```ts
nextBeingEntered
```

否則可能把兩個邏輯上獨立的 enter chain 錯誤地綁在一起。

---

# 9. 🟢 不需要修改：Fraction / HALF 的整體設計

目前：

```ts
const HALF: Fraction = makeFraction(1, 2)
```

以及：

```ts
relativeCoord
```

一路傳遞到：

```text
computeTarget
    ↓
resolveBlocked
    ↓
tryEnter
    ↓
getEntryCell
```

這個設計應保留。

尤其不要把它簡化成：

```ts
number
```

因為：

```text
1/2
1/3
2/5
...
```

等 exact boundary 情況需要可靠判斷：

```ts
remainder === 0
```

浮點數可能產生誤差。

---

# 10. 建議新增的測試

除了目前已有的 fixture tests，建議新增以下測試。

## 10.1 Board invariant

測試建立 world 時：

```text
- root board 沒有 owner
- non-root board 有且只有一個 owner
- dangling boardRef 被拒絕
- duplicate board ownership 被拒絕
```

---

## 10.2 Rectangular board rejection

如果採用 square-board 設計：

```text
Board 4×4 → valid
Board 5×5 → valid
Board 4×5 → invalid
```

避免未來誤把 rectangular board 傳入 engine。

---

## 10.3 Cross-board occupied entry

這個非常重要。

建立一個會發生：

```text
A board
  ↓ exit
parent board
  ↓ enter
B board
  ↓
B 的 entry cell 有 C
  ↓
C 還可以被 push / enter / eat
```

的 fixture。

這可以一次驗證：

- fractional offset
- board exit
- board entry
- recursive push
- recursive enter
- eat
- `beingEntered`
- `inMotion`

---

## 10.4 Boundary entry safety

特別測：

```text
relativeCoord = exact integer boundary
```

並驗證 `getEntryCell()` 不會產生：

```text
x = -1
y = -1
```

或任何超出 board 範圍的 cell。

---

# 11. 建議直接修改後的 Architecture Invariants

可以在 Architecture section 後新增：

```text
## World invariants

The engine assumes the following invariants:

1. Exactly one piece has kind === 'player'.

2. Every board is square:
   board.cells.length === board.size
   board.cells[y].length === board.size

3. The root board is not referenced by any container.

4. Every non-root board is referenced by exactly one container.

5. Every container.boardRef points to an existing board.

6. No two containers reference the same BoardId.

7. Every piece has exactly one valid location.

8. No two pieces occupy the same (board, x, y) cell.

9. normal pieces have no boardRef.

10. container pieces always have a valid boardRef.

11. Flipped/mirrored container orientation is not supported by this
    sub-project; board-boundary traversal therefore preserves direction.
```

---

# 最終修改優先級

## 🔴 實作前一定要修

1. **Board 改成明確 square-board model**
2. **明確規定 non-root Board exactly one container owner**
3. **`getEntryCell()` 加 boundary validation**

## 🟠 建議一起修

4. 明確寫出目前沒有 orientation transformation
5. 明確定義 `box` requirement 的 piece-kind 範圍
6. 補 cross-board occupied-entry fixture

## 🟢 不要改

以下目前邏輯是正確方向：

- Push → Enter → Eat
- `inMotion`
- `beingEntered`
- eat 時 reset `beingEntered`
- Fraction
- `HALF = 1/2`
- recursive board exit
- root board 不可 exit
- normal 不可被 enter
- container 可以被 enter
- non-player box requirement

---

## 實作前 Checklist

- [ ] Board 是否明確為 square？
- [ ] 所有 `width / height` 使用處是否已統一？
- [ ] 是否保證每個 non-root board 只有一個 owner？
- [ ] `findContainerFor()` 是否拒絕 0 或多個 owner？
- [ ] `getEntryCell()` 是否能安全處理 `offset - 1`？
- [ ] 是否明確標示 flipped/mirrored out of scope？
- [ ] 是否明確定義 `box` requirement？
- [ ] 是否新增 cross-board occupied-entry test？
- [ ] 是否新增 board invariant tests？
- [ ] 是否保留 Push → Enter → Eat 順序？
- [ ] 是否保留 `inMotion` loop handling？
- [ ] 是否保留 exact Fraction？
