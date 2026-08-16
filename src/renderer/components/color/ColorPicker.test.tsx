// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseAnyColor } from '@renderer/lib/color/convert'
import { ColorPicker } from './ColorPicker'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
let emitted: string[]

function clickTab(label: string): void {
  const tab = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
    .find((button) => button.textContent === label)
  expect(tab).toBeTruthy()
  act(() => tab!.click())
}

function commitField(label: string, value: string): void {
  const input = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)
  expect(input, label).toBeTruthy()
  act(() => {
    input!.value = value
    input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  })
}

beforeEach(() => {
  emitted = []
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => {
    root.render(
      <ColorPicker
        value="#33669980"
        label="Test colour"
        onChange={(value) => emitted.push(value)}
      />
    )
  })
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function expectPersistableRgba(): void {
  const value = emitted.at(-1)
  expect(value).toMatch(/^rgba\(/)
  expect(value).not.toMatch(/^(hsv|cmyk)\(/)
  expect(parseAnyColor(value!)?.a).toBeCloseTo(0.502, 3)
  const swatch = document.createElement('span')
  swatch.style.backgroundColor = value!
  expect(swatch.style.backgroundColor).not.toBe('')
}

describe('non-CSS editing formats', () => {
  it('persists an HSV edit as browser CSS without losing alpha', () => {
    clickTab('HSV')
    commitField('V%', '72')
    expectPersistableRgba()
  })

  it('persists a CMYK edit as browser CSS without losing alpha', () => {
    clickTab('CMYK')
    commitField('C%', '35')
    expectPersistableRgba()
  })
})
