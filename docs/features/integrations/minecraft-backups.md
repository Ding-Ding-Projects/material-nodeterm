# Minecraft world backups

World backups for a managed Minecraft server instance (see
[minecraft-server.md](minecraft-server.md) for the server manager these attach to). Source:
`src/core/minecraft/backups.ts` (the implementation) and
`src/renderer/components/minecraft/MinecraftBackupsPanel.tsx` (the UI, part of the service node's
panel).

## What a backup actually is

A backup is a real filesystem copy of the world folder — the server's `level-name` from
`server.properties`, defaulting to vanilla's own `"world"` — taken as a plain recursive directory
copy rather than an archive. Nothing in this codebase's dependency graph currently writes a zip,
and a directory copy needs no new dependency at all: `fs.cp` is a stable Node builtin, and it's
exactly what a user could do by hand from a file manager. Vanilla itself nests the Nether
(`DIM-1`) and the End (`DIM1`) inside the overworld's own folder, so copying that one directory
already carries all three dimensions.

Backups live at `<instance dir>/backups/<id>/`, each with its own `meta.json` (`{id, levelName,
createdAt, sizeBytes, auto?}`). Ids are timestamp-derived and sortable (`makeBackupId`): the wall
clock formatted to the second, plus a disambiguating counter suffix — not just milliseconds — so
two backups requested inside the same second (a manual one right after an automatic
restore-safety-net copy) never collide.

## Refused while the server is running

`backups.ts` itself doesn't know anything about the server *process* — that check lives entirely
in `server-manager.ts` (the module's only caller), which refuses both `createBackup` and
`restoreBackup` outright while the instance is running: "A backup while the server is running can
capture files mid-write — stop the server first." The panel repeats the same message before the
request is even sent.

This isn't a "best effort while running" compromise — it's a hard refusal, because a backup taken
mid-write could capture a half-flushed region file, and a restore would be replacing files the
live server still has open. Neither failure mode is worth trying to be clever about.

## Atomic creation

`createBackup` copies the source world into a temp directory named `<finalDir>.copying-<pid>`,
writes `meta.json` into it, then calls `renameAtomic` to publish it under its final id. A
concurrent `listBackups` can therefore never observe a partially-copied backup — it either doesn't
exist yet, or it exists complete with valid metadata. `listBackups` reinforces this from the
reading side: a backup folder with no readable `meta.json`, or one whose `meta.json` doesn't parse
as valid `BackupMeta`, is silently **skipped** rather than reported as corrupt — it wasn't made by
this module, or the process was killed mid-copy before the rename completed, and either way it
isn't something the user asked to see in their backup list.

Creating a backup against a world folder that has never existed (the server has never been started
once) is an honest refusal rather than a "successful" empty backup — the source path is checked to
exist before anything is copied.

## Restore never deletes outright

`restoreBackup` never deletes the world it's about to overwrite. It first calls `createBackup`
itself with `auto: true` to preserve the current world as an **automatic** backup — marked `auto`
so `listBackups` can label it honestly as one the system made, not one the user asked for — and
only then removes the live world directory and copies the chosen backup into place (again via a
temp-then-`renameAtomic` sequence, with the copied backup's own bookkeeping `meta.json` stripped
out before the rename — that file is backup-list metadata, not part of the world, and must never
land inside the live world folder).

The consequence: choosing the wrong backup to restore is always itself recoverable, by restoring
the automatic safety-net copy the restore just made. The panel's confirmation dialog says this
explicitly — "The world being replaced is saved first as an automatic backup, so this can be
undone by restoring it back."

## Id validation and path safety

`backupId` values reach `restoreBackup` and `deleteBackup` as plain strings from IPC — data a
compromised or buggy renderer could set to anything. Both are checked against `SAFE_BACKUP_ID`
(`/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/`) before being used to build a filesystem path, the same
discipline `server-manager.ts`'s own `SAFE_ID` already applies to instance directory names.
`deleteBackup` goes one step further and re-verifies the **resolved** path still sits inside
`backupsRoot` before calling `rm -rf` on it — belt-and-braces on top of the regex, since deletion
is the one operation here with no automatic-backup safety net underneath it (deletion is
permanent; the caller is responsible for gating it behind the destructive-action confirmation, the
same as `MinecraftApi.remove`).

## No automatic pruning

Nothing in this module deletes or thins out old backups automatically — the panel says so
explicitly ("nothing here deletes or thins out old backups automatically, so remove ones you no
longer want by hand"). This is a stated v1 choice: a backup is a full directory copy of a
potentially large world, and deciding a retention policy (keep last N, keep one per day, …) is a
product decision nobody has made yet. Until then, every backup a user or an auto-restore-safety
creates stays until explicitly deleted.

## Suggested articles

- [Minecraft server manager](minecraft-server.md) — the instance/process lifecycle this feature's
  running-server refusal depends on.
- [Service nodes](service-nodes.md) — the broader canvas-node category the Minecraft manager
  belongs to.
