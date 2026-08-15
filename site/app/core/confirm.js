// site/app/core/confirm.js
//
// Destructive-action super-confirmation gate. Anchored beside the control
// that triggered it whenever there's room; falls back to a centered
// dialog on a genuinely constrained width. Names the exact action and
// what it affects, requires two INDEPENDENTLY operated key controls
// before a full-range slider becomes usable, and only completing the
// slide runs the destructive action. An always-available emergency-exit
// control and Escape both cancel; focus returns to the control that
// opened the gate either way.
//
// This is a user-experience speed bump matching the desktop app's own
// "toy lock" framing for irreversible actions on this static site (e.g.
// clearing locally stored settings) — it is not a security boundary.

let activeGate = null

export function openConfirmGate({ anchor, title, description, confirmLabel = 'Confirm', onConfirm }) {
  closeConfirmGate() // only one gate at a time

  const scrim = document.createElement('div')
  scrim.className = 'confirm-gate__scrim'

  const gate = document.createElement('div')
  gate.className = 'confirm-gate'
  gate.setAttribute('role', 'alertdialog')
  gate.setAttribute('aria-modal', 'true')
  gate.setAttribute('aria-label', title)

  gate.innerHTML = `
    <h3 class="confirm-gate__title"></h3>
    <p class="confirm-gate__desc"></p>
    <div class="confirm-gate__keys">
      <label class="confirm-gate__key">
        <input type="checkbox" data-key="1" />
        <span>Key 1 — I understand what this affects</span>
      </label>
      <label class="confirm-gate__key">
        <input type="checkbox" data-key="2" />
        <span>Key 2 — I want to proceed anyway</span>
      </label>
    </div>
    <div class="confirm-gate__slider-row">
      <input type="range" min="0" max="100" value="0" class="confirm-gate__slider" disabled aria-label="Slide fully right to confirm" />
      <span class="confirm-gate__slider-label">Slide to confirm</span>
    </div>
    <div class="confirm-gate__progress" hidden>
      <div class="confirm-gate__progress-bar"></div>
      <span>Working…</span>
    </div>
    <div class="confirm-gate__footer">
      <button type="button" class="btn btn-secondary btn-sm confirm-gate__cancel">Emergency exit (cancel)</button>
    </div>
  `
  gate.querySelector('.confirm-gate__title').textContent = title
  gate.querySelector('.confirm-gate__desc').textContent = description

  document.body.appendChild(scrim)
  document.body.appendChild(gate)
  positionGate(gate, anchor)

  const key1 = gate.querySelector('[data-key="1"]')
  const key2 = gate.querySelector('[data-key="2"]')
  const slider = gate.querySelector('.confirm-gate__slider')
  const progress = gate.querySelector('.confirm-gate__progress')
  const progressBar = gate.querySelector('.confirm-gate__progress-bar')

  function refreshSlider() {
    slider.disabled = !(key1.checked && key2.checked)
    if (slider.disabled) slider.value = 0
  }
  key1.addEventListener('change', refreshSlider)
  key2.addEventListener('change', refreshSlider)

  let completed = false
  slider.addEventListener('input', () => {
    progress.hidden = false
    progressBar.style.width = `${slider.value}%`
    if (Number(slider.value) >= 100 && !completed) {
      completed = true
      progressBar.classList.add('confirm-gate__progress-bar--done')
      setTimeout(() => {
        cleanup()
        anchor && anchor.focus && anchor.focus()
        onConfirm && onConfirm()
      }, 260)
    }
  })

  function cancel() {
    cleanup()
    anchor && anchor.focus && anchor.focus()
  }
  gate.querySelector('.confirm-gate__cancel').addEventListener('click', cancel)
  scrim.addEventListener('click', cancel)
  function onKeydown(e) {
    if (e.key === 'Escape') cancel()
  }
  document.addEventListener('keydown', onKeydown, true)

  function cleanup() {
    document.removeEventListener('keydown', onKeydown, true)
    scrim.remove()
    gate.remove()
    activeGate = null
  }

  activeGate = { cleanup }
  key1.focus()
  return { close: cleanup }
}

export function closeConfirmGate() {
  if (activeGate) activeGate.cleanup()
}

function positionGate(gate, anchor) {
  // Anchored beside the control when there's room; otherwise centered —
  // and always kept fully inside the viewport with its own scroll rather
  // than spilling off-screen or covering the control that opened it.
  gate.style.position = 'fixed'
  gate.style.maxHeight = '90vh'
  gate.style.overflowY = 'auto'
  const vw = window.innerWidth
  const vh = window.innerHeight
  if (anchor && vw >= 640) {
    const r = anchor.getBoundingClientRect()
    const width = Math.min(420, vw - 32)
    let left = r.left
    if (left + width > vw - 16) left = vw - width - 16
    if (left < 16) left = 16
    let top = r.bottom + 8
    gate.style.width = `${width}px`
    // Measure after layout to keep it inside the bottom edge too.
    requestAnimationFrame(() => {
      const h = gate.getBoundingClientRect().height
      if (top + h > vh - 16) top = Math.max(16, r.top - h - 8)
      gate.style.top = `${top}px`
    })
    gate.style.left = `${left}px`
    gate.style.top = `${top}px`
  } else {
    gate.style.width = `min(420px, calc(100vw - 32px))`
    gate.style.left = '50%'
    gate.style.top = '50%'
    gate.style.transform = 'translate(-50%, -50%)'
  }
}
