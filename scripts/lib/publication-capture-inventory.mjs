/**
 * Hand-written publication roster for captures that explain the current product.
 *
 * Directory discovery is deliberately not used here. A missing capture must make the
 * check fail, rather than disappear from the set it checks.
 */
export const README_CAPTURE_ROSTER = [
  'app-01-launch.png',
  'app-02-settings.png',
  'app-03-palette.png',
  'app-04-canvas.png',
  'app-05-kanban.png',
  'app-06-history.png',
  'app-status-surface.png',
  'app-settings-language.png',
  'app-settings-narrator.png',
  'app-settings-appearance-editor.png',
  'app-settings-app-identity.png',
  'app-settings-schedule.png',
  'app-adhd-modes.png',
  'app-windows-terminal-profiles.png',
  'app-windows-terminal-profile-availability.png',
  'app-kids-home.png',
  'app-kids-gate.png',
  'app-kids-parent.png',
  'app-compact-more.png',
  'app-node-catalog-73.png',
  'app-terminal-created.png',
  'app-aws-from-compact-more.png',
  'app-settings-docker-host.png',
  'app-projectless-add-disabled.png',
  'app-kids-unavailable-recovery.png',
  'app-kids-targeted-reset.png'
]

export const SITE_CAPTURE_ROSTER = [
  'app-01-launch.png',
  'app-02-settings.png',
  'app-03-palette.png',
  'app-04-canvas.png',
  'app-05-kanban.png',
  'app-06-history.png',
  'app-status-surface.png',
  'app-settings-language.png',
  'app-settings-narrator.png',
  'app-settings-appearance-editor.png',
  'app-settings-app-identity.png',
  'app-settings-schedule.png',
  'app-settings-docker-host.png',
  'app-adhd-modes.png',
  'app-windows-terminal-profiles.png',
  'app-windows-terminal-profile-availability.png',
  'app-kids-home.png',
  'app-kids-gate.png',
  'app-kids-parent.png',
  'app-settings-kids-mode.png'
]

function normalisePath(value) {
  return value.replace(/^\.\//, '').replace(/\\/g, '/')
}

/** Return real Markdown image embeds, not arbitrary first mentions of a filename. */
export function markdownImageEmbeds(markdown) {
  const result = []
  let fenced = false
  let inComment = false
  for (const originalLine of markdown.split(/\r\n|\n|\r/)) {
    if (/^\s*(```|~~~)/.test(originalLine)) {
      fenced = !fenced
      continue
    }
    if (fenced) continue
    let line = originalLine
    if (inComment) {
      const close = line.indexOf('-->')
      if (close === -1) continue
      line = line.slice(close + 3)
      inComment = false
    }
    const open = line.indexOf('<!--')
    if (open !== -1) {
      const close = line.indexOf('-->', open + 4)
      line = close === -1 ? line.slice(0, open) : line.slice(0, open) + line.slice(close + 3)
      inComment = close === -1
    }
    const expression = /!\[([^\]\r\n]*)\]\((?:<([^>\r\n]+)>|([^\s()\r\n]+))(?:\s+"[^"]*")?\)/g
    for (const match of line.matchAll(expression)) {
      result.push({ alt: match[1], path: normalisePath(match[2] ?? match[3]) })
    }
  }
  return result
}

/** Extract actual rendered gallery image URLs, not source-shaped strings. */
export function renderedImagePaths(html) {
  return [...html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"[^>]*>/g)].map((match) => normalisePath(match[1]))
}

export function validatePublicationCaptures({ readme, siteHtml }) {
  const errors = []
  const embeds = markdownImageEmbeds(readme)
  const embedPaths = new Set(embeds.map((embed) => embed.path))

  for (const file of README_CAPTURE_ROSTER) {
    const path = `docs/assets/shots/${file}`
    if (!embedPaths.has(path)) errors.push(`README lacks an actual Markdown image embed for ${path}`)
  }

  const images = new Set(renderedImagePaths(siteHtml))
  for (const file of SITE_CAPTURE_ROSTER) {
    if (!images.has(`assets/shots/${file}`)) errors.push(`rendered site gallery lacks required capture assets/shots/${file}`)
  }

  return errors
}

/**
 * Current is a provenance claim. A filename, a fresh checkout timestamp, or an ordinary prose
 * mention does not establish it. The v2 manifest's semantic entry must bind the same image to
 * the requested source commit before a real Markdown image embed may use a current label.
 */
export function validateCurrentCaptureLabels({ readme, manifest, sourceCommit }) {
  const errors = []
  const entries = Array.isArray(manifest?.entries) ? manifest.entries : []
  for (const embed of markdownImageEmbeds(readme)) {
    if (!/\bcurrent\b/i.test(embed.alt) || !embed.path.startsWith('docs/assets/shots/')) continue
    const file = embed.path.split('/').at(-1)
    const record = entries.find((entry) => entry.file === file)
    if (!record) {
      errors.push(`current image ${embed.path} has no semantic v2 capture record`)
      continue
    }
    if (record.provenance?.commit !== sourceCommit) {
      errors.push(`current image ${embed.path} is not bound to source commit ${sourceCommit}`)
    }
    if (!/^[0-9a-f]{64}$/.test(record.sha256 || '') || !record.tuple || !record.provenance?.method || !record.provenance?.receipt || !(record.version ?? record.provenance?.version)) {
      errors.push(`current image ${embed.path} lacks a complete semantic provenance record with a displayed version`)
    }
  }
  return errors
}
