/** Guided AWS service managers for the AWS Universe.
 *
 * The module has no shell fallback. Callers supply the trusted, bundled AWS transport and get
 * service-specific typed facades backed by the one schema executor.
 */
export { AWS_MANAGER_CATALOG, findAwsOperation } from './catalog'
export {
  AwsSchemaExecutor,
  createAwsManagers,
  createAwsManagersFromTransport,
  AwsServiceManager,
  S3Manager,
  Ec2Manager,
  IamManager,
  StsManager,
  LambdaManager,
  CloudWatchManager,
  LogsManager
} from './managers'
export type { AwsTransport, AwsSchemaExecutorOptions } from './schema-executor'
export type { AwsManagers } from './managers'
