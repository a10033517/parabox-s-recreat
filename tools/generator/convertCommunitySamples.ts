import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseOfficialLevel } from '../../src/game/engine/officialFormat'
import { serializeLevel } from '../../src/game/engine/levelSchema'

// One-shot conversion: docs/differential/community-samples/*.txt (official version-4 format)
// -> src/levels/builtin/community-samples/*.json (this engine's own format), so they can be
// played in the app exactly like any other built-in level. Re-run after adding new .txt samples.
function main() {
  const here = dirname(fileURLToPath(import.meta.url))
  const srcDir = join(here, '../../docs/differential/community-samples')
  const outDir = join(here, '../../src/levels/builtin/community-samples')
  mkdirSync(outDir, { recursive: true })
  for (const name of readdirSync(srcDir)) {
    if (!name.endsWith('.txt')) continue
    const world = parseOfficialLevel(readFileSync(join(srcDir, name), 'utf8'))
    const outName = name.replace('.txt', '.json')
    writeFileSync(join(outDir, outName), JSON.stringify(serializeLevel(world)))
    console.log('wrote', outName)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
