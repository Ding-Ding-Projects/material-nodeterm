// site/app/shared/convert.js
//
// The "Turn-it-into" lab's parsing half: turn pasted text in one of nine
// recognised shapes into a list of plain-object records, which
// exportFormats.js#emit then turns back out into any of thirteen output
// shapes. Everything here runs synchronously in the browser; nothing is
// ever sent anywhere.

export function parseRecords(text, from) {
  const t = String(text || '').trim()
  if (!t) return []
  if (from === 'json') {
    const v = JSON.parse(t)
    return Array.isArray(v) ? v : [v]
  }
  if (from === 'jsonl') return t.split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l))
  if (from === 'csv' || from === 'tsv') {
    const sep = from === 'csv' ? ',' : '\t'
    const lines = t.split(/\r?\n/).filter(Boolean)
    const head = lines[0].split(sep).map((h) => h.trim().replace(/^"|"$/g, ''))
    return lines.slice(1).map((line) => {
      const cells = line.split(sep)
      const obj = {}
      head.forEach((h, i) => (obj[h] = String(cells[i] === undefined ? '' : cells[i]).trim().replace(/^"|"$/g, '')))
      return obj
    })
  }
  if (from === 'yaml') {
    const out = []
    let cur = null
    t.split(/\r?\n/).forEach((line) => {
      if (/^-\s*/.test(line)) {
        cur = {}
        out.push(cur)
        const rest = line.replace(/^-\s*/, '')
        if (rest.includes(':')) {
          const i = rest.indexOf(':')
          cur[rest.slice(0, i).trim()] = rest.slice(i + 1).trim()
        }
      } else if (cur && line.includes(':')) {
        const i = line.indexOf(':')
        cur[line.slice(0, i).trim()] = line.slice(i + 1).trim()
      }
    })
    return out.length ? out : [{ text: t }]
  }
  if (from === 'base64') return [{ text: decodeURIComponent(escape(atob(t.replace(/\s+/g, '')))) }]
  if (from === 'hex') return [{ text: (t.replace(/[^0-9a-f]/gi, '').match(/.{1,2}/g) || []).map((h) => String.fromCharCode(parseInt(h, 16))).join('') }]
  if (from === 'xml') {
    const rows = []
    ;(t.match(/<item>[\s\S]*?<\/item>/g) || []).forEach((chunk) => {
      const obj = {}
      ;(chunk.match(/<(\w+)>([\s\S]*?)<\/\1>/g) || []).forEach((f) => {
        const m = f.match(/<(\w+)>([\s\S]*?)<\/\1>/)
        if (m && m[1] !== 'item') obj[m[1]] = m[2]
      })
      rows.push(obj)
    })
    return rows.length ? rows : [{ text: t }]
  }
  return t.split(/\r?\n/).filter(Boolean).map((line) => ({ text: line }))
}

// A cheap best-guess at what shape a blob of pasted text is in — used by
// the lab's "Guess the type" button. It is a guess, never a promise.
export function detectShape(text) {
  const t = String(text || '').trim()
  if (/^[[{]/.test(t)) return 'json'
  if (/^\s*-\s/.test(t)) return 'yaml'
  if (/^</.test(t)) return 'xml'
  if (t.includes('\t')) return 'tsv'
  if (/^[^\n]+,[^\n]+/.test(t)) return 'csv'
  if (/^[0-9a-f\s]+$/i.test(t) && t.length > 8) return 'hex'
  if (/^[A-Za-z0-9+/=\s]+$/.test(t) && t.length > 12) return 'base64'
  return 'text'
}
