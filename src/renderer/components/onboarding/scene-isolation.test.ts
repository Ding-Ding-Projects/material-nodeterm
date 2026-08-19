// scenes.tsx draws its illustrations with private `onb-*` classes frozen to match the app's
// context menu (`ctx-menu`/`ctx-item`/`ctx-icon`) and terminal status badge (`term-node__status`)
// as they looked when these scenes were tuned. If either literal class name creeps back in, a
// later restyle of the real UI silently re-skins or misaligns a 7s hand-timed animation with no
// error and no failing render test (this file is never unit-rendered). See the header comment in
// scenes.tsx and the `.onb-menu`/`.onb-node__status` block in styles.css for the frozen copies.
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const scenes = fs.readFileSync(path.join(__dirname, 'scenes.tsx'), 'utf8')

describe('onboarding scenes stay isolated from live app-chrome classes', () => {
  it.each(['ctx-menu', 'ctx-item', 'ctx-icon', 'term-node__status'])(
    'never borrows the real "%s" class',
    (needle) => {
      expect(scenes).not.toContain(needle)
    }
  )
})
