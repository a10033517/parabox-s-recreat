import { useEffect, useRef, useState } from 'react'
import { onBackButton } from './native'
import { MenuScreen } from './ui/MenuScreen'
import { LevelSelect, LevelSection } from './ui/LevelSelect'
import { GameScreen } from './game/GameScreen'
import { EditorScreen } from './editor/EditorScreen'
import { BUILTIN_LEVELS, loadCommunitySampleLevels, loadCustomLevels, loadGeneratedLevels, loadWorldLevels, loadAuthoredLevels, LevelMeta, CUSTOM_LEVEL_ID_PREFIX } from './levels'
import { deleteCustomLevel, listCompletedLevels, markLevelComplete } from './storage/progress'
import { ImportDialog } from './ui/ImportDialog'
import { music } from './audio/music'
import { MUSIC_VOLUME, useSettings } from './storage/settings'

type Screen = 'menu' | 'levelSelect' | 'game' | 'editor'

export default function App() {
  const [screen, setScreen] = useState<Screen>('menu')
  const [activeLevel, setActiveLevel] = useState<LevelMeta | null>(null)
  const [importing, setImporting] = useState(false)
  const [, refresh] = useState(0) // imported / deleted levels live in storage: re-read them

  // Background music: browsers allow sound only after a gesture, so the first tap / key starts
  // it; the settings set its volume; it goes quiet while the app is in the background.
  const [settings] = useSettings()
  useEffect(() => music.setVolume(MUSIC_VOLUME[settings.music]), [settings.music])
  useEffect(() => {
    const unlock = () => music.unlock()
    const visibility = () => music.setHidden(document.visibilityState === 'hidden')
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('keydown', unlock)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [])
  // Outside a level, always the main theme (GameScreen switches to the Void theme in the Void).
  useEffect(() => {
    if (screen !== 'game') music.setTheme('main')
  }, [screen])

  // Android back: game -> level list -> menu -> close the app.
  const screenRef = useRef(screen)
  screenRef.current = screen
  useEffect(
    () =>
      onBackButton(() => {
        const current = screenRef.current
        if (current === 'game') setScreen('levelSelect')
        else if (current === 'levelSelect' || current === 'editor') setScreen('menu')
        else return false
        return true
      }),
    [],
  )
  // Recomputed each render rather than memoised so a level just saved in the
  // editor shows up as soon as the player navigates back to level select.
  const sections: LevelSection[] = [
    { title: '教学关卡', levels: BUILTIN_LEVELS },
    ...loadWorldLevels().map((world) => ({ title: world.name, levels: world.levels })),
    { title: '编辑器关卡', levels: loadAuthoredLevels() },
    { title: '更多生成关卡', levels: loadGeneratedLevels() },
    { title: '社群关卡', levels: loadCommunitySampleLevels() },
    { title: '汇入与自制关卡', levels: loadCustomLevels() },
  ]
  const allLevels = sections.flatMap((section) => section.levels)
  const completedIds = listCompletedLevels()

  if (screen === 'menu') {
    return (
      <MenuScreen
        onStart={() => setScreen('levelSelect')}
        onEditor={() => setScreen('editor')}
        completed={allLevels.filter((l) => completedIds.includes(l.id)).length}
        total={allLevels.length}
      />
    )
  }

  if (screen === 'levelSelect') {
    return (
      <>
      <LevelSelect
        levels={allLevels}
        sections={sections}
        completedIds={completedIds}
        onSelect={(level) => {
          setActiveLevel(level)
          setScreen('game')
        }}
        onBack={() => setScreen('menu')}
        onImport={() => setImporting(true)}
        onDelete={{
          canDelete: (level) => level.id.startsWith(CUSTOM_LEVEL_ID_PREFIX),
          remove: (level) => {
            if (!window.confirm(`删除「${level.name}」?`)) return
            deleteCustomLevel(level.id.slice(CUSTOM_LEVEL_ID_PREFIX.length))
            refresh((n) => n + 1)
          },
        }}
      />
      {importing && <ImportDialog onClose={() => { setImporting(false); refresh((n) => n + 1) }} />}
      </>
    )
  }

  if (screen === 'game' && activeLevel) {
    const index = allLevels.findIndex((l) => l.id === activeLevel.id)
    const next = index >= 0 ? allLevels[index + 1] : undefined
    return (
      <GameScreen
        key={activeLevel.id}
        initialWorld={activeLevel.world}
        levelName={activeLevel.name}
        hint={activeLevel.hint}
        onExit={() => setScreen('levelSelect')}
        onWin={() => markLevelComplete(activeLevel.id)}
        onNext={next !== undefined ? () => setActiveLevel(next) : undefined}
      />
    )
  }

  if (screen === 'editor') {
    return <EditorScreen onBack={() => setScreen('menu')} />
  }

  return null
}
