import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { replay } from '../../src/game/engine/replayHarness'
import { exportOfficial } from './exportOfficial'
import { cases } from './cases'

function main() {
  const outDir = join(dirname(fileURLToPath(import.meta.url)), '../../docs/differential')
  mkdirSync(outDir, { recursive: true })
  const flipY = process.argv.includes('--flipY')
  const rows: string[] = []
  for (const c of cases()) {
    writeFileSync(join(outDir, `${c.id}.txt`), c.officialText ?? exportOfficial(c.world, 'root', { flipY }))
    const snaps = replay(c.world, c.inputs)
    rows.push(`## ${c.id} — ${c.title}\n\n問題:${c.question}\n\n輸入序列:${c.inputs.join(' ')}\n\n| 步 | 輸入 | 引擎:是否移動 | 引擎:玩家位置(space,x,y) | 原版實測 |\n|---|---|---|---|---|`)
    snaps.forEach((s, i) => {
      const p = s.locations.player
      rows.push(`| ${i + 1} | ${s.input} | ${s.accepted ? '是' : '否'} | ${p.board}, ${p.x}, ${p.y} | |`)
    })
    rows.push('')
  }
  const readme = `# 原版對拍(differential test)

由 \`npx tsx tools/differential/generate.ts [--flipY]\` 產生。

## 步驟
1. 把 \`case*.txt\` 放進原版 Custom Levels 匯入資料夾(見官方文件 https://www.patricksparabox.com/custom-levels/)。
2. **先跑 case1 校準**:確認檔案可載入、玩家與箱子的上下位置與預期一致。若上下顛倒,加 \`--flipY\` 重新產生。若檔案無法載入,把錯誤回報給我(匯出格式的玩家/實心箱欄位是依官方欄位表推測的)。
3. 依「輸入序列」逐步操作,每步記錄玩家在哪個箱子內(以顏色辨識:root 灰、第一個 interior 藍)、格子座標、以及該步是否有移動。
4. 把結果填進下表「原版實測」欄,或直接告訴我差異。
5. 差異處我會改引擎(canonical exit 規則 / clone 進入格 / Infinite Exit 表現)並把原版結果寫成測試。

匯出的格式限制:無人擁有的最外層(root)邊緣引擎視為實心;匯出時把 root 包進四周是牆的 3x3 外框(root 箱在中央格),離開 root 邊緣就撞牆,與引擎一致。原版沒有這個隱含邊界,不包會直接通到 Void——那是檔案資訊不足,不是引擎問題。case4 的 root 由 self-loop 擁有,不包外框。normal box 以 fillwithwalls 實心 Block 表示;Void / ∞ 由原版自行產生,檔案中沒有。

${rows.join('\n')}
`
  writeFileSync(join(outDir, 'README.md'), readme)
  console.log(`wrote ${cases().length} cases to ${outDir}${flipY ? ' (flipY)' : ''}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
