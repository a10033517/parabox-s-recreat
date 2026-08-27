# Patrick's Parabox 致敬版 — 手机 PWA 设计文件

## 背景与定位

原创(非官方、非取用原版素材/程式码)的递归式推箱子解谜游戏,以 Patrick's Parabox 的「箱中箱」玩法为灵感,做成可在手机浏览器安装、完全离线游玩的 PWA。

- 美术、关卡、程式码全部原创,不使用 Patrick's Parabox 原版任何素材或代码。
- MVP 范围:箱子推动 + 箱中箱嵌套。玩家进入箱子内部操控(原版进阶机制)暂不做,未来可扩充。
- 目标平台:手机浏览器(触控操作),同时兼容桌面浏览器游玩。

## 技术栈与专案结构

- **React + Vite**:UI 外壳(主选单、关卡选择、编辑器、设定)与路由。
- **Canvas 2D**:游戏画面渲染,包含递归嵌套箱子的绘制。不使用 PixiJS(此规模用不到 WebGL 渲染引擎的额外能力),未来如需更丰富的转场/特效动画,可将渲染层单独替换。
- **vite-plugin-pwa**:产生 Service Worker(预缓存全部静态资源)与 Web App Manifest,达成安装到主画面 + 完全离线游玩。
- 纯前端专案,无后端。部署为静态网站。

```
src/
  main.tsx                 # 入口, 注册 Service Worker
  App.tsx                  # 路由: 主选单 / 游戏 / 编辑器 / 关卡选择
  game/
    engine/                # 与 UI 无关的纯游戏逻辑
      GameState.ts
      rules.ts              # 推动链/嵌套判定(核心规则, 见下)
      levelSchema.ts         # 关卡 JSON 格式定义
    render/
      CanvasRenderer.ts     # 把 GameState 画成 Canvas 网格(含递归嵌套绘制)
    GameScreen.tsx          # 组合 Canvas + 触控 UI + HUD
  editor/
    EditorScreen.tsx        # 关卡编辑器页面(含进入箱子内部编辑的面包屑导航)
  levels/
    builtin/*.json           # 手动设计的内建关卡
    builtin/generated/*.json # 生成器产出、经审核的关卡包
  ui/
    DPad.tsx, SwipeLayer.tsx, MenuScreen.tsx, LevelSelect.tsx
  storage/
    progress.ts             # localStorage 存取(通关记录、自订关卡)
public/
  manifest.json, icons/

tools/
  generator/                 # 开发阶段用的 Node.js 脚本, 不打包进 App
    generateLevel.ts         # 从终局反向走步, 产生初始局面(保证可解)
    solver.ts                # BFS/IDA* 找最短(最优)解, 复用 game/engine/rules.ts
    difficultyScorer.ts      # 分析最优解中各机制出现次数, 计算难度分数
    generateBatch.ts         # CLI: 依难度分级批量产生关卡, 输出 JSON
```

## 核心资料结构:递归 Grid

```ts
type CellType = 'empty' | 'wall' | 'target'

type Grid = {
  width: number
  height: number
  cells: CellType[][]
  boxes: Box[]
  player?: { x: number; y: number }   // 只有最外层 Grid 会有 player(MVP 不支援玩家进箱子)
}

type Box = {
  id: string
  x: number; y: number
  boxType: 'normal' | 'container'     // normal: 只能被嵌套; container: 能接收嵌套(未来可扩充更多类型)
  interior: Grid                       // container 类型才有实质作用; normal 的 interior 恒为空
  isGoalBox?: boolean                  // 标记这个箱子是否为关卡的过关目标物(需被推到某个 target 格上)
}
```

整个关卡是一个最外层 `Grid`;箱子的 `interior` 又是一份完整的 `Grid`,可以再放箱子,同一套规则/渲染/求解逻辑对任意嵌套深度都适用,不需要为每一层写特例。

## 核心规则:推动链与嵌套判定

箱子只能推、不能拉。每次玩家按方向键:

1. 从玩家往推动方向数出整条链:`玩家 → 箱1 → 箱2 → ... → 箱N`,直到遇到空地、墙或边界。
2. **链尾是空地** → 整条链(所有箱子与玩家)平移一格,不触发嵌套(标准推箱子)。
3. **链尾是墙** → 从墙这端开始往回扫描,寻找「有效阻挡点」:
   - 紧邻墙的箱子必定卡死不能动(墙不接受嵌套)。
   - 往回检查下一个箱子:
     - 若前一个卡死的箱子是 **容器箱(container)** → 触发嵌套:当前箱子消失、进入该容器箱的 `interior`,扫描到此为止。
     - 若前一个卡死的箱子是 **普通箱(normal)**(不能接收)→ 当前箱子也卡死,视为新的阻挡点,继续往回扫描。
   - 若一路扫描到玩家都卡死(即整条链都是不能接收嵌套的普通箱)→ 整条链完全不能动,这次移动无效。
4. 一旦触发嵌套:嵌套点之后(靠墙那一侧)全部维持原位不动;嵌套点之前(靠玩家那一侧,含玩家)全部往推动方向平移一格,填补消失箱子空出的格子。
5. **每次移动最多触发一次嵌套。**

胜利条件:关卡指定的目标箱子最终停在指定的 `target` 格上;判定需要递归比对,因为目标箱子可能位于任意层的嵌套内部。

`applyMove(grid, direction): Grid | null`(不合法回传 `null`)是此规则的唯一实作,游戏本体、求解器、生成器的反向逻辑都共用同一份,避免行为不一致。

## 关卡生成器(开发阶段工具,不在手机端运行)

- **生成**:采用反向生成 —— 从一个已解决的终局(箱子已在目标点)开始,反覆套用 `applyMove` 的反向操作(反向平移、反向嵌套/展开)往回走随机步数,产生初始局面。此法天生保证「至少有一组解」。
- **求解与验证**:用 BFS/IDA* 对生成的初始局面正向搜索,找出真正的最短(最优)解 —— 避免生成过程中意外出现比预期更简单的捷径,让关卡实际比设计的难度低。
- **难度评分**:分析最优解的移动序列,统计各机制的使用次数与种类(例如箱中箱嵌套发生几次、是否需要借助普通箱当路障来引导容器箱等),使用越多种/越多次进阶机制 → 难度分数越高。依此分数把关卡分级(简单/中等/困难)。
- **产出流程**:开发时执行 `generateBatch.ts` → 生成候选关卡 → 求解评分 → 输出 JSON → 人工快速抽查后收进 `src/levels/builtin/generated/`,与手动设计的关卡一起提交进 repo、随 App 打包发布。手机端完全不运行生成/求解逻辑,不需要 Web Worker,不消耗玩家端算力与电量。

## 关卡编辑器

- 简易关卡编辑器(`EditorScreen`),提供网格画布 + 素材面板(墙、目标点、普通箱、容器箱、玩家起点),点击/拖曳放置。
- 支援「进入箱子编辑其内部网格」,以面包屑导航显示当前编辑到第几层嵌套。
- 存档到 localStorage,并可汇出/汇入 JSON 分享关卡。

## UI / 画面结构

- **主选单**:开始游戏、关卡选择、编辑器、设定(音效开关等)。
- **游戏画面**(`GameScreen`):Canvas 渲染区 + 上方 HUD(关卡名、步数、复位/上一步按钮)+ 下方触控区。
- **触控操作**:同时支援虚拟 D-pad 与滑动手势(Swipe)两种输入方式。
- **关卡选择**:列表/网格显示内建关卡(含生成器产出、依难度分组)+ 自订关卡(玩家用编辑器做的,存 localStorage)。

## 离线与存档

- `vite-plugin-pwa` 产生 Service Worker(预缓存全部静态资源,`autoUpdate` 策略)与 `manifest.json`(App 图示、`display: standalone`、直向锁定)。
- 首次载入后完全离线可玩,无任何网路请求依赖。
- 进度(`storage/progress.ts`)统一存 localStorage:区分「内建关卡通关记录」与「自订关卡资料」两类 key。

## 测试策略

- `game/engine/rules.ts`(推动链/嵌套判定)是最需要单元测试覆盖的部分:针对各种链条组合写测试 —— 空地平移、单一容器箱嵌套、普通箱卡死、连续容器箱只触发一次嵌套、链条完全卡死等,对应上面确认过的每一条规则。
- `tools/generator/solver.ts` 用同一套规则的测试 fixture 反向验证求解正确性。
- UI 层用少量整合测试(例如点击 D-pad 触发正确的 state 变化)即可,不追求全覆盖。

## 未来可扩充(不在本次 MVP 范围)

- 玩家可进入箱子内部操控(切换控制层)。
- 更多箱子类型(除 normal / container 外)。
- 手机端现场生成关卡模式(目前仅开发阶段预生成)。
