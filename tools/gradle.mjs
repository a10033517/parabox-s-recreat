// Runs the Android Gradle wrapper with the given tasks, on Windows (gradlew.bat) and macOS /
// Linux (./gradlew) alike: `node tools/gradle.mjs assembleDebug`.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const androidDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'android')
const windows = process.platform === 'win32'
const wrapper = join(androidDir, windows ? 'gradlew.bat' : 'gradlew')
const result = spawnSync(wrapper, process.argv.slice(2), { cwd: androidDir, stdio: 'inherit', shell: windows })
process.exit(result.status ?? 1)
