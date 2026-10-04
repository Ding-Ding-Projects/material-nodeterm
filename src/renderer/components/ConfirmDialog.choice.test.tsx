// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from './ConfirmDialog'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function Harness({ onConfirm }: { onConfirm: (value: string) => void }): React.JSX.Element {
  const [value, setValue] = useState('completed')
  return (
    <ConfirmDialog
      message="Close issue #4 on GitHub?"
      confirmLabel="Close issue"
      choice={{
        label: 'Close as',
        options: [{ value: 'completed', label: 'Completed' }, { value: 'not_planned', label: 'Not planned' }],
        value,
        onChange: setValue
      }}
      onCancel={() => {}}
      onConfirm={() => onConfirm(value)}
    />
  )
}

describe('ConfirmDialog choice', () => {
  it('renders a labelled radio group with the default selected, and confirms the picked value', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const confirm = vi.fn()
    act(() => root.render(<Harness onConfirm={confirm} />))
    const group = document.body.querySelector<HTMLElement>('[role="radiogroup"]')!
    expect(group.getAttribute('aria-label')).toBe('Close as')
    const radios = [...group.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
    expect(radios.map((radio) => radio.checked)).toEqual([true, false])
    expect(radios.every((radio) => radio.classList.contains('mdx-radio'))).toBe(true)
    act(() => radios[1].click())
    const button = [...document.body.querySelectorAll('button')].find((b) => b.textContent === 'Close issue')!
    act(() => button.click())
    expect(confirm).toHaveBeenCalledWith('not_planned')
    act(() => root.unmount())
    host.remove()
  })
})
