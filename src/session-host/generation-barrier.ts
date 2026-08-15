/** A same-name PTY can have only one protocol generation at a time. The wire format identifies
 *  data/exit frames by session name alone, so reusing that name while the prior generation still
 *  has final frames to publish makes those frames indistinguishable from the replacement's. */
export interface RetiringSessionGeneration {
  exited: boolean
  ending: Promise<void> | null
}

/** Keep an exiting generation visible until its final output, exit frame and teardown have all
 *  completed. The identity check is defensive: the attach gate below should prevent replacement,
 *  but an unrelated future writer must never let an old cleanup delete a newer generation. */
export async function retireSessionGeneration<T>(
  sessions: Map<string, T>,
  name: string,
  generation: T,
  publishAndDispose: () => Promise<void>
): Promise<boolean> {
  await publishAndDispose()
  if (sessions.get(name) !== generation) return false
  sessions.delete(name)
  return true
}

/** Return the active generation, or an empty slot only after an exiting generation has finished
 *  publishing. Waiting rather than deleting is the protocol-compatible generation boundary: a
 *  socket may receive the old exit before its attach response, but never after it has attached to
 *  a new same-name PTY. */
export async function currentSessionAfterRetirement<T extends RetiringSessionGeneration>(
  sessions: Map<string, T>,
  name: string
): Promise<T | undefined> {
  for (;;) {
    const current = sessions.get(name)
    if (!current || !current.exited) return current
    if (!current.ending) {
      throw new Error(`exited session ${name} has no retirement barrier`)
    }
    await current.ending
  }
}
