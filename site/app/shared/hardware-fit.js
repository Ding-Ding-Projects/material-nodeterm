// site/app/shared/hardware-fit.js
//
// An honest, conservative guess at whether this browser's machine could
// run a given Ollama model, from the only two numbers a browser is ever
// willing to disclose: navigator.deviceMemory (rounded hard, and only in
// Chromium browsers) and navigator.hardwareConcurrency. When
// deviceMemory is unavailable, the verdict is "Unknown fit" — never a
// guess dressed up as a fact.

export function fitVerdict(gb) {
  let ram = 0
  try {
    ram = Number(navigator.deviceMemory || 0)
  } catch (_err) {
    ram = 0
  }
  const cores = navigator.hardwareConcurrency || 0
  if (!ram) {
    return { verdict: 'Unknown fit', why: 'This browser will not tell us how much memory you have, so we are not going to guess. Cores seen: ' + (cores || '?') + '.' }
  }
  if (gb * 1.4 < ram) {
    return { verdict: 'Should fit', why: 'Needs about ' + gb + ' GB; the browser reports roughly ' + ram + ' GB and ' + cores + ' cores.' }
  }
  if (gb < ram) {
    return { verdict: 'Tight', why: 'Needs about ' + gb + ' GB out of roughly ' + ram + ' GB — it may run, slowly, with little room left.' }
  }
  return { verdict: 'Too big', why: 'Needs about ' + gb + ' GB but the browser only reports roughly ' + ram + ' GB.' }
}
