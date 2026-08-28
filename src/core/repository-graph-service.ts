import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { access, mkdir, readFile, readdir, stat } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { basename, extname, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import ts from 'typescript'
import { platform, type CorePlatform } from './platform'
import { writeFileAtomic } from './fs-atomic'
import {
  REPOSITORY_GRAPH_ADAPTERS,
  REPOSITORY_GRAPH_LIMITS,
  type RepositoryGraphAdapterInfo,
  type RepositoryGraphApi,
  type RepositoryGraphEdge,
  type RepositoryGraphExportInput,
  type RepositoryGraphExportResult,
  type RepositoryGraphFingerprint,
  type RepositoryGraphMode,
  type RepositoryGraphNode,
  type RepositoryGraphProgress,
  type RepositoryGraphRefreshInput,
  type RepositoryGraphSnapshot,
  type RepositoryGraphSourceLocation
} from '../shared/repository-graph'

const execFileAsync = promisify(execFile)
const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'out', 'build', 'coverage', '.cache'])
const MAX_TEXT = REPOSITORY_GRAPH_LIMITS.maxFileBytes

export interface RepositoryGraphTarget {
  cwd?: string
  ssh?: unknown
  name: string
}

export interface RepositoryGraphServiceOptions {
  userDataDir: string
  projectTargetInfo: (projectId: string) => RepositoryGraphTarget | null
}

type Operation = { cancelled: boolean; operationId: string }

function safeProjectId(id: string): string {
  return id.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 160) || 'unknown'
}

function adapter(id: string): RepositoryGraphAdapterInfo {
  return REPOSITORY_GRAPH_ADAPTERS.find((item) => item.id === id) ?? { id, version: '1', kind: 'manifest', patterns: [], available: false, reason: 'Adapter is not bundled.' }
}

function sourceLoc(file: ts.SourceFile, node: ts.Node): RepositoryGraphSourceLocation {
  const pos = file.getLineAndCharacterOfPosition(node.getStart(file))
  return { path: file.fileName, line: pos.line + 1, column: pos.character + 1 }
}

function boundedHash(entries: Array<{ path: string; bytes: Buffer }>): string {
  const hash = createHash('sha256')
  for (const entry of entries) hash.update(entry.path).update('\0').update(entry.bytes)
  return hash.digest('hex')
}

async function listFiles(root: string, operation: Operation, onProgress: (done: number, total: number, phase: RepositoryGraphProgress['phase'], message: string) => void): Promise<Array<{ abs: string; rel: string; bytes: Buffer }>> {
  const found: Array<{ abs: string; rel: string; bytes: Buffer }> = []
  const dirs: string[] = [root]
  let bytes = 0
  while (dirs.length > 0 && found.length < REPOSITORY_GRAPH_LIMITS.maxFiles && bytes < REPOSITORY_GRAPH_LIMITS.maxBytes) {
    if (operation.cancelled) break
    const dir = dirs.pop()!
    let entries: import('node:fs').Dirent[]
    try { entries = await readdir(dir, { withFileTypes: true }) } catch { continue }
    for (const entry of entries) {
      if (operation.cancelled || found.length >= REPOSITORY_GRAPH_LIMITS.maxFiles || bytes >= REPOSITORY_GRAPH_LIMITS.maxBytes) break
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) dirs.push(abs)
        continue
      }
      if (!entry.isFile() || !CODE_EXTENSIONS.has(extname(entry.name).toLowerCase()) && !isManifestName(entry.name)) continue
      try {
        const info = await stat(abs)
        if (info.size > MAX_TEXT || bytes + info.size > REPOSITORY_GRAPH_LIMITS.maxBytes) continue
        const content = await readFile(abs)
        bytes += content.byteLength
        found.push({ abs, rel: relative(root, abs).replaceAll(sep, '/'), bytes: content })
        onProgress(found.length, Math.max(found.length, dirs.length + found.length), 'discovering', `Discovered ${found.length} files`)
      } catch { /* unreadable files remain omitted, never fabricated */ }
    }
  }
  return found
}

function isManifestName(name: string): boolean {
  return REPOSITORY_GRAPH_ADAPTERS.some((item) => item.patterns.some((pattern) => pattern === name || pattern.startsWith(`${name}.`) || pattern.includes('*') && new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*')}$`, 'u').test(name)))
}

function nodeId(kind: string, label: string): string { return `${kind}:${label}` }
function pushNode(nodes: Map<string, RepositoryGraphNode>, node: RepositoryGraphNode): void {
  if (!nodes.has(node.id) && nodes.size < REPOSITORY_GRAPH_LIMITS.maxNodes) nodes.set(node.id, node)
}
function pushEdge(edges: Map<string, RepositoryGraphEdge>, edge: RepositoryGraphEdge): void {
  if (!edges.has(edge.id) && edges.size < REPOSITORY_GRAPH_LIMITS.maxEdges) edges.set(edge.id, edge)
}

function addManifestDependencies(content: string, path: string, revision: string, nodes: Map<string, RepositoryGraphNode>, edges: Map<string, RepositoryGraphEdge>, omissions: string[]): void {
  const manager = basename(path).toLowerCase()
  let names: string[] = []
  if (manager === 'package.json') {
    try {
      const value = JSON.parse(content) as Record<string, unknown>
      for (const key of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies', 'require']) {
        const group = value[key]
        if (group && typeof group === 'object') names.push(...Object.keys(group as Record<string, unknown>))
      }
    } catch { omissions.push(`${path}: malformed JSON manifest`) }
  } else if (manager === 'package-lock.json') {
    try {
      const value = JSON.parse(content) as Record<string, unknown>
      const packages = value.packages
      if (packages && typeof packages === 'object') {
        for (const [key, record] of Object.entries(packages as Record<string, unknown>)) {
          if (!key || key === '' || !record || typeof record !== 'object') continue
          names.push(key.startsWith('node_modules/') ? key.slice('node_modules/'.length) : key)
        }
      }
    } catch { omissions.push(`${path}: malformed package-lock JSON`) }
  } else {
    omissions.push(`${path}: no bundled semantic adapter for this manifest format`)
    return
  }
  const file = nodeId('file', path)
  for (const name of [...new Set(names)].slice(0, 5000)) {
    const packageId = nodeId('package', name)
    pushNode(nodes, { id: packageId, kind: 'package', label: name, packageManager: manager })
    pushEdge(edges, { id: `${file}->${packageId}:depends-on`, from: file, to: packageId, kind: 'depends-on', confidence: 'medium', source: { path }, adapterId: manager.includes('lock') ? `${manager}-lockfile` : `${manager}-manifest`, adapterVersion: '1', sourceRevision: revision })
  }
}

function parseCode(file: ts.SourceFile, checker: ts.TypeChecker, revision: string, nodes: Map<string, RepositoryGraphNode>, edges: Map<string, RepositoryGraphEdge>, omissions: string[], root: string): void {
  const rel = relative(root, file.fileName).replaceAll(sep, '/')
  const fileId = nodeId('file', rel)
  pushNode(nodes, { id: fileId, kind: 'file', label: rel, source: { path: rel } })
  const declarationBySymbol = new Map<ts.Symbol, string>()
  const declarationId = (decl: ts.Declaration, symbol: ts.Symbol, label: string): string => {
    const existing = declarationBySymbol.get(symbol)
    if (existing) return existing
    const id = nodeId('symbol', `${rel}#${label}`)
    declarationBySymbol.set(symbol, id)
    pushNode(nodes, { id, kind: 'symbol', label, detail: ts.SyntaxKind[decl.kind], source: { ...sourceLoc(file, decl), path: rel } })
    pushEdge(edges, { id: `${fileId}->${id}:declares`, from: fileId, to: id, kind: 'references', confidence: 'high', source: { path: rel }, adapterId: file.fileName.endsWith('.ts') || file.fileName.endsWith('.tsx') ? 'typescript-semantic' : 'javascript-semantic', adapterVersion: '1', sourceRevision: revision })
    return id
  }
  const visit = (node: ts.Node): void => {
    if (nodes.size >= REPOSITORY_GRAPH_LIMITS.maxNodes || edges.size >= REPOSITORY_GRAPH_LIMITS.maxEdges) return
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const specifier = node.moduleSpecifier.text
      const resolved = ts.resolveModuleName(specifier, file.fileName, { moduleResolution: ts.ModuleResolutionKind.NodeNext, target: ts.ScriptTarget.ESNext }, ts.sys).resolvedModule?.resolvedFileName
      const target = resolved ? nodeId('file', relative(root, resolved).replaceAll(sep, '/')) : nodeId('module', specifier)
      if (!resolved) pushNode(nodes, { id: target, kind: 'module', label: specifier, unresolved: true })
      pushEdge(edges, { id: `${fileId}->${target}:imports`, from: fileId, to: target, kind: resolved ? 'imports' : 'unresolved', confidence: resolved ? 'high' : 'low', source: { ...sourceLoc(file, node), path: rel }, adapterId: file.fileName.endsWith('.ts') || file.fileName.endsWith('.tsx') ? 'typescript-semantic' : 'javascript-semantic', adapterVersion: '1', sourceRevision: revision, unresolved: !resolved, note: resolved ? undefined : 'Dynamic or unresolved module resolution.' })
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const specifier = node.moduleSpecifier.text
      const resolved = ts.resolveModuleName(specifier, file.fileName, { moduleResolution: ts.ModuleResolutionKind.NodeNext, target: ts.ScriptTarget.ESNext }, ts.sys).resolvedModule?.resolvedFileName
      const target = resolved ? nodeId('file', relative(root, resolved).replaceAll(sep, '/')) : nodeId('module', specifier)
      if (!resolved) pushNode(nodes, { id: target, kind: 'module', label: specifier, unresolved: true })
      pushEdge(edges, { id: `${fileId}->${target}:exports`, from: fileId, to: target, kind: resolved ? 'exports' : 'unresolved', confidence: resolved ? 'high' : 'low', source: { ...sourceLoc(file, node), path: rel }, adapterId: 'typescript-semantic', adapterVersion: '1', sourceRevision: revision, unresolved: !resolved })
    }
    if (ts.isClassDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node) || ts.isVariableDeclaration(node) || ts.isMethodDeclaration(node)) {
      const name = node.name && ts.isIdentifier(node.name) ? node.name.text : null
      const symbol = name ? checker.getSymbolAtLocation(node.name!) : undefined
      if (name && symbol) {
        const id = declarationId(node as ts.Declaration, symbol, name)
        if (ts.isClassDeclaration(node) && node.heritageClauses) for (const heritage of node.heritageClauses) for (const type of heritage.types) {
          const parent = checker.getSymbolAtLocation(type.expression)
          const target = parent ? nodeId('symbol', `${rel}#${parent.name}`) : nodeId('symbol', `unresolved#${type.expression.getText(file)}`)
          if (!parent) pushNode(nodes, { id: target, kind: 'symbol', label: type.expression.getText(file), unresolved: true })
          pushEdge(edges, { id: `${id}->${target}:inherits`, from: id, to: target, kind: parent ? 'inherits' : 'unresolved', confidence: parent ? 'high' : 'low', source: { ...sourceLoc(file, type), path: rel }, adapterId: 'typescript-semantic', adapterVersion: '1', sourceRevision: revision, unresolved: !parent })
        }
      }
    }
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const symbol = checker.getSymbolAtLocation(node.expression)
      const target = symbol ? nodeId('symbol', `${rel}#${symbol.name}`) : nodeId('symbol', `unresolved#${node.expression.getText(file)}`)
      if (!symbol) pushNode(nodes, { id: target, kind: 'symbol', label: node.expression.getText(file), unresolved: true })
      pushEdge(edges, { id: `${fileId}->${target}:calls:${node.getStart(file)}`, from: fileId, to: target, kind: symbol ? 'calls' : 'unresolved', confidence: symbol ? 'medium' : 'low', source: { ...sourceLoc(file, node), path: rel }, adapterId: file.fileName.endsWith('.ts') || file.fileName.endsWith('.tsx') ? 'typescript-semantic' : 'javascript-semantic', adapterVersion: '1', sourceRevision: revision, unresolved: !symbol, note: symbol ? undefined : 'Reflection, generated code, or dynamic dispatch is unresolved.' })
    }
    if (ts.isImportDeclaration(node) && !ts.isStringLiteral(node.moduleSpecifier)) omissions.push(`${rel}: non-literal import is unresolved`)
    ts.forEachChild(node, visit)
  }
  visit(file)
}

function normalizeSnapshot(value: unknown): RepositoryGraphSnapshot | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as RepositoryGraphSnapshot
  if (raw.version !== 1 || typeof raw.projectId !== 'string' || !raw.fingerprint || !Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) return null
  return raw
}

export class RepositoryGraphService implements RepositoryGraphApi {
  private readonly operations = new Map<string, Operation>()
  private readonly listeners = new Set<(progress: RepositoryGraphProgress) => void>()
  private readonly snapshots = new Map<string, RepositoryGraphSnapshot>()
  private readonly writeQueue = new Map<string, Promise<void>>()

  constructor(private readonly options: RepositoryGraphServiceOptions) {}

  private cachePath(projectId: string): string { return join(this.options.userDataDir, 'repository-graph', safeProjectId(projectId), 'snapshot.json') }
  private previousPath(projectId: string): string { return join(this.options.userDataDir, 'repository-graph', safeProjectId(projectId), 'previous.json') }

  private emit(projectId: string, operationId: string, phase: RepositoryGraphProgress['phase'], completed: number, total: number, status: RepositoryGraphStatus, message: string): void {
    const progress = { projectId, operationId, phase, completed, total, status, message } satisfies RepositoryGraphProgress
    for (const listener of this.listeners) listener(progress)
  }

  private async target(projectId: string): Promise<{ root: string; name: string } | { snapshot: RepositoryGraphSnapshot }> {
    const info = this.options.projectTargetInfo(projectId)
    if (!info) throw new Error('The selected project is not registered on this host.')
    if (info.ssh || !info.cwd) throw new Error('Repository graphs run on the source-owning host and are unavailable for this remote project.')
    const root = resolve(info.cwd)
    await access(root, fsConstants.R_OK)
    return { root, name: info.name }
  }

  async inspect(projectId: string, mode: RepositoryGraphMode = 'combined'): Promise<RepositoryGraphSnapshot> {
    const cached = this.snapshots.get(projectId)
    if (cached && (mode === cached.mode || mode === 'combined')) return cached
    try {
      const raw = normalizeSnapshot(JSON.parse(await readFile(this.cachePath(projectId), 'utf8')))
      if (raw) { this.snapshots.set(projectId, raw); return raw }
    } catch { /* absent cache is an honest idle state */ }
    return { version: 1, projectId, mode, status: 'idle', rootLabel: 'Project source', fingerprint: { revision: 'unknown', files: 0, bytes: 0, contentHash: '', generatedAt: 0 }, nodes: [], edges: [], adapters: REPOSITORY_GRAPH_ADAPTERS.map((item) => ({ ...item, patterns: [...item.patterns] })), omissions: ['No verified graph snapshot exists yet. Refresh to index the project source.'], createdAt: 0 }
  }

  async refresh(input: RepositoryGraphRefreshInput): Promise<RepositoryGraphSnapshot> {
    const operationId = `graph-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    const operation = { operationId, cancelled: false }
    this.operations.set(operationId, operation)
    const mode = input.mode ?? 'combined'
    const old = this.snapshots.get(input.projectId) ?? await this.inspect(input.projectId, mode)
    try {
      const target = await this.target(input.projectId)
      if ('snapshot' in target) throw new Error('Invalid graph target.')
      const files = await listFiles(target.root, operation, (done, total, phase, message) => this.emit(input.projectId, operationId, phase, done, total, 'running', message))
      this.emit(input.projectId, operationId, 'parsing', 0, files.length, 'running', 'Parsing semantic source files')
      let revision = 'unknown'
      try { revision = (await execFileAsync('git', ['-C', target.root, 'rev-parse', 'HEAD'], { windowsHide: true, maxBuffer: 1024 * 1024 })).stdout.trim() || 'unknown' } catch { /* non-git folders still receive a content fingerprint */ }
      const nodes = new Map<string, RepositoryGraphNode>()
      const edges = new Map<string, RepositoryGraphEdge>()
      const omissions: string[] = []
      const codeFiles = files.filter((file) => CODE_EXTENSIONS.has(extname(file.rel).toLowerCase()))
      if (mode !== 'dependencies') {
        const program = ts.createProgram(codeFiles.map((file) => file.abs), { allowJs: true, checkJs: false, noEmit: true, moduleResolution: ts.ModuleResolutionKind.NodeNext, target: ts.ScriptTarget.ESNext, skipLibCheck: true })
        const checker = program.getTypeChecker()
        for (let i = 0; i < codeFiles.length; i++) {
          if (operation.cancelled) break
          const source = program.getSourceFile(codeFiles[i].abs)
          if (source) parseCode(source, checker, revision, nodes, edges, omissions, target.root)
          this.emit(input.projectId, operationId, 'parsing', i + 1, codeFiles.length, 'running', `Parsed ${i + 1} of ${codeFiles.length} source files`)
        }
      }
      if (mode !== 'code') {
        const manifests = files.filter((file) => isManifestName(basename(file.rel)))
        for (let i = 0; i < manifests.length; i++) {
          if (operation.cancelled) break
          const manifest = REPOSITORY_GRAPH_ADAPTERS.find((item) => item.patterns.some((pattern) => pattern === basename(manifests[i].rel) || (pattern.includes('*') && new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*')}$`, 'u').test(basename(manifests[i].rel)))))
          if (!manifest?.available) omissions.push(`${manifests[i].rel}: ${manifest?.reason ?? 'No bundled semantic adapter is available.'}`)
          else addManifestDependencies(manifests[i].bytes.toString('utf8'), manifests[i].rel, revision, nodes, edges, omissions)
          this.emit(input.projectId, operationId, 'dependencies', i + 1, manifests.length, 'running', `Read ${i + 1} of ${manifests.length} dependency manifests`)
        }
      }
      const fingerprint: RepositoryGraphFingerprint = { revision, files: files.length, bytes: files.reduce((sum, file) => sum + file.bytes.byteLength, 0), contentHash: boundedHash(files.map((file) => ({ path: file.rel, bytes: file.bytes }))), generatedAt: Date.now() }
      let revisionAfter = revision
      try { revisionAfter = (await execFileAsync('git', ['-C', target.root, 'rev-parse', 'HEAD'], { windowsHide: true, maxBuffer: 1024 * 1024 })).stdout.trim() || revision } catch { /* retain the pre-parse revision */ }
      const endFiles = await listFiles(target.root, operation, () => undefined)
      const endHash = boundedHash(endFiles.map((file) => ({ path: file.rel, bytes: file.bytes })))
      if (revisionAfter !== revision || endHash !== fingerprint.contentHash) {
        const retained = { ...old, status: 'stale' as const, omissions: [...old.omissions, old.fingerprint.contentHash ? 'Source changed while indexing; previous verified snapshot retained.' : 'Source changed while indexing; no stable snapshot was published.'] }
        this.snapshots.set(input.projectId, retained)
        this.emit(input.projectId, operationId, 'finalizing', 1, 1, 'stale', retained.omissions.at(-1)!)
        return retained
      }
      const stale = old.fingerprint.contentHash !== '' && old.fingerprint.contentHash !== fingerprint.contentHash && old.fingerprint.revision !== revision
      const snapshot: RepositoryGraphSnapshot = { version: 1, projectId: input.projectId, mode, status: operation.cancelled ? 'cancelled' : omissions.length ? 'partial' : stale ? 'stale' : 'ready', rootLabel: target.name, fingerprint, nodes: [...nodes.values()], edges: [...edges.values()], adapters: REPOSITORY_GRAPH_ADAPTERS.map((item) => ({ ...item, patterns: [...item.patterns] })), omissions, createdAt: Date.now(), ...(old.fingerprint.contentHash ? { previousFingerprint: old.fingerprint } : {}) }
      if (operation.cancelled) return { ...old, status: 'cancelled', omissions: [...old.omissions, 'Refresh was cancelled; the previous verified snapshot was retained.'] }
      this.snapshots.set(input.projectId, snapshot)
      await this.persist(input.projectId, snapshot, old)
      this.emit(input.projectId, operationId, 'finalizing', 1, 1, snapshot.status, `Indexed ${snapshot.nodes.length} nodes and ${snapshot.edges.length} edges`)
      return snapshot
    } catch (error) {
      const failed: RepositoryGraphSnapshot = { ...old, status: 'failed', omissions: [...old.omissions, error instanceof Error ? error.message : String(error)] }
      this.snapshots.set(input.projectId, failed)
      this.emit(input.projectId, operationId, 'finalizing', 1, 1, 'failed', failed.omissions.at(-1) ?? 'Indexing failed')
      return failed
    } finally { this.operations.delete(operationId) }
  }

  private async persist(projectId: string, snapshot: RepositoryGraphSnapshot, previous: RepositoryGraphSnapshot): Promise<void> {
    const run = async (): Promise<void> => {
      const dir = join(this.options.userDataDir, 'repository-graph', safeProjectId(projectId))
      await mkdir(dir, { recursive: true })
      if (previous.fingerprint.contentHash) await writeFileAtomic(this.previousPath(projectId), JSON.stringify(previous), { mode: 0o600 })
      await writeFileAtomic(this.cachePath(projectId), JSON.stringify(snapshot), { mode: 0o600 })
    }
    const queued = (this.writeQueue.get(projectId) ?? Promise.resolve()).then(run, run)
    this.writeQueue.set(projectId, queued.catch(() => {}))
    await queued
  }

  async cancel(operationId: string): Promise<boolean> { const operation = this.operations.get(operationId); if (!operation) return false; operation.cancelled = true; return true }

  async export(input: RepositoryGraphExportInput): Promise<RepositoryGraphExportResult> {
    const snapshot = await this.inspect(input.projectId, input.mode ?? 'combined')
    const nodes = snapshot.nodes
    const edges = snapshot.edges
    this.emit(input.projectId, 'export', 'exporting', 0, 1, 'running', `Exporting ${input.format}`)
    let content = ''
    if (input.format === 'json') content = JSON.stringify(snapshot, null, 2)
    else if (input.format === 'jsonl') content = [...nodes.map((node) => JSON.stringify({ type: 'node', ...node })), ...edges.map((edge) => JSON.stringify({ type: 'edge', ...edge }))].join('\n') + '\n'
    else if (input.format === 'csv' || input.format === 'tsv') {
      const delimiter = input.format === 'csv' ? ',' : '\t'
      const quote = (value: unknown): string => { const text = String(value ?? ''); return input.format === 'csv' ? `"${text.replaceAll('"', '""')}"` : text.replaceAll('\t', ' ') }
      content = ['kind' + delimiter + 'id' + delimiter + 'label' + delimiter + 'from' + delimiter + 'to' + delimiter + 'relation', ...nodes.map((node) => ['node', node.id, node.label, '', '', node.kind].map(quote).join(delimiter)), ...edges.map((edge) => ['edge', edge.id, '', edge.from, edge.to, edge.kind].map(quote).join(delimiter))].join('\n') + '\n'
    } else if (input.format === 'markdown') content = `# Repository graph\n\nSource revision: ${snapshot.fingerprint.revision}\n\n## Nodes\n\n${nodes.map((node) => `- **${node.kind}** \`${node.id}\` ${node.label}${node.unresolved ? ' (unresolved)' : ''}`).join('\n')}\n\n## Edges\n\n${edges.map((edge) => `- \`${edge.from}\` → \`${edge.to}\`, ${edge.kind}, confidence ${edge.confidence}, source ${edge.source?.path ?? 'unknown'}`).join('\n')}\n`
    else if (input.format === 'html') content = `<!doctype html><meta charset="utf-8"><title>Repository graph</title><h1>Repository graph</h1><p>Source revision: ${snapshot.fingerprint.revision}</p><h2>Nodes</h2><ul>${nodes.map((node) => `<li><b>${escapeHtml(node.kind)}</b> ${escapeHtml(node.label)}</li>`).join('')}</ul><h2>Edges</h2><ul>${edges.map((edge) => `<li>${escapeHtml(edge.from)} → ${escapeHtml(edge.to)} (${escapeHtml(edge.kind)})</li>`).join('')}</ul>`
    else if (input.format === 'graphml') content = `<?xml version="1.0" encoding="UTF-8"?><graphml xmlns="http://graphml.graphdrawing.org/xmlns"><graph id="repository" edgedefault="directed">${nodes.map((node) => `<node id="${escapeXml(node.id)}"><data key="label">${escapeXml(node.label)}</data></node>`).join('')}${edges.map((edge) => `<edge id="${escapeXml(edge.id)}" source="${escapeXml(edge.from)}" target="${escapeXml(edge.to)}"><data key="kind">${escapeXml(edge.kind)}</data></edge>`).join('')}</graph></graphml>`
    else content = `digraph repository {\n${nodes.map((node) => `  "${escapeDot(node.id)}" [label="${escapeDot(node.label)}"];`).join('\n')}\n${edges.map((edge) => `  "${escapeDot(edge.from)}" -> "${escapeDot(edge.to)}" [label="${escapeDot(edge.kind)}"];`).join('\n')}\n}\n`
    this.emit(input.projectId, 'export', 'exporting', 1, 1, 'ready', `Exported ${input.format}`)
    return { format: input.format, filename: `repository-graph-${input.projectId}.${input.format === 'markdown' ? 'md' : input.format}`, content, sourceRevision: snapshot.fingerprint.revision, stale: snapshot.status === 'stale', omissions: snapshot.omissions }
  }

  async openSource(projectId: string, location: RepositoryGraphSourceLocation): Promise<{ ok: true } | { ok: false; reason: string }> {
    try {
      const target = await this.target(projectId)
      if ('snapshot' in target) return target.snapshot.status === 'unsupported' ? { ok: false, reason: 'Source navigation is unsupported for this project.' } : { ok: false, reason: 'Invalid source target.' }
      const rel = location.path.replaceAll('\\', '/')
      const abs = resolve(target.root, rel)
      if (abs !== target.root && !abs.startsWith(`${target.root}${sep}`)) return { ok: false, reason: 'Source path is outside the selected project.' }
      const info = await stat(abs)
      if (!info.isFile()) return { ok: false, reason: 'Source file is missing.' }
      await platform().openExternal(`file://${abs.replaceAll('\\', '/')}${location.line ? `:${location.line}${location.column ? `:${location.column}` : ''}` : ''}`)
      return { ok: true }
    } catch (error) { return { ok: false, reason: error instanceof Error ? error.message : String(error) } }
  }

  onProgress(listener: (progress: RepositoryGraphProgress) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener) }
}

function escapeHtml(value: string): string { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;') }
function escapeXml(value: string): string { return escapeHtml(value).replaceAll("'", '&apos;') }
function escapeDot(value: string): string { return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"') }
