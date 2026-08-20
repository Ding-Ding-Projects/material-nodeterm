#!/usr/bin/env node

/**
 * Focused CDP worker for the packaged Windows terminal-profile acceptance pass.
 *
 * This file never launches Electron. The outer orchestrator starts it only as the child of
 * Lowlevel Cheap's hidden `run_command`, after the packaged app is already on a named headless
 * desktop. Direct invocation is refused unless the orchestrator supplies a per-run guard.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { createRequire } from 'node:module'
import { parseArgs } from 'node:util'
import WebSocket from 'ws'
import { renameAtomicSync } from './lib/rename-atomic.mjs'

const require = createRequire(import.meta.url)
const {
  MIN_CAPTURE_BYTES,
  REQUIRED_EVIDENCE_IDS,
  buildProfileProbe,
  dialectForProfile,
  journaledNodeIds,
  parseProfileProbeOutput,
  requireInside,
  validateCandidateProvenance,
  validateCdpTargets,
  validateProfileCatalog,
  validateProfileResults
} = require('./windows-profile-packaged-acceptance-core.cjs')

const { values } = parseArgs({
  strict: true,
  options: {
    phase: { type: 'string' },
    attach: { type: 'string' },
    state: { type: 'string' },
    evidence: { type: 'string' },
    project: { type: 'string' },
    'task-root': { type: 'string' },
    repo: { type: 'string' },
    provenance: { type: 'string' },
    'run-id': { type: 'string' },
    'main-pid': { type: 'string' },
    hwnd: { type: 'string' },
    commit: { type: 'string' },
    'source-digest': { type: 'string' },
    candidate: { type: 'string' },
    'candidate-sha256': { type: 'string' },
    'custom-dialect': { type: 'string' }
  }
})

function die(message) {
  process.stderr.write(`[windows-profile-packaged-driver] ${message}\n`)
  process.exit(1)
}

function requiredString(name) {
  const value = values[name]
  if (typeof value !== 'string' || value.trim() === '' || /[\0\r\n]/u.test(value)) {
    die(`--${name} must be a non-empty string without NUL/newlines.`)
  }
  return value
}

function requiredInteger(name) {
  const value = Number(requiredString(name))
  if (!Number.isSafeInteger(value) || value <= 0) die(`--${name} must be a positive integer.`)
  return value
}

const phase = requiredString('phase')
if (!['bootstrap', 'reattach', 'cleanup', 'close'].includes(phase)) die(`Unsupported --phase ${phase}.`)
const port = requiredInteger('attach')
if (port < 1024 || port > 65535) die('--attach must be a non-privileged TCP port.')
const runId = requiredString('run-id')
if (!/^[A-Za-z0-9._-]{8,64}$/u.test(runId)) die('--run-id must be 8-64 safe identifier characters.')
if (process.env.NODETERM_WINDOWS_PROFILE_ACCEPTANCE_DRIVER !== runId) {
  die('Refusing direct use: the per-run Lowlevel Cheap driver guard is missing.')
}
const taskRootRaw = requiredString('task-root')
if (!path.isAbsolute(taskRootRaw)) die('--task-root must be an absolute path.')
const taskRoot = path.resolve(taskRootRaw)
function ownedPath(name) {
  const value = requiredString(name)
  if (!path.isAbsolute(value)) die(`--${name} must be an absolute path.`)
  return requireInside(taskRoot, path.resolve(value), `--${name}`)
}
const stateFile = ownedPath('state')
const evidenceDirectory = ownedPath('evidence')
const projectDirectory = ownedPath('project')
const provenanceFile = ownedPath('provenance')
const repoRaw = requiredString('repo')
if (!path.isAbsolute(repoRaw)) die('--repo must be an absolute path.')
const repoRoot = path.resolve(repoRaw)
const mainPid = requiredInteger('main-pid')
const hwnd = requiredInteger('hwnd')
const commit = requiredString('commit').toLocaleLowerCase('en-US')
const sourceDigest = requiredString('source-digest').toLocaleLowerCase('en-US')
const candidateRaw = requiredString('candidate')
if (!path.isAbsolute(candidateRaw)) die('--candidate must be an absolute path.')
const candidate = path.resolve(candidateRaw)
const candidateSha256 = requiredString('candidate-sha256').toLocaleLowerCase('en-US')
const customDialect = values['custom-dialect']

if (!/^[0-9a-f]{40}$/u.test(commit)) die('--commit must be a full 40-character Git SHA.')
if (!/^[0-9a-f]{64}$/u.test(sourceDigest)) die('--source-digest must be a SHA-256 hex digest.')
if (!/^[0-9a-f]{64}$/u.test(candidateSha256)) die('--candidate-sha256 must be a SHA-256 hex digest.')
if (customDialect && !['powershell', 'cmd', 'git-bash'].includes(customDialect)) {
  die('--custom-dialect must be powershell, cmd, or git-bash.')
}

const trustedProvenance = validateCandidateProvenance({
  repoRoot,
  expectedCommit: commit,
  provenance: provenanceFile,
  candidate
})
if (
  trustedProvenance.workingTreeDigest !== sourceDigest ||
  trustedProvenance.artifacts['packaged-executable'].sha256 !== candidateSha256
) {
  die('Driver source/build provenance does not match the orchestrator challenge.')
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
const jobPrefix = `__ntWindowsProfileAcceptance_${runId.replace(/[^A-Za-z0-9_]/gu, '_')}`
let jobSequence = 0

class Cdp {
  constructor(socket) {
    this.socket = socket
    this.sequence = 0
    this.pending = new Map()
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString())
      if (!message.id || !this.pending.has(message.id)) return
      const pending = this.pending.get(message.id)
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(message.error.message))
      else pending.resolve(message.result)
    })
  }

  static async connect(debugPort) {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`)
    if (!response.ok) throw new Error(`CDP /json/list returned HTTP ${response.status}.`)
    const target = validateCdpTargets(await response.json(), {
      expectedRendererFile: path.join(path.dirname(candidate), 'resources', 'app.asar', 'out', 'renderer', 'index.html'),
      expectedPort: debugPort
    })
    const socket = new WebSocket(target.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 })
    await new Promise((resolve, reject) => {
      socket.once('open', resolve)
      socket.once('error', reject)
    })
    return { cdp: new Cdp(socket), target }
  }

  send(method, params = {}) {
    const id = ++this.sequence
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${method} timed out.`))
      }, 30_000)
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        }
      })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  close() {
    this.socket.close()
  }
}

let cdp
let target

async function evaluate(expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true })
  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Renderer evaluation failed.'
    )
  }
  return result.result?.value
}

/**
 * Poll `expression` until it yields something truthy.
 *
 * The expression must evaluate to a VALUE, not a DOM node. `evaluate` serializes by value, and a
 * node's reference graph is unserializable — CDP answers `Object reference chain is too long`,
 * every time, forever. Because that throw is caught below as a transient, an expression ending in
 * `querySelector(...)` does not fail fast: it spins for the whole timeout and is then reported as
 * `did not become true`, which reads as the app never reaching the state rather than as a bug in
 * the question being asked. One such expression cost a full packaged run. End predicates with
 * `!!(...)`.
 */
async function waitFor(expression, description, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      const value = await evaluate(expression)
      if (value) return value
    } catch (error) {
      // A reload destroys the current execution context, and retrying against the replacement is
      // the whole reason this is caught. But an unserializable RESULT is not transient — it will
      // fail identically on every poll — so surface it immediately instead of spending the
      // timeout proving it again and then blaming the application.
      if (/reference chain is too long/i.test(String(error?.message ?? ''))) {
        throw new Error(
          `${description}: the expression returned a DOM node rather than a value ` +
            `(${error.message}). Wrap the predicate in !!(...).`
        )
      }
      lastError = error
    }
    await sleep(100)
  }
  throw new Error(`${description} did not become true within ${timeoutMs}ms${lastError ? `: ${lastError.message}` : '.'}`)
}

async function rendererPromise(expression, description, timeoutMs = 30_000) {
  const id = `${jobPrefix}_${++jobSequence}`
  const idJson = JSON.stringify(id)
  await evaluate(`(function(){
    window[${idJson}] = { done: false };
    Promise.resolve().then(function(){ return (${expression}); }).then(
      function(value){ window[${idJson}] = { done: true, ok: true, value: value }; },
      function(error){ window[${idJson}] = { done: true, ok: false, error: String(error && (error.stack || error.message) || error) }; }
    );
    return true;
  })()`)
  const result = await waitFor(
    `window[${idJson}] && window[${idJson}].done ? window[${idJson}] : null`,
    description,
    timeoutMs
  )
  await evaluate(`delete window[${idJson}]; true`)
  if (!result.ok) throw new Error(`${description} failed: ${result.error}`)
  return result.value
}

async function key(key, code, virtualKey, modifiers = 0) {
  for (const type of ['keyDown', 'keyUp']) {
    await cdp.send('Input.dispatchKeyEvent', {
      type,
      key,
      code,
      windowsVirtualKeyCode: virtualKey,
      nativeVirtualKeyCode: virtualKey,
      modifiers
    })
  }
}

async function clickPoint(x, y, button = 'left') {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount: 1 })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount: 1 })
}

async function elementPoint(expression, description) {
  const point = await waitFor(
    `(function(){var e=${expression}; if(!e) return null; var r=e.getBoundingClientRect();
      return r.width>0 && r.height>0 ? {x:r.left+r.width/2,y:r.top+r.height/2} : null;})()`,
    description
  )
  return point
}

async function clickElement(expression, description) {
  const point = await elementPoint(expression, description)
  await clickPoint(point.x, point.y)
}

async function setInput(selector, value) {
  const changed = await evaluate(`(function(){
    var input=document.querySelector(${JSON.stringify(selector)});
    if(!input) return false;
    var setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input',{bubbles:true}));
    return true;
  })()`)
  if (!changed) throw new Error(`Input ${selector} was not found.`)
}

async function openPaletteCommand(label) {
  await clickElement(
    `document.querySelector('.cluster-search[title="Command palette"]')`,
    'command-palette button'
  )
  await waitFor(`!!document.querySelector('.palette__input')`, 'command palette')
  await setInput('.palette__input', label)
  const labelJson = JSON.stringify(label)
  try {
    await clickElement(
      `Array.from(document.querySelectorAll('.palette__item')).find(function(row){
        var label=row.querySelector('.palette__label');
        return label && label.textContent.trim()===${labelJson} && row.getAttribute('aria-disabled')!=='true';
      })`,
      `enabled palette command ${label}`
    )
  } catch (error) {
    // Say what WAS on offer. A palette label is a user-facing string that gets renamed by ordinary
    // UI work, and the bare timeout ("did not become true within 15000ms") is indistinguishable
    // from the app failing to boot — it cost a whole packaged run to learn that `Settings` had
    // become `Open Settings`. Listing the rows turns the next rename into a one-run diagnosis.
    const offered = await evaluate(
      `Array.from(document.querySelectorAll('.palette__item')).map(function(row){
         var l=row.querySelector('.palette__label');
         return (l ? l.textContent.trim() : '(no label)') + (row.getAttribute('aria-disabled')==='true' ? ' [disabled]' : '');
       })`
    ).catch(() => null)
    const seen = Array.isArray(offered) && offered.length > 0 ? offered.join(', ') : '(none)'
    throw new Error(`${error.message} — palette offered: ${seen}`)
  }
}

async function closeTransientUi() {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await key('Escape', 'Escape', 27)
    await sleep(100)
  }
  await evaluate(`(function(){
    var toggle=document.querySelector('.tab__board-toggle');
    if(toggle && document.querySelector('[class*="kanban"]')) toggle.click();
    var skip=document.querySelector('.onb-skip'); if(skip) skip.click();
    return true;
  })()`)
  await waitFor(`!!document.querySelector('.react-flow__pane')`, 'canvas pane')
}

async function seedIsolatedWorkspace() {
  const project = {
    id: `windows-profile-acceptance-${runId}`,
    name: 'Windows profile acceptance',
    color: '#0a84ff',
    cwd: projectDirectory,
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: []
  }
  const saved = await rendererPromise(`(async function(){
    var settings=await window.nodeTerminal.settings.load();
    await window.nodeTerminal.settings.save(Object.assign({},settings,{
      seenOnboarding:true,
      telemetryEnabled:false,
      phoneAccessEnabled:false,
      mobilePushEnabled:false,
      notifyOnClaudeDone:false,
      soundEffects:false
    }));
    await window.nodeTerminal.workspace.save(${JSON.stringify({
      version: 2,
      activeProjectId: project.id,
      projects: [project]
    })});
    return true;
  })()`, 'save isolated acceptance workspace')
  if (saved !== true) throw new Error('Isolated workspace save did not return true.')
  await evaluate('location.reload(); true')
  await waitFor(`!!document.querySelector('.react-flow__pane')`, 'reloaded isolated canvas', 30_000)
  await closeTransientUi()
}

async function capture(id, verifyExpression, note, ptyExpectation) {
  const verified = await evaluate(`!!(${verifyExpression})`)
  if (!verified) throw new Error(`Capture ${id} verification failed: ${note}`)
  let ptyFragments = []
  if (ptyExpectation) {
    const screen = await ptyCapture(ptyExpectation.nodeId)
    ptyFragments = ptyExpectation.fragments.map(String)
    for (const fragment of ptyFragments) {
      if (!screen.includes(fragment)) {
        throw new Error(`Capture ${id} PTY precondition is missing ${JSON.stringify(fragment)}.`)
      }
    }
  }
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  const buffer = Buffer.from(shot.data, 'base64')
  if (buffer.length < MIN_CAPTURE_BYTES) throw new Error(`Capture ${id} is blank/small (${buffer.length} bytes).`)
  const file = path.join(evidenceDirectory, `${id}.png`)
  fs.mkdirSync(evidenceDirectory, { recursive: true })
  fs.writeFileSync(file, buffer)
  return {
    id,
    file,
    bytes: buffer.length,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    verifier: { note, ptyNodeId: ptyExpectation?.nodeId ?? null, ptyFragments }
  }
}

function shellSingleQuote(value) {
  return `'${String(value).replace(/'/gu, `'"'"'`)}'`
}

async function ptyCapture(nodeId) {
  return rendererPromise(
    `window.nodeTerminal.pty.capture(${JSON.stringify(nodeId)},true)`,
    `capture PTY ${nodeId}`
  )
}

async function ptyCaptureUntil(nodeId, predicate, description, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  let last = ''
  while (Date.now() < deadline) {
    try {
      last = String(await ptyCapture(nodeId))
      if (predicate(last)) return last
    } catch {
      // The node can mount before its persistent session finishes attaching.
    }
    await sleep(150)
  }
  throw new Error(`${description} did not appear in PTY ${nodeId}. Tail: ${JSON.stringify(last.slice(-1200))}`)
}

/**
 * Type into a node's session, waiting for the session to exist first.
 *
 * `.term-node__xterm` in the DOM proves the node MOUNTED, not that its persistent session has
 * finished attaching — the gap is acknowledged in this file's own capture loop ("The node can
 * mount before its persistent session finishes attaching"). `sendText` addresses the session by
 * NAME, so during that gap it finds nothing and answers false, exactly as it answers false for a
 * locked node: one bare boolean for every refusal, which is right for the product and gives a
 * caller nothing to distinguish "not yet" from "never".
 *
 * Measured: sending the instant the xterm appears returns false and fails the run; the identical
 * call against the same build a few seconds later returns true.
 *
 * So retry, but BOUNDED. A permanent refusal still fails — it just costs the deadline first — and
 * the message says both things that could have caused it rather than only the one that did not.
 */
async function sendPtyText(nodeId, text, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  let sent = false
  while (Date.now() < deadline) {
    sent = await rendererPromise(
      `window.nodeTerminal.pty.sendText(${JSON.stringify(nodeId)},${JSON.stringify(text)},{enter:false})`,
      `send text to PTY ${nodeId}`
    )
    if (sent === true) return
    await sleep(250)
  }
  throw new Error(
    `PTY ${nodeId} rejected acceptance input for ${timeoutMs}ms — its session never became ` +
      `writable (no live session by that name, or a write gate refused it).`
  )
}

async function waitForPtyDestroyed(nodeId, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  let consecutiveAbsent = 0
  while (Date.now() < deadline) {
    try {
      const result = await rendererPromise(
        `Promise.all([
          window.nodeTerminal.pty.sendText(${JSON.stringify(nodeId)},'',{enter:false}),
          window.nodeTerminal.pty.capture(${JSON.stringify(nodeId)},true)
        ]).then(function(values){return {writable:values[0],screen:String(values[1]||'')}})`,
        `verify destroyed PTY ${nodeId}`
      )
      if (result.writable === false && result.screen === '') {
        consecutiveAbsent += 1
        if (consecutiveAbsent >= 3) return
      } else {
        consecutiveAbsent = 0
      }
    } catch {
      // A transport error is not proof of absence. Keep polling for three explicit negative reads.
      consecutiveAbsent = 0
    }
    await sleep(150)
  }
  throw new Error(`Journaled PTY ${nodeId} remained writable/capturable after destroy.`)
}

async function removeJournaledNodesFromWorkspace(nodeIds) {
  const result = await rendererPromise(
    `(async function(){
      var ids=new Set(${JSON.stringify(nodeIds)});
      var workspace=await window.nodeTerminal.workspace.load();
      var next=Object.assign({},workspace,{projects:workspace.projects.map(function(project){
        return Object.assign({},project,{nodes:project.nodes.filter(function(node){return !ids.has(node.id)})});
      })});
      await window.nodeTerminal.workspace.save(next);
      var checked=await window.nodeTerminal.workspace.load();
      var remaining=[];
      checked.projects.forEach(function(project){project.nodes.forEach(function(node){if(ids.has(node.id))remaining.push(node.id)})});
      return {remaining:remaining};
    })()`,
    'remove journaled acceptance nodes from isolated workspace'
  )
  if (!Array.isArray(result.remaining) || result.remaining.length !== 0) {
    throw new Error(`Journaled acceptance nodes remain persisted: ${JSON.stringify(result.remaining)}.`)
  }
}

async function destroyJournaledSessions(nodeIds) {
  for (const nodeId of nodeIds) {
    await evaluate(
      `window.nodeTerminal.pty.destroy(${JSON.stringify(nodeId)},{everySocket:true}); true`
    )
    // `destroy` is intentionally a one-way renderer cast. Its consequence, not the cast return,
    // is the trustworthy boundary: require both send and capture to report absence repeatedly.
    await waitForPtyDestroyed(nodeId)
  }
  await removeJournaledNodesFromWorkspace(nodeIds)
  return nodeIds.length
}

async function createProfileNode(profile, catalog, onNodeDiscovered) {
  const before = await evaluate(`Array.from(document.querySelectorAll('.react-flow__node[data-id]'))
    .filter(function(n){return n.querySelector('.term-node')}).map(function(n){return n.dataset.id})`)
  const commandLabel = `New terminal — ${profile.label}`
  await openPaletteCommand(commandLabel)
  const beforeJson = JSON.stringify(before)
  const nodeId = await waitFor(`(function(){
    var before=new Set(${beforeJson});
    var ids=Array.from(document.querySelectorAll('.react-flow__node[data-id]'))
      .filter(function(n){return n.querySelector('.term-node')}).map(function(n){return n.dataset.id});
    return ids.find(function(id){return !before.has(id)}) || null;
  })()`, `new terminal node for ${profile.id}`, 20_000)
  await onNodeDiscovered(nodeId)
  const nodeSelector = `.react-flow__node[data-id=${JSON.stringify(nodeId)}]`
  await waitFor(`(function(){var n=document.querySelector(${JSON.stringify(nodeSelector)});
    var c=n&&n.querySelector('.term-profile-chip'); return c&&c.textContent.trim()===${JSON.stringify(profile.label)};})()`,
    `profile label ${profile.label}`)
  await waitFor(`(function(){var n=document.querySelector(${JSON.stringify(nodeSelector)});
    return !!(n && !n.querySelector('.term-node__closed') && n.querySelector('.term-node__xterm'));})()`,
    `running terminal for ${profile.id}`, 30_000)

  const probe = buildProfileProbe(profile, catalog, { token: runId, customDialect })
  await sendPtyText(nodeId, probe.command)
  let parsed
  const screen = await ptyCaptureUntil(
    nodeId,
    (value) => {
      try {
        parsed = parseProfileProbeOutput(probe, value, projectDirectory)
        return parsed.markerVerified && parsed.unicodeVerified && parsed.cwdVerified && parsed.sizeVerified
      } catch {
        return false
      }
    },
    `profile probe for ${profile.id}`
  )
  parsed = parseProfileProbeOutput(probe, screen, projectDirectory)
  return {
    id: profile.id,
    label: profile.label,
    kind: profile.kind,
    dialect: probe.dialect,
    nodeId,
    labelVerified: true,
    inputOutputVerified: parsed.markerVerified,
    unicodeVerified: parsed.unicodeVerified,
    cwdVerified: parsed.cwdVerified,
    sizeVerified: parsed.sizeVerified,
    size: parsed.size,
    captureFragments: [probe.marker, probe.unicode]
  }
}

async function resizeRepresentative(result, profile, catalog) {
  const selector = `.react-flow__node[data-id=${JSON.stringify(result.nodeId)}]`
  await clickElement(`document.querySelector(${JSON.stringify(selector)})`, 'representative terminal node')
  const handleSelector = `${selector} .react-flow__resize-control.handle.bottom.right`
  const before = await waitFor(`(function(){var n=document.querySelector(${JSON.stringify(selector)});
    if(!n)return null;var r=n.getBoundingClientRect();return {width:r.width,height:r.height};})()`, 'node dimensions')
  const point = await elementPoint(`document.querySelector(${JSON.stringify(handleSelector)})`, 'terminal resize handle')
  // `buttons: 1` is the load-bearing field, and its absence is why this drag did nothing.
  //
  // CDP's `button` names the button that CHANGED; `buttons` is the bitmask of what is currently
  // HELD. A mouseMoved without it arrives at the page with `event.buttons === 0` — a hover. The
  // resize control is React Flow's NodeResizer, which is d3-drag underneath, and d3-drag ignores a
  // move with no button held. So the press and release landed, nothing dragged, and the run failed
  // on "resized terminal dimensions did not become true" as though the app had refused to resize.
  //
  // Intermediate steps rather than one jump: a drag implementation is entitled to expect a motion
  // sequence, and a single teleport is the shape least likely to be honoured. Hover first, exactly
  // as `clickPoint` does, so the handle is the element under the pointer when the press arrives.
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, button: 'none', buttons: 0 })
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1
  })
  for (const step of [0.25, 0.5, 0.75, 1]) {
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: point.x + 120 * step,
      y: point.y + 80 * step,
      button: 'left',
      buttons: 1
    })
    await sleep(30)
  }
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: point.x + 120, y: point.y + 80, button: 'left', buttons: 0, clickCount: 1
  })
  await waitFor(`(function(){var n=document.querySelector(${JSON.stringify(selector)});if(!n)return false;
    var r=n.getBoundingClientRect();return r.width>${before.width + 60} && r.height>${before.height + 30};})()`,
    'resized terminal dimensions')
  const resizedProbe = buildProfileProbe(profile, catalog, { token: `${runId}-resized`, customDialect })
  await sendPtyText(result.nodeId, resizedProbe.command)
  let resized
  const screen = await ptyCaptureUntil(
    result.nodeId,
    (value) => {
      try {
        resized = parseProfileProbeOutput(resizedProbe, value, projectDirectory)
        return resized.markerVerified && resized.cwdVerified && resized.sizeVerified
      } catch {
        return false
      }
    },
    'resized PTY report'
  )
  resized = parseProfileProbeOutput(resizedProbe, screen, projectDirectory)
  const next = resized.size
  if (!next) throw new Error('Resized PTY did not report its new size.')
  if (result.size && next.cols === result.size.cols && next.rows === result.size.rows) {
    throw new Error('Node resize did not change the child PTY size.')
  }
  result.resizeVerified = true
  result.resizedSize = next
}

function continuityCommand(dialect, token) {
  const prefix = `NT_CONTINUITY:${token}`
  if (dialect === 'powershell') {
    return {
      prefix,
      command:
        `$nti=0; while($true){$nti++; Write-Output ('${prefix}:PID=' + $PID + ':TICK=' + $nti); Start-Sleep -Milliseconds 700}\r`
    }
  }
  if (dialect === 'cmd') {
    return {
      prefix,
      command:
        `@powershell.exe -NoLogo -NoProfile -Command "$i=0; while($true){$i++; ` +
        `Write-Output ('${prefix}:PID=' + $PID + ':TICK=' + $i); Start-Sleep -Milliseconds 700}"\r`
    }
  }
  const script = `i=0; while :; do i=$((i+1)); printf '${prefix}:PID=%s:TICK=%s\\n' "$$" "$i"; sleep 1; done`
  return { prefix, command: `sh -lc ${shellSingleQuote(script)}\r` }
}

function latestContinuity(screen, prefix) {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const matches = [...String(screen).matchAll(new RegExp(`${escaped}:PID=(\\d+):TICK=(\\d+)`, 'g'))]
  if (!matches.length) return null
  const match = matches[matches.length - 1]
  return { terminalProcessPid: Number(match[1]), tick: Number(match[2]) }
}

function readSessionHostState(userDataDir) {
  const file = path.join(userDataDir, 'session-host.json')
  const state = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (!Number.isInteger(Number(state.pid)) || Number(state.pid) <= 0) throw new Error('session-host.json has no valid PID.')
  return { pid: Number(state.pid), startedAt: state.startedAt, protocolVersion: state.protocolVersion }
}

function writeState(state) {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true })
  const temporary = `${stateFile}.${crypto.randomUUID()}.tmp`
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { flag: 'wx' })
    renameAtomicSync(temporary, stateFile)
  } catch (error) {
    try {
      fs.rmSync(temporary, { force: true })
    } catch {
      // Retain the primary write failure.
    }
    throw error
  }
}

async function startContinuity(profileResult) {
  const continuity = continuityCommand(profileResult.dialect, runId)
  await sendPtyText(profileResult.nodeId, continuity.command)
  const screen = await ptyCaptureUntil(
    profileResult.nodeId,
    (value) => latestContinuity(value, continuity.prefix)?.tick >= 2,
    'long-lived continuity process'
  )
  return { ...latestContinuity(screen, continuity.prefix), marker: continuity.prefix }
}

async function openProfileSettingsAndCapture(captures, catalog) {
  // 'Open Settings', not 'Settings'. The palette command is built in Canvas.tsx's `buildCommands`
  // and the nav-rail DESTINATION beside it is the one labelled plain 'Settings' — two different
  // surfaces, one of which the palette does not search. Verified against the shipped list.
  await openPaletteCommand('Open Settings')
  await waitFor(`!!document.querySelector('[class*="settings"]')`, 'Settings')
  await clickElement(
    `Array.from(document.querySelectorAll('button')).find(function(button){return button.textContent.trim()==='Shell'})`,
    'Settings Shell section'
  )
  await waitFor(`!!document.querySelector('#terminal-profile-select')`, 'terminal profile selector')
  captures.push(
    await capture(
      'windows-terminal-profile-picker',
      `(function(){var s=document.querySelector('#terminal-profile-select');var status=document.querySelector('#terminal-profile-status');
        var availability=document.querySelector('#terminal-profile-availability');
        return s && s.getBoundingClientRect().width>0 && s.options.length>=${catalog.length} && status && availability;
      })()`,
      'Settings Shell profile selector and live availability status were visible.'
    )
  )
  const unavailable = catalog.find((profile) => !profile.available)
  if (!unavailable) throw new Error('Isolated profile catalog did not expose a visible unavailable state.')
  await evaluate(`(function(){var row=Array.from(document.querySelectorAll('#terminal-profile-availability li')).find(function(item){
    return item.innerText.includes(${JSON.stringify(unavailable.label)}) && item.innerText.includes(${JSON.stringify(unavailable.unavailableReason)});
  }); if(row)row.scrollIntoView({block:'center'}); return !!row;})()`)
  captures.push(
    await capture(
      'windows-terminal-profile-unavailable',
      `(function(){var row=Array.from(document.querySelectorAll('#terminal-profile-availability li')).find(function(item){
          return item.innerText.includes(${JSON.stringify(unavailable.label)}) && item.innerText.includes(${JSON.stringify(unavailable.unavailableReason)});
        });if(!row)return false;var rect=row.getBoundingClientRect();return rect.top>=0 && rect.bottom<=innerHeight;
      })()`,
      `Settings visibly showed ${unavailable.label} unavailable with its exact reason.`
    )
  )
  await closeTransientUi()
}

async function rightClickNode(nodeId) {
  const point = await elementPoint(
    `document.querySelector(${JSON.stringify(`.react-flow__node[data-id="${nodeId}"] .term-node__header`)})`,
    'terminal node header'
  )
  await clickPoint(point.x, point.y, 'right')
  await waitFor(`!!document.querySelector('.ctx-menu')`, 'terminal context menu')
}

async function chooseRestartProfile(nodeId, label) {
  await rightClickNode(nodeId)
  const restartRow = `Array.from(document.querySelectorAll('.ctx-item')).find(function(row){
    var label=row.querySelector('.ctx-item__label'); return label && label.textContent.trim()==='Restart with profile…';
  })`
  const point = await elementPoint(restartRow, 'Restart with profile submenu')
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, button: 'none' })
  await waitFor(`!!document.querySelector('.ctx-submenu')`, 'Restart with profile submenu choices')
  await clickElement(
    `Array.from(document.querySelectorAll('.ctx-submenu .ctx-item')).find(function(row){
      var item=row.querySelector('.ctx-item__label');
      return item && item.textContent.trim()===${JSON.stringify(label)} && !row.disabled && row.getAttribute('aria-disabled')!=='true';
    })`,
    `restart profile ${label}`
  )
  await waitFor(`!!document.querySelector('.destgate[role="alertdialog"]')`, 'restart destructive gate')
}

async function restartWithProfile(state, captures) {
  const current = state.profiles.find((profile) => profile.nodeId === state.continuity.nodeId)
  const alternative = state.catalog.find(
    (profile) => profile.available && profile.id !== current.id && profile.id !== 'custom'
  )
  if (!alternative) throw new Error('No second available profile exists for destructive restart acceptance.')
  await chooseRestartProfile(current.nodeId, alternative.label)
  captures.push(
    await capture(
      'windows-terminal-profile-restart-warning',
      `document.querySelector('.destgate__desc') && /live process/i.test(document.querySelector('.destgate__desc').textContent) && /persistent session/i.test(document.querySelector('.destgate__desc').textContent)`,
      'Restart gate named both the live process and persistent session destruction.'
    )
  )
  await clickElement(`document.querySelector('.destgate__exit')`, 'restart cancellation')
  await waitFor(`!document.querySelector('.destgate')`, 'cancelled restart gate')
  const unchanged = await evaluate(`(function(){var n=document.querySelector(${JSON.stringify(`.react-flow__node[data-id="${current.nodeId}"]`)});
    var c=n&&n.querySelector('.term-profile-chip'); return c&&c.textContent.trim()===${JSON.stringify(current.label)};})()`)
  if (!unchanged) throw new Error('Cancelling profile restart changed the node profile.')

  await chooseRestartProfile(current.nodeId, alternative.label)
  const keys = await evaluate(`document.querySelectorAll('.destgate__key').length`)
  if (keys !== 2) throw new Error(`Restart gate exposed ${keys} authorization keys instead of two.`)
  await clickElement(`document.querySelectorAll('.destgate__key')[0]`, 'first restart authorization key')
  await clickElement(`document.querySelectorAll('.destgate__key')[1]`, 'second restart authorization key')
  await clickElement(`document.querySelector('.destgate__slider')`, 'restart authorization slider')
  await key('End', 'End', 35)
  await waitFor(`!document.querySelector('.destgate')`, 'confirmed restart gate', 30_000)
  await waitFor(`(function(){var n=document.querySelector(${JSON.stringify(`.react-flow__node[data-id="${current.nodeId}"]`)});
    var c=n&&n.querySelector('.term-profile-chip'); return c&&c.textContent.trim()===${JSON.stringify(alternative.label)};})()`,
    'replacement profile label', 30_000)

  const replacementProbe = buildProfileProbe(alternative, state.catalog, {
    token: `${runId}-replacement`,
    customDialect
  })
  await sendPtyText(current.nodeId, replacementProbe.command)
  await ptyCaptureUntil(
    current.nodeId,
    (screen) => screen.includes(replacementProbe.marker),
    'replacement profile output'
  )
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    try {
      process.kill(state.continuity.terminalProcessPid, 0)
    } catch {
      return { from: current.id, to: alternative.id, oldProcessExited: true }
    }
    await sleep(100)
  }
  throw new Error(`Old terminal process ${state.continuity.terminalProcessPid} still exists after confirmed restart.`)
}

async function closeWindow() {
  try {
    await evaluate(`window.nodeTerminal.closeWindow(); true`)
  } catch (error) {
    if (cdp.socket?.readyState === WebSocket.OPEN) throw error
  }
}

async function bootstrap() {
  await seedIsolatedWorkspace()
  const userDataDir = requireInside(
    taskRoot,
    path.resolve(await rendererPromise('window.nodeTerminal.userDataDir()', 'resolve packaged userDataDir')),
    'Packaged userDataDir'
  )
  const catalog = validateProfileCatalog(await rendererPromise(
    'window.nodeTerminal.terminalProfiles.refresh()',
    'refresh Windows terminal profiles',
    60_000
  ))
  const state = {
    schemaVersion: 1,
    runId,
    commit,
    sourceDigest,
    candidateSha256,
    target,
    initial: { mainPid, hwnd },
    userDataDir,
    projectDirectory,
    catalog,
    // Node ids journaled the INSTANT the renderer reports them, before any probe can fail.
    // `state.profiles` only ever gains a node that completed every probe, so a node created for a
    // profile whose probe then throws would never appear there — and its session would outlive the
    // run, which is the one thing a Windows session host is designed to do. `cleanup()` reads both
    // lists through `journaledNodeIds`, so a half-created node is still destroyed.
    pendingNodeIds: [],
    profiles: [],
    captures: []
  }
  writeState(state)
  await openProfileSettingsAndCapture(state.captures, catalog)
  writeState(state)
  for (const profile of catalog.filter((candidate) => candidate.available)) {
    // The third argument is not optional, and omitting it was a real defect rather than a style
    // choice: `createProfileNode` awaits `onNodeDiscovered(nodeId)` the moment the renderer hands
    // back the new node id, so calling it with two arguments threw
    // `TypeError: onNodeDiscovered is not a function` on the FIRST profile — two captures into a
    // five-capture run, every time, since the refactor that introduced the parameter. The journal
    // write is the whole point of the callback: it happens before any probe can fail.
    const result = await createProfileNode(profile, catalog, async (nodeId) => {
      state.pendingNodeIds.push(nodeId)
      writeState(state)
    })
    state.profiles.push(result)
    writeState(state)
    if (state.profiles.length === 1) {
      state.captures.push(
        await capture(
          'windows-terminal-profile-terminal',
          `(function(){var node=document.querySelector(${JSON.stringify(`.react-flow__node[data-id="${result.nodeId}"]`)});
            var chip=node&&node.querySelector('.term-profile-chip');var canvas=node&&node.querySelector('.xterm canvas');
            return chip && chip.textContent.trim()===${JSON.stringify(profile.label)} && canvas && canvas.getBoundingClientRect().width>0;
          })()`,
          `A packaged ${profile.label} terminal showed its exact profile label and rendered xterm.`,
          { nodeId: result.nodeId, fragments: result.captureFragments }
        )
      )
    }
    await resizeRepresentative(result, profile, catalog)
    writeState(state)
  }
  validateProfileResults(catalog, state.profiles)
  if (!state.profiles.some((profile) => profile.resizeVerified)) {
    throw new Error('No packaged terminal completed a real NodeResizer → PTY resize.')
  }
  const continuityProfile =
    state.profiles.find((profile) => profile.id === 'pwsh') ??
    state.profiles.find((profile) => profile.id === 'windows-powershell') ??
    state.profiles.find((profile) => profile.dialect === 'powershell') ??
    state.profiles[0]
  const continuity = await startContinuity(continuityProfile)
  const host = readSessionHostState(userDataDir)
  state.initial.sessionHostPid = host.pid
  state.continuity = {
    ...continuity,
    nodeId: continuityProfile.nodeId,
    profileId: continuityProfile.id,
    profileLabel: continuityProfile.label,
    dialect: continuityProfile.dialect,
    sessionHostPid: host.pid,
    sessionHostStartedAt: host.startedAt,
    sessionHostProtocolVersion: host.protocolVersion,
    mainPid,
    hwnd
  }
  writeState(state)
  await sleep(2500)
  await closeWindow()
  return { phase, profiles: state.profiles.length, sessionHostPid: host.pid }
}

async function reattach() {
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
  if (
    state.runId !== runId ||
    state.commit !== commit ||
    state.sourceDigest !== sourceDigest ||
    state.candidateSha256 !== candidateSha256
  ) {
    throw new Error('Reattach state provenance does not match this invocation.')
  }
  state.userDataDir = requireInside(taskRoot, path.resolve(state.userDataDir), 'Journaled userDataDir')
  await closeTransientUi()
  const nodeId = state.continuity.nodeId
  await waitFor(`!!document.querySelector(${JSON.stringify(`.react-flow__node[data-id="${nodeId}"]`)})`, 'reattached terminal node', 30_000)
  const screen = await ptyCaptureUntil(
    nodeId,
    (value) => latestContinuity(value, state.continuity.marker)?.tick > state.continuity.tick,
    'advancing reattached continuity output',
    30_000
  )
  const current = latestContinuity(screen, state.continuity.marker)
  const host = readSessionHostState(state.userDataDir)
  if (host.pid !== state.continuity.sessionHostPid) throw new Error('Session-host PID changed after packaged relaunch.')
  if (
    host.startedAt !== state.continuity.sessionHostStartedAt ||
    host.protocolVersion !== state.continuity.sessionHostProtocolVersion
  ) {
    throw new Error('Session-host identity changed after packaged relaunch.')
  }
  if (current.terminalProcessPid !== state.continuity.terminalProcessPid) {
    throw new Error('Long-lived terminal process PID changed after packaged relaunch.')
  }
  const captures = state.captures
  captures.push(
    await capture(
      'windows-terminal-profile-reattached',
      `(function(){var node=document.querySelector(${JSON.stringify(`.react-flow__node[data-id="${nodeId}"]`)});
        var chip=node&&node.querySelector('.term-profile-chip');var canvas=node&&node.querySelector('.xterm canvas');
        return chip && chip.textContent.trim()===${JSON.stringify(state.continuity.profileLabel)} &&
          canvas && canvas.getBoundingClientRect().width>0;
      })()`,
      'The relaunched packaged app reconstructed the same persistent terminal screen and exact label.',
      { nodeId, fragments: [state.continuity.marker, `TICK=${current.tick}`] }
    )
  )
  const restart = await restartWithProfile(state, captures)
  for (const profile of state.profiles) {
    await rendererPromise(
      `(function(){window.nodeTerminal.pty.destroy(${JSON.stringify(profile.nodeId)},{everySocket:true}); return true;})()`,
      `destroy acceptance session ${profile.nodeId}`
    )
  }
  const required = new Set(REQUIRED_EVIDENCE_IDS)
  for (const id of required) if (!captures.some((capture) => capture.id === id)) throw new Error(`Missing capture ${id}.`)
  state.reattached = {
    mainPid,
    hwnd,
    sessionHostPid: host.pid,
    sessionHostStartedAt: host.startedAt,
    sessionHostProtocolVersion: host.protocolVersion,
    terminalProcessPid: current.terminalProcessPid,
    tick: current.tick,
    marker: state.continuity.marker,
    screen: screen.slice(-4000)
  }
  state.restart = restart
  state.captures = captures
  writeState(state)
  await sleep(500)
  await closeWindow()
  return { phase, stateFile, restart }
}

async function cleanup() {
  let destroyed = 0
  if (fs.existsSync(stateFile)) {
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
    if (
      state.runId !== runId ||
      state.commit !== commit ||
      state.sourceDigest !== sourceDigest ||
      state.candidateSha256 !== candidateSha256
    ) {
      throw new Error('Cleanup state provenance does not match this invocation.')
    }
    // `journaledNodeIds` unions pendingNodeIds with the completed profiles and validates every
    // entry, so a node created for a profile whose probe later threw is destroyed too. Deriving
    // the list from `state.profiles` alone — as this did — leaks exactly the sessions a failed run
    // creates, and a Windows session host outlives the app on purpose, so the leak is permanent.
    const ids = journaledNodeIds(state)
    // `destroyJournaledSessions` is the intended implementation and was defined but never called.
    // It does not trust the one-way `destroy` cast: it waits for send AND capture to report the
    // session absent, then removes the nodes from the workspace.
    destroyed = await destroyJournaledSessions(ids)
    await sleep(500)
  }
  await closeWindow()
  return { phase, destroyed, closed: true }
}

async function main() {
  ;({ cdp, target } = await Cdp.connect(port))
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1600,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false
  })
  if (phase === 'close') {
    await closeWindow()
    return { phase, closed: true }
  }
  if (phase === 'cleanup') return cleanup()
  return phase === 'bootstrap' ? bootstrap() : reattach()
}

try {
  const result = await main()
  process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`)
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
  process.exitCode = 1
} finally {
  cdp?.close()
}
