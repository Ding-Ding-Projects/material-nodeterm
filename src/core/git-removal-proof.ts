import { createHash } from 'crypto'

export interface GitRemovalFingerprintInput {
  headOid: string
  index: string
  cachedDiff: string
  worktreeDiff: string
  porcelain: string
  untracked: string
  generation: string
}

/** Length-prefix every field: concatenation must not let two different boundaries hash alike. */
export function gitRemovalFingerprint(input: GitRemovalFingerprintInput): string {
  const hash = createHash('sha256')
  for (const value of [
    input.headOid,
    input.index,
    input.cachedDiff,
    input.worktreeDiff,
    input.porcelain,
    input.untracked,
    input.generation
  ]) {
    hash.update(String(Buffer.byteLength(value)))
    hash.update(':')
    hash.update(value)
  }
  return hash.digest('hex')
}
