export function MenuScreen({ onStart, onEditor }: { onStart: () => void; onEditor: () => void }) {
  return (
    <div className="menu-screen">
      <h1>Parabox Tribute</h1>
      <button onClick={onStart}>开始游戏</button>
      <button onClick={onEditor}>关卡编辑器</button>
    </div>
  )
}
