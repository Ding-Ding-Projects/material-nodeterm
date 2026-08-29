// Shared AWS CLI v2 types. Runtime work lives in src/core/aws so the renderer never
// executes a process, resolves PATH, or reads a machine credential.

export const AWS_CLI_WINDOWS_X64_MANIFEST = {
  version: '2.36.31',
  platform: 'win32-x64',
  url: 'https://awscli.amazonaws.com/AWSCLIV2-User-2.36.31.msi?src=script-exe',
  sha256: '300d490cebe7d89913acc0f7ca1c585032fd2a7f698e809d7ce9905614013acd',
  bundledRelativePath: 'aws/AWSCLIV2-User-2.36.31.msi'
} as const

export type AwsCliState =
  | 'unsupported-platform'
  | 'not-installed'
  | 'ready'
  | 'stale'
  | 'installing'
  | 'failed'
  | 'offline'

export type AwsCliSource = 'bundled' | 'verified-fetch' | 'user-install' | null

export interface AwsCliStatus {
  state: AwsCliState
  expectedVersion: string
  installedVersion: string | null
  executablePath: string | null
  installerSource: AwsCliSource
  installerSha256: string | null
  progress: number | null
  detail: string | null
  checkedAt: number
}

export interface AwsModelSummary {
  id: string
  name: string
  provider: string | null
  inputModalities: string[]
  outputModalities: string[]
  responseStreamingSupported: boolean | null
  customizationsSupported: string[]
  inferenceTypesSupported: string[]
  source: 'aws-cli' | 'offline-cache'
}

export interface AwsModelInventory {
  models: AwsModelSummary[]
  source: 'aws-cli' | 'offline-cache' | 'unavailable'
  fetchedAt: number | null
  stale: boolean
  detail: string | null
}

export interface AwsApi {
  status(): Promise<AwsCliStatus>
  ensure(): Promise<AwsCliStatus>
  repair(): Promise<AwsCliStatus>
  cancel(): Promise<void>
  models(): Promise<AwsModelInventory>
  refreshModels(): Promise<AwsModelInventory>
}
