import { useEffect, useRef, useState } from 'react'
import { onBackButton } from './native'
import { MenuScreen } from './ui/MenuScreen'
import { LevelSelect, LevelSection } from './ui/LevelSelect'
import { GameScreen } from './game/GameScreen'
import { EditorScreen } from './editor/EditorScreen'
import { BUILTIN_LEVELS, loadCommunitySampleLevels, loadCustomLevels, loadGeneratedLevels, loadWorldLevels, loadAuthoredLevels, LevelMeta } from './levels'
import { listCompletedLevels, markLevelComplete } from './storage/progress'

type Screen = 'menu' | 'levelSelect' | 'game' | 'editor'

export default function App() {
  const [screen, setScreen] = useState<Screen>('menu')
  const [activeLevel, setActiveLevel] = useState<LevelMeta | null>(null)

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
    { title: '自制关卡', levels: loadCustomLevels() },
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
      <LevelSelect
        levels={allLevels}
        sections={sections}
        completedIds={completedIds}
        onSelect={(level) => {
          setActiveLevel(level)
          setScreen('game')
        }}
        onBack={() => setScreen('menu')}
      />
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
