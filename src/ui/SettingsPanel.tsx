import { ReactNode } from 'react'
import { ControlMode, Settings, useSettings } from '../storage/settings'

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={value === o.value} className={value === o.value ? 'is-active' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Row({ title, hint, children, stacked }: { title: string; hint?: string; children: ReactNode; stacked?: boolean }) {
  return (
    <div className={`settings-row${stacked ? ' is-stacked' : ''}`}>
      <div className="settings-row-text">
        <div className="settings-row-title">{title}</div>
        {hint !== undefined && <div className="settings-row-hint">{hint}</div>}
      </div>
      {children}
    </div>
  )
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={checked} aria-label={label} className={`toggle${checked ? ' is-on' : ''}`} onClick={() => onChange(!checked)}>
      <span className="toggle-knob" />
    </button>
  )
}

const CONTROL_OPTIONS: { value: ControlMode; label: string; hint: string }[] = [
  { value: 'swipe', label: '滑动', hint: '在画面上滑动来移动,不显示方向键' },
  { value: 'swipe+dpad', label: '滑动+方向键', hint: '可以滑动,也显示方向键' },
  { value: 'dpad', label: '方向键', hint: '只用画面下方的方向键' },
  { value: 'tap', label: '点击四边', hint: '点画面的上、下、左、右边来移动' },
]

// Control settings: how the player moves, and how swipes behave.
export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [settings, save] = useSettings()
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => save({ ...settings, [key]: value })
  const swipes = settings.controls === 'swipe' || settings.controls === 'swipe+dpad'
  const control = CONTROL_OPTIONS.find((o) => o.value === settings.controls)

  return (
    <div className="win-overlay" role="dialog" aria-label="设定">
      <div className="win-card settings-card">
        <div className="import-title">设定</div>

        <div className="settings-section">操作方式</div>
        <div className="control-grid">
          {CONTROL_OPTIONS.map((o) => (
            <button key={o.value} className={`control-option${settings.controls === o.value ? ' is-active' : ''}`} aria-pressed={settings.controls === o.value} onClick={() => set('controls', o.value)}>
              <span className={`control-icon c-${o.value.replace('+', '-')}`} aria-hidden="true" />
              {o.label}
            </button>
          ))}
        </div>
        <div className="settings-row-hint">{control?.hint}</div>

        {settings.controls !== 'dpad' && (
          <Row title={settings.controls === 'tap' ? '点击范围' : '滑动范围'}>
            <Segmented label="范围" value={settings.swipeArea} onChange={(v) => set('swipeArea', v)} options={[{ value: 'screen', label: '整个画面' }, { value: 'board', label: '只有棋盘' }]} />
          </Row>
        )}

        {swipes && (
          <>
            <Row title="什么时候移动" hint={settings.swipeTrigger === 'move' ? '手指滑过一段距离就立刻移动' : '手指放开时才移动'}>
              <Segmented label="移动时机" value={settings.swipeTrigger} onChange={(v) => set('swipeTrigger', v)} options={[{ value: 'move', label: '滑到就动' }, { value: 'release', label: '放开才动' }]} />
            </Row>
            {settings.swipeTrigger === 'move' && (
              <>
                <Row title="拖曳连续移动" hint="手指不放开继续拖,每多拖一大段距离再走一步,也可以转弯">
                  <Toggle label="拖曳连续移动" checked={settings.dragSteps} onChange={(v) => set('dragSteps', v)} />
                </Row>
                <Row title="按住持续移动" hint="滑动后手指停住不放,会一直往那个方向走">
                  <Toggle label="按住持续移动" checked={settings.holdRepeat} onChange={(v) => set('holdRepeat', v)} />
                </Row>
              </>
            )}
            <Row title="滑动灵敏度" hint="要滑多远才算一步">
              <Segmented label="灵敏度" value={settings.sensitivity} onChange={(v) => set('sensitivity', v)} options={[{ value: 'high', label: '高' }, { value: 'medium', label: '中' }, { value: 'low', label: '低' }]} />
            </Row>
          </>
        )}

        <Row title="最快移动速度" hint="输入再快,每秒最多走几步;来不及走的会排队(最多 2 步)" stacked>
          <Segmented label="最快移动速度" value={settings.moveRate} onChange={(v) => set('moveRate', v)} options={[{ value: 'unlimited', label: '不限' }, { value: 'fast', label: '每秒 8 步' }, { value: 'medium', label: '每秒 5 步' }, { value: 'slow', label: '每秒 3 步' }]} />
        </Row>

        <Row title="点箱子查看内部" hint={settings.controls === 'tap' ? '长按有内部的箱子,查看它里面的结构' : '点一下(或长按)有内部的箱子,查看它里面的结构'}>
          <Toggle label="点箱子查看内部" checked={settings.tapToInspect} onChange={(v) => set('tapToInspect', v)} />
        </Row>

        <Row title="背景音乐" hint="进入虚空时会换成虚空的配乐">
          <Segmented label="背景音乐" value={settings.music} onChange={(v) => set('music', v)} options={[{ value: 'off', label: '关' }, { value: 'low', label: '小' }, { value: 'medium', label: '中' }, { value: 'high', label: '大' }]} />
        </Row>

        <Row title="震动回馈" hint="每走一步轻轻震动一下">
          <Toggle label="震动回馈" checked={settings.haptics} onChange={(v) => set('haptics', v)} />
        </Row>

        <button className="btn-primary" onClick={onClose}>完成</button>
      </div>
    </div>
  )
}
