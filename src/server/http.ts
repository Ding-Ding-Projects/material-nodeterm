// Plain node:http request handler for the server edition.
// Deliberately NOT Fastify: the handler surface is tiny (a handful of auth
// routes + static renderer serving), it must be embeddable in an existing
// http.Server the WS upgrade also attaches to (Task 5), and avoiding a
// framework keeps the dependency/attack surface minimal. See task-4-brief.md.
import http from 'http'
import fs from 'fs'
import path from 'path'
import zlib from 'zlib'
import type { Auth } from './auth'
import { proxyAuthAllowed, type TrustProxyConfig } from './proxy-trust'
import { handleDownload } from './download'
import { handleUpload } from './upload'
import type { DownloadTickets } from '../core/download-tickets'
import { rpIdFromHost, verifyAssertion, verifyRegistration } from './webauthn'
import type { LadderAnswer, LadderRung } from '../core/unlock-ladder'

export const SESSION_COOKIE = 'nt_session'

const MAX_BODY_BYTES = 10 * 1024 // 10KB POST body cap

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2'
}

// CSP served with the inline login/setup pages (no app assets, no connections).
const PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'"

/** Types worth compressing. Everything else (png, woff2) is already compressed — running it
 *  through gzip only burns CPU and usually grows the payload. */
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.map', '.json', '.svg'])
/** Below this, a compressed frame plus its headers is not worth the round of CPU. */
const COMPRESS_MIN_BYTES = 1024
/** Total bytes of compressed payloads held in memory. The renderer dir is ~100 files whose gzip
 *  total is a couple of MB, so this is headroom, not a working limit — when it is exceeded the
 *  whole cache is dropped (simplest correct eviction for a set this small). */
const COMPRESS_CACHE_MAX_BYTES = 32 * 1024 * 1024

export interface HttpHandlerOpts {
  auth: Auth
  rendererDir: string
  /**
   * Reverse-proxy SSO trust (issue #29): when set, a request whose TCP peer is inside the
   * trusted nets and which carries the header (non-empty) is authenticated without a
   * session cookie. Never *blocks* anything — a request that doesn't qualify simply falls
   * through to the normal cookie/login path.
   */
  trustProxy?: TrustProxyConfig
  /** Ticket store backing `GET /download` (Explorer file downloads). Omitted in tests that don't
   *  exercise it — the route then simply doesn't exist. */
  downloadTickets?: DownloadTickets
  /** Data directory backing authenticated raw-byte browser uploads. Omitted by auth-only tests and
   *  embedders that intentionally do not expose the upload route. */
  uploadUserDataDir?: string
}

/** Parse the `nt_session=` value out of a Cookie header. Exported for the WS upgrade (Task 5). */
export function sessionTokenFromCookie(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    const name = part.slice(0, eq).trim()
    if (name === SESSION_COOKIE) return part.slice(eq + 1).trim()
  }
  return undefined
}

function isHtmlNavigation(req: http.IncomingMessage): boolean {
  const accept = req.headers['accept']
  return typeof accept === 'string' && accept.includes('text/html')
}

function cookieAttributes(req: http.IncomingMessage): string {
  let attrs = `HttpOnly; SameSite=Strict; Path=/`
  if (req.headers['x-forwarded-proto'] === 'https') attrs += '; Secure'
  return attrs
}

function setSessionCookie(req: http.IncomingMessage, res: http.ServerResponse, token: string): void {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; ${cookieAttributes(req)}`)
}

function clearSessionCookie(req: http.IncomingMessage, res: http.ServerResponse): void {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Max-Age=0; ${cookieAttributes(req)}`)
}

function redirect(res: http.ServerResponse, status: number, location: string): void {
  res.writeHead(status, { Location: location })
  res.end()
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const s = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(s)
}

function sendPage(res: http.ServerResponse, status: number, html: string): void {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': PAGE_CSP,
    'X-Content-Type-Options': 'nosniff'
  })
  res.end(html)
}

/** Read a form-encoded POST body (capped) and decode into URLSearchParams. */
/** The session token this request carries, or '' — passkey routes need it to tell "already
 *  signed in, enrolling another key" from "anonymous". */
function sessionFrom(req: http.IncomingMessage): string {
  return sessionTokenFromCookie(req.headers.cookie) ?? ''
}

/**
 * The origin the browser will have put in clientDataJSON.
 *
 * It must be derived from what the BROWSER saw, not from how this process is bound: behind a
 * reverse proxy or a tunnel the page is https on a public name while the server speaks plain
 * http to a container. Getting this wrong fails every passkey with "origin mismatch" on exactly
 * the deployments the feature is for. X-Forwarded-Proto is only honoured when the proxy is
 * trusted, which is the same rule the Secure cookie flag already follows.
 */
function originOf(req: http.IncomingMessage): string {
  const host = req.headers.host || 'localhost'
  const xfProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0]!.trim()
  const proto = xfProto || ((req.socket as { encrypted?: boolean }).encrypted ? 'https' : 'http')
  return `${proto}://${host}`
}

/** JSON body, bounded by the same limit as form bodies. */
function readJson(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let aborted = false
    req.on('data', (chunk: Buffer) => {
      if (aborted) return
      size += chunk.length
      if (size > MAX_BODY_BYTES) { aborted = true; reject(new Error('body too large')); req.destroy(); return }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (aborted) return
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch (e) { reject(e) }
    })
    req.on('error', reject)
  })
}

function readForm(req: http.IncomingMessage): Promise<URLSearchParams> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let aborted = false
    req.on('data', (chunk: Buffer) => {
      if (aborted) return
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        aborted = true
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (aborted) return
      resolve(new URLSearchParams(Buffer.concat(chunks).toString('utf8')))
    })
    req.on('error', (err) => {
      if (!aborted) reject(err)
    })
  })
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const PAGE_STYLE =
  "margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0d10;color:#e6e6e6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"
const CARD_STYLE =
  'background:#16191d;border:1px solid #26292e;border-radius:12px;padding:32px;width:320px;box-shadow:0 10px 40px rgba(0,0,0,0.4)'
const INPUT_STYLE =
  'width:100%;box-sizing:border-box;margin:8px 0;padding:10px 12px;border-radius:8px;border:1px solid #33373d;background:#0b0d10;color:#e6e6e6;font-size:14px'
const BUTTON_STYLE =
  'width:100%;box-sizing:border-box;margin-top:12px;padding:10px 12px;border-radius:8px;border:none;background:#2f6feb;color:#fff;font-size:14px;font-weight:600;cursor:pointer'
const H1_STYLE = 'margin:0 0 4px;font-size:18px;font-weight:600'
const SUB_STYLE = 'margin:0 0 16px;font-size:13px;color:#9aa0a6'
const ERR_STYLE = 'margin:0 0 12px;font-size:13px;color:#f26d6d'

/**
 * Sign-in. A passkey is offered FIRST when one is enrolled, with the password kept underneath as
 * the alternative rather than hidden behind a link — a self-hosted box whose only credential
 * lives on one phone is a box that eventually locks its owner out, so the fallback stays in
 * plain sight.
 *
 * The passkey button is rendered only when `hasPasskey` — an "unlock with a passkey" control on
 * a server with none enrolled is a button that can only ever fail, which is exactly the
 * decorative-control problem this project refuses everywhere else. It is also hidden when the
 * browser has no WebAuthn at all, decided at runtime below rather than guessed at from a
 * user-agent string.
 */
function loginPage(hasError: boolean, hasPasskey: boolean): string {
  const errLine = hasError
    ? `<p style="${ERR_STYLE}">That did not work. Try again.</p>`
    : ''
  const passkeyBlock = hasPasskey
    ? `<div id="pk-wrap" hidden style="display:flex;flex-direction:column;gap:10px;margin-bottom:6px">
         <button style="${BUTTON_STYLE}" type="button" id="pk-btn">Unlock with a passkey</button>
         <p id="pk-err" style="${ERR_STYLE};display:none"></p>
         <p style="${SUB_STYLE};margin:2px 0 0">or sign in with your password</p>
       </div>`
    : ''
  const script = hasPasskey
    ? `<script>
(function () {
  // Only reveal the passkey path if this browser can actually do it. Feature-detect; never
  // sniff the user agent.
  if (!window.PublicKeyCredential || !navigator.credentials) return;
  var wrap = document.getElementById('pk-wrap');
  var btn = document.getElementById('pk-btn');
  var err = document.getElementById('pk-err');
  wrap.hidden = false;
  var b64u = function (buf) {
    return btoa(String.fromCharCode.apply(null, new Uint8Array(buf)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  var fromB64u = function (s) {
    var t = s.replace(/-/g, '+').replace(/_/g, '/');
    var bin = atob(t + '==='.slice((t.length + 3) % 4));
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  };
  var fail = function (m) { err.textContent = m; err.style.display = 'block'; btn.disabled = false; btn.textContent = 'Unlock with a passkey'; };
  btn.addEventListener('click', function () {
    err.style.display = 'none';
    btn.disabled = true; btn.textContent = 'Waiting for your passkey…';
    fetch('/auth/passkey/login/options', { method: 'POST' })
      .then(function (r) { if (!r.ok) throw new Error('options'); return r.json(); })
      .then(function (o) {
        return navigator.credentials.get({ publicKey: {
          challenge: fromB64u(o.challenge),
          rpId: o.rpId,
          allowCredentials: (o.allowCredentials || []).map(function (c) { return { type: 'public-key', id: fromB64u(c.id) }; }),
          userVerification: o.userVerification,
          timeout: o.timeout
        }}).then(function (cred) { return { cred: cred, challenge: o.challenge }; });
      })
      .then(function (x) {
        if (!x.cred) throw new Error('cancelled');
        return fetch('/auth/passkey/login/verify', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            id: x.cred.id,
            challenge: x.challenge,
            authenticatorData: b64u(x.cred.response.authenticatorData),
            clientDataJSON: b64u(x.cred.response.clientDataJSON),
            signature: b64u(x.cred.response.signature)
          })
        });
      })
      .then(function (r) {
        if (r.ok) { window.location.href = '/'; return; }
        // Say which of the two it is: an expired challenge is fixed by clicking again, a
        // rejected signature is not, and one generic message sends people down the wrong path.
        return r.json().catch(function () { return {}; }).then(function (j) {
          fail(j.error === 'challenge_expired' ? 'That took too long — tap to try again.'
             : j.error === 'too_many_attempts' ? 'Too many attempts. Wait a minute and try again.'
             : 'That passkey was not accepted. You can sign in with your password instead.');
        });
      })
      .catch(function (e) {
        // A user who dismisses the system prompt is not an error worth shouting about.
        if (e && (e.name === 'NotAllowedError' || e.message === 'cancelled')) {
          btn.disabled = false; btn.textContent = 'Unlock with a passkey'; return;
        }
        fail('Could not reach your passkey. Use your password instead.');
      });
  });
})();
</script>`
    : ''
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in — nodeterm</title></head><body style="${PAGE_STYLE}"><div style="${CARD_STYLE}"><h1 style="${H1_STYLE}">nodeterm</h1><p style="${SUB_STYLE}">Sign in to continue</p>${errLine}${passkeyBlock}<form method="post" action="/auth/login" style="display:flex;flex-direction:column;gap:10px"><input style="${INPUT_STYLE}" type="password" name="password" placeholder="Password" autocomplete="current-password"><button style="${BUTTON_STYLE}" type="submit">Sign in</button></form></div>${script}</body></html>`
}

/**
 * The lockout screen, and the unlock ladder that lets someone play their way out of the wait.
 *
 * The ladder is an ALTERNATIVE to waiting, never a way in: clearing it ends the countdown and
 * returns the user to the ordinary password form, which they still have to pass. Every question
 * is generated and graded by the server (src/core/unlock-ladder.ts); this page only draws what it
 * is handed and posts back what the user did.
 *
 * Written without a single JS template literal on purpose — the whole script is embedded in a TS
 * template literal, so a stray dollar-brace inside it would be interpolated at build time rather
 * than reaching the browser.
 */
function lockedPage(remainingMs: number, ladderOffered: boolean): string {
  const secs = Math.ceil(remainingMs / 1000)
  const offer = ladderOffered
    ? `<button style="${BUTTON_STYLE}" type="button" id="lad-start">Play your way out</button>
       <p style="${SUB_STYLE};margin:6px 0 0">Win and the wait ends. You will still need your password.</p>`
    : `<p style="${SUB_STYLE};margin:6px 0 0">No shortcuts left for now — the clock is the way through.</p>`

  const script = ladderOffered
    ? `<script>
(function () {
  var box = document.getElementById('lad-box');
  var startBtn = document.getElementById('lad-start');
  var note = document.getElementById('lad-note');

  function say(t) { if (note) note.textContent = t; }
  function post(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {})
    }).then(function (r) { return r.json().catch(function () { return {}; }); });
  }
  function done(msg) {
    box.innerHTML = '<p style="${SUB_STYLE}">' + msg + '</p>';
    setTimeout(function () { location.href = '/login'; }, 1200);
  }
  function draw(c) {
    if (!c || !c.kind) { box.innerHTML = ''; return; }
    if (c.kind === 'dimsum') return drawDimSum(c);
    if (c.kind === 'math') return drawMath(c);
    return drawWhack(c);
  }

  function drawDimSum(c) {
    var h = '<p style="${SUB_STYLE}">Which dim sum is this?</p>';
    h += '<p style="font-size:34px;margin:6px 0 12px;text-align:center">' + c.prompt + '</p>';
    h += '<div style="display:flex;flex-direction:column;gap:8px">';
    for (var i = 0; i < c.choices.length; i++) {
      h += '<button type="button" style="${BUTTON_STYLE}" data-choice="' + i + '"></button>';
    }
    h += '</div>';
    box.innerHTML = h;
    var bs = box.querySelectorAll('[data-choice]');
    for (var j = 0; j < bs.length; j++) {
      // textContent, not string concatenation into innerHTML: a dish name is server data and
      // this page must not grow an injection point for the sake of four buttons.
      bs[j].textContent = c.choices[j];
      bs[j].addEventListener('click', function (e) {
        var k = Number(e.currentTarget.getAttribute('data-choice'));
        answer({ kind: 'dimsum', nonce: c.nonce, choice: c.choices[k] });
      });
    }
  }

  function drawMath(c) {
    var h = '<p style="${SUB_STYLE}">Ten easy sums. All ten, or it is whack-a-mole.</p>';
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:10px 0">';
    for (var i = 0; i < c.questions.length; i++) {
      h += '<label style="display:flex;align-items:center;gap:6px;font-size:15px">' +
           '<span data-q="' + i + '" style="min-width:78px"></span>' +
           '<input data-m="' + i + '" inputmode="numeric" style="${INPUT_STYLE};width:68px;padding:6px"></label>';
    }
    h += '</div><button type="button" style="${BUTTON_STYLE}" id="lad-math-go">Check</button>';
    box.innerHTML = h;
    for (var q = 0; q < c.questions.length; q++) {
      box.querySelector('[data-q="' + q + '"]').textContent = c.questions[q] + ' =';
    }
    document.getElementById('lad-math-go').addEventListener('click', function () {
      var out = [];
      for (var i = 0; i < c.questions.length; i++) {
        var el = box.querySelector('[data-m="' + i + '"]');
        out.push(Number(el && el.value));
      }
      answer({ kind: 'math', nonce: c.nonce, answers: out });
    });
  }

  function drawWhack(c) {
    var need = c.requiredHits;
    var h = '<p style="${SUB_STYLE}">Last chance: hit ' + need + ' moles.</p>';
    h += '<p id="lad-score" style="text-align:center;font-size:15px;margin:6px 0">0 / ' + need + '</p>';
    h += '<div style="display:grid;grid-template-columns:repeat(' + c.gridSize +
         ',1fr);gap:8px;margin:8px 0">';
    for (var i = 0; i < c.gridSize * c.gridSize; i++) {
      h += '<button type="button" data-cell="' + i +
           '" style="aspect-ratio:1;border-radius:12px;border:1px solid rgba(255,255,255,.14);' +
           'background:rgba(255,255,255,.05);font-size:26px;cursor:pointer"></button>';
    }
    h += '</div>';
    box.innerHTML = h;

    var started = Date.now();
    var hits = [];
    var live = {};
    var cells = box.querySelectorAll('[data-cell]');
    var score = document.getElementById('lad-score');

    for (var k = 0; k < cells.length; k++) {
      cells[k].addEventListener('click', function (e) {
        var cell = Number(e.currentTarget.getAttribute('data-cell'));
        if (!live[cell]) return;
        hits.push({ cell: cell, atMs: Date.now() - started });
        // The on-screen score is encouragement only. The server regrades every hit against the
        // schedule it issued, so an edited counter buys nothing.
        score.textContent = hits.length + ' / ' + need;
        e.currentTarget.textContent = '';
        live[cell] = false;
      });
    }

    c.moles.forEach(function (m) {
      setTimeout(function () {
        var el = box.querySelector('[data-cell="' + m.cell + '"]');
        if (!el) return;
        el.textContent = '\\uD83D\\uDC2D';
        live[m.cell] = true;
      }, m.showAtMs);
      setTimeout(function () {
        var el = box.querySelector('[data-cell="' + m.cell + '"]');
        if (el && live[m.cell]) el.textContent = '';
        live[m.cell] = false;
      }, m.hideAtMs);
    });

    // A touch past the round's own length, because the server refuses a submission that arrives
    // before the round could possibly have finished.
    setTimeout(function () {
      answer({ kind: 'whack', nonce: c.nonce, hits: hits });
    }, c.durationMs + 300);
  }

  function answer(a) {
    say('');
    post('/auth/unlock/verify', a).then(function (v) {
      if (v && v.cleared) { done(v.message || 'Unlocked.'); return; }
      say((v && v.message) || 'That did not work.');
      if (v && v.next) {
        post('/auth/unlock/challenge', { rung: v.next }).then(draw);
      } else {
        box.innerHTML = '';
      }
    });
  }

  startBtn.addEventListener('click', function () {
    startBtn.remove();
    post('/auth/unlock/challenge', {}).then(function (c) {
      if (!c || !c.kind) { say('No shortcuts left — wait it out.'); return; }
      draw(c);
    });
  });
})();
</script>`
    : ''

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Locked out — nodeterm</title></head><body style="${PAGE_STYLE}"><div style="${CARD_STYLE}"><h1 style="${H1_STYLE}">Locked out</h1><p style="${SUB_STYLE}">Too many wrong passwords. Try again in <strong id="lad-clock">${secs}</strong>s.</p>${offer}<p id="lad-note" style="${ERR_STYLE}"></p><div id="lad-box"></div></div><script>
(function () {
  var left = ${secs};
  var el = document.getElementById('lad-clock');
  var t = setInterval(function () {
    left -= 1;
    if (el) el.textContent = String(Math.max(0, left));
    if (left <= 0) { clearInterval(t); location.href = '/login'; }
  }, 1000);
})();
</script>${script}</body></html>`
}

function setupNeedsTokenPage(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Set up — nodeterm</title></head><body style="${PAGE_STYLE}"><div style="${CARD_STYLE}"><h1 style="${H1_STYLE}">Set up nodeterm</h1><p style="${SUB_STYLE}">Open the setup link printed in the server console — it carries a one-time token. This page can't be used without it.</p></div></body></html>`
}

function setupPage(token: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Set up — nodeterm</title></head><body style="${PAGE_STYLE}"><form method="post" action="/auth/setup" style="${CARD_STYLE}"><h1 style="${H1_STYLE}">Welcome to nodeterm</h1><p style="${SUB_STYLE}">Choose a password to secure this server.</p><input type="hidden" name="token" value="${esc(token)}"><input style="${INPUT_STYLE}" type="password" name="password" placeholder="New password (min 8 chars)" autofocus autocomplete="new-password" minlength="8"><button style="${BUTTON_STYLE}" type="submit">Create password</button></form></body></html>`
}

/**
 * Resolve a URL path against the renderer root with traversal protection.
 * Returns the absolute file path, or null if it escapes the root.
 */
function resolveStaticPath(rendererDir: string, urlPath: string): string | null {
  // Decode percent-encoding so %2e%2e / %2f can't smuggle a traversal past the check.
  let decoded: string
  try {
    decoded = decodeURIComponent(urlPath)
  } catch {
    return null
  }
  // Normalize backslashes to forward slashes so Windows-style separators can't escape.
  decoded = decoded.replace(/\\/g, '/')
  if (decoded === '/' || decoded === '') decoded = '/index.html'
  // Strip the leading slash, then normalize. path.normalize collapses ../ segments.
  const normalized = path.normalize(decoded).replace(/^(\.\.[/\\])+/, '')
  const root = path.resolve(rendererDir)
  const candidate = path.resolve(root, '.' + (normalized.startsWith('/') ? normalized : '/' + normalized))
  // Containment check: the resolved path must be the root or sit under root + separator.
  if (candidate !== root && !candidate.startsWith(root + path.sep)) return null
  return candidate
}

/**
 * Pick a content encoding the client accepts. Brotli first (roughly 15% smaller than gzip on
 * our bundles), gzip as the universal fallback. A `;q=0` on a token is a refusal, so it is
 * honoured — everything else about the q-value ordering is ignored deliberately: we have two
 * candidates and a fixed preference between them.
 */
export function negotiateEncoding(header: string | undefined): 'br' | 'gzip' | null {
  if (!header) return null
  const accepted = new Set<string>()
  for (const part of header.split(',')) {
    const [tokenRaw, ...params] = part.split(';')
    const token = tokenRaw.trim().toLowerCase()
    if (!token) continue
    const refused = params.some((p) => /^\s*q\s*=\s*0(\.0+)?\s*$/i.test(p))
    if (!refused) accepted.add(token)
  }
  if (accepted.has('br')) return 'br'
  if (accepted.has('gzip')) return 'gzip'
  return null
}

/** `<encoding> <path>` → the compressed body for one exact file revision (`sig`). The promise is
 *  cached, not just its result, so N concurrent first-hits compress once. */
const compressCache = new Map<string, { sig: string; body: Promise<Buffer | null> }>()
let compressCacheBytes = 0

function compress(buf: Buffer, enc: 'br' | 'gzip'): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const done = (err: Error | null, out: Buffer): void => resolve(err ? null : out)
    if (enc === 'br') {
      zlib.brotliCompress(
        buf,
        // Quality 5 is the knee of the curve for JS/CSS: within a few percent of the default 11
        // at a small fraction of its CPU — and the answer is cached, so this runs once per build.
        { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } },
        done
      )
    } else {
      zlib.gzip(buf, { level: 6 }, done)
    }
  })
}

/** The compressed body for a file revision, or null when compression failed (→ serve identity). */
function compressedBody(
  key: string,
  sig: string,
  enc: 'br' | 'gzip',
  identity: () => Promise<Buffer>
): Promise<Buffer | null> {
  const hit = compressCache.get(key)
  if (hit && hit.sig === sig) return hit.body
  const body = identity()
    .then((buf) => compress(buf, enc))
    .then((out) => {
      if (!out) {
        compressCache.delete(key)
        return null
      }
      compressCacheBytes += out.length
      if (compressCacheBytes > COMPRESS_CACHE_MAX_BYTES) {
        compressCache.clear()
        compressCacheBytes = 0
      }
      return out
    })
    .catch(() => {
      compressCache.delete(key)
      return null
    })
  compressCache.set(key, { sig, body })
  return body
}

/** Test seam: drop the compressed-payload cache. */
export function _resetStaticCacheForTest(): void {
  compressCache.clear()
  compressCacheBytes = 0
}

/**
 * Serve one built renderer file.
 *
 * Three things beyond reading the bytes, all of which matter because the browser client is the
 * whole point of the Server Edition and it is usually NOT on the same LAN:
 *  - **Compression.** The entry bundle is ~2.1 MB raw / ~0.46 MB gzipped, and the lazy Monaco
 *    chunk 6.2 MB / 1.1 MB. Compressed payloads are cached per file revision, so the CPU is paid
 *    once per build, not per request.
 *  - **Caching.** Vite content-hashes everything under /assets, so those can be `immutable`;
 *    index.html revalidates by ETag (a 304 costs one small round trip instead of the bundle).
 *    `private` rather than `public`: the app sits behind auth and a shared proxy has no business
 *    holding it.
 *  - **Async reads.** This handler shares its event loop with every terminal's WS frames, so a
 *    `readFileSync` of a multi-MB chunk stalls output for every attached session.
 */
async function serveStatic(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  rendererDir: string,
  urlPath: string
): Promise<void> {
  const filePath = resolveStaticPath(rendererDir, urlPath)
  if (!filePath) {
    sendJson(res, 400, { error: 'bad_path' })
    return
  }
  let stat: fs.Stats
  try {
    stat = await fs.promises.stat(filePath)
  } catch {
    sendJson(res, 404, { error: 'not_found' })
    return
  }
  if (stat.isDirectory()) {
    sendJson(res, 404, { error: 'not_found' })
    return
  }
  const ext = path.extname(filePath).toLowerCase()
  const isIndex = path.basename(filePath) === 'index.html'
  const sig = `${stat.size.toString(16)}-${Math.round(stat.mtimeMs).toString(16)}`
  // Weak: index.html's body is rewritten below, so the tag describes the response, not the file.
  const etag = `W/"${sig}"`
  const headers: http.OutgoingHttpHeaders = {
    'Content-Type': CONTENT_TYPES[ext] || 'application/octet-stream',
    ETag: etag,
    Vary: 'Accept-Encoding',
    'Cache-Control': urlPath.startsWith('/assets/')
      ? 'private, max-age=31536000, immutable'
      : 'private, no-cache'
  }
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers)
    res.end()
    return
  }

  const identity = async (): Promise<Buffer> => {
    const raw = await fs.promises.readFile(filePath)
    // CSP rewrite ONLY on index.html: relax connect-src so the WS client can connect.
    if (!isIndex) return raw
    const html = raw.toString('utf8')
    const marker = "default-src 'self';"
    if (!html.includes(marker)) {
      // A silent no-op here would leave the desktop CSP intact and the browser
      // would block the ws:/wss: WebSocket with no visible error — make sure an
      // operator sees this in the server logs.
      console.warn(
        "[nodeterm-server] index.html CSP did not contain the expected `default-src 'self';` marker — the ws: connect-src rewrite did not apply; the browser will block the WebSocket. Rebuild the renderer or update the rewrite."
      )
      return raw
    }
    return Buffer.from(html.replace(marker, "default-src 'self'; connect-src 'self' ws: wss:;"))
  }

  const enc =
    COMPRESSIBLE.has(ext) && stat.size >= COMPRESS_MIN_BYTES
      ? negotiateEncoding(req.headers['accept-encoding'] as string | undefined)
      : null
  if (enc) {
    const packed = await compressedBody(`${enc} ${filePath}`, sig, enc, identity)
    if (packed) {
      res.writeHead(200, { ...headers, 'Content-Encoding': enc, 'Content-Length': packed.length })
      res.end(packed)
      return
    }
    // Compression failed (OOM, corrupt read): fall through and serve the bytes as they are.
  }
  let body: Buffer
  try {
    body = await identity()
  } catch {
    sendJson(res, 404, { error: 'not_found' })
    return
  }
  res.writeHead(200, { ...headers, 'Content-Length': body.length })
  res.end(body)
}

export function createHttpHandler(
  opts: HttpHandlerOpts
): (req: http.IncomingMessage, res: http.ServerResponse) => void {
  const { auth, rendererDir, trustProxy, downloadTickets, uploadUserDataDir } = opts

  return function handler(req: http.IncomingMessage, res: http.ServerResponse): void {
    void handle(req, res).catch(() => {
      if (!res.headersSent) sendJson(res, 500, { error: 'internal' })
      else res.end()
    })
  }

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url || '/', 'http://x')
    const pathname = url.pathname
    const method = req.method || 'GET'

    const proxyAuthed =
      trustProxy !== undefined && proxyAuthAllowed(trustProxy, req.headers, req.socket.remoteAddress)

    // A proxy-authed caller has no use for the password pages — send them home.
    if (proxyAuthed && method === 'GET' && (pathname === '/login' || pathname === '/setup')) {
      redirect(res, 302, '/')
      return
    }

    // ---- Public auth routes (no session required) --------------------------

    if (pathname === '/setup' && method === 'GET') {
      if (auth.isConfigured()) {
        sendPage(res, 403, '<!doctype html><title>403</title><p style="color:#fff">Already configured.</p>')
        return
      }
      // The setup token is printed to the SERVER CONSOLE and must be presented as `?token=`.
      // Never serve the live token to a caller that hasn't already got it (otherwise anyone who
      // can reach /setup before a password is set could harvest it → POST /auth/setup → takeover).
      const provided = url.searchParams.get('token') || ''
      if (!auth.verifySetupToken(provided)) {
        sendPage(res, 403, setupNeedsTokenPage())
        return
      }
      sendPage(res, 200, setupPage(provided))
      return
    }

    if (pathname === '/login' && method === 'GET') {
      if (!auth.isConfigured()) {
        redirect(res, 302, '/setup')
        return
      }
      if (!auth.loginAllowed()) {
        // A password box that silently refuses every entry reads as a broken server. Show the
        // wait, and the way to skip it.
        sendPage(res, 200, lockedPage(auth.lockoutRemainingMs(), auth.ladder.available()))
        return
      }
      sendPage(res, 200, loginPage(url.searchParams.has('error'), auth.hasPasskey()))
      return
    }

    // ---- Unlock ladder ----------------------------------------------------
    //
    // Reachable ONLY while locked out, and it grants exactly one thing: an end to the current
    // wait. It issues no session, sets no cookie, and never touches the password or the attempt
    // budget. See src/core/unlock-ladder.ts for why each rung is shaped the way it is.

    if (pathname === '/auth/unlock/challenge' && method === 'POST') {
      if (auth.loginAllowed()) {
        // Not locked out, so there is no wait to skip. Refusing here also stops the ladder being
        // farmed for free challenges while the account is perfectly usable.
        sendJson(res, 409, { error: 'not_locked' })
        return
      }
      const body = (await readJson(req).catch(() => null)) as { rung?: unknown } | null
      const asked = body?.rung
      const rung =
        asked === 'math' || asked === 'whack' || asked === 'dimsum' ? (asked as LadderRung) : undefined
      const challenge = auth.ladder.issue(rung)
      if (!challenge) {
        sendJson(res, 429, { error: 'no_ladder', message: 'No shortcuts left — wait it out.' })
        return
      }
      sendJson(res, 200, challenge)
      return
    }

    if (pathname === '/auth/unlock/verify' && method === 'POST') {
      if (auth.loginAllowed()) {
        sendJson(res, 409, { error: 'not_locked' })
        return
      }
      const body = (await readJson(req).catch(() => null)) as LadderAnswer | null
      if (!body || typeof body.nonce !== 'string') {
        sendJson(res, 400, { error: 'bad_request' })
        return
      }
      const verdict = auth.ladder.verify(body)
      // The ONE effect a cleared ladder has. No session, no cookie, no extra attempts — the user
      // lands back on the ordinary password form.
      if (verdict.cleared) auth.clearLockoutByLadder()
      sendJson(res, 200, verdict)
      return
    }

    if (pathname === '/auth/setup' && method === 'POST') {
      // Gate on !isConfigured FIRST: setupToken() regenerates a fresh token once
      // consumed, so we must never touch consumeSetupToken when already configured.
      if (auth.isConfigured()) {
        sendJson(res, 403, { error: 'already_configured' })
        return
      }
      let form: URLSearchParams
      try {
        form = await readForm(req)
      } catch {
        sendJson(res, 400, { error: 'bad_request' })
        return
      }
      const token = form.get('token') || ''
      const password = form.get('password') || ''
      if (password.length < 8 || !auth.consumeSetupToken(token)) {
        sendJson(res, 403, { error: 'invalid_setup' })
        return
      }
      auth.setPassword(password)
      const session = auth.createSession()
      setSessionCookie(req, res, session)
      redirect(res, 303, '/')
      return
    }

    if (pathname === '/auth/login' && method === 'POST') {
      if (!auth.loginAllowed()) {
        sendJson(res, 429, { error: 'too_many_attempts' })
        return
      }
      let form: URLSearchParams
      try {
        form = await readForm(req)
      } catch {
        sendJson(res, 400, { error: 'bad_request' })
        return
      }
      const password = form.get('password') || ''
      if (auth.verifyPassword(password)) {
        auth.recordLoginSuccess()
        const session = auth.createSession()
        setSessionCookie(req, res, session)
        redirect(res, 303, '/')
        return
      }
      auth.recordLoginFailure()
      redirect(res, 303, '/login?error=1')
      return
    }

    // ---- Passkeys (WebAuthn) ----------------------------------------------
    //
    // Four routes, two pairs: options -> verify, for register and for login. The options call
    // mints a single-use challenge; the verify call consumes it. Nothing here is reachable
    // before the account exists, so a passkey can never be the thing that CREATES the account —
    // registration requires either an existing session or the one-time setup code.

    if (pathname === '/auth/passkey/register/options' && method === 'POST') {
      // Enrolling a key is an account change, so it needs proof you are already in: a live
      // session, or the first-run setup code. Without this, anyone who reached the login page
      // could bind their own authenticator and own the box.
      const body = await readJson(req).catch(() => null)
      const viaSetup = !auth.isConfigured() && auth.verifySetupToken(String((body as Record<string, unknown> | null)?.token ?? ''))
      if (!viaSetup && !auth.validateSession(sessionFrom(req))) {
        sendJson(res, 401, { error: 'unauthorized' })
        return
      }
      const rpId = rpIdFromHost(req.headers.host || '')
      sendJson(res, 200, {
        challenge: auth.newChallenge(),
        rp: { id: rpId, name: 'nodeterm' },
        // One account, so a fixed user handle. It is not a secret and identifies nobody.
        user: { id: Buffer.from('nodeterm').toString('base64url'), name: 'nodeterm', displayName: 'nodeterm' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        // Exclude what is already enrolled so the same authenticator is not registered twice.
        excludeCredentials: auth.listCredentials().map((c) => ({ type: 'public-key', id: c.id })),
        authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
        attestation: 'none',
        timeout: 120000
      })
      return
    }

    if (pathname === '/auth/passkey/register/verify' && method === 'POST') {
      const body = (await readJson(req).catch(() => null)) as Record<string, string> | null
      if (!body) { sendJson(res, 400, { error: 'bad_request' }); return }
      const viaSetup = !auth.isConfigured() && auth.verifySetupToken(String(body.token ?? ''))
      if (!viaSetup && !auth.validateSession(sessionFrom(req))) {
        sendJson(res, 401, { error: 'unauthorized' })
        return
      }
      if (!auth.consumeChallenge(String(body.challenge ?? ''))) {
        sendJson(res, 400, { error: 'challenge_expired' })
        return
      }
      try {
        const cred = verifyRegistration({
          attestationObject: String(body.attestationObject ?? ''),
          clientDataJSON: String(body.clientDataJSON ?? ''),
          expectedChallenge: String(body.challenge ?? ''),
          expectedOrigin: originOf(req),
          rpId: rpIdFromHost(req.headers.host || ''),
          label: (String(body.label ?? '').trim() || 'Passkey').slice(0, 60)
        })
        auth.addCredential(cred)
        sendJson(res, 200, { ok: true, id: cred.id, label: cred.label })
      } catch (e) {
        // The specific reason goes to the log, never to the caller: it describes exactly which
        // check failed, which is a map for anyone probing.
        console.warn('[passkey] registration rejected:', e instanceof Error ? e.message : e)
        sendJson(res, 400, { error: 'registration_failed' })
      }
      return
    }

    if (pathname === '/auth/passkey/login/options' && method === 'POST') {
      if (!auth.loginAllowed()) { sendJson(res, 429, { error: 'too_many_attempts' }); return }
      sendJson(res, 200, {
        challenge: auth.newChallenge(),
        rpId: rpIdFromHost(req.headers.host || ''),
        allowCredentials: auth.listCredentials().map((c) => ({ type: 'public-key', id: c.id })),
        userVerification: 'preferred',
        timeout: 120000
      })
      return
    }

    if (pathname === '/auth/passkey/login/verify' && method === 'POST') {
      if (!auth.loginAllowed()) { sendJson(res, 429, { error: 'too_many_attempts' }); return }
      const body = (await readJson(req).catch(() => null)) as Record<string, string> | null
      if (!body) { sendJson(res, 400, { error: 'bad_request' }); return }
      if (!auth.consumeChallenge(String(body.challenge ?? ''))) {
        sendJson(res, 400, { error: 'challenge_expired' })
        return
      }
      const cred = auth.listCredentials().find((c) => c.id === String(body.id ?? ''))
      if (!cred) {
        // Counts as a failure: otherwise an unknown id is a free, unthrottled probe.
        auth.recordLoginFailure()
        sendJson(res, 400, { error: 'unknown_credential' })
        return
      }
      try {
        const { newCounter } = verifyAssertion({
          credential: cred,
          authenticatorData: String(body.authenticatorData ?? ''),
          clientDataJSON: String(body.clientDataJSON ?? ''),
          signature: String(body.signature ?? ''),
          expectedChallenge: String(body.challenge ?? ''),
          expectedOrigin: originOf(req),
          rpId: rpIdFromHost(req.headers.host || '')
        })
        auth.updateCredentialCounter(cred.id, newCounter)
        auth.recordLoginSuccess()
        setSessionCookie(req, res, auth.createSession())
        sendJson(res, 200, { ok: true })
      } catch (e) {
        console.warn('[passkey] assertion rejected:', e instanceof Error ? e.message : e)
        auth.recordLoginFailure()
        sendJson(res, 400, { error: 'login_failed' })
      }
      return
    }

    if (pathname === '/auth/logout' && method === 'POST') {
      clearSessionCookie(req, res)
      redirect(res, 303, '/login')
      return
    }

    // ---- Everything else requires a valid session --------------------------

    const token = sessionTokenFromCookie(req.headers['cookie'])
    if (!proxyAuthed && !auth.validateSession(token)) {
      if (isHtmlNavigation(req)) redirect(res, 302, '/login')
      else sendJson(res, 401, { error: 'unauthorized' })
      return
    }

    // Authenticated: an Explorer download redeems its one-shot ticket here (see download.ts).
    if (downloadTickets && (await handleDownload(req, res, url, downloadTickets))) return

    // Authenticated: browser-held bytes stream over HTTP rather than inflating inside the shared
    // 8 MiB RPC socket. This is after the session/proxy gate on purpose — the route writes files.
    if (uploadUserDataDir && (await handleUpload(req, res, url, uploadUserDataDir))) return

    // Authenticated: serve static renderer files (index.html fallback for '/').
    await serveStatic(req, res, rendererDir, pathname)
  }
}
