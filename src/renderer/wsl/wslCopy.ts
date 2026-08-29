import type { WslCreateStage } from '@shared/wsl'

/**
 * The one WSL copy inventory. Each user-authored string has one catalogue id and one English
 * fallback, so the renderer cannot drift into a second ad-hoc id map or an unlocalised literal.
 * Runtime values such as distribution names, operation ids, executable names, and parser errors
 * are never entries here.
 */
export const WSL_COPY = {
  title: { id: 'wsl.create.title', fallback: 'New WSL instance' },
  cancel: { id: 'wsl.create.actions.cancel', fallback: 'Cancel' },
  cancelling: { id: 'wsl.create.actions.cancelling', fallback: 'Cancelling…' },
  create: { id: 'wsl.create.actions.create', fallback: 'Create' },
  creating: { id: 'wsl.create.actions.creating', fallback: 'Creating…' },
  description: { id: 'wsl.create.description', fallback: 'Choose a distribution from the live WSL catalogue, then give this machine-local instance a unique name.' },
  filterLabel: { id: 'wsl.create.filter.label', fallback: 'Filter distributions' },
  filterRegex: { id: 'wsl.create.filter.regex', fallback: 'Regex for WSL distributions' },
  listAria: { id: 'wsl.create.list.aria', fallback: 'Available WSL distributions' },
  loading: { id: 'wsl.create.status.loading', fallback: 'Loading available distributions…' },
  catalogueErrorPrefix: { id: 'wsl.create.error.cataloguePrefix', fallback: 'Could not load available distributions:' },
  catalogueNotInstalled: { id: 'wsl.create.error.catalogueNotInstalled', fallback: 'WSL is not installed on this machine, so the online catalogue is unavailable.' },
  catalogueCommandFailed: { id: 'wsl.create.error.catalogueCommandFailed', fallback: 'The WSL catalogue command could not be completed.' },
  catalogueParseFailed: { id: 'wsl.create.error.catalogueParseFailed', fallback: 'The WSL catalogue response could not be parsed.' },
  emptyNone: { id: 'wsl.create.empty.none', fallback: 'No distributions available.' },
  emptyNoMatch: { id: 'wsl.create.empty.noMatch', fallback: 'No distributions match that filter.' },
  nameLabel: { id: 'wsl.create.field.name', fallback: 'Instance name' },
  nameAria: { id: 'wsl.create.field.nameAria', fallback: 'WSL instance name' },
  namePlaceholder: { id: 'wsl.create.field.placeholder', fallback: 'my-project' },
  nameSupport: { id: 'wsl.create.field.support', fallback: 'Letters, numbers, spaces, dots, hyphens, and underscores are accepted.' },
  operationErrorPrefix: { id: 'wsl.create.error.prefix', fallback: 'The WSL operation reported an error:' },
  starting: { id: 'wsl.create.progress.starting', fallback: 'Starting WSL creation…' },
  cancellingProgress: { id: 'wsl.create.progress.cancelling', fallback: 'Cancelling WSL creation…' },
  validating: { id: 'wsl.create.progress.validating', fallback: 'Validating the selected distribution and name.' },
  checking: { id: 'wsl.create.progress.checking', fallback: 'Checking WSL availability and the current distribution list.' },
  recording: { id: 'wsl.create.progress.recording', fallback: 'Recording ownership for "{name}" so this app can manage the new instance.' },
  completed: { id: 'wsl.create.progress.completed', fallback: 'WSL instance "{name}" was created and ownership was recorded.' },
  failed: { id: 'wsl.create.progress.failed', fallback: 'WSL instance creation failed: {error}' },
  cancelled: { id: 'wsl.create.progress.cancelled', fallback: 'WSL instance creation was cancelled.' },
  cancelledLate: { id: 'wsl.create.progress.cancelledLate', fallback: 'WSL instance "{name}" was created before cancellation completed; no canvas frame was bound.' },
  step: { id: 'wsl.create.progress.step', fallback: 'Step' },
  of: { id: 'wsl.create.progress.of', fallback: 'of' },
  progressAria: { id: 'wsl.create.progress.aria', fallback: 'WSL creation phase progress' },
  progressValue: { id: 'wsl.create.progress.value', fallback: 'Step {step} of {steps}, {stage}. {detail}' },
  stageValidating: { id: 'wsl.create.progress.stage.validating', fallback: 'validating' },
  stageChecking: { id: 'wsl.create.progress.stage.checking', fallback: 'checking' },
  stageInstalling: { id: 'wsl.create.progress.stage.installing', fallback: 'installing' },
  stageRecording: { id: 'wsl.create.progress.stage.recording', fallback: 'recording' },
  stageCompleted: { id: 'wsl.create.progress.stage.completed', fallback: 'completed' },
  stageFailed: { id: 'wsl.create.progress.stage.failed', fallback: 'failed' },
  stageCancelled: { id: 'wsl.create.progress.stage.cancelled', fallback: 'cancelled' },
  elapsed: { id: 'wsl.create.progress.elapsed', fallback: 'Elapsed time:' },
  seconds: { id: 'wsl.create.progress.seconds', fallback: 'seconds.' },
  installing: { id: 'wsl.create.progress.installing', fallback: 'Installing "{catalogue}" as "{name}" for operation {operationId}. Installation progress is reported by phase because wsl.exe provides no byte or percentage telemetry.' },
  installingDetail: { id: 'wsl.create.progress.installingDetail', fallback: 'Installation progress is reported by phase because wsl.exe provides no byte or percentage telemetry.' },
  cancellable: { id: 'wsl.create.progress.cancellable', fallback: 'The operation is bounded and can be cancelled.' },
  noActive: { id: 'wsl.create.error.noActive', fallback: 'Cancellation could not be sent because there is no active WSL operation.' },
  cancelRejected: { id: 'wsl.create.error.cancelRejected', fallback: 'Cancellation was not accepted because the WSL operation is no longer active. You can retry or close this dialog.' },
  cancelErrorPrefix: { id: 'wsl.create.error.cancelPrefix', fallback: 'Could not cancel WSL creation:' },
  required: { id: 'wsl.create.validation.required', fallback: 'Name is required.' },
  whitespace: { id: 'wsl.create.validation.whitespace', fallback: 'Name cannot start or end with whitespace.' },
  length: { id: 'wsl.create.validation.length', fallback: 'Name must be 64 characters or fewer.' },
  characters: { id: 'wsl.create.validation.characters', fallback: 'Name contains characters that are not allowed.' },
  shape: { id: 'wsl.create.validation.shape', fallback: 'Use letters, numbers, spaces, dots, hyphens, or underscores, starting and ending with a letter or number.' },
  duplicate: { id: 'wsl.create.validation.duplicate', fallback: 'A WSL instance with this name already exists.' }
} as const

export type WslCopyKey = keyof typeof WSL_COPY

export const WSL_COPY_INVENTORY = Object.entries(WSL_COPY).map(([key, value]) => ({
  key: key as WslCopyKey,
  ...value
}))

const WSL_COPY_BY_FALLBACK: Map<string, WslCopyKey> = new Map(
  WSL_COPY_INVENTORY.map((entry) => [entry.fallback, entry.key])
)

/** Resolve a legacy pure-validator message to the one canonical catalogue key. */
export function wslCopyKeyForFallback(value: string): WslCopyKey | undefined {
  return WSL_COPY_BY_FALLBACK.get(value)
}

export function wslStageCopyKey(stage: WslCreateStage): WslCopyKey {
  const keys: Record<WslCreateStage, WslCopyKey> = {
    validating: 'stageValidating',
    checking: 'stageChecking',
    installing: 'stageInstalling',
    recording: 'stageRecording',
    completed: 'stageCompleted',
    failed: 'stageFailed',
    cancelled: 'stageCancelled'
  }
  return keys[stage]
}

export interface WslAuthoredError {
  ownership: 'authored'
  copy: WslCopyKey
}

export interface WslExternalFactError {
  ownership: 'external-factual'
  /** Complete external text, retained verbatim except for authored text around `facts`. */
  text: string
  facts: readonly string[]
  /** Runtime values for an authored template, formatted before fact spans are preserved. */
  params?: Readonly<Record<string, string>>
  /** Optional authored catalogue prefix rendered before the preserved external text. */
  authoredPrefix?: WslCopyKey
  /** Authored catalogue template used when the production error has a typed code. */
  authoredTemplate?: WslCopyKey
}

export type WslDialogError = WslAuthoredError | WslExternalFactError
