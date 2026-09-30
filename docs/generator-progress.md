# 關卡生成器進度整理

更新日期:2026-09-20
範圍:`tools/generator/` 與 `src/levels/builtin/generated/`。引擎、渲染器、編輯器的並行工作只在最後一節簡述,細節請看各自的 spec/plan。

## 1. 目前狀態一句話

生成器已從「反向構造(reverse-walk)」整個換成「隨機生成 → 結構驗證 → solver → 難度分析 → 篩選 → 存檔」架構,已出貨 15 關(easy / medium / hard 各 5),全專案 `tsc` 乾淨、測試 301/301 通過。最近一次修正了兩個會讓 container 變成裝飾品的 bug,出貨關卡已用修正後的流程重新生成。

最新相關 commit:`5a0a1e2`(重新生成關卡)、`1ae2e3e`(兩個 bug 修正)。

## 2. 目前架構

流程(`tools/generator/generateBatch.ts` 主迴圈):

1. `randomGenerator.ts` 產生候選關卡
2. `basicValidator.ts` 做便宜的結構檢查
3. `checkWin` 防呆(生成當下就已解開的關卡直接丟棄)
4. 以 `canonicalKey` 去重
5. `solver.ts` 的 BFS 求最短解(有 `maxSolverExpandedStates` 上限)
6. `difficultyAnalyzer.ts` 產出 difficulty vector
7. `filter.ts` 依 hard → medium → easy 的順序分級
8. hard 進候選池,最後用 `selectDiverseTopN` 依分數加多樣性挑出 5 關

### 模組職責

| 檔案 | 職責 |
|---|---|
| `randomGenerator.ts` | 隨機牆/地板、玩家、每個箱子各自獨立決定「家 board」(root 或新建的 interior,可巢狀到 `maxNestingDepth`)與「目標 board」(同 board 或其他 board)。生成 container 時強制在其背後放牆,否則 container 只會被推走、永遠進不去。 |
| `basicValidator.ts` | 重疊、起點在牆上、缺玩家、goal 數 ≠ box 數、每個 board 地板須為單一連通區、interior 恰有一個 container 指向、每個 board 的巢狀深度、container 至少一面被擋住。 |
| `solver.ts` | BFS。`SolveResult` 含 `moves / expandedStates / visitedStates / maxFrontierSize / branchingFactors`(每個展開狀態的合法移動數)。 |
| `difficultyAnalyzer.ts` | 見下節。 |
| `filter.ts` | md 第 20 節的範圍式 `accept()`,加上 `classifyTier`。 |
| `generatorConfig.ts` | 所有可調參數與三級門檻。 |
| `canonical.ts` | 狀態雜湊,未改動。 |

### Difficulty vector 各欄位定義

- `solutionLength`、`expandedStates`、`generatedStates`、`maxQueueSize`:直接取自 solver。
- `avgBranching` / `maxBranching`:`branchingFactors` 的平均與最大值。
- `deadEndRatio`:合法移動數為 0 的展開狀態比例(窄定義,只算「立即卡死」)。
- `criticalDecisions`:對最佳路徑上每個狀態,檢查其他合法動作是否都無法在預算 `k`(該狀態起最佳解剩餘步數)內解開;都失敗就算一個決策點。
- `spaceTransitions` / `nestedBoxUsed`:最佳解中有幾步造成 piece 換 board。
- `nestedBoxRequired`:把所有 container 原地降級成 `kind: 'normal'`(位置不變、仍可被推,但永遠不能被進入)後重解,若無解則為 true。
- `maxContainerDepthUsed`:重播最佳解,取所有 piece 到過的最深 board 層級。

## 3. 目前設定值

生成範圍取自 md 第 5 節範例:board 邊長 6–10(本引擎 board 必為正方形,取 width/height 較大者)、牆密度 0.15–0.40、箱子 1–4、`containerProbability` 0.3、`crossBoardGoalProbability` 0.3、interior 邊長 3–5、`maxNestingDepth` 2。

`maxSolveDepth` 200、`maxSolverExpandedStates` 20000、`hardCandidatePoolSize` 15、`diversityWeight` 10、`maxAttempts` 3000。

### 分級門檻(來自診斷,非猜測)

100 個已解樣本的實測分佈:

| 指標 | p25 | p50 | p75 | p90 |
|---|---|---|---|---|
| solutionLength | 10 | 13 | 20 | 29 |
| criticalDecisions | 9 | 12 | 18 | 27 |
| avgBranching | 2.78 | 2.94 | 3.11 | 3.24 |

- easy:`solutionLength ≤ 9`
- medium:`solutionLength ≥ 10`
- hard:`solutionLength ≥ 20` 且 `criticalDecisions ≥ 18`(兩者需同時滿足)

`deadEndRatio` 在全部 100 個樣本中恆為 0,沒有區分度,因此刻意不進任何分級條件。

## 4. 目前出貨的 15 關

最近一次生成:1947 次嘗試,easy/medium/hard 各 5(`hardCandidatesFound=15`)。丟棄分佈:生成失敗 481、結構驗證不過 951、無解或超預算 441、`alreadySolved` 0、分級池滿 49。

各關 `solutionLength`:easy 1–9、medium 10–16、hard 24–50。驗證項目:全部可 `parseLevel`、皆非生成即解開、沒有任何 piece 一出生就站在 goal 上。

這批只有 1 關含 container(`hard-05`),且經降級重解驗證,該 container 並非解題必要。也就是說這批關卡並沒有展示「一定要進 container 才能過關」的型態。

## 5. 歷史脈絡

### 反向構造時期(已全數刪除)

先前的生成器從已解狀態反向走 N 步產生關卡,期間累積了大量診斷與調整,結論如下,留作參考:

- 有效:提高 `minReverseSteps`(12→35,上限 50 不變)。hard 產出率約 1.5% → 5.5%,`moveCount` p90 12 → 14。原因是強迫每條合格的路都夠長,而不是只允許它夠長。
- 無效:提高種子端的素材機率(群數、interior 大小、multi-box、filler、obstacle)。A/B 對照 `moveCount` p50 皆為 7、hard 比例在誤差內。原因是必要性檢查會刪掉最短解用不到的素材,「提供更多」不等於「必須用到更多」。
- 無效:放大棋盤(`SLOT_SIZE` 5→7)、拉寬反向步數範圍。皆因倖存者偏差使解變短、成功率下降。
- multi-box group 在幾何上做不到(吞噬會使 container 位移,第二面牆無法對齊),已擱置。
- obstacle box 種子時放置存活率僅約 4%(後續反向步驟會把它走開),改為事後插入;事後插入的「吞噬前一格」策略被證明不可能有效(推鏈遞迴解析會把它免費吸收),最終改成「純走路且前方是牆」的位置。

### 重新設計(本次)

依據使用者提供的 `parabox_level_generator.md`,分 10 個 task 完成:

1. `solve()` 加入 branching factor 統計
2. `randomGenerator.ts`
3. `basicValidator.ts`
4. `difficultyAnalyzer.ts`
5. `filter.ts`
6. 新版 `generatorConfig.ts`
7. 重寫 `generateBatch.ts`
8. 刪除 14 個反向構造相關檔案與測試
9. 以診斷數據設定分級門檻
10. 重新生成、驗證、收尾

設計依據見 `docs/superpowers/specs/2026-09-18-parabox-generator-random-solve-redesign.md`,實作計畫見 `docs/superpowers/plans/2026-09-18-generator-random-solve-redesign.md`。

範圍決定:只使用現有引擎能力(不含 clone/possess 機制,也不刻意生成 cycle);做到 filter 與入庫為止;mutation / 演化搜尋 / `.txt` 匯出 / Web UI 不在此輪範圍。

## 6. 實作與驗證中發現的問題(已修正)

**TDD 階段**

- 巢狀深度原本算的是 container 自己所在位置的深度,應算每個 board 自己的深度。
- `maxContainerDepthUsed` 原本只追蹤玩家所在 board;但吞噬時是箱子進入 container,玩家留在外層,必須看所有 piece。
- `nestedBoxRequired` 早期版本直接刪除 interior board,導致其 goal 消失、`checkWin` 誤判為已解開。
- 「0 個 critical decision」只可能出現在單一步驟、完全被牆包住的起點;只要走出第一步,往回走永遠是合法但失敗的選項。

**出貨後試玩回報「container 不能用」,追查後確認兩個 bug(commit `1ae2e3e`)**

1. 目標格與箱子起點各自獨立抽取,箱子可能一出生就站在自己的 goal 上(什麼都不必做);同樣的問題也包括箱子出生在較早箱子的 goal 上、或 goal 落在已被佔用的格子。修正:`unoccupiedFloorCells` 同時排除「已有 piece」與「已有 requirement」的格子,piece 與 goal 的選格都用它。
2. `nestedBoxRequired` 早期以「把 container 所在格變牆並刪除 piece」判斷,容易誤判:container 的格子若剛好在解法路徑上被經過(或 container 本身就是被推到 root goal 上的那個 piece),刪除後就無解,但這與是否「進入」container 無關。修正:改為原地降級成 `kind: 'normal'`。以 `medium-02.json` 實測,降級後原本的 15 步解完全不受影響,證明先前對該關「必須使用 container」的說法是錯的。

兩個修正各有回歸測試。修正後 `alreadySolved` 丟棄數從 24 降到 0。

**效能取捨**

`hardCandidatePoolSize=60`、`maxAttempts=5000`(沿用舊版數字)在新流程下過慢:hard 候選的 `analyze()` 要多次呼叫 solver(`criticalDecisions` 約 3×解長 次、`nestedBoxRequired` 再一次),且主迴圈在 easy/medium 已滿後仍會持續找 hard 池直到上限。實測跑了近一小時仍未完成後終止,改為 15 / 3000,約 1500–1900 次嘗試即收斂。

## 7. 已知限制與待辦

- **container 實際被需要的比例偏低**:初次診斷中 `nestedBoxRequired` 為真的比例約 5%(該次統計含已修正的假陽性,修正後實際比例應更低,尚未重新量測),目前這批 15 關中沒有一關真的必須進入 container。若要讓「必須使用 container」成為常見型態,需要調整生成策略(例如偏向讓箱子的目標落在 container 內部、或提高跨 board 目標比例)並重新診斷。
- 修正後尚未重跑一次完整的難度分佈診斷,現行分級門檻仍是修正前量測的值。目前重新生成仍能順利填滿配額,但分佈可能已有小幅位移。
- `deadEndRatio` 目前無區分度,只保留為紀錄欄位。
- `criticalDecisions` 的定義偏寬:只要存在任何合法但失敗的替代動作就計入,包含單純「往回走」,因此與 `solutionLength` 高度相關,尚未驗證它是否提供額外資訊。
- `basicValidator` 拒絕率偏高(診斷中約 58%),尚未針對生成端減少無謂浪費。
- 診斷與正式生成耗時長,主要成本在 `criticalDecisions` 與 `nestedBoxRequired` 的額外 solver 呼叫。
- md 中尚未實作的部分:mutation / 演化搜尋、關卡結構層級的多樣性比較、human-like solver、`.txt` 匯出、Web UI。
- 從未實測過瀏覽器內實際遊玩(Chrome 擴充功能未連線);目前的驗證全部在引擎層(`parseLevel` → `solve` → 逐步 `applyMove` 重播)。

## 8. 相關 commit 索引(生成器)

| commit | 內容 |
|---|---|
| `c7bcd49` | `solve()` 加入 branching factor 統計 |
| `a76bc8b` | 隨機生成器 |
| `9781772` | 結構驗證器 |
| `a2f75a0` | 難度分析器 |
| `c44e56c` | 範圍式篩選與分級 |
| `95d0a56` | 新版 generator config |
| `de404fe` | 重寫 `generateBatch.ts` |
| `043ad14` | 刪除反向構造模組與測試 |
| `b1de3ee` | 以診斷數據設定分級門檻 |
| `4879b1a` | 調降候選池與嘗試上限 |
| `b75e684` | 首次以新流程重新生成關卡 |
| `1ae2e3e` | 修正兩個 container 相關 bug |
| `5a0a1e2` | 以修正後流程重新生成關卡 |

## 9. 其他並行工作(僅供對照,非本文件範圍)

同一個 repo 在這段期間還有其他線的工作,git log 中可見:引擎新增 Void、cycle、clone / flip / container link / transfer 機制;編輯器新增 self-loop-box 等工具;遞迴渲染與連續鏡頭(recursive render + camera)及其後續的 camera framing 重新設計,均已有 spec 與 plan(位於 `docs/superpowers/specs/` 與 `docs/superpowers/plans/`)。這些變更對生成器的影響:新增的 `Piece` 欄位(`cloneOf` / `fliph` / `linkedTo`)皆為可選,對一般 container 行為完全向下相容,已逐段核對 `tryEnter` / `computeTarget`。此外,原本標為「與本工作無關」的 11 個 `EditorScreen.test.tsx` 失敗,已由那些並行工作修好。

## 10. 官方對照審查後的修改(2026-09-21)

依據 `parabox_logic_review_and_required_fixes.md` 並對照官方 Custom Levels 文件與現有程式碼。

**已做(生成器層,`tools/generator/`)**

- `basicValidator`:新增 `ValidatorPolicy`。連通地板、goal=box、interior 唯一 owner、container 至少一面被擋,四項降級為「生成政策」(`GENERATOR_POLICY` 預設全開,出貨行為不變;`CORE_ONLY_POLICY` 全關)。核心檢查(重疊、越界、牆上起點、單一玩家、boardRef 可解析、可回到 root、深度)維持。
- `solver`:新增 `solveDetailed`,回傳 `SOLVED / UNSOLVABLE / EXPANSION_CAP / DEPTH_CAP`;`solve()` 保持舊介面。
- `generateBatch`:統計拆出 `discardedSearchCap`(超預算,未證明無解)與 `discardedUnsolvable`(狀態空間耗盡)。
- 新增測試:CORE_ONLY 政策、SolveStatus、canonicalKey 對 containment / clone / flip / link 的區分。

**審查文件中與現況不符的說法(已核對)**

- 「canonicalKey 可能不含拓撲」:不成立。`canonicalKey` 序列化整個 `World`(boards、pieces 含 boardRef/cloneOf/fliph/linkedTo/infiniteFor、locations),拓撲差異必然反映在 key。已補測試鎖定。
- 「center-only entry / chain push」:引擎 `getEntryCell` 以相對座標進入,玩家正常推入為邊中心;chain push 由 `resolveBlocked` 遞迴解析,`rules.test.ts` 已有覆蓋。

**刻意未做(需另立 spec)**

- 長方形 board:引擎幾何(`fraction`、`computeTarget`、`getEntryCell`)全以 `board.size` 為唯一邊長,且既有 `2026-09-04-parabox-engine-spec-fixes.md` 明確採 square 以對應 reference solver。官方格式雖有 width/height,但長方形進出的比例映射語意未經原版驗證,不宜猜測實作。
- `attempt_order` 可配置、Infinite Enter、Void 與原版差異對拍、mechanic-aware 生成、transition trace、puzzle signature:皆需原版遊戲比對或新設計,屬審查文件 Phase B–D。
- 難度門檻仍是專案自訂經驗值(非官方定義),修正後尚未重新校準。
