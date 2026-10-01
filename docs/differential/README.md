# 原版對拍(differential test)

由 `npx tsx tools/differential/generate.ts [--flipY]` 產生。

## 步驟
1. 把 `case*.txt` 放進原版 Custom Levels 匯入資料夾(見官方文件 https://www.patricksparabox.com/custom-levels/)。
2. **先跑 case1 校準**:確認檔案可載入、玩家與箱子的上下位置與預期一致。若上下顛倒,加 `--flipY` 重新產生。若檔案無法載入,把錯誤回報給我(匯出格式的玩家/實心箱欄位是依官方欄位表推測的)。
3. 依「輸入序列」逐步操作,每步記錄玩家在哪個箱子內(以顏色辨識:root 灰、第一個 interior 藍)、格子座標、以及該步是否有移動。
4. 把結果填進下表「原版實測」欄,或直接告訴我差異。
5. 差異處我會改引擎(canonical exit 規則 / clone 進入格 / Infinite Exit 表現)並把原版結果寫成測試。

匯出的格式限制:無人擁有的最外層(root)邊緣引擎視為實心;匯出時把 root 包進四周是牆的 3x3 外框(root 箱在中央格),離開 root 邊緣就撞牆,與引擎一致。原版沒有這個隱含邊界,不包會直接通到 Void——那是檔案資訊不足,不是引擎問題。case4 的 root 由 self-loop 擁有,不包外框。normal box 以 fillwithwalls 實心 Block 表示;Void / ∞ 由原版自行產生,檔案中沒有。

## case5-infenter-authored — Infinite Enter 進入既有(authored)ε:floating Block + exitblock Ref + infenter

問題:按 R 進入 A 後,玩家是否落在 floating Block F(有 PlayerButton 目標)內、關卡是否過關?沒有多生成 null-space ε?(引擎:進入 F,過關,不建 Void)

輸入序列:R

| 步 | 輸入 | 引擎:是否移動 | 引擎:玩家位置(space,x,y) | 原版實測 |
|---|---|---|---|---|
| 1 | R | 是 | b9, 0, 0 | |

## case6-infinite-enter-null-space — Infinite Enter 沒有既有 ε(null-space ε)

問題:同 case5 但沒有 floating Block / Ref。按 R 後原版發生什麼?玩家進入哪裡、Void 裡是否出現 ε、能否走出來、走出來落在哪?(原版實測(使用者):ε 在 Void 中心,玩家在 ε 內、左邊緣中間(小方塊);一路往右推會被推出 ε 進入 Void 並變成鎖定箱;Void 7x7,邊緣是看不見的牆),之後在內部可走動但出不去;interior 大小是暫定)

輸入序列:R R

| 步 | 輸入 | 引擎:是否移動 | 引擎:玩家位置(space,x,y) | 原版實測 |
|---|---|---|---|---|
| 1 | R | 是 | epsilon:p1, 0, 2 | |
| 2 | R | 是 | epsilon:p1, 1, 2 | |

## case7-infenterid-matching — infenterid 比對:兩個候選 ε

問題:兩個 exitblock Ref:F9 的 infenterid=1、F10 的 infenterid=2。進入 A(level 1)的 Infinite Enter 進入哪一個?(引擎:只比 id,進入 F9)。之後再把 F9 的 infenternum 改成 2 重錄,看 degree 是否影響選擇。

輸入序列:R

| 步 | 輸入 | 引擎:是否移動 | 引擎:玩家位置(space,x,y) | 原版實測 |
|---|---|---|---|---|
| 1 | R | 是 | b9, 0, 0 | |

## case1-single-ref — 1 Block + 1 Ref (calibration)

問題:y 軸方向是否需 flipY;進入後落點;退出後落點。先跑這關確認匯出格式可載入。

輸入序列:R L

| 步 | 輸入 | 引擎:是否移動 | 引擎:玩家位置(space,x,y) | 原版實測 |
|---|---|---|---|---|
| 1 | R | 是 | inside, 0, 1 | |
| 2 | L | 是 | root, 0, 1 | |

## case2-two-refs-shared — 2 Ref → same Block:從 b 進入,退出回到哪個 Ref?

問題:從下方(較低)的 Ref 進入後按 L 離開,玩家出現在上方 Ref 旁,還是下方 Ref 旁?(引擎暫定:回到 canonical 上方 a)

輸入序列:R L

| 步 | 輸入 | 引擎:是否移動 | 引擎:玩家位置(space,x,y) | 原版實測 |
|---|---|---|---|---|
| 1 | R | 是 | inside, 0, 1 | |
| 2 | L | 是 | root, 0, 1 | |

## case3-clone-enter — Clone 進入落點

問題:推 clone 進入後落在 source interior 的哪一格?退出後回到 source 旁還是 clone 旁?(引擎:進入格同直接進入 source;退出回 source)

輸入序列:R L

| 步 | 輸入 | 引擎:是否移動 | 引擎:玩家位置(space,x,y) | 原版實測 |
|---|---|---|---|---|
| 1 | R | 是 | inside, 0, 1 | |
| 2 | L | 是 | root, 0, 2 | |

## case4-self-loop-infinite — Self-loop 貼邊推出(Infinite Exit)

問題:把自我包含箱推出邊界後:是否生成 ∞ 箱、箱子從哪一側被推出、玩家是否仍前進一格。

輸入序列:R R

| 步 | 輸入 | 引擎:是否移動 | 引擎:玩家位置(space,x,y) | 原版實測 |
|---|---|---|---|---|
| 1 | R | 是 | root, 1, 0 | |
| 2 | R | 是 | root, 2, 0 | |

