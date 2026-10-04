// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import {
  decideMarkdownLinkClick,
  installMarkdownLinkGuard,
  RENDERED_MARKDOWN_CONTAINERS
} from './markdownLinks'

describe('decideMarkdownLinkClick', () => {
  it('opens http/https/mailto externally', () => {
    expect(decideMarkdownLinkClick('https://github.com/x')).toEqual({
      action: 'external',
      url: 'https://github.com/x'
    })
    expect(decideMarkdownLinkClick('http://a.b/')).toEqual({ action: 'external', url: 'http://a.b/' })
    expect(decideMarkdownLinkClick('mailto:a@b.c')).toEqual({ action: 'external', url: 'mailto:a@b.c' })
    expect(decideMarkdownLinkClick('  HTTPS://A.B/x  ')).toEqual({ action: 'external', url: 'https://a.b/x' })
  })

  it('ignores same-document fragments and empty hrefs', () => {
    expect(decideMarkdownLinkClick('#section')).toEqual({ action: 'ignore' })
    expect(decideMarkdownLinkClick('#')).toEqual({ action: 'ignore' })
    expect(decideMarkdownLinkClick('')).toEqual({ action: 'ignore' })
  })

  it('treats relative paths, file: and other schemes as local (never navigated)', () => {
    expect(decideMarkdownLinkClick('src/core/pty-manager.ts:4100')).toEqual({ action: 'local' })
    expect(decideMarkdownLinkClick('./README.md')).toEqual({ action: 'local' })
    expect(decideMarkdownLinkClick('/etc/hosts')).toEqual({ action: 'local' })
    expect(decideMarkdownLinkClick('//evil.example/x')).toEqual({ action: 'local' })
    expect(decideMarkdownLinkClick('file:///etc/passwd')).toEqual({ action: 'local' })
    expect(decideMarkdownLinkClick('vscode://file/x')).toEqual({ action: 'local' })
    expect(decideMarkdownLinkClick('javascript:alert(1)')).toEqual({ action: 'local' })
  })
})

describe('installMarkdownLinkGuard', () => {
  let uninstall: (() => void) | undefined
  afterEach(() => {
    uninstall?.()
    uninstall = undefined
    document.body.innerHTML = ''
  })

  function setup(html: string) {
    document.body.innerHTML = html
    const openExternal = vi.fn()
    const notifyLocal = vi.fn()
    uninstall = installMarkdownLinkGuard(document, { openExternal, notifyLocal })
    return { openExternal, notifyLocal }
  }

  function click(el: Element, init: MouseEventInit = {}): MouseEvent {
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init })
    el.dispatchEvent(ev)
    return ev
  }

  it('prevents navigation for a relative link inside rendered markdown and tells the user', () => {
    const { openExternal, notifyLocal } = setup(
      '<div class="term-md__content"><p><a href="src/core/pty-manager.ts:4100">pty</a></p></div>'
    )
    const ev = click(document.querySelector('a')!)
    expect(ev.defaultPrevented).toBe(true)
    expect(notifyLocal).toHaveBeenCalledTimes(1)
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('routes an https link through openExternal in every container', () => {
    for (const sel of RENDERED_MARKDOWN_CONTAINERS) {
      const cls = sel.slice(1)
      const { openExternal } = setup(`<div class="${cls}"><a href="https://a.b/x"><code>x</code></a></div>`)
      // Click lands on a CHILD of the anchor — closest() must still find it.
      const ev = click(document.querySelector('code')!)
      expect(ev.defaultPrevented, sel).toBe(true)
      expect(openExternal, sel).toHaveBeenCalledWith('https://a.b/x')
      uninstall?.()
      uninstall = undefined
    }
  })

  it('swallows a fragment link without doing anything', () => {
    const { openExternal, notifyLocal } = setup(
      '<div class="term-chat__text"><a href="#heading">jump</a></div>'
    )
    const ev = click(document.querySelector('a')!)
    expect(ev.defaultPrevented).toBe(true)
    expect(openExternal).not.toHaveBeenCalled()
    expect(notifyLocal).not.toHaveBeenCalled()
  })

  it('handles modifier clicks too (nothing else owns them on rendered markdown)', () => {
    const { openExternal } = setup('<div class="sticky-node__md"><a href="https://a.b/">x</a></div>')
    const ev = click(document.querySelector('a')!, { metaKey: true })
    expect(ev.defaultPrevented).toBe(true)
    expect(openExternal).toHaveBeenCalledWith('https://a.b/')
  })

  it('leaves anchors outside rendered markdown alone', () => {
    const { openExternal, notifyLocal } = setup('<div class="toolbar"><a href="relative">x</a></div>')
    const ev = click(document.querySelector('a')!)
    expect(ev.defaultPrevented).toBe(false)
    expect(openExternal).not.toHaveBeenCalled()
    expect(notifyLocal).not.toHaveBeenCalled()
  })

  it('skips an event someone already handled, and non-primary buttons', () => {
    const { openExternal } = setup('<div class="term-md__content"><a href="https://a.b/">x</a></div>')
    const a = document.querySelector('a')!
    a.addEventListener('click', (e) => e.preventDefault(), { once: true })
    click(a)
    click(a, { button: 1 })
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('uninstalls cleanly', () => {
    const { openExternal } = setup('<div class="term-md__content"><a href="https://a.b/">x</a></div>')
    uninstall!()
    uninstall = undefined
    const ev = click(document.querySelector('a')!)
    expect(ev.defaultPrevented).toBe(false)
    expect(openExternal).not.toHaveBeenCalled()
  })
})

describe('RENDERED_MARKDOWN_CONTAINERS contract', () => {
  // The list is a contract with the components that render markdown into these classes. A rename
  // there without a rename here would silently re-open the canvas-wipe bug, so pin that every
  // class is still emitted by some component source file.
  const RENDERER = path.join(__dirname, '..')
  function sources(dir: string, out: string[] = []): string[] {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) sources(full, out)
      else if (/\.tsx$/.test(e.name) && !/\.test\.tsx$/.test(e.name)) out.push(full)
    }
    return out
  }
  const all = sources(RENDERER).map((f) => fs.readFileSync(f, 'utf8'))

  it('names only class selectors that a component still renders', () => {
    expect(RENDERED_MARKDOWN_CONTAINERS.length).toBeGreaterThan(0)
    for (const sel of RENDERED_MARKDOWN_CONTAINERS) {
      expect(sel.startsWith('.'), sel).toBe(true)
      const cls = sel.slice(1)
      const used = all.some((src) => new RegExp(`className=["'{][^"'}]*\\b${cls}\\b`).test(src))
      expect(used, `${cls} is not rendered by any component`).toBe(true)
    }
  })

  it('covers every component that injects rendered markdown HTML', () => {
    // Any file that pipes renderMarkdown output into dangerouslySetInnerHTML must do it inside one
    // of the listed containers — a new markdown surface has to join the list.
    const offenders = sources(RENDERER)
      .filter((f) => {
        const src = fs.readFileSync(f, 'utf8')
        return /renderMarkdown/.test(src) && /dangerouslySetInnerHTML/.test(src)
      })
      // NoteMarkdown takes its container class from its callers — pinned by the next test.
      .filter((f) => path.basename(f) !== 'NoteMarkdown.tsx')
      .filter((f) => {
        const src = fs.readFileSync(f, 'utf8')
        return !RENDERED_MARKDOWN_CONTAINERS.some((sel) => src.includes(sel.slice(1)))
      })
    expect(offenders.map((f) => path.relative(RENDERER, f))).toEqual([])
  })

  it('every NoteMarkdown usage renders into a listed container', () => {
    const usages = all.flatMap((src) => [...src.matchAll(/<NoteMarkdown\b[^>]*>/g)].map((m) => m[0]))
    expect(usages.length).toBeGreaterThan(0)
    for (const u of usages) {
      const cls = /className="([^"]+)"/.exec(u)?.[1] ?? ''
      expect(
        RENDERED_MARKDOWN_CONTAINERS.some((sel) => cls.split(/\s+/).includes(sel.slice(1))),
        u
      ).toBe(true)
    }
  })
})
