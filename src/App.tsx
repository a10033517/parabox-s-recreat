import { Component, lazy, ReactNode, Suspense, useState } from 'react'
import { MenuScreen } from './ui/MenuScreen'
import { LevelSelect } from './ui/LevelSelect'
import { GameScreen } from './game/GameScreen'
import { BUILTIN_LEVELS, loadCustomLevels, loadGeneratedLevels, LevelMeta } from './levels'
import { isLevelComplete, listCompletedLevels, markLevelComplete } from './storage/progress'

// Lazy-loaded: EditorScreen still targets the pre-World engine API and won't
// compile until sub-project 3 rebuilds it. A static import would fail at
// module-link time and crash every screen, not just the editor, under
// `npm run dev` — deferring the import means only navigating into the editor
// hits that failure there. This does NOT make the app buildable: `npm run
// build` (Rollup) still statically resolves this dynamic import and hard-
// errors on EditorScreen.tsx's missing exports either way. This sub-project's
// tested acceptance bar is "playable under `npm run dev`," not "deployable
// via `npm run build`" — that stays broken until sub-project 3 lands.
const EditorScreen = lazy(() => import('./editor/EditorScreen').then((m) => ({ default: m.EditorScreen })))

// Suspense alone only covers the loading state — a module-link failure
// inside the lazy import throws during render and, uncaught, unmounts the
// entire app. This boundary contains that failure to the editor screen.
class EditorErrorBoundary extends Component<{ onBack: () => void; children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="editor-unavailable">
          <p>关卡编辑器暂时无法使用</p>
          <button onClick={this.props.onBack}>返回</button>
        </div>
      )
    }
    return this.props.children
  }
}

type Screen = 'menu' | 'levelSelect' | 'game' | 'editor'

export default function App() {
  const [screen, setScreen] = useState<Screen>('menu')
  const [activeLevel, setActiveLevel] = useState<LevelMeta | null>(null)
  // Recomputed each render rather than memoised so a level just saved in the
  // editor shows up as soon as the player navigates back to level select.
  const allLevels = [...BUILTIN_LEVELS, ...loadGeneratedLevels(), ...loadCustomLevels()]

  if (screen === 'menu') {
    return <MenuScreen onStart={() => setScreen('levelSelect')} onEditor={() => setScreen('editor')} />
  }

  if (screen === 'levelSelect') {
    return (
      <LevelSelect
        levels={allLevels}
        completedIds={listCompletedLevels()}
        onSelect={(level) => {
          setActiveLevel(level)
          setScreen('game')
        }}
        onBack={() => setScreen('menu')}
      />
    )
  }

  if (screen === 'game' && activeLevel) {
    return (
      <GameScreen
        key={activeLevel.id}
        initialWorld={activeLevel.world}
        onExit={() => setScreen('levelSelect')}
        onWin={() => {
          markLevelComplete(activeLevel.id)
          if (isLevelComplete(activeLevel.id)) setScreen('levelSelect')
        }}
      />
    )
  }

  if (screen === 'editor') {
    return (
      <EditorErrorBoundary onBack={() => setScreen('menu')}>
        <Suspense fallback={null}>
          <EditorScreen onBack={() => setScreen('menu')} />
        </Suspense>
      </EditorErrorBoundary>
    )
  }

  return null
}
