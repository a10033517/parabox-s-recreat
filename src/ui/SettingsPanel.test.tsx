import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { SettingsPanel } from './SettingsPanel'

describe('SettingsPanel', () => {
  beforeEach(() => localStorage.clear())

  it('opens on the controls tab and keeps sound and the rest in their own tabs', () => {
    render(<SettingsPanel onClose={() => {}} />)
    expect(screen.getByRole('tab', { name: '操作' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('最快移动速度')).toBeInTheDocument()
    expect(screen.queryByText('背景音乐')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: '声音与震动' }))
    expect(screen.getByText('背景音乐')).toBeInTheDocument()
    expect(screen.getByText('震动回馈')).toBeInTheDocument()
    expect(screen.queryByText('最快移动速度')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: '其他' }))
    expect(screen.getByText('点箱子查看内部')).toBeInTheDocument()
  })
})
