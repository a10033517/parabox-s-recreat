# 社群樣本關卡(第三方 editor 附帶範例)

來源:https://github.com/iwVerve/Parafox (`Parafox/datafiles/example/*.txt`),Patrick's Parabox 的第三方
level editor「Parafox」隨附的範例檔。使用者自行下載後提供這幾個檔案用於測試。

- **不是** Patrick Traynor 官方發布的 350+ 手作關卡,是社群 editor 作者為展示格式與機制自製的小關。
- repo 未標示授權(license: null)。這裡只把它們當作**官方 version 4 檔案格式的真實樣本**,用來
  回歸測試 `parseOfficialLevel` 這個匯入器的相容性——不主張版權歸屬,不重新散布為遊戲內容。
- **未經原版遊戲驗證**:我沒有原版遊戲可以操作,以下測試只確認「能否被本引擎正確解析、載入後的
  結構是否符合預期」,不保證這些關卡在本引擎下的完整可玩性與原版一致。

| 檔案 | 用途(依內容推測) |
|---|---|
| `file_format_example.txt` | 與官方 Custom Levels 文件本身列出的範例逐字相同 |
| `iiexit_intro.txt` | Infinite Exit 示範:root 對自己的三個 self-loop Ref,兩個標記不同 `infexitnum` |
| `infenter_line.txt` | Infinite Enter 示範:root 自我 Ref + `exitblock`/`infenter`/`infenterid` 授權 destination |
| `clone_rescue_ref_2.txt` | Clone / Reference 示範 |
| `hungry_flip.txt` | Flip(`fliph`)示範 |
| `order_elbow_push.txt` | 自訂 `attempt_order`(`enter,eat,push,possess`)示範 |
| `poswall_first.txt` | Possessable wall 示範(possess 已於 2026-09-26 實作,見 `possess.test.ts`) |

`iiexit_void3.txt` is NOT a third-party sample: it is `iiexit_intro.txt` with the ∞∞ box (`Ref 4 1 ... 1 1`) moved one cell down to (4,2), made on 2026-09-24 so the user can check that pushing ∞∞ off the edge spawns ∞∞∞ in the Void.

`player_box_eat.txt` is NOT a third-party sample either: made on 2026-09-25 to try the player-as-a-box mechanic. The player (a `player=1` Block without fillwithwalls) has a Button inside it; walk right three times so the orange box, stuck against a wall, is eaten into the player onto that Button, then stand on the player goal.

**Not in the public repository.** The third-party `.txt` files above (and `iiexit_void3.txt`, derived from `iiexit_intro.txt`) carry no licence, so `.gitignore` keeps them — and their converted `src/levels/builtin/community-samples/*.json` — out of the repo. Download them from https://github.com/iwVerve/Parafox (`Parafox/datafiles/example/`) into this folder and run `npx tsx tools/generator/convertCommunitySamples.ts` to use them locally; the tests that need them skip themselves when they are missing. Only `player_box_eat` is this project's own and is committed.
