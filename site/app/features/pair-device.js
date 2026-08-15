// "Pair this device" — the browser end of the desktop app's QR pairing flow.
//
// THE DIRECTION MATTERS, because it is the opposite of what people assume: the desktop app
// (Herng Ha) GENERATES the QR, and this page SCANS it. Nothing is generated here.
//
// What the QR contains (built by src/main/pairing-core.ts `buildPairingPayload`):
//     { v:1, host, port, user, token, pairPort, nodeterm:true, name, hostKey?, relay? }
// `token` is a single-use secret on a listener that lives ten minutes and stops at the first
// success. That token IS the authorization — scanning the QR is the capability.
//
// What this page then does:
//   1. generate an Ed25519 keypair in the browser (WebCrypto), private key never leaves it
//   2. POST { token, publicKey } to  http://<host>:<pairPort>/pair
//      (`token` is either the QR's full secret or the six-digit code shown beside it)
//   3. the desktop installs the public key and the device is paired
//
// TWO REAL CONSTRAINTS, surfaced to the user rather than discovered as a silent failure:
//
//   Mixed content. A page served over https CANNOT fetch http://192.168.x.x — the browser blocks
//   it outright, and no amount of CORS on the far end changes that. Pairing therefore works when
//   this site is reached over plain http on the LAN, which is exactly the LAN-only deployment
//   this is built for. If the page is on https we say so up front instead of letting the POST
//   fail with an opaque "Failed to fetch".
//
//   QR decoding. `BarcodeDetector` is native in Chromium and Android; Safari does not implement
//   it. Rather than ship a QR decoder or pretend, the camera path is offered only where the API
//   exists, and everywhere else the same payload can be pasted — the desktop shows it as text
//   beside the QR for precisely this reason.

import { registerTab } from '../core/registry.js'

const IS_SECURE_PAGE = location.protocol === 'https:'
const CAN_SCAN = typeof window.BarcodeDetector !== 'undefined'

/** Base64url of an ArrayBuffer — the encoding the pairing endpoint expects. */
function b64(buf) {
  const bytes = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

/**
 * An OpenSSH `ssh-ed25519 AAAA...` line built from a raw 32-byte public key.
 *
 * The host validates the line's shape and appends it to authorized_keys, so it has to be the real
 * wire format: length-prefixed "ssh-ed25519", then the length-prefixed key. Sending the bare
 * base64 key would be accepted by nothing.
 */
function opensshEd25519(rawKey) {
  const type = new TextEncoder().encode('ssh-ed25519')
  const key = new Uint8Array(rawKey)
  const out = new Uint8Array(4 + type.length + 4 + key.length)
  const dv = new DataView(out.buffer)
  let o = 0
  dv.setUint32(o, type.length); o += 4
  out.set(type, o); o += type.length
  dv.setUint32(o, key.length); o += 4
  out.set(key, o)
  return `ssh-ed25519 ${b64(out.buffer)} nodeterm-web`
}

/**
 * Build a payload from a hand-typed `host:port` plus the six-digit code the desktop shows beside
 * the QR.
 *
 * This exists because scanning is not always possible — Safari ships no QR reader, a laptop has
 * no rear camera, and someone pairing a browser on the very machine showing the code cannot point
 * one screen at itself. The desktop's listener accepts the short code in the same field as the
 * QR's long token, so nothing here is a second endpoint or a second kind of authorization: it is
 * the same single-use credential, typed instead of scanned.
 *
 * The desktop caps this at five wrong entries and then stops the whole listener, because six
 * digits is only a million and a LAN is quick — so the cost of a mistyped digit is pressing Pair
 * again, and the cost of guessing is that guessing does not work.
 */
function payloadFromCode(hostPort, code) {
  var digits = String(code || '').replace(/\D/g, '')
  if (digits.length !== 6) throw new Error('The code is six digits.')
  var m = /^\s*(?:https?:\/\/)?([^\s/:]+):(\d{1,5})\s*$/.exec(String(hostPort || ''))
  if (!m) throw new Error('Enter the address as shown on the desktop, e.g. 192.168.1.20:53411')
  return { v: 1, nodeterm: true, host: m[1], pairPort: Number(m[2]), token: digits }
}

/** Parse and sanity-check a scanned payload before we act on it. */
function parsePayload(text) {
  let p
  try {
    p = JSON.parse(String(text).trim())
  } catch {
    throw new Error('That is not a nodeterm pairing code — it is not valid JSON.')
  }
  if (!p || p.nodeterm !== true) throw new Error('That QR is not a nodeterm pairing code.')
  if (p.v !== 1) throw new Error(`This pairing code is version ${p.v}; this page understands version 1.`)
  for (const k of ['host', 'token', 'pairPort']) {
    if (!p[k]) throw new Error(`The pairing code is missing "${k}".`)
  }
  return p
}

async function pair(payload, setStatus) {
  // Either a scanned/pasted payload string, or one already built from a typed code.
  const p = typeof payload === 'object' && payload ? payload : parsePayload(payload)

  if (IS_SECURE_PAGE && !/^https:/.test(`http://${p.host}`)) {
    // Stated before the attempt, not after: on https this cannot work, and "Failed to fetch"
    // would send someone hunting a network fault that is really a browser policy.
    throw new Error(
      'This page is served over https, and a secure page is not allowed to contact ' +
        `http://${p.host}:${p.pairPort} — browsers block that as mixed content. Open this site ` +
        'over plain http on your LAN to pair, then come back.'
    )
  }

  setStatus('Generating a key for this device…')
  let pubRaw
  let keys
  try {
    keys = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
    pubRaw = await crypto.subtle.exportKey('raw', keys.publicKey)
  } catch {
    throw new Error(
      'This browser cannot generate an Ed25519 key (needs Safari 17+, Chrome 113+, or Firefox 129+). ' +
        'Pair from a newer browser.'
    )
  }

  const line = opensshEd25519(pubRaw)
  setStatus(`Contacting ${p.name || p.host}…`)

  const res = await fetch(`http://${p.host}:${p.pairPort}/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: p.token, publicKey: line, deviceId: `web-${Date.now().toString(36)}` })
  }).catch(() => {
    throw new Error(
      `Could not reach ${p.host}:${p.pairPort}. The desktop app must still be showing the QR ` +
        '(the code expires after ten minutes), and this device must be on the same network.'
    )
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(
      res.status === 403
        ? 'The host rejected that code. Check the six digits, or press Pair again on the desktop for a fresh one.'
        : res.status === 429
          // The short-code attempt cap. The listener has stopped, so retrying here is pointless —
          // say so rather than letting someone type a sixth guess into a dead window.
          ? 'Too many wrong codes, so the desktop closed the pairing window. Press Pair again there for a fresh code.'
          : `The host answered ${res.status}. ${detail}`.trim()
    )
  }
  return p
}

export function registerPairDevice(store) {
  registerTab({
    id: 'pair',
    title: 'Pair a device',
    icon: '📱',
    group: 'Remote',
    render: () => `
      <section class="pair-room">
        <h2>Pair this device</h2>
        <p>
          Open <strong>nodeterm on your computer</strong>, go to <em>Settings → Phone</em> and press
          <em>Pair</em>. It shows a QR code, a six-digit code, and an address. Scan the QR here,
          type the six digits, or paste the full text — any of the three works.
        </p>
        ${
          IS_SECURE_PAGE
            ? `<p class="pair-warn" role="note">This page is on <strong>https</strong>. Browsers refuse to
               contact a plain-http address on your LAN from a secure page, so pairing will not work
               here — open this site over <strong>http</strong> on your local network instead.</p>`
            : ''
        }
        ${
          CAN_SCAN
            ? `<button type="button" class="pair-btn" data-action="pair-scan">Scan the QR with this camera</button>`
            : `<p class="pair-note">This browser has no built-in QR reader (Safari does not provide one),
               so use the paste box below — the desktop shows the same code as text next to the QR.</p>`
        }
        <fieldset class="pair-manual">
          <legend>Type the code instead</legend>
          <p class="pair-note">The desktop shows a six-digit code and an address under the QR.</p>
          <label class="pair-label" for="pair-host">Address</label>
          <input id="pair-host" class="pair-input" inputmode="url" autocomplete="off"
            placeholder="192.168.1.20:53411">
          <label class="pair-label" for="pair-code">Six-digit code</label>
          <input id="pair-code" class="pair-input pair-input--code" inputmode="numeric"
            maxlength="6" autocomplete="one-time-code" placeholder="000000">
          <button type="button" class="pair-btn" data-action="pair-code">Pair with this code</button>
        </fieldset>

        <label class="pair-label" for="pair-paste">Or paste the full pairing code</label>
        <textarea id="pair-paste" class="pair-paste" rows="4"
          placeholder='{"v":1,"host":"192.168.…","token":"…","pairPort":…,"nodeterm":true}'></textarea>
        <button type="button" class="pair-btn" data-action="pair-submit">Pair with this code</button>
        <p class="pair-status" data-pair-status aria-live="polite"></p>
      </section>`
  })

  return {
    'pair-submit': async () => {
      const el = document.querySelector('[data-pair-status]')
      const box = document.getElementById('pair-paste')
      const setStatus = (m) => { if (el) el.textContent = m }
      try {
        const p = await pair(box ? box.value : '', setStatus)
        setStatus(`Paired with ${p.name || p.host}. This device can now reach it.`)
      } catch (e) {
        setStatus(e && e.message ? e.message : 'Pairing failed.')
      }
    },
    'pair-code': async () => {
      const el = document.querySelector('[data-pair-status]')
      const setStatus = (m) => { if (el) el.textContent = m }
      const host = document.getElementById('pair-host')
      const code = document.getElementById('pair-code')
      try {
        const built = payloadFromCode(host ? host.value : '', code ? code.value : '')
        const p = await pair(built, setStatus)
        setStatus(`Paired with ${p.name || p.host}. This device can now reach it.`)
      } catch (e) {
        setStatus(e && e.message ? e.message : 'Pairing failed.')
      }
    },
    'pair-scan': async () => {
      const el = document.querySelector('[data-pair-status]')
      const setStatus = (m) => { if (el) el.textContent = m }
      if (!CAN_SCAN) { setStatus('This browser cannot scan; paste the code instead.'); return }
      let stream
      try {
        setStatus('Starting the camera…')
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        const video = document.createElement('video')
        video.srcObject = stream
        video.setAttribute('playsinline', '')
        await video.play()
        const det = new window.BarcodeDetector({ formats: ['qr_code'] })
        setStatus('Point the camera at the QR code…')
        // Poll rather than requestVideoFrameCallback: the latter is not everywhere, and a QR
        // that is being held up to a camera does not need 60fps to be found.
        for (let i = 0; i < 200; i++) {
          const found = await det.detect(video).catch(() => [])
          if (found && found.length) {
            const p = await pair(found[0].rawValue, setStatus)
            setStatus(`Paired with ${p.name || p.host}. This device can now reach it.`)
            break
          }
          await new Promise((r) => setTimeout(r, 150))
        }
      } catch (e) {
        setStatus(e && e.message ? e.message : 'Could not use the camera.')
      } finally {
        if (stream) for (const t of stream.getTracks()) t.stop()
      }
    }
  }
}
