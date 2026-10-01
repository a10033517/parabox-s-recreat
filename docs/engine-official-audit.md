# 引擎 / Void / 視覺 對照官方審查(2026-09-21)

對照:`patricks_parabox_rebuild_design.md`、`patricks_parabox_void_visual_design.md`。維持正方形 board。
官方來源:Custom Levels 文件、作者訪談;社群 Wiki 僅作交叉參考(Wiki 頁面本次抓取回 402,只取得搜尋摘要)。

## 已修改

- 新增 `World.attemptOrder`(官方 header `attempt_order`)。`resolveBlocked` 依序嘗試 push / enter / eat,預設 `push, enter, eat`;Priority 附錄可用 `enter, eat, push`。Void 鎖定規則(鎖定的 piece 只能 push)保留。`parseLevel` 驗證為三者的排列。測試:`rules.test.ts`、`levelSchema.test.ts`。

## 已核對、與現況一致(無需修改)

| 規格項目 | 引擎現況 |
|---|---|
| 單推 / 連推 | `tryMovePiece` 遞迴解析,遠端先動 |
| push 優先於 enter | 預設順序即此 |
| 進出是空間轉移非 portal | `computeTarget` 依 containment 爬升 |
| 自我包含 / 多重 loop 為合法 graph | `parseLevel` 允許 cycle;`computeTarget` 以 `visited` 偵測無限退出 |
| Infinite Exit → Void,已有 destination 不重複生成 | `ensureInfiniteDestination` / `findInfiniteDestination` |
| Void 內物件鎖定、不可 enter/eat | `isInVoid` |
| Void 是真實 Space | `VOID_BOARD_ID` board,存在於 `world.boards` |
| Undo 還原完整拓撲 | state 為完整 `World` snapshot |
| 拓撲進 canonical key | `canonicalKey` 序列化整個 `World`(已補測試) |

## 與規格或官方可能不一致,**未改**(需原版實測)

1. **Clone 進入偏移**:見下節「clone_void_infinite 規格套用」;進入來源 interior 已改,**進入格的精確偏移**仍待原版對拍。
2. **Infinite Enter / Epsilon**:引擎無 `infenter` / `infenterid` 模型。官方格式有欄位,runtime 行為只有玩家社群整理,規格自己也列為「待驗證」。
3. **`floatinspace`**:官方以 block 屬性表示無 OuterLevel;引擎以 runtime `void` board 表示。兩者是否可互轉需對照,未實作。
4. **Transfer**:引擎以 `linkedTo`(兩 container 直接連結、mirrored offset)實作。規格 §13 要求「同位置子箱候選 + 決定性 tie-break」,官方無公開 tie-break,需實測後才能寫測試。
5. **Open / 不完整外框箱子、Cycle 旋轉、Oblong**:引擎的 board 邊界是陣列邊緣;Oblong 依使用者決定不做。
6. **`Player = box` / Possess / Wall**:規格本身列為第二階段,未做。

## 視覺 / 動畫 / 鏡頭(`void_visual_design.md`)

未改動。這份是實作建議(標為 [重製規格]),非官方規則;現有 renderer 已有 recursive render + camera(見 `docs/superpowers/specs/` 的 camera framing spec)。尚未實作:進出 squash/shrink 動畫曲線、Infinite Box `∞` 符號與 Void 生成/eject 動畫、camera shake、debug overlay(F1–F5)。建議另開 spec,先做規格優先序 1–5(Enter/Exit shrink-grow、camera zoom、push squash、depth transition)。

## 建議下一步(需你決定)

- 對拍 Clone(項 1),對拍後我再決定是否改 `tryEnter`。
- Void V01–V05 已補於 `src/game/engine/void.test.ts`(14 個測試,全過);V06(clone)、V07(Infinite Enter)待對應機制定案。

## clone_void_infinite 規格套用(2026-09-21)

依 `patricks_parabox_clone_void_infinite_detailed.md`。

**已改**
- **Clone 是對 source block 的 reference,不是 portal**(規格 §3、§5、§42、錯誤 3)。`tryEnter`:clone 的 source 若是有 interior 的 container,進入 clone = 以 source 的規則進入 source 的 interior(clone 自身位置與 fliph 無關);`CanvasRenderer.resolveRecursionTarget` 同步改為顯示 source 的 interior。舊行為(傳送到 main body 所在格並推開它)只保留給「source 是無 interior 的普通 piece」的舊形態(`11-clone-box`)。
- 出口不創造反向 portal:退出 source interior 回到 source 所在位置,不回 clone(C11 測試)。
- 新測試:C02、C09、C10、C11、舊形態 fallback;Undo 還原拓撲與 Void/∞ 狀態(IE11/F09)。
- 既有測試兩處因語意改變而更新(`rules.test.ts` 的 clone 推入測試、`CanvasRenderer.test.ts` 的 clone 疊 tint 測試)。

**核對後一致(無需改)**:Infinite Box 不可 enter 但可 push(V04)、Void 不是巨大棋盤而是獨立有限 board、renderer 不決定 paradox、solver 只用 logical state(`canonicalKey`)。

**規格標為 [VERIFY],刻意不實作**:`infexitnum` / `infenternum` matching 語意、`infenterid` 解析、Infinite Enter / Epsilon、`Ref.floatinspace`、clone 進入格的精確偏移、`zoomfactor` 相機公式、Multi Infinite 的 first-room attribution、goal 針對 definition 或 instance。
**規格要求的架構重構未做**:Definition / Instance 分離、`LevelPath`、`VoidContext`、`levelContext` 欄位。現引擎以「board 只被一個 container 擁有」為前提,兩個 clone 共享 source interior 已可運作,但真正的 Ref 多實例(同一 Block 出現在多處並各有 runtime identity)需要資料模型重寫,屬另一個大型 spec。

## Definition / Instance(2026-09-21,依使用者 Phase 1–4 計畫)

決定:Goal 維持現況(格子 requirement 只分 box/player,不綁 definition/instance)。Clone 維持上一節做法。

**Phase 1(已做,不重寫 World)**:現有 `Board` 即 Block Definition(cells 遊戲中不變),container `Piece` 即 Ref Instance(自有 runtime id 與位置,`boardRef` / `cloneOf` 指向 definition)。`types.ts` 新增 `BlockDefinition` / `RefInstance` 別名與 `getDefinition`、`targetDefinitionOf`、`instancesOf`。`parseLevel` 不再拒絕「多個 Ref 指向同一 Block」(2 Ref → same Definition)。

**Phase 2(已做,暫時規則)**:所有離開 interior 的路徑都經 `findContainerFor` 單一縫隙。多個 Ref 共享時,canonical instance = id 排序最小的非 clone Ref(確定性,不受物件 key 順序影響)。`canonicalKey` 不含 instance path。**此規則未經原版驗證**。

**Phase 3(已做)**:`replayHarness.ts`(`replay` / `finalWorld`,輸出 input → 逐步 locations 快照,格式即原版錄製應對照的欄位)與 `definitionInstance.test.ts`:1 Def+1 Ref、2 Ref→同 Def、巢狀共享、共享+Clone、共享+遞迴、共享+Infinite Exit。「退出回到哪個 Ref」的測試標為 PROVISIONAL。

**Phase 4(待原版證據)**:若原版證明 exit 依進入的 Ref 返回 → 在 `findContainerFor` 縫隙改為 instance-path routing(state 需加進入路徑,`canonicalKey` 同步納入);若走其他規則 → 只改 resolver。

**已知風險**:先前 `parseLevel` 禁止多 owner,原因是「self-loop Ref 與外部 Ref 共享同一 board 時,canonical 規則可能讓 self-loop 的出口回到外部 Ref,使 self-loop 箱看起來失效」。現已允許,行為由 canonical 規則決定(有測試鎖定確定性,不代表符合原版)。生成器的 `requireSingleOwner` 政策仍預設開啟,不會生成此類關卡。

## 原版對拍結果 #1(2026-09-21,使用者實測)

- case1–case4 全部可載入(匯出格式可用)。
- **Eat、Clone 與引擎一致**。
- **Void 可走出去**:原版 Void 不是有牆的小房間。一般關卡用牆封住,永遠不會進入 Void;只有「沒有定義無限大箱子」的 self-loop 觸發 Infinite Exit 時才進 Void,且**無限大箱子在 Void 中心**。
  - 修改:Void board 由 5x5 改為 31x31 全地板(`VOID_SIZE` / `VOID_CENTER`),Infinite 箱放在中心 (15,15);新 destination 依中心外擴 5x5 的搜尋順序;piece 在 Void 內可自由走動,實務上不會碰到邊界。陣列邊緣仍會擋住(離中心 15 格),非真正無限。若要真正無限需改 `cells` 存取(`cellAt`)與 renderer,未做。
  - 測試:V02 中心座標、新增「Void 內任一方向可走 10 格」;其餘 Void 座標斷言改為相對中心。
- **待釐清**:「Infinite 外層要是目前的箱子靠下緣才會下面有虛空」——使用者說明已含在上述 Void 描述中;引擎現行條件(自我包含箱貼著自己所在 board 的該側邊緣、往該方向推才觸發,虛空/被推出者出現在該方向)與此一致,未另改。若原版在具體操作上仍有差異,請提供 case4 步驟與畫面描述。

## recursive_clone_infinite_void_implementation_spec 核對(2026-09-21,不使用原版對拍結果)

依 `parabox_recursive_clone_infinite_void_implementation_spec.md` 逐項對照引擎;測試在 `src/game/engine/specConformance.test.ts`(12 → 全部 438 測試通過)。

**已修改**
1. **既有 ∞ 應接住 paradox,且不物化 Void**(§25、§31、§36、§61、§63):`ensureInfiniteDestination` 先找既有 destination,找不到才建立 Void(lazy)。原本無論如何都先建 Void。
2. **被推出者落在 ∞ 所在的空間**(§36):`resolveInfiniteExit` 原本一律往 Void board 放;現改為在 destination 自己所在 board 的下一格放置(關卡內既有 ∞ 也適用),撞牆則失敗。
3. **Paradox 歸屬用「第一個離開的 container」**(§39–40、反模式 6):`computeTarget` 新增 `seedOwner`,無限退出的 `ownerId` = 第一個爬出的 container,而非「閉合 cycle 那個 board 的 owner」。純 self-loop 結果不變;有「尾巴」(先經過分支再進 loop)時 destination 改鍵於第一個 container。既有測試 `infinite result names the board that actually repeats` 依此更新。

**已確認一致(有測試)**:Clone 單向進入、退出回原箱不回 clone(C1–C4)、clone 不深拷貝(C6)、有限 self-loop 不是 paradox(T3)、Infinite box 不可 Enter 但可 Push(V04)、Void 為有界特殊空間(§43,證實先前改 31x31 是誤判)、undo 還原 paradox(含既有 ∞)、clone 放進原箱的遞迴會終止不爆 stack(CI1–CI5)。

**未實作(規格自己標為需原版對拍或屬大型工作)**
- **Infinite Enter / Epsilon**(§16–21、§29):需要 mechanic-aware 的偵測(區分有限 cycle 與真正無限縮小)與 ε 物件,規格 §76 也把 matching 列為待對拍。目前 clone-in-parent 等情形由 `beingEntered` 擋住而回傳 null(不當機、不生成 ε)。
- `infexitnum` / `infenternum` / `infenterid` 欄位、`floatinspace` loader(§26–30):本專案關卡格式是自有 JSON,沒有官方 txt 匯入器(僅有單向匯出)。
- Original inside Clone(§60 OC):clone 沒有自己的 interior,結構上無法表達「Clone 包含 A」,故無此 fixture。
- 多 Ref 共用 Definition 的 exit instance 選擇(§76-1)、Void 多物件擺放座標(§76-6):仍是 PROVISIONAL。
- `canonicalKey` 加入 entry context / recursion context(§49):目前狀態即完整 World,未加 instance path。

## current_progress_and_problem_solutions 路線圖(2026-09-21)

依 `parabox_current_progress_and_problem_solutions.md` 的 A–K 順序,本輪只做「不需猜測原版行為」的項目。

**已做**
- **E 官方欄位 schema**:`Piece` 新增 `infExit` / `infExitNum` / `infEnter` / `infEnterNum` / `infEnterId`,`Board` 新增 `zoomFactor` / `floatInSpace`;`parseLevel` 只驗型別(布林/整數/正數),**原樣保存、不賦予玩法語意**(degree 比對、`infenterid` 查找層級皆未驗證,不假設「同數字 = 同 destination」)。測試在 `levelSchema.test.ts`。
- **H Transfer 三段拆分**:`collectTransferCandidates` / `selectTransferTarget` / `resolveTransferTarget`(`rules.ts`)。純重構,行為不變;懸空 `linkedTo` 仍是「該步失敗」而非落入一般爬升。selector 是暫定(取第一個候選),原版證據出來只換 selector。
- **J 生成器根本原因**:診斷發現 container 幾乎沒被用到的**真正原因**是 `randomGenerator` 給 interior board 也加了整圈牆——進入 container 會落在 interior 邊緣「該側中心格」(`getEntryCell`),離開也要走邊緣格,整圈牆等於永遠進不去、出不來,container 變成裝飾。診斷:重跑前 33 個可解關卡中 3 個含 container、**0 個必要**。修正:interior 保留邊牆但每側中心格開口(interior 尺寸限奇數,中心才唯一);新增測試鎖定。

**刻意不做(需原版證據或會違反「不猜」原則)**
- **F Infinite Enter / ε**:在現行引擎幾何下,`tryEnter` 的進入格軸向座標恆為對側邊緣,而目標格必為鄰格,故 `beingEntered` 命中只可能出現在極特殊的推鏈;真正的觸發條件、ε 落點、`infenternum` 比對都沒有公開資料。不憑空做一個會讓 ε 行為與 ∞ 完全相同的實作;需要可建構的原版最小 fixture 後再做。
- **B VoidContext 抽出**:目前 Void 仍是 5x5 board(`VOID_SIZE=5`,非 31x31)。路線圖說「不要固定大小、用特殊 space 抽象」;抽象需要先知道原版 Void 的邊界行為,未做。
- **G canonical recursion context、I zoomfactor 相機公式、D Clone 偏移**:同上,等對拍。

**J 診斷結果(修正 interior 開口後,150 秒取樣)**:7 個可解關卡中 3 個含 container,**3 個全部「container 為解題必要」**(修正前:33 個可解、3 個含 container、0 個必要)。代價:interior 變開放後狀態空間變大,可解樣本產出變慢(150 秒 7 個 vs 修正前 240 秒 33 個),`maxSolverExpandedStates=20000` 下超預算比例上升。**尚未重新生成出貨關卡**:15 關完整批次可能需要更長時間或調高預算/降低牆密度下限,需要另行決定。`nestedBoxRequired` 已改為 export 供診斷使用。

## Infinite Enter / ε 實作(2026-09-21,依 infinite_enter_epsilon_official_research.md)

**實作(`rules.ts`、`types.ts`;測試 `infiniteEnter.test.ts`,命名為 IE-expected-from-public-evidence,不是原版 golden trace)**
- **偵測(CONTRACT-01/03)**:與 `beingEntered` 遞迴保護分離。`tryEnter` 對每次進入記錄結構簽名 `enter:<instance>:<dir>:<entryCell>`;同一 instance、同方向、落在同一進入格再度出現 = 純向內迴圈、無有限終止點 → Infinite Enter。同 instance 但落點不同仍是普通遞迴保護(blocked);自我包含的有限進入、有限 cycle 不產生 ε(IE04、IE05)。
- **歸屬(CONTRACT-06)**:seed = 這次移動解析中**第一個被進入**的 piece(`seed:` 記錄於同一個 set),ε 鍵於 seed,不是閉合迴圈的那個 piece(IE03)。
- **解析三步驟(CONTRACT-04/05)**:偵測 → 找既有 ε(`epsilonFor === seed`)→ 沒有才在 Void 建立 null-space ε。既有 ε 重用,不多耗 Void 格(IE02)。
- **ε 是 gameplay state(CONTRACT-08)**:`void-epsilon:<seed>` 容器 piece(`epsilonFor`)+ 無牆 1x1 interior board `epsilon:<seed>`,放在 Void。進 World,undo 與 `canonicalKey` 自動涵蓋(IE08,含「undo 後再建不是 singleton」)。
- **∞ 與 ε 語意不同(CONTRACT-07)**:∞ 不可進入;ε 是可進入的容器。Clone 解析器不知道 ε(CONTRACT-02):clone 只轉成 source interior,後續是否無限由 `tryEnter` 的簽名偵測決定。
- 進入 ε 後離開:沿 ε 容器爬升,落在 Void 中 ε 旁邊該方向的格(IE07)。

**PROVISIONAL / VERIFY(公開資料未定)**:ε 內的落點與被佔位者的擠出方式;ε 的 matching 目前**只比 seed identity**,`infenternum` / `infenterid` 只保存不比對;多個候選 ε 的 tie-break;shared Definition 下的 ε routing;Multi Infinite / ε→ε 的完整歸屬;ε 是否有 null-space 特殊邊界。

**未做(路線圖後段)**:renderer 的 `SpawnEpsilonEvent` 動畫與 ε 符號、generator 的 `infiniteEnterRequired` 驗證、官方 `infenter` Ref 建構(floating Block + exitblock Ref + Assign)的載入。

## Infinite Enter 後段(patricks-parabox-infinite-enter-implementation.md,2026-09-21)

**A. 官方 infenter 載入**(`officialFormat.ts`,測試 `officialFormat.test.ts`)
- `parseOfficialLevel(text)`:官方 txt(version 4)子集 → 引擎 World。兩階段:先 tokenize 成樹、Ref 只存目標 id;再解析。Ref 可出現在被指 Block 之前。
- 映射:Block → board `b<id>` + 容器 piece `p<id>`;`floatinspace=1` 的 Block → 只有 board、**不放進任何 parent**(runtime outerLevel = null,與 editor hierarchy 分離);Ref→一般 Block → clone;Ref→floating Block → 共享該 Definition 的容器(不複製);`fillwithwalls` → 實心箱;`player=1` → 玩家。
- `infexit/infenter/infenternum/infenterid/exitblock` 完整保存(新增 `Piece.exitBlock`)。驗證:infenter Ref 無目標 → 報錯;目標非 floating → 報錯;非方形 / 非 version 4 → 拒絕不猜。
- `infiniteEnterRegistry(world)`:唯一列舉授權 destination 的地方(generator / simulation / renderer 不各自掃描)。
- **Case D(Block 上直接標 infenter)**:官方 Block 欄位表根本沒有 infenter 欄位,格式上無法表達,故無對應處理。

**引擎解析順序(rules.ts `resolveInfiniteEnter`)**:授權 destination(Ref 的 `infEnterId` = seed 定義的官方 block id)→ 既有引擎 ε → 建立 null-space ε。授權目的地就是普通進入該 Ref 的 floating Block。**比對仍是 VERIFY**:只比 id,degree 只保存;平手依 piece id 排序。

**B. generator `infiniteEnterRequired`**(`infiniteEnterValidator.ts`)
- 回傳 `{required, foundRef, reachable, triggered, necessary, valid, degree?, refId?, error?}`。`valid = reachable && triggered && necessary`:可解、解法重播真的產生 Infinite Enter、且**關掉 Infinite Enter(mechanic removal,`disableInfiniteEnter`)後無解**。只「存在」ε 不算。
- 接入 `generateBatch`(`config.infiniteEnterRequired`,預設關)與統計 `discardedNoInfiniteEnter`。**限制**:隨機生成器本身還不會產生含 Infinite Enter 的候選,開啟此旗標目前會拒絕所有隨機候選;它是驗證閘,不是生成器。
- 測試涵蓋文件 Test 1–4(不要求 / 無 Infinite Enter → 拒 / 有 Ref 但沒用到 → 拒 / 真的需要 → 收)。

**C. renderer / 事件**
- `events.ts`:`SpawnEpsilonEvent {seedId, destinationId, board, created, authored, degree?}`,由模擬在偵測點發出;`GameState.lastEvents` 保存最近一步的一次性事件,undo 清空。事件在模組層 context(非 World、不序列化),`applyMove` 對既有呼叫者仍是純函式。
- renderer:`paradoxGlyph`(∞ / ε 共用同一路徑,ε 統一用 U+03B5);renderer 只依 piece 的 `epsilonFor` 決定字形,不推論 paradox。GameScreen 只在事件 `created === true` 時播 Void 轉場動畫。
- ε 本體是 World state,所以 restart / replay / undo 不需要 renderer 端狀態(規格 §18–19 的「一次性事件、持久本體」由此達成)。camera:玩家位於 Void 內部空間(如 ε 的 interior)時錨定 Void(`isInVoidSpace`)。
- **限制**:沒有獨立的 scale 0→1 spawn 動畫曲線與 `EpsilonVisualState`(Spawn/Active/Remove);目前只有 ε 字形與既有 Void 轉場。若要做,應接在 `GameScreen` 的 `RenderAnimation` 上。

## 「都做」:ε 動畫 / Infinite Enter 生成器 / 對拍材料(2026-09-21)

**1. ε 縮放動畫**(`epsilonAnimation.ts`,測試 `epsilonAnimation.test.ts`)
- `EpsilonVisualState`(Spawn / Active / Remove)與 `classifyEpsilonVisuals(pre, post, events)`:只有事件 `created===true` 才是 Spawn(一次性);ε 仍存在為 Active;undo 後消失為 Remove。純函式,無計時器、無狀態。
- `epsilonSpawnScale(progress)`:關鍵影格 0 → 0.2 → 0.6 → 1.0,前段保持 0 讓 ε 在世界切換之後才出現。
- renderer:`DrawContext.getPieceScale`,ε 縮小 + 淡入(globalAlpha),長大期間不遞迴繪製內部。GameScreen 在 spawn 事件時用 700ms 的 Void 轉場,只在兩階段轉場的後半縮放。ε 本體是 World state,restart / replay / undo 不需 renderer 狀態。

**2. Infinite Enter archetype 生成器**(`infiniteEnterArchetype.ts`)
- 不憑空塞 ε:建構已知會產生 Infinite Enter 的拓撲(A 背後有牆、interior 進入格上有背後有牆的自身 clone O、封死的口袋放 exitblock Ref → floating Block 目標),其餘(root 尺寸 3–6、A/口袋位置、玩家位置、interior 尺寸、裝飾牆)隨機。每個候選都要通過 `validateInfiniteEnter`(可解、解法真的觸發、關掉 Infinite Enter 後無解)。
- `npm run generate:infinite-enter` 產出 5 關到 `src/levels/builtin/generated-ie/`(與 `generated/` 分開,避免被 `generate:levels` 清掉);`loadGeneratedLevels` 一併載入,既有的「未解開 / 可解 / id 唯一」測試自動涵蓋。
- 已知限制:這是單一 archetype,結構變化有限;證明「需要」靠驗證閘而不是構造。

**3. 原版對拍材料**(`npm run generate:differential`)
- 新增 case5(authored ε)、case6(null-space ε)、case7(`infenterid` 比對,兩個候選)。這三個是**手寫的官方格式 txt**(含 floatinspace / exitblock / infenter,World 匯出器無法表達),README 附引擎預測。
- 我無法執行原版:**實測結果仍待你錄製**。case7 之後建議再以 F9 的 infenternum=2 重錄,確認 degree 是否影響選擇。注意這三個檔案的 root 沒有外框牆(路徑不碰邊緣)。

## 上網驗證(2026-09-21):能找到什麼、不能做什麼

**限制(誠實說明)**:我看不了 YouTube / 影片內容(沒有影片或音訊解析,YouTube 頁面只給標題與描述,拿不到逐格畫面或字幕)。Fandom Wiki 頁面抓取回 402。因此只驗證到**文字型公開來源**:Steam 討論串(含作者本人回覆)與搜尋摘要。這些不是官方 source code,也不是逐步 golden trace。

**來源**
- 作者本人回覆:https://steamcommunity.com/app/1260520/discussions/0/3267931984795617686/ —「the infinite loop is attributed to the first room which you enter or exit from」;「what you really did was enter the Epsilon room _for_ the Epsilon room, rather than Double Epsilon for the green room」;並承認另一種處理「perhaps would have been better and more consistent」。
- 玩家整理:https://steamcommunity.com/app/1260520/discussions/0/595134572710075033/ — ∞/ε/null space 行為。
- Clone:https://steamcommunity.com/app/1260520/discussions/0/595142878916789375/。

**與引擎核對**
| 公開描述 | 引擎 | 結論 |
|---|---|---|
| 推 clone 進 parent 產生 infinite entry | fixture:clone 站在 parent interior 進入格,背後有牆 | 一致 |
| ε 已存在於場內 → 直接進入,不建新的 null-space ε | 授權 / 既有 ε 優先,重用 | 一致 |
| ∞ 已存在 → 原箱被推出該 ∞(彷彿走完整條無限鏈) | 一致(測試已有) | 一致 |
| ∞ 不能進入,只能推 / 離開 | 一致 | 一致 |
| null space:「無法再互動」 | Void 內物件鎖定,只能被推 | 一致 |
| 歸屬 = 第一個進入/離開的 room | seed = 第一個被進入者 | 一致 |
| ε「沒有牆(null space 例外,那裡一切都有牆)」;進入 null-space ε 後「困在裡面」 | **原本不一致**:引擎的 null-space ε 可離開 | **已修正** |

**本輪修改**:`Piece.sealedInterior`。null-space 生成的 ε 為封閉(`computeTarget` 遇到即回傳 blocked),進入後任何方向都出不去;場內既有 / 授權的 ε 仍是無牆、可離開的「ghost cube」。測試 IE07 改為兩種情況。

**仍未被公開資料證實**:進入 ε 後的實際落點格;`infenterid` / `infenternum` 比對;被擠出者處理;ε 的視覺。這些仍要靠你在原版錄製 case5–7。

## ε 設計釐清(使用者,2026-09-21)

- **∞**:因為是 Infinite Exit,只能出不能進(已是如此;新增測試「進入 ∞ 失敗」)。
- **ε**:因為是 Infinite Enter,必須**可進入**,且落點與一般箱子相同——**由進入方向決定進入格**。
  - 修改:Infinite Enter 進入 ε 不再固定落在 (0,0),改為對 ε 呼叫一般的 `tryEnter`(方向 → 該邊中心格,佔位者照一般規則被推 / 處理)。ε 的 interior 由 1x1 改為 3x3 無牆(`EPSILON_SIZE`),才有各邊的進入格。null-space ε 仍封閉:內部可走動,出不去。
  - ε 也可以**不經 Infinite Enter 直接進入**,和 container 完全一樣(測試:四個方向的落點;與同樣 interior 的普通 container 落點相同)。
  - 授權 destination(官方 floating Block + exitblock Ref)原本就走 `tryEnter`,行為不變。
- 測試:`infiniteEnter.test.ts` 新增「ε is an ordinary enterable box (and ∞ is not)」。
- 仍暫定:ε interior 尺寸(3x3);位於 Void 的 ε 仍受「Void 內物件鎖定」,玩家在場內無法從外面直接進入 null-space ε(那個 ε 只在 Void)。

## case6 原版實測修正(使用者截圖,2026-09-21)——**取代上一節的「null-space ε 是 3x3 封閉可進入」**

原版 case6(沒有既有 ε 的 Infinite Enter),往右走一步的畫面:
- 玩家在 **Void 內**,站在 ε 箱的**左側**(進入方向的來源側);沒有進入 ε。
- ε 箱(綠色、ε 符號、金色鎖定框)在 **Void 中心**;Void 是**黑底、灰色邊框、散落暗方塊**,**大小 7x7**。
- 使用者說明:ε 在 Void 中和所有 Void 箱一樣**只能出不能進**;Void 內物件皆鎖定。

引擎修改:
- `VOID_SIZE = 7`、`VOID_CENTER = 3`(原 5x5);新 destination 仍依中心外擴 5x5 的搜尋順序(涵蓋在 7x7 內)。
- null-space ε 改為一般 Void 箱(`kind: 'normal'`,無 interior、無 `sealedInterior`),生成於 Void 中心。Infinite Enter 無既有 ε 時,**玩家落在 ε 旁、進入方向的來源側**(往右 → ε 左側;佔位者沿背向被推開,推不動則該步失敗);不再進入 ε 內部。事件 `SpawnEpsilonEvent.board` 為 Void。
- **場內既有的 ε(有 interior 的 container,不在 Void)仍可進入**:進入方向決定落點,與 container 相同(使用者先前的設計);授權 destination 同。
- renderer:Void 黑底、灰色邊框、24 個確定性(無隨機)暗方塊;ε 箱綠色 + ε 字形 + 既有鎖定框。
- 測試:IE01(位置)、IE07(7x7 邊界、走到邊界外被擋)、IE02(既有 ε 不重生,玩家仍在旁)、differential case6 預測 `(void, 2, 3)`。

**Void 邊界**:7x7 + 邊框 = 陣列邊緣擋住,與截圖一致(先前「31x31 可走出去」為誤判,已還原)。
**仍未證實**:多個 Void 箱的擺放順序(ε 之外)、ε 被推動的行為(引擎:一般推動)。

## case6 再修正(使用者說明,2026-09-21)——**取代上一節「玩家落在 ε 旁」**

截圖中的粉色小方塊其實在 **ε 內部**(約為 ε 的 1/5 大,位於左邊緣中間),不是站在 ε 外面。正確行為:
- Infinite Enter(無既有 ε)→ 在 Void 中心生成 ε 箱;推進來的東西**進入 ε 內部**,落在**進入方向對應邊的中間格**(往右 → 左邊緣中間,即 5x5 內部的 (0,2)),之後**繼續被往右推**。
- **一旦被推出 ε,就在 Void 裡,變成「只能出不能進」的鎖定箱**;ε 本身被推出去也一樣。ε 箱在 Void 中同樣是鎖定的:Void 內的任何東西(包括玩家)不能走進它,只能推它;**只有 paradox 本身能把東西放進 ε**。
- Void 就是 7x7 的空間,可隨意推箱子;**邊緣是推不動的牆,但遊戲不顯示牆格**(引擎:陣列邊緣擋住;renderer 只畫一圈細邊框,與截圖一致,沒有牆格)。

引擎修改:
- ε 又是**有 interior 的 container**(`EPSILON_SIZE = 5`,無牆),位於 Void 中心;`resolveInfiniteEnter` 一律對 ε 做一般的 `tryEnter`(方向決定落點),不再把玩家放在 ε 旁。移除「只能出不能進、無 interior」的一般 Void 箱做法與 `sealedInterior`。
- ε 出來的東西落在 Void 的 ε 旁(一般 exit 爬升),`isInVoid` 自動使其鎖定。
- 測試:IE01(落點 (epsilon:A, 0, 2))、鎖定(Void 內走向 ε 只會推它)、IE07(離開 ε 後鎖定、7x7 邊界擋住)、IE02(重用既有 ε 並進入)、往下進入落在上邊緣中間 (2,0)、differential case6 預測 `(epsilon:p1, 0, 2)`。

仍未證實:ε 內部實際格數(依截圖比例推得 5x5);多個 Void 箱的擺放順序。

## case6 補充(使用者,2026-09-22)

- **ε 內部格數可自訂**:不是待驗證的官方魔數,而是和官方 Block 的 width/height 一樣,本來就是每關自由選擇的值。修正:`EPSILON_SIZE`(固定常數)改為 `DEFAULT_EPSILON_SIZE`,`ensureEpsilonDestination(world, seedId, size?)` 可傳入自訂大小,null-space 情況才用預設值 5。測試鎖定可自訂。
- **多個箱子推入 ε 是一般推箱規則**:進入格 (0,2) 若已有東西,直接照一般 push chain 處理(`tryEnter` 本來就會呼叫 `resolveBlocked`,無需額外程式碼);已補測試「(0,2) 已有 blocker,進入時 blocker 被推到 (1,2)」。
- **被推出 Void 才鎖定,其餘都是正常推箱**:已是現有行為(`isInVoid` 依位置判定),此次澄清沒有發現不一致。

## 上網找到真實關卡驗證(2026-09-22)

**能找到什麼**:找不到官方 350+ 手作關卡的可下載檔案(官方文件只說可從 Unity editor project 內查看 sample inf-enter level,沒有另外提供下載)。但找到第三方 level editor **iwVerve/Parafox**(GitHub,MIT 授權未標示,repo 本身是「a level editor for Patrick's Parabox」)內建的 example 關卡檔,是真正的官方 version 4 格式檔案,其中兩個是**針對 Infinite Exit / Infinite Enter 專門設計的示範關**(`iiexit_intro.txt`、`infenter_line.txt`)。`file_format_example.txt` 與官方文件本身列出的範例逐字相同,可交叉確認官方文件的欄位順序抄錄無誤。

**沒有把這些檔案提交進 repo**(Parafox 沒有標示授權,保守起見不放進使用者的專案),只在暫存目錄暫時載入測試,並用它們揭露的結構寫成**我自己手寫**的 regression 測試。

**發現並修正一個真的 bug**:`iiexit_intro.txt` 用三個 Ref、皆指向 **root 自己的 id**(容器內直接 reference 最外層,不透過 clone)做 Infinite Exit 示範。我的 `officialFormat.ts` 匯入器原本把「Ref → 非 floating Block」一律轉成 `cloneOf: p<targetId>`;但 root 從來不會有自己的 placed piece `p0`,所以 self-loop-via-Ref 進去這關會被 `resolveCloneTeleport` 靜默判定失敗(找不到位置就回傳 null),整個關卡的核心機制被我的匯入器弄壞而不自知。

**根本原因與修正**:官方格式沒有獨立的「clone」欄位——`Ref` 的 `id` 一律指向一個 Board 定義(不是 piece),self-loop、一般 reference、玩家所稱的「Clone」在檔案格式層級是同一種東西:多個 Ref/Block 共用同一個 board(即 Definition/Instance 章節已經做好的「2 Ref → same Definition」)。修正:匯入器不再對非 floating 目標產生 `cloneOf`,一律產生 `boardRef` 共享,和 floating 目標一致。新增測試:`officialFormat.test.ts` 的「shares its board」與「self-loop via Ref works」,後者直接用 `iiexit_intro.txt` 揭露的結構重現並斷言 `applyMove` 不再拋錯。全部 7 個抓到的範例檔重跑都能正常 parse。

**這不影響既有的引擎層 Clone(`cloneOf`/`resolveCloneTeleport`)設計**——那是給「source 是無 interior 的一般 piece」legacy 形態用的(`11-clone-box.json`),仍保留。這次修的只是官方格式匯入器選錯了對應方式。

**看到但沒有採用的新線索(第三方 editor 範例,非官方原始碼,標記待驗證)**
- `infenter_line.txt`:Infinite Enter 的觸發不是靠 clone-in-parent,而是**一個 Ref 直接自我指向包含它的 Block**(比我先前假設的「clone 放進 parent」更簡單),搭配另一個 `exitblock=1, infenter=1, infenterid=0` 的 Ref 指向 floating Block。`infenterid=0` 對應 root 自己的 id,支持我先前「`infenterid` 比對的是 seed 定義的 official id」的實作方向。
- `iiexit_intro.txt`:同一個 root self-loop 同時有**兩個** `infexit=1` 的 Ref,`infexitnum` 分別是 1 和 0——顯示同一個遞迴來源可以同時有多個以 degree 區分的 Infinite Exit destination。目前引擎 `infExitNum` 只保存不比對,這是很具體的「需要比對」證據,但只有一個第三方樣本,不足以推出比對演算法,沒有動引擎行為。
- `exitblock` 出現在**不是** floating 目標的 Ref 上(`order_elbow_push.txt`、`iiexit_intro.txt` 皆有),暗示它可能與「多個 Ref 共用同一個 Definition 時,哪一個是 canonical exit instance」有關——這正好是 Phase 4 的懸而未決問題。只是一個假設,證據不足以動 `findContainerFor` 的邏輯,先記錄。

來源:https://github.com/iwVerve/Parafox (`Parafox/datafiles/example/*.txt`)。

## Zygahedron/Parabox-Editor 原始碼核對(2026-09-22)——**解決 Phase 4 懸案**

使用者提供第二個第三方 editor:https://github.com/Zygahedron/Parabox-Editor (Python)。

**這個 editor 能確認什麼、不能確認什麼**:`level.py` 只有 `Block` / `Ref` / `Wall` / `Floor` / `Level` 的資料模型與存讀檔(`save()` / `__init__` parse)、繪圖(`draw`)、editor 選單(`menu`),**完全沒有 push / enter / eat / resolve / move / simulate 之類的移動邏輯**(grep 確認)。所以它不能像原版遊戲一樣被操作驗證,**不能拿來確認「所有遊戲設計」**——它跟我自己的 `officialFormat.ts` 一樣,只是檔案格式的讀寫層,不是 runtime 权威來源。

**但它確認了一個具體、重要的格式語意**,直接解決先前標為「待對拍」的 Phase 4 問題:

```python
# Ref.__init__:
self.exitblock = to_bool(exitblock)
if self.exitblock:
    block = level.blocks[self.id]
    if block.exit:
        block.exit.exitblock = False   # 拿掉前一個持有者的旗標
    block.exit = self                  # 這個 Ref 成為該 Block 唯一的 exit

# 編輯器選單同樣邏輯(手動勾選 Exit Block 時強制唯一)。
# Level.__init__ 讀檔後再次確認:
if int(exitblock) and not int(infenter):
    ref_exits[int(id)] = ref
...
block.exit = ref
```

**確認的規則**:`exitblock=1` 在同一個 Block id 上**最多只有一個 Ref 能持有**,editor 主動強制唯一性(設定新的就清掉舊的)。這代表官方欄位 `exitblock`(doc 原文「this ref is the level's exit block」)就是「多個 Ref 共用同一個 Definition 時,哪一個是 canonical exit instance」的正式機制——不是我先前的臆測。另外 `infenter` 與一般 exit 是分開的角色:同時是 `infenter` 的 exitblock Ref 不會被當成該 Block 的一般 `exit`。

**已修改**(`types.ts` `findContainerFor`):在共用 definition 的候選中,優先選「`exitBlock === true` 且 `infEnter !== true`」的那個;沒有被標記的情況(未授權關卡、生成器輸出)才退回原本「id 排序最小」的暫定規則。測試:`definitionInstance.test.ts` 新增兩則(exitBlock 決定退出位置、exitBlock+infEnter 不搶一般 exit)。

**信賴等級**:仍是第三方 editor 作者的理解,不是原版原始碼或原版對拍,但這是**主動維護唯一性 invariant** 的證據(不是偶然巧合),比先前完全沒有證據的「id 最小」臆測可信得多。全部 498 測試通過,`tsc` 乾淨。

## 使用者提供的社群樣本關卡(2026-09-22)

使用者親自下載並提供 7 個 Parafox 範例檔(與先前我抓取的內容逐位元組相同,僅 CRLF 差異),要求用來測試。已正式收錄:

- `docs/differential/community-samples/*.txt` + `README.md`(說明來源、非官方原版關卡、未主張授權)。
- `src/game/engine/communitySamples.test.ts`:9 則測試,直接載入這些真實檔案斷言:
  - `file_format_example.txt`:兩個 self-loop Ref 正確共用 root 的 board。
  - `iiexit_intro.txt`:self-loop-via-Ref 不再產生不存在的 `cloneOf` 目標(先前那個 bug 的直接回歸測試);兩個 `infExit` piece 的 `infExitNum` 確實不同(0 與 1),證實 degree 用於區分多個目的地。
  - `infenter_line.txt`:`infiniteEnterRegistry` 找到恰好一個 authored destination。
  - `order_elbow_push.txt`:`attempt_order enter,eat,push,possess` 正確解析成 `['enter','eat','push']`(possess 被捨棄)。
  - `clone_rescue_ref_2.txt`、`hungry_flip.txt`:載入並可移動,`fliph` 欄位正確讀出。
  - `poswall_first.txt`:僅測「能解析」,因為 possessable wall 是本引擎未實作的機制(wall 在本引擎裡不是 piece,無法表達 possess)。

全部 507 個測試通過,`tsc` 乾淨。這批仍然**不是**原版遊戲的權威驗證,只證明匯入器對真實外部檔案的相容性與先前修正的正確性。

## 社群樣本轉為可玩關卡(2026-09-22)

7 個檔案全數通過(`communitySamples.test.ts` 9 則測試皆過)。已轉成本引擎 JSON 格式,可在 app 內直接遊玩:

- `tools/generator/convertCommunitySamples.ts`:一次性轉換腳本,讀 `docs/differential/community-samples/*.txt` → 寫 `src/levels/builtin/community-samples/*.json`(用 `parseOfficialLevel` 解析、`serializeLevel` 輸出)。新增樣本後可重跑。
- `src/levels/index.ts`:新增 `loadCommunitySampleLevels()`,關卡名稱加上「[社群]」前綴以便在關卡選單分辨,和自己出貨的 13 關、生成關卡分開。
- `src/App.tsx`:併入 `allLevels`,關卡選單會直接看到這 7 關。
- 測試:`loadCommunitySampleLevels` 新增於 `src/levels/index.test.ts`(7 關、id 不重複、皆未過關),**刻意不測 solvable**——`iiexit_intro` 已知會讓本專案的 BFS solver 記憶體炸開,那是 solver 預算問題,不代表關卡真的無解。

全部 508 個測試通過,`tsc` 乾淨,`vite build` 成功。

**提醒**:`poswall_first` 用到 possessable wall,本引擎沒有 possess 機制,那關實際玩起來會缺少該機制對應的行為(牆會是普通牆,無法 possess)。其餘 6 關的機制(self-loop、reference/clone、infinite exit/enter、flip、自訂 attempt_order)本引擎都有對應實作。

## 原版遊戲截圖驗證:∞ 符號是靜態渲染規則,不只是 Void 才有(2026-09-22)

使用者提供 **`iiexit_intro.txt` 在原版遊戲中的實際截圖**(非我的引擎、非第三方 editor——這是目前唯一一次拿到真正原版畫面)。畫面顯示:

- 中央:粉紅色、兩個圓點眼睛的箱子 = 玩家本體(對應檔案 `Block 4 3 1 5 5 0.9 1 0.7 1 1 1 1 0 0 0 0`,hue=0.9 為官方 palette 的 Player 色;同時 `fillwithwalls=1` 與 `player=1` 兩個欄位同時為 1,證實我的匯入器「player 優先於 fillwithwalls」的判斷是對的)。
- 左上藍框房間:一般巢狀預覽(三個小方框 + 玩家縮影),**沒有 ∞ 符號**——對應檔案裡唯一沒有 `infexit` 標記、只有 `exitblock=1` 的那個 self-loop Ref `(1,5)`。
- 右上黃框房間:單一箱子直接顯示 **∞∞ 眼睛**,沒有任何巢狀內容——對應 `infexitnum=0` 的 Ref `(7,5)`。
- 下方黃框房間:箱子顯示 ∞∞ 眼睛,**裡面還嵌套一個更小、同樣是 ∞∞ 眼睛的箱子**——對應 `infexitnum=1` 的 Ref `(4,1)`:先展開一層真正的遞迴,再在那一層畫 ∞。

**發現**:`infexit`/`infexitnum` 不是(或不只是)先前以為的「Void 內多目的地比對用的 degree」,而至少是一個**渲染規則**:在關卡本身(還沒觸發任何 paradox 前)靜態顯示——「這是一個已知會無限遞迴的 Ref,遞迴展開 `infexitnum` 層真實內容後,改畫 ∞ 符號,不管畫面預算還夠不夠繼續縮小」。沒被標記的 self-loop 完全不受影響,照舊只受既有的像素/深度預算限制。

**已實作**(`CanvasRenderer.ts`):
- `drawBoardRecursive` 新增 `pathBoardCounts` 參數,沿目前遞迴路徑記錄「這個 board id 已經進入過幾次」。
- 對每個 container piece:若 `infExit === true`,目標 board 在路徑上已出現次數超過 `infExitNum ?? 0`,就在該 piece 自己的格子畫 `∞`,不再往下遞迴;`infEnter === true` 同理畫 `ε`(尚未有畫面證據,依對稱性實作,標記較低信賴)。未標記的一般 container / self-loop 完全不受影響。
- 測試:`staticParadoxGlyph.test.ts`,直接用真實的 `iiexit_intro.txt` 檔案驗證三個 Ref 的三種畫面结果,並確認極端像素預算不會替未標記的 Ref 生出不該有的符號。

全部 512 個測試通過,`tsc` 乾淨,`vite build` 成功。

**風險與限制**:`ε` 的靜態渲染規則沒有截圖佐證,是依對稱性推測;`infExitNum`/`infEnterNum` 是否**同時**還有先前假設的「Void 目的地比對」用途,仍未證實——這次只確認了渲染面的行為,沒有動 `resolveInfiniteExit`/`resolveInfiniteEnter` 的 gameplay 邏輯。

## Parafox 原始碼核對(2026-09-22)——**推翻並修正上一節的 ∞/ε 渲染模型**

使用者提供 `Parafox.zip`。這是**編譯後的執行檔**(GameMaker `data.win` + `Parafox.exe`),不是原始碼,`data.win` 是二進位打包格式,只能靠 grep 撈出字串常數(`infenter`/`infexit`/`exitblock`/`fillwithwalls`/`attempt_order`/`possess` 均存在,但沒有可讀邏輯)。改到 GitHub(`iwVerve/Parafox`)抓真正的 GML 原始碼(`objects/objBlock/Create_0.gml`、`objects/objRef/Create_0.gml`、`objects/objWall/Create_0.gml`、`objects/objFloor/Create_0.gml`、`scripts/scrEnum/scrEnum.gml`)。

**這個 editor 同樣沒有任何移動/模擬邏輯**(第三次確認:官方文件、Zygahedron/Parabox-Editor、這個 GameMaker 版都一樣,只有存讀檔與畫面預覽,沒有 push/enter/eat/resolve)。它能確認的是「欄位語意」與「作者自己的理解」,不能確認 runtime 判定演算法。

**逐欄位比對(完全吻合,信心提升到最高)**
- `Block` 16 個欄位順序:`x y id width height hue sat val zoomfactor fillwithwalls player possessable playerorder fliph floatinspace specialeffect`——與我的 `BLOCK` 常數完全一致。
- `Ref` 15 個欄位順序:`x y id exitblock infexit infexitnum infenter infenternum infenterid player possessable playerorder fliph floatinspace specialeffect`——與我的 `REF` 常數完全一致。
- `Wall` 新增欄位:`player possessable playerorder`(我先前只讀 x,y,其餘欄位捨棄——possess 未實作,合理維持現狀)。
- `Floor` type 除了 `Button`/`PlayerButton`,還有 `FastTravel`/`Info`(我的匯入器只支援前兩者,遇到其他會直接報錯,不會靜默吞掉——安全但不完整,尚未修)。
- `enum ATTEMPTORDER = PUSH, ENTER, EAT, POSSESS`——與官方 `attempt_order` 預設順序一致。

**推翻並修正:∞/ε 不是「遞迴 N 層後改畫一個符號」,而是「N+1 個符號疊放在同一格,遞迴照常不受影響」**

`objRef` 的 `draw()`(GML,節錄):
```
with(findBlockByIndex(index)) { draw(rect.clone(), level+1, false); }   // 一律遞迴,不受 infexit 影響

if (infexit) {
    for (var i = 0; i < (infexitnum + 1); i++) {
        // 在同一個 rect 內,垂直切成 infexitnum+1 等分,每一格畫一個 ∞ sprite
    }
}
```
以及屬性面板 tooltip:`Infinite Exit Num.` = **「0 = 1 infinity」**,`Infinite Enter Num.` = **「0 = 1 epsilon」**。

這與上一節(依單一張原版截圖推論)實作的「遞迴 `infExitNum` 層真實內容,超過就改畫一個 ∞」**不符**。這份是**明確、無需詮釋的原始碼**,比對一張低解析度截圖的推論證據力更強——重新檢視那張截圖:下方黃框房間的兩個 ∞∞ 圖案更符合「同一格內垂直疊放 2 個徽章,中間露出一點縮小的遞迴內容」,而不是「外層一個、內層一個」的兩層巢狀。

**已修正**(`CanvasRenderer.ts`):
- 移除 `pathBoardCounts` 與「超過門檻就以符號取代遞迴」的邏輯,遞迴判斷回到單純的像素/深度預算,`infExit`/`infEnter` 完全不影響是否繼續遞迴。
- 新增 `staticParadoxBadge` + `drawParadoxBadgeStack`:`infExit`/`infEnter` 為真的 piece,在自己格子內疊放 `(infExitNum ?? 0) + 1` 個符號(垂直等分),與遞迴內容**同時**繪製(遞迴內容照舊畫在下面,徽章疊在上面),不論預算是否還夠。
- 測試整批重寫為 `staticParadoxBadge.test.ts`(5 則):用精確座標比對(不是包圍盒),因為這個範例檔三個 self-loop Ref 全部指向 root,任一個的遞迴內部都會再嵌入其他兩個的縮小副本,包圍盒式檢查會誤把嵌套內容算成同一格——確認度數 0/1/3 時徽章數與位置正確、未標記的 Ref 永遠沒有徽章、標記的 Ref 遞迴不會被徽章縮短或拉長。

**exitblock 的補充理解**:`objRef` 屬性欄位 tooltip 寫「Allows infinite nesting in both directions」,比 Zygahedron 版本的「唯一 exit 持有者」講法更具體,暗示語意可能是「預設只能單向巢狀(進去看得到,退出不一定走這裡),打勾才允許雙向」,而不只是單純的「多個 Ref 選一個當 canonical exit」。兩份第三方原始碼在「同一個 Block id 最多一個 Ref 該被特殊對待」這件事上互相印證,`findContainerFor` 的現有實作(優先選 `exitBlock` 者)予以保留;但這個更細的「雙向」語意目前無法從純 UI/存檔邏輯反推,**仍待原版對拍**,未改動 gameplay resolver。

全部 513 個測試通過,`tsc` 乾淨,`vite build` 成功。

**教訓記錄(誠實檢討)**:上一節我把「一張截圖的一種合理解讀」寫得太篤定,實作前應該先確認是否有更直接的證據(這次的原始碼)。這次的修正過程本身也是個提醒:原始碼 > 截圖推論 > 純文件描述,證據等級不同時,新證據出現要願意推翻先前結論,而不是硬凹兩者都對。

## 修正:Infinite Exit 從未檢查關卡內既有的 ∞ 箱(2026-09-22,使用者回報 + 直接測試確認)

使用者指出 `iiexit_intro.txt` 仍然錯誤:關卡裡已經有 ∞ 箱時,推自我包含箱到邊緣**不會**進 Void,而是**從那個 ∞ 箱被推出來**;把那個被推出的箱子再推到邊緣,會從**下一個(度數更高)的 ∞ 箱**被推出來,依此類推(∞ → ∞∞ → ∞∞∞…);∞ 系列箱子一律只能出不能進;**只有關卡裡完全沒有這種箱子時,才會在虛空中心生成一個**。

**確認方式**:直接對 `iiexit_intro.txt` 跑 BFS 搜尋(不是手推,程式搜出真實合法路徑),找到目前(修正前)進 Void 的最短路徑 `down,left,left,left,down,down,down,down`——玩家把 `ref0`(canonical 的一般 self-loop,`exitBlock=true`)推到開放的下邊界(這關的圍牆其實留了下緣缺口,非畫面直覺的位置),此時 `ownerId` 恆為 `ref0` 自己(它是 `findContainerFor('b0')` 的唯一持有者)。**修正前**,這個 `ownerId` 直接進 Void,完全忽略關卡裡另外兩個 `infExit` 旗標的 Ref(`(7,5)` 度數0、`(4,1)` 度數1)。

**根本原因**:`ensureInfiniteDestination`/`resolveInfiniteExit` 只認自己合成或手動打上 `infiniteFor` 標記的 Void 目的地,從未檢查關卡內單純以 `infExit` 旗標存在的 Ref。

**已修正**:
- `types.ts` 新增 `findAuthoredInfiniteExitCandidates(world, ownerId)`:同家族(與 ownerId 目標同一個 board,即同一個遞迴 Definition)、`infExit===true`、排除 ownerId 自己,依 `infExitNum` 升冪排序。`infExit` 沒有像 `infEnterId` 那種「指定對象」欄位,家族判定只能靠「目標 board 相同」。
- `rules.ts` `resolveInfiniteExit` 改為:先照升冪嘗試每個 authored 候選的 eject(失敗就換下一個),全部失敗才退回 Void(原行為不變,只是延後觸發)。
- **度數推進**:新增內部欄位 `Piece.infExitDegreeUsed`(非官方欄位,純引擎內部狀態)。同一個逃逸中的 piece 第二次觸發 Infinite Exit 時,只考慮 `infExitNum > 上次用過的度數` 的候選,不會退回較低度數(即使那格目前是空的)——這點經**直接測試證實**:讓同一個 `ref0` 觸發兩次,第二次確實換到下一個度數,而不是又跳回同一個。

**測試**
- `authoredInfiniteExit.test.ts`(10 則):`findAuthoredInfiniteExitCandidates` 的家族/排序/排除;`resolveInfiniteExit` 直接呼叫驗證第一次用度數0、第二次推進到度數1、兩個度數都用完後才落回 Void、完全沒有 authored 候選時原行為不變。
- 端到端:用**真實 `iiexit_intro.txt`**+ BFS 找到的真實合法路徑(不是我編的),確認修正後不進 Void、正確落在度數0箱旁;另一條 9 步延伸路徑確認能推進到度數1,同樣不進 Void;undo 完整還原;重播結果具確定性。

全部 523 個測試通過,`tsc` 乾淨,`vite build` 成功。

**仍是 PROVISIONAL,未驗證**:
- 度數用完後是否真的落回 Void(這關只有 2 個度數,無法驗證是否應該「循環回度數0」而非落回 Void)——目前選擇落回 Void,是較保守、不外推的假設。
- 家族判定「目標 board 相同即同家族」對這關(3 個 Ref 全指向 root)成立,但若未來出現「經過中繼 board 才到達真正循環處」的 tail case,`ownerId`(attribution seed)的目標 board 不一定等於真正循環的 board,這裡的家族判定可能不準——已知限制,未處理。

## 修正:∞ 箱本身可以被走進去(2026-09-22,使用者回報)

使用者指出:∞、∞∞ 系列箱子本身就是「被無限推出的結果」,所以**本體永遠不能被進入**——不只是站在 Void 裡的那些才不能進,關卡裡任何 `infExit` 標記的 Ref 都一樣。

檢查後確認引擎確實有這個洞:`infExit` 標記的 Ref 在一般關卡板上時,只是普通的 self-loop container,`tryEnter` 完全沒有檢查這個旗標,玩家可以正常走進去。

**已修正**:`tryEnter` 在確認 `into.kind === 'container'` 之後,新增 `if (into.infExit === true) return null`——不論這個 piece 在 Void 裡還是在一般關卡板上,一律不能進入;仍可被推、可被吃(依 attempt_order)。`infEnter` 標記的 authored ε destination不受影響,維持可進入(它本來就是設計給玩家走進去的)。

**視覺**:同步比照使用者指示,把 Void 裡「只能出不能進」piece 既有的金色鎖定框效果,擴大套用到任何 `infExit` 標記的 piece,不論在不在 Void——`renderBoard`(legacy)與 `drawBoardRecursive` 兩處渲染都改了同一個條件(`board.id === VOID_BOARD_ID || piece.infExit === true`)。

**測試**:`authoredInfiniteExit.test.ts` 新增「走進 infExit 箱失敗,推得動時仍可推」「推不動時整步失敗、不會退而求其次進入」;`CanvasRenderer.test.ts` 新增「一般關卡板上的 infExit 箱也畫金色鎖定框」(legacy 與遞迴渲染各一則)。

全部 527 個測試通過,`tsc` 乾淨,`vite build` 成功。

## 修正:Infinite Exit 的度數由「逃逸的東西是什麼」決定(2026-09-23,使用者回報)

使用者回報 `iiexit_intro`:一般自包箱推到邊緣 → 從 ∞ 出來 OK;∞ 箱推到邊緣 → 從 ∞∞ 出來 OK;之後再推到邊緣一次卻進了 Void,應該從關卡內的 ∞ 出來。這關要進 Void 必須是 ∞×3(關卡內沒有,才在 Void 生成 ∞∞∞)。

**撤回上一版的錯誤規則**:上一節寫的「同一個 piece 每逃逸一次就往上推一個度數」(`infExitDegreeUsed`),我當時標成「直接測試證實」,其實只證實了我自己程式照我寫的方式運作,**從未對照原版**,是過度宣稱。這正是這次 bug 的原因:一般自包箱第三次逃逸時被要求度數 2,找不到就進了 Void。

**正確規則**(`rules.ts` `infiniteExitDegreeOf`):
- 逃逸的是一般 piece(箱子、玩家、一般自包箱)→ 度數 0(從 ∞ 出來),**不論逃逸過幾次**。
- 逃逸的是同家族度數 d 的 ∞ 箱(關卡內 `infExit` Ref,或 Void 生成的 ∞)→ 度數 d+1(從 ∞∞、∞∞∞… 出來)。
- 只接受**度數完全相符**的關卡內 ∞ 箱;關卡沒有該度數(或全都接不下)才在 Void 中心生成該度數的箱子。Void 目的地以 (owner, 度數) 為鍵,度數 >0 的 id 為 `void-infinite:<owner>:<度數>` 並帶 `infExitNum`,渲染成度數+1 個 ∞ 疊放(與關卡內同度數箱子一致)。
- 移除 `Piece.infExitDegreeUsed`(型別、schema 驗證、邏輯、測試)。

**驗證**(BFS 在真實 `iiexit_intro.txt` 上搜出的合法路徑):一般自包箱推出 → 落在 ∞ 旁;在自包箱貼邊時把 ∞ 推出 → 落在 ∞∞ (4,1) 正下方 (4,2);之後再把一般自包箱推出 → 落在 ∞ (4,2) 正下方 (4,3),**不進 Void**;從該狀態 BFS 14 步內找不到任何進 Void 的路徑。單元測試:度數 0/1/2 的去向、∞∞ 逃逸時關卡無度數 2 → Void 中心生成 ∞∞∞、同度數 Void 箱重用不重複、Void ∞∞∞ 畫 3 個符號。

全部 532 個測試通過,`tsc` 乾淨,`vite build` 成功。

**已知限制(未改)**:∞ 箱本身貼著邊緣時,從它「推出」的那一格在板外,目前視為該目的地失敗、改用下一個候選或 Void。原版此時可能是把推出當成一次普通移動(再經過自包箱爬出),尚未驗證。BFS 在同一關可以走到這個情況(∞ 箱被推到底邊後,自包箱再逃逸)。

## 修正:自包箱與 ∞ 箱同時在邊緣時應從 ∞∞ 出來(2026-09-24,使用者回報)

使用者回報:把自包箱跟 ∞ 箱都推到邊緣後再推出,應從 ∞∞ 箱出來(關卡內有 ∞∞,不進 Void)。

原因(BFS 找到兩種錯誤路徑):

1. ∞ 箱貼在同一邊緣(未堆疊,例如 ref0 在 (1,8)、ref2 在 (7,8) 往下推)。從 ∞ 箱出來會再次離開棋盤,舊程式直接把它當失敗改走 Void。
2. ∞ 出口格正是推動者(玩家)這一步要離開的格子。舊程式把「出口格被同一推動鏈佔據」一律視為失敗,改走 Void。

修正(`src/game/engine/rules.ts` 的 `tryEjectFrom` / `resolveInfiniteExit`):

- `tryEjectFrom` 回傳 `ok` / `offEdge` / `blocked` 三種結果。
- 出口格是推動鏈的第一個移動者(最後面的推動者)時可以落地;是自己或推動鏈中其他成員時為 `blocked`。
- 度數升級:該度數的 ∞ 箱全部在推動鏈中,或任一個貼邊(`offEdge`),則升到下一度數。
- 該度數的 ∞ 箱存在但出口被牆或推不動的箱子擋住:整步不能移動(不再改走 Void)。
- 只有關卡內完全沒有該度數的箱子時才在 Void 生成該度數的箱子。

驗證:回歸測試在 `src/game/engine/authoredInfiniteExit.test.ts`(兩個新情境)。iiexit_intro 深度 40 BFS(94,074 個狀態):0 重疊,0 次進入 Void。

**PROVISIONAL**:貼邊時升級度數、以及推動鏈中誰落在哪一格,是依使用者描述推導,未對照原版原始碼逐格確認。

## 修正:鎖定白框太粗,擋住虛空箱子裡的玩家(2026-09-24,使用者回報)

自包箱推進虛空後,引擎狀態正確:自包箱在 Void 裡,玩家仍在它的內部,原本的自我包含迴圈解除。問題只在渲染:鎖定白框線寬是 `cellSize / 8`,鏡頭放大到箱子內部時(一格約 432px),線寬約 54px,蓋住玩家所在的邊緣列。修正:`CanvasRenderer.ts` 的 `outlineWidth()` 把鎖定白框、Void 邊框、linkedTo 邊框限制在 2–6px。回歸測試在 `CanvasRenderer.test.ts`。

## 修正:官方檔案的 y 軸方向;eat 只在推不動時觸發(2026-09-24,使用者提供實機截圖)

**y 軸**:使用者提供 `order_elbow_push` 的實機截圖。檔案裡 y=7 的 PlayerButton 在畫面第 2 列,y=5 的玩家在第 4 列,可見檔案的 y 由下往上數。原本匯入器不翻轉,所以關卡上下顛倒。修正:`parseOfficialLevel` 與 `exportOfficial` 的 `flipY` 預設改為 true。iiexit 系列測試改用翻轉後的座標(y → 8−y,上下方向互換);物理規則上下對稱,測試情境本身不變。`iiexit_void3.txt` 不需改檔:∞∞ 從凹槽往外移一格,在正確方向下是往上一格。

**eat**:使用者在實機觀察到,即使自訂 `attempt_order` 把 eat 排在 push 前面,箱子後面有空地時仍然是被推動,不會被吃掉。修正:`resolveBlocked` 輪到 eat 時,若該箱子推得動就跳過 eat,之後輪到 push 時推動。使用者補充:eat 與進入 container 使用相同的落點規則(對方那一側邊緣中心那格要能進去)。引擎的 eat 本來就呼叫同一個 `tryEnter`,已用測試確認。測試在 `rules.test.ts` 的 "eat only when the occupant cannot be pushed"。

## 修正:push 永遠最先嘗試,attempt_order 只決定 enter / eat 的先後(2026-09-24,使用者實機回報)

上一節只讓 eat 讓位給 push,但 `order_elbow_push` 的藍色箱子從上或下被推時仍然是「走進去」。原因是自訂順序 `enter,eat,push` 讓 enter 排在 push 前面。使用者在實機觀察:箱子後面沒有牆就會被推動。修正:`resolveBlocked` 一律先嘗試 push;push 失敗後才依 `attempt_order` 嘗試 enter / eat(順序中的 push 項目被略過)。上一節 eat 專用的判斷已併入這條規則並移除。本文件第 8 行「Priority 附錄可用 `enter, eat, push`,先進入」的描述因此失效;舊測試 "enter-first order enters the same container" 改為:後面有空地時推動,推不動時才進入。另加測試確認 push 失敗後 `attempt_order` 仍決定 enter 或 eat。

**PROVISIONAL**:這條規則來自一個關卡的實機觀察。`attempt_order` 在原版中是否還有其他作用(例如 possess 的順序)未驗證。

## 鏡頭與外觀重做(2026-09-25)

**鏡頭**:依 `docs/superpowers/specs/2026-09-18-camera-framing-design.md` 實作 `cameraForFocus`(取代 `cameraForPlayer`)。鏡頭只取決於玩家站在哪個 board,不取決於玩家在 board 內的位置,所以一般移動鏡頭不動,只有進出箱子、傳送、進出 Void 時才重新取景。玩家在最外層時顯示整個 board 加一圈邊距;在箱子內時,以外層 board 為基準,顯示整個箱子加外層一圈格子(`DEFAULT_RENDER_BUDGET.marginCells = 1`)。遊戲畫面放大為 `min(100%, 68vh)`,上限 720px。

**外觀**(參考使用者提供的實機截圖):每個 board 用它所屬箱子的顏色繪製,牆是較亮的色調,地板是較暗的色調;最外層是淺灰牆、深灰地板。牆會在下方和右側的地板投下陰影。每個 piece 有深色外框;玩家與玩家目標有兩顆眼睛;目標格是淺色空心方框。官方關卡的方塊顏色(hue / sat / val)現在由 `parseOfficialLevel` 匯入到 `Board.color` / `Piece.color`(`levelSchema` 驗證格式為 `#rrggbb`)。∞ / ε 符號改為白色並放大。裝飾一律用 path 繪製,`fillRect` 仍維持每格、每個目標、每個 piece 各一次,既有渲染測試的呼叫數不變。

**補充(2026-09-25,使用者回報)**:最外層 board 若本身在某個箱子裡(自包關卡),畫面邊距不再是黑色,而是那個箱子在自己 board 上的周圍格子。`resolveDrawRoot`(`recursiveTransform.ts`)從外兩層開始繪製,並調整縮放,讓擁有者那一格剛好蓋住原本的 board,所以鏡頭座標不變。一般樹狀關卡的最外層和 Void 仍從自身繪製。遞迴繪製門檻 `minCellPixels` 由 4 降為 2,縮小的自包箱也畫得出內部。

**補充(2026-09-25,使用者要求)**:分身箱子比原本的箱子更淺、更亮(`isCloneInstance` + `CLONE_LIGHTEN = 0.4`),外殼和內部都套用。分身指兩種:`cloneOf` piece,以及同一個 board 的第二個以後的 Ref instance(正規擁有者是 `findContainerFor` 選出的另一個 piece,通常是 exitBlock 那個)。∞ / ε 箱子不算分身,它們用自己的符號標示。

## 玩家本身也可以是箱子(2026-09-25,使用者要求)

官方格式中 `player=1` 且 `fillwithwalls=0` 的 Block 是有內部的玩家:別的方塊可以被吃進或推入玩家體內,玩家體內的方塊也能從玩家的位置被推出。實作:新增 `hasInterior(piece)`(container,或帶 `boardRef` 的玩家),`tryEnter`、`targetDefinitionOf`、`findContainerFor`、`levelSchema` 的擁有者檢查、渲染器與鏡頭的擁有者判斷都改用它。`parseOfficialLevel` 對沒有 fillwithwalls 的玩家 Block 建立內部 board。`fillwithwalls=1` 的玩家仍是實心的。有內部的玩家會畫出內部,眼睛改為淺色。測試:`playerBox.test.ts`。測試關卡:`player_box_eat.txt`。

**未實作**:possess(`possessable` 旗標與 `attempt_order` 中的 possess)。`poswall_first` 關卡仍無法 possess。

## 修正:穿過翻轉箱子的東西本身也會翻轉(2026-09-25,使用者在 hungry_flip 回報)

原本 fliph 只讓方向鏡像。修正後(`rules.ts`):
- 進入或穿出 fliph 箱子的東西,本身的 `fliph` 會切換。不對稱的箱子(例如 hungry_flip 裡本身是箱子的玩家)出來後是鏡像的,可進入或吃東西的那一側也跟著翻轉。
- 垂直進出 fliph 箱子時,橫向位置也會鏡像(內部第 x 欄,從外面看是第 size−1−x 欄)。
- 穿出 fliph 箱子後,繼續推動使用鏡像後的方向;進入 fliph 箱子後,內部推動使用 `entryDir`。`computeTarget` 的結果新增 `dir` / `flipped`,只在經過 fliph 箱子時出現。

驗證:`flipTransit.test.ts`。其中 hungry_flip 由 BFS 找到 45 步解,第 4 步玩家穿過翻轉的自包箱後翻轉。實機截圖確認玩家內部開口由右側變為左側。

**未處理**:Infinite Exit / Infinite Enter 的彈出路徑不計算翻轉次數。

## 移動與翻轉動畫(2026-09-25,使用者要求)

- 所有移動的箱子和玩家都會平滑移動,不再瞬間切換。同一個 board 內沿用 `getRenderLocationFactory` 插值,現在各種移動都套用(Void 轉場除外)。
- 換 board 的移動(進出箱子、被吃進去):`moveAnimation.ts` 的 `pieceCellInAnchor` 算出移動前後在畫面座標中的格子(含 fliph 鏡像),`interpolateCell` 讓中心直線移動、大小依幾何比例縮放。動畫期間該 piece 從一般繪製中隱藏(`hiddenPieces`),改在最上層繪製。
- 翻轉:本次 `fliph` 改變的 piece 做水平翻面(scale −1 → 0 → 1,`flipScaleAt`)。
- `CanvasRenderer.ts` 把單一 piece 的繪製抽成 `drawPiece`,供一般繪製和動畫疊加共用。動畫時間:一般移動 150ms,進出箱子 280ms。

## 附身 possess(2026-09-26,使用者要求)

玩家走進可附身(`possessable`)的方塊或牆壁,且推、進入、吃都失敗時(例如後面是牆),控制權轉到那個方塊上。possess 永遠最後嘗試,符合官方預設順序 push, enter, eat, possess,所以推得動的可附身方塊會被推動而不是被附身。實作(`rules.ts` 的 `possess`):玩家與目標交換身分,位置都不變。被附身的方塊成為玩家,保留自己的外觀、位置和內部;舊身體留在原處變成一般方塊(有內部就是 container),並保留 `possessable`,可以再附身回去。引擎會發出 `PossessEvent`;畫面用它避免兩個身體互相滑動,只有鏡頭移動。

官方格式:Block 第 11 欄、Ref 第 10 欄是 `possessable`;Wall 的 `player` / `possessable` 欄位(第 2、3 欄)為 1 時,改成牆壁方塊(`wall: true` 的 piece):平常像牆一樣推不動、不能被吃,被附身後就能像玩家一樣移動和推東西。畫面上,可附身的方塊有淡色空眼,牆壁方塊用牆色。`poswall_first` 由 BFS 找到 19 步解,過程中會附身到牆上。測試:`possess.test.ts`。

## 修正:進入 exitblock 在自身內部的箱子後,鏡頭卡在角落(2026-09-26,使用者在 file_format_example 回報)

原因:綠色 Block 1 的內部有一個指向自己、且標為 exitblock 的 Ref。`findContainerFor(b1)` 回傳這個內部 Ref,所以鏡頭往外找時只會在 b1 裡繞圈,到不了最外層,結果退回預設鏡頭(0.5, 0.5)。

修正(`recursiveTransform.ts`):新增 `ownerPathToAnchor`,往外找一條真正能到達最外層的擁有者路徑。每一步仍優先正規出口,走不通就改用其他 instance(這裡是放在最外層的綠色 Block 本體)。`resolveCanonicalBoardTransform`、鏡頭 Case 1、移動動畫的 `pieceCellInAnchor` 都改用這條路徑(`boardTransformInAnchor`),並同時處理 fliph 鏡像(過去鏡頭沒有鏡像 x)。遊戲規則(`computeTarget` 的往外爬)不變。回歸測試在 `camera.test.ts`,實機截圖確認正確。

**更正(2026-09-26,使用者指正)**:上一節讓鏡頭改走「能到達最外層」的路徑,把綠色箱子框在 root 上,這是錯的。綠色箱子的出口 Ref 在自己內部,所以進去之後往外走只會回到綠色箱子本身;玩家就在「綠色包綠色」的迴圈裡,畫面也應該這樣呈現。修正(`camera.ts` 的 `effectiveAnchorBoard`):沿引擎的出口路徑(`findContainerFor`,和 `computeTarget` 往外爬相同)往外找;若在到達最外層前就繞回來,就以這個迴圈(其中最小的 board id)作為鏡頭基準。`CameraTransform.anchorBoardId` 記錄這個基準,畫面從它開始繪製,外圈由 `resolveDrawRoot` 畫出迴圈本身。基準不同的兩個鏡頭之間不做插值,改用淡出淡入。`ownerPathToAnchor` 仍保留給一般繪製座標使用。回歸測試(`camera.test.ts`)已改為預期 `anchorBoardId === 'b1'`。

## 修正:在自包箱裡走到邊緣兩次就掉進虛空(2026-09-26,使用者在 file_format_example 回報)

情境:在綠色箱子 b1 內,出口 Ref ref2 位於中央 (1,1)。玩家站在 ref2 正旁邊的邊緣格往外走時,經由 ref2 出去,落點是 ref2 的旁邊,也就是玩家自己原本那一格。先前(2026-09-24 為 iiexit 所加的規則)「落回自己的格子」一律當作無限出口,所以玩家掉進虛空。

修正(`tryMovePiece`):落回自己的格子時,若移動者是推動鏈最前面、自己走的那一個(`inMotion` 為空,帶它出去的箱子沒在動),就是合法的原地移動,狀態不變,只是往外走了一層。其他情況(例如 iiexit 裡被推的 ∞ 箱經由同一次推動中也在移動的自包箱出去)維持無限出口,改從 ∞∞ 出來。碰到中央的 ref2 並把它推出邊緣時,它經由自己出去,仍是無限出口,因為關卡裡沒有 ∞ 箱,所以進入虛空。

**影響**:iiexit 系列關卡中,玩家自己走、且正好站在自包箱旁的邊緣往外走時,結果也改成原地不動,不再從 ∞ 出來。此點尚未經使用者在實機確認。測試:`authoredInfiniteExit.test.ts` 的最後一組。

## 介面:推動自包箱時外圈閃動;虛空中 ε 箱的鎖定框擋住內容(2026-09-26,使用者回報)

- 外圈(`resolveDrawRoot`)依自包箱的位置計算。先前這個位置直接用移動後的值,推動自包箱時外圈會在動畫結束時一次跳到新位置,造成閃動。現在改用動畫中的插值位置(`getRenderLocation`),外圈跟著自包箱一起平滑移動。
- 鎖定白框(虛空中的方塊、∞ 箱)原本最寬 6px(cell/8),會蓋住箱子內部邊緣格,例如被推進 ε 箱的東西。現在寬度與一般外框相同(1.5–4px,`lockRingWidth`),畫在外框的位置上。
