import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { basename, isAbsolute, resolve } from 'node:path'

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
    while (true) {
      if (inComment) {
        const close = line.indexOf('-->')
        if (close === -1) {
          line = ''
          break
        }
        line = line.slice(close + 3)
        inComment = false
      }
      const open = line.indexOf('<!--')
      if (open === -1) break
      const close = line.indexOf('-->', open + 4)
      if (close === -1) {
        line = line.slice(0, open)
        inComment = true
        break
      }
      line = line.slice(0, open) + line.slice(close + 3)
    }
    const expression = /!\[([^\]\r\n]*)\]\((?:<([^>\r\n]+)>|([^\s()\r\n]+))(?:\s+"[^"]*")?\)/g
    const codeFreeSegments = line.split('`').filter((_segment, index) => index % 2 === 0)
    for (const segment of codeFreeSegments) {
      for (const match of segment.matchAll(expression)) {
        result.push({ alt: match[1], path: normalisePath(match[2] ?? match[3]) })
      }
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
function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function pngDimensions(path) {
  const bytes = readFileSync(path)
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return null
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

function validReceipt(receipt, sourceCommit) {
  if (!receipt || receipt.schemaVersion !== 1 || receipt.route !== 'cheap-lowlevel-headless') return false
  if (typeof receipt.method !== 'string' || !receipt.method.includes('cheap Lowlevel MCP headless')) return false
  if (receipt.source?.gitHead !== sourceCommit || !/^[0-9a-f]{64}$/.test(receipt.source?.workingTreeDigest || '') || !/^[0-9a-f]{64}$/.test(receipt.source?.provenanceSha256 || '')) return false
  if (!/^[0-9a-f]{64}$/.test(receipt.candidate?.sha256 || '') || !/^[0-9a-f]{64}$/.test(receipt.candidate?.appAsarSha256 || '')) return false
  if (receipt.launch?.ok !== true || !receipt.launch.desktop || !Number.isInteger(receipt.launch.pid) || !Number.isInteger(receipt.launch.hwnd) || receipt.launch.focusStealing !== false || receipt.launch.terminalWindow !== false) return false
  return receipt.cdp?.count === 1 && !!receipt.cdp.id && !!receipt.cdp.url && !!receipt.cdp.webSocketDebuggerUrl
}

function validTuple(tuple) {
  return !!tuple && typeof tuple.label === 'string' && tuple.label.length > 0 && Number.isSafeInteger(tuple.viewport?.width) && tuple.viewport.width > 0 && Number.isSafeInteger(tuple.viewport?.height) && tuple.viewport.height > 0 && Number.isFinite(tuple.deviceScaleFactor) && tuple.deviceScaleFactor > 0 && typeof tuple.theme === 'string' && tuple.theme.length > 0 && typeof tuple.languageMode === 'string' && tuple.languageMode.length > 0
}

export function validateCurrentCaptureLabels({ readme, manifest, sourceCommit, root, receiptRoot }) {
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
    const path = resolve(root ?? '.', embed.path)
    let actualHash = ''
    let dimensions = null
    try {
      actualHash = sha256(path)
      dimensions = pngDimensions(path)
    } catch {
      errors.push(`current image ${embed.path} is missing from the checked publication root`)
    }
    if (actualHash && record.sha256 !== actualHash) errors.push(`current image ${embed.path} hash does not match its semantic record`)
    if (!dimensions || dimensions.width !== record.width || dimensions.height !== record.height) errors.push(`current image ${embed.path} dimensions do not match its semantic record`)
    if (!validTuple(record.tuple) || !record.provenance?.version || !record.provenance?.buildKind) {
      errors.push(`current image ${embed.path} lacks a complete semantic provenance record with a displayed version`)
    }
    const receiptId = record.provenance?.receiptId
    const receiptPath = receiptRoot && receiptId && !isAbsolute(receiptId)
      ? resolve(receiptRoot, receiptId)
      : ''
    if (!receiptId || isAbsolute(receiptId) || !receiptRoot || !/^[0-9a-f]{64}$/.test(record.provenance?.receiptSha256 || '')) {
      errors.push(`current image ${embed.path} lacks a portable external receipt id and digest`)
      continue
    }
    let receipt
    try {
      const receiptBytes = readFileSync(receiptPath)
      if (createHash('sha256').update(receiptBytes).digest('hex') !== record.provenance.receiptSha256) {
        errors.push(`current image ${embed.path} receipt digest does not match`)
        continue
      }
      receipt = JSON.parse(receiptBytes.toString('utf8'))
    } catch {
      errors.push(`current image ${embed.path} external receipt cannot be read and parsed`)
      continue
    }
    if (!validReceipt(receipt, sourceCommit)) errors.push(`current image ${embed.path} external receipt is invalid`)
    const receiptCapture = receipt.capture
    const receiptEvidence = Array.isArray(receipt.evidence) ? receipt.evidence.find((item) => basename(item.file || '') === file) : null
    if (!receiptCapture || receiptCapture.version !== record.provenance.version || receiptCapture.buildKind !== record.provenance.buildKind || JSON.stringify(receiptCapture.tuple) !== JSON.stringify(record.tuple) || !receiptEvidence || receiptEvidence.sha256 !== record.sha256 || receiptEvidence.width !== record.width || receiptEvidence.height !== record.height) {
      errors.push(`current image ${embed.path} is not bound to the external receipt capture output`)
    }
  }
  return errors
}
