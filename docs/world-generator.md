# 分類型關卡生成器(World Profiles)

依據 `parabox_level_generator_world_profiles.md`。每個 World 的關卡都必須**需要**該 World 的核心機制,而不只是「看起來像」。

## 每關的共同要求

- **玩家終點**:和原版一樣,每關都有一個玩家目標格,玩家最後要走到那裡才算過關。位置可能在任何房間,包括箱子裡面。沒有玩家終點的候選直接淘汰(`noPlayerGoal`)。
- **大小多變**:最外層房間 5–8 格,箱子內部 3–7 格(也有偶數)。偶數大小的房間,每一邊的出入口是中間兩格。

## 三層驗證(`tools/generator/worlds/verify.ts`)

1. **存在**(`presence`):關卡結構包含該機制,且不含後面 World 的進階機制(例如 Intro 不可有自包箱、分身、翻轉、附身)。
2. **使用**(`usage`):用引擎事件重播最佳解,確認真的觸發了該機制。事件包括 `EnterEvent`(含 selfLoop / clone)、`ExitEvent`、`EatEvent`、`FlipEvent`、`PossessEvent`、`InfiniteExitEvent`。引擎嘗試後放棄的分支,事件會回滾(`eventMark` / `rollbackEvents`),所以紀錄只包含實際發生的事。
3. **必要**(`ablations`):拿掉機制後重新求解,必須**窮舉整個狀態空間後證明無解**(`UNSOLVABLE`)。搜尋被上限中斷的結果不算證明,這種候選會被淘汰(`ablationUnproven`)。

## 目前的 World(`tools/generator/worlds/profiles.ts`)

| World | 核心機制 | 拿掉機制的方式 |
|---|---|---|
| 1 入门 Intro | 箱中箱 | 禁止進入與吃(`enter`、`eat`) |
| 2 进入 Enter | 1-loop 自包箱 | 自包箱改成通往一個獨立、空的同樣房間 |
| 3 空箱 Empty | 空的開放箱子 | 空箱內部全部填牆 |
| 4 吞噬 Eat | eat | 禁止 `eat` |
| 5 互相包含 Reference | 長度 ≥2 的循環 | 循環中每個箱子輪流改成通往獨立房間;每個版本都要無解 |
| 8 分身 Clone | 同一房間的多個 instance | 每個分身改成通往自己的獨立房間 |
| 11 翻转 Flip | fliph 箱子 | 取消所有 fliph |
| 14 附身 Possess | 可附身的箱子 | 禁止 `possess` |
| 15 墙壁 Wall | 可附身的牆 | 禁止 `possess` |
| 16 无限大 Infinite Exit | ∞ 悖論出口 | 禁止 `infiniteExit` |

尚未做:Swap、Center、Transfer、Open、Cycle、Player(多玩家)、Infinite Enter(舊的 `generated-ie` 另有驗證器,目前放在「更多生成关卡」)、Multi Infinite、Appendix 類。

## 產生

```bash
npm run generate:worlds -- --per 20 --seconds 3000 --oversample 1.5
# 單一 World:npx tsx tools/generator/worlds/generateWorlds.ts --only enter --per 20
# 只試跑、不寫檔:加 --dry
```

- `generateAll.ts` 讓每個 World 各用一個程序平行生成(預設同時跑「CPU 核心數 − 2」個),全部完成後再重建 `manifest.json`。
- 每個 World 輸出到自己的資料夾(`<order>-<id>/NN.json`),加上一份 `world.json`。總清單由各 `world.json` 合併而成,所以可以只重新生成某一個 World。
- 每個 World 用固定種子(`1,000,000 × order + 嘗試次數`,mulberry32),同一個種子一定產生同一關。
- **難度**:
  - 每個 World 都提高了最短解下限(10–14 步)、最外層房間大小(6–9 格)和箱子數(2–3 個)。
  - 收集 `per × oversample` 個合格關卡後,依難度分數(最短解步數 + 3 × log2(搜尋狀態數))挑出**最難的** `--per` 關,再由易到難排序。
  - 時間到了還湊不滿的 World,就出貨已經找到的全部合格關卡。
- manifest 裡每關都有分類紀錄:種子、結構、最佳解步數與走法、搜尋量、使用與必要性結果。
- App 的關卡列表依 World 分組顯示(`loadWorldLevels`)。
- 最近一次執行的紀錄:`docs/world-generator-last-run.txt`。

## 效能

生成器要大量求解。這次同時修了兩個引擎層級的瓶頸:

- `moveTo` 原本每移動一步就用 `structuredClone` 深拷貝整個世界,現在只替換 `locations`。
- 求解器的狀態 key 原本把整個世界(包含所有格子)序列化,現在改用 `stateKey`,只包含會變動的部分,並快取沒有變動的部分。

整套測試從數分鐘降到約 11 秒。

## 測試

`tools/generator/worlds/worlds.test.ts`:
- 失敗分支不留事件。
- 停用的機制確實不會發生。
- 同一個種子生成結果相同。
- 每個已輸出關卡:重播紀錄的解法能過關,而且用到該機制。
- 每個 World 第一關:拿掉機制後證明無解。
