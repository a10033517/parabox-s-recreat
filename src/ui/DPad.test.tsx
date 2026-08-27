import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DPad } from './DPad'

test('clicking each direction button calls onMove with the right direction', async () => {
  const onMove = vi.fn()
  render(<DPad onMove={onMove} />)
  const user = userEvent.setup()

  await user.click(screen.getByLabelText('上'))
  await user.click(screen.getByLabelText('下'))
  await user.click(screen.getByLabelText('左'))
  await user.click(screen.getByLabelText('右'))

  expect(onMove.mock.calls).toEqual([['up'], ['down'], ['left'], ['right']])
})
