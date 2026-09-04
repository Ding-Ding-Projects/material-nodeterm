/**
 * Syntax-aware basename for recorded paths.
 *
 * The implementation lives in `src/shared/path-basename.ts` and is re-exported here so both sides
 * of the CorePlatform seam AND the renderer share ONE definition. The renderer bundle has no node
 * builtins, so a `node:path`-backed copy could never reach it — and a second copy is exactly how
 * three project-name call sites came to split a Deen No path on `/` alone and hand the caller the
 * whole path back as the leaf.
 */
export { basenameForPathSyntax, isWindowsPathSyntax, normalizePathTail } from '../shared/path-basename'
