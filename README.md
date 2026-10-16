# 遞迴解謎遊戲原型與關卡生成器

參考 Patrick's Parabox 的遞迴箱體玩法製作的個人遊戲原型，結合關卡編輯、BFS 求解與機制驗證，探索如何產生需要運用指定規則的解謎關卡。

A personal recursive puzzle game prototype with a level editor, BFS solving, and mechanic-based level generation. The project remains in development.

## 個人貢獻與工具使用

我負責玩法規格、功能取捨與試玩回饋；程式實作由 AI 工具協助完成。這個專案主要呈現需求定義、規則判斷及透過試玩推進修正的過程。

## 原型功能

- 遞迴箱體與房間進出，包含自我包含、分身、翻轉、附身及無限退出等機制。
- Canvas 遊戲畫面、復原、重開與進度儲存。
- 鍵盤、方向按鈕及滑動控制。
- 關卡編輯、匯入與匯出。
- 依機制分類的關卡生成與驗證流程。

目前 World 清單包含 **10 類、每類 20 關，共 200 關**，可由 [關卡清單](src/levels/builtin/worlds/manifest.json) 查看各關的解法與生成紀錄。這是關卡產出數量，尚不是玩家測試成效或難度平衡的證明。

## 關卡生成與驗證

生成器先建立候選關卡，再透過結構檢查、BFS 求解與難度篩選挑選結果。機制驗證分為：

1. **存在**：關卡結構包含指定機制。
2. **使用**：重播解法時確實觸發該機制。
3. **必要**：停用或替換該機制後重新求解；只有完整搜尋確認無解才接受，達到搜尋上限不算證明。

現有測試會重播全部 World 關卡的解法，並對各類第一關執行停用機制檢查。生成時的驗證紀錄、測試涵蓋範圍與實際玩家體驗，是三種不同的證據。

詳細說明見 [World 生成器](docs/world-generator.md)。

## 技術與主要目錄

| 區域 | 內容 |
|---|---|
| `src/game/engine/` | 遊戲狀態與規則 |
| `src/game/render/` | Canvas 繪圖與遞迴畫面 |
| `src/level-editor/` | 本機關卡編輯器 |
| `tools/generator/` | 求解、生成、篩選與機制驗證 |
| `src/levels/builtin/worlds/` | 分類關卡與清單 |
| `android/`、`ios/` | Capacitor 行動 App 專案 |

主要採用 TypeScript、React、Vite、Canvas 與 Vitest；行動 App 打包使用 Capacitor。

## 本機執行

準備 Node.js 與 npm，在專案根目錄執行：

```bash
npm ci
npm run dev
```

開啟終端機顯示的本機網址即可遊玩。

```bash
npm run test    # 執行測試
npm run build   # TypeScript 檢查與網頁建置
npm run editor  # 本機關卡編輯器
```

本機編輯器會儲存關卡至專案目錄，操作方式見 [編輯器說明](docs/level-editor.md)。行動 App 建置步驟見 [打包說明](docs/app-packaging.md)。

## 開發狀態

原型仍在開發與試玩修正中。部分進階規則與原作的相容程度仍需核對；既有自動測試也不能取代瀏覽器、手機操作及玩家試玩的驗證。玩法與規則參考來源為 Patrick's Parabox，本專案不代表完整重現原作所有機制。
