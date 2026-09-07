// Runs inside the reference after load and observes its real output.
function inspectReference() {
  const doc = document
  if (!doc.getElementById('design-reference-freeze')) {
    const style = doc.createElement('style')
    style.id = 'design-reference-freeze'
    style.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}'
    doc.head.appendChild(style)
  }
  for (const animation of doc.getAnimations?.() || []) { animation.pause(); animation.currentTime = 0 }
  const host = doc.querySelector('#dc-root > .sc-host')
  const brokenImage = [...doc.images].some((image) => image.complete && image.naturalWidth === 0)
  const styles = [...doc.querySelectorAll('link[rel="stylesheet"]')]
  const fontFaces = doc.fonts ? [...doc.fonts] : []
  const requiredFonts = ['Outfit', 'Roboto Mono', 'Material Symbols Rounded']
  const fontsRegistered = requiredFonts.every((name) => fontFaces.some((face) => face.family.replace(/["']/g, '') === name))
  // Checking a family alone permits fallback. Load real faces, including icon ligatures.
  if (fontsRegistered && !doc.documentElement.dataset.designReferenceFontLoad) {
    doc.documentElement.dataset.designReferenceFontLoad = 'pending'
    Promise.all(requiredFonts.flatMap((name) => [400, 500, 700].map((weight) =>
      doc.fonts.load(`${weight} 16px "${name}"`, name === 'Material Symbols Rounded' ? 'settings' : 'Preview')
    ))).then((faces) => {
      doc.documentElement.dataset.designReferenceFontLoad = faces.every((loaded) => loaded.length > 0) ? 'loaded' : 'failed'
    }, () => { doc.documentElement.dataset.designReferenceFontLoad = 'failed' })
  }
  const error = doc.querySelector('.sc-logic-error,.sc-has-error,.sc-placeholder-error')
  if (error || brokenImage || fontFaces.some((face) => face.status === 'error') || doc.documentElement.dataset.designReferenceFontLoad === 'failed') {
    return { state: 'failed', reason: 'reference logic, image, or font failed' }
  }
  const bounds = host?.getBoundingClientRect()
  const ready = host && host.childElementCount > 0 && bounds.width > 0 && bounds.height > 0 &&
    host.textContent.trim().length > 0 && !doc.querySelector('x-dc') &&
    !doc.querySelector('.sc-missing,.sc-unresolved,.sc-placeholder') &&
    doc.documentElement.dataset.theme === 'dark' && styles.length >= 3 && styles.every((link) => !!link.sheet) &&
    [...doc.images].every((image) => image.complete && image.naturalWidth > 0) &&
    fontsRegistered && doc.fonts.status === 'loaded' && doc.documentElement.dataset.designReferenceFontLoad === 'loaded'
  return { state: ready ? 'ready' : 'pending' }
}
const readinessScript = `(${inspectReference.toString()})()`
async function waitForReference({ probe, failures, timeoutMs = 12000, intervalMs = 50, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const deadline = now() + timeoutMs
  let readyCount = 0
  while (now() < deadline) {
    if (failures.length) throw new Error(failures[0])
    const result = await probe()
    if (failures.length) throw new Error(failures[0])
    if (result.state === 'failed') throw new Error(result.reason)
    readyCount = result.state === 'ready' ? readyCount + 1 : 0
    if (readyCount >= 3) return
    await sleep(intervalMs)
  }
  throw new Error('reference did not render a complete semantic root before the deadline')
}
module.exports = { inspectReference, readinessScript, waitForReference }
