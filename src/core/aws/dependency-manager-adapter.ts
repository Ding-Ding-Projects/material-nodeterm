import type { AwsCliStatus } from '../../shared/aws'
import { AwsCliService } from './service'

/** Small adapter for the app's dependency-manager surfaces. It deliberately exposes the AWS
 * manager as a user-scoped, verified dependency and never offers PATH discovery as authority. */
export interface AwsCliDependencyAdapter {
  readonly id: 'aws-cli-v2-windows-x64'
  status(): AwsCliStatus
  ensure(): Promise<AwsCliStatus>
  repair(): Promise<AwsCliStatus>
  cancel(): Promise<void>
}

export function createAwsCliDependencyAdapter(service: AwsCliService): AwsCliDependencyAdapter {
  return {
    id: 'aws-cli-v2-windows-x64',
    status: () => service.status(),
    ensure: () => service.ensure(),
    repair: () => service.repair(),
    cancel: () => service.cancel()
  }
}
