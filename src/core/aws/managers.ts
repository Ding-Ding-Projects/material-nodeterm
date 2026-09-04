import { AwsSchemaExecutor, type AwsTransport, type AwsSchemaExecutorOptions } from './schema-executor'
import { randomUUID } from 'node:crypto'
import type { AwsBulkExecutionResult, AwsExecutionRequest, AwsExecutionResult, AwsExecutionTarget, AwsManagerApi, AwsManagerDescriptor } from '../../shared/aws-managers'

export type S3ListObjectsInput = { bucket: string; prefix?: string; maxKeys?: number; region: string }
export type S3ObjectInput = { bucket: string; key: string; region: string }
export type S3GetObjectInput = S3ObjectInput & { destination: { handle: string; name: string; size: number } }
export type S3PutObjectInput = S3ObjectInput & { source: { handle: string; name: string; size: number } }
export type S3DeleteObjectsInput = { bucket: string; keys: { key: string; bucket?: string; region?: string }[]; region: string }
export type Ec2InstancesInput = { instanceIds: string[]; region: string }
export type Ec2DescribeInput = { region: string; filters?: unknown[] }
export type IamUserInput = { userName: string }
export type StsAssumeRoleInput = { roleArn: string; roleSessionName: string; durationSeconds?: number; externalId?: string }
export type LambdaInvokeInput = { functionName: string; invocationType: 'RequestResponse' | 'Event' | 'DryRun'; payload?: string; region: string }
export type LogsFilterInput = { logGroupName: string; filterPattern?: string; startTime?: number; endTime?: number; region: string }

/** One service-scoped facade. It exposes the same schema executor for every manager, so retries,
 * permission checks, progress, cancellation, pagination, waiters, and destructive previews cannot
 * drift between providers. Service-specific classes below only type their input methods. */
export class AwsServiceManager {
  constructor(
    readonly service: AwsExecutionRequest['service'],
    protected readonly executor: AwsSchemaExecutor
  ) {}

  catalog(): Promise<readonly AwsManagerDescriptor[]> { return this.executor.catalog() }
  permission(...args: Parameters<AwsManagerApi['permission']>): ReturnType<AwsManagerApi['permission']> { return this.executor.permission(...args) }
  previewDestructive(request: AwsExecutionRequest): ReturnType<AwsManagerApi['previewDestructive']> { return this.executor.previewDestructive(request) }
  bulk<T = unknown>(requests: readonly AwsExecutionRequest[], signal?: AbortSignal): Promise<AwsBulkExecutionResult<T>> { return this.executor.bulk<T>(requests, signal) }
  protected execute<T>(operationId: string, input: Record<string, unknown>, target: AwsExecutionTarget, requestId = randomUUID(), confirmationNonce?: string): Promise<AwsExecutionResult<T>> {
    return this.executor.execute<T>({ requestId, operationId, service: this.service, input, target, confirmationNonce })
  }
  protected stream<T>(operationId: string, input: Record<string, unknown>, target: AwsExecutionTarget, requestId = randomUUID(), signal?: AbortSignal): AsyncIterable<T | import('../../shared/aws-managers').AwsProgressEvent> {
    return this.executor.stream<T>({ requestId, operationId, service: this.service, input, target, signal })
  }
  toPortableIntent(request: AwsExecutionRequest) { return this.executor.toPortableIntent(request) }
}

export class S3Manager extends AwsServiceManager {
  constructor(executor: AwsSchemaExecutor) { super('s3', executor) }
  listBuckets(target: AwsExecutionTarget) { return this.execute('s3.listBuckets', {}, target) }
  listObjects(input: S3ListObjectsInput, target: AwsExecutionTarget) { return this.execute('s3.listObjectsV2', input, target) }
  getObject(input: S3GetObjectInput, target: AwsExecutionTarget) { return this.execute('s3.getObject', input, target) }
  putObject(input: S3PutObjectInput, target: AwsExecutionTarget) { return this.execute('s3.putObject', input, target) }
  deleteObject(input: S3ObjectInput, target: AwsExecutionTarget, confirmationNonce?: string) { return this.execute('s3.deleteObject', input, target, randomUUID(), confirmationNonce) }
  deleteObjects(input: S3DeleteObjectsInput, target: AwsExecutionTarget, confirmationNonce?: string) { return this.execute('s3.deleteObjects', input, target, randomUUID(), confirmationNonce) }
}

export class Ec2Manager extends AwsServiceManager {
  constructor(executor: AwsSchemaExecutor) { super('ec2', executor) }
  describeInstances(input: Ec2DescribeInput, target: AwsExecutionTarget) { return this.execute('ec2.describeInstances', input, target) }
  startInstances(input: Ec2InstancesInput, target: AwsExecutionTarget) { return this.execute('ec2.startInstances', input, target) }
  stopInstances(input: Ec2InstancesInput & { hibernate?: boolean }, target: AwsExecutionTarget, confirmationNonce?: string) { return this.execute('ec2.stopInstances', input, target, randomUUID(), confirmationNonce) }
  terminateInstances(input: Ec2InstancesInput, target: AwsExecutionTarget, confirmationNonce?: string) { return this.execute('ec2.terminateInstances', input, target, randomUUID(), confirmationNonce) }
  rebootInstances(input: Ec2InstancesInput & { force?: boolean }, target: AwsExecutionTarget) { return this.execute('ec2.rebootInstances', input, target) }
}

export class IamManager extends AwsServiceManager {
  constructor(executor: AwsSchemaExecutor) { super('iam', executor) }
  listUsers(input: { maxItems?: number }, target: AwsExecutionTarget) { return this.execute('iam.listUsers', input, target) }
  listRoles(input: { maxItems?: number }, target: AwsExecutionTarget) { return this.execute('iam.listRoles', input, target) }
  getPolicy(input: { policyArn: string }, target: AwsExecutionTarget) { return this.execute('iam.getPolicy', input, target) }
  createUser(input: IamUserInput, target: AwsExecutionTarget) { return this.execute('iam.createUser', input, target) }
  deleteUser(input: IamUserInput, target: AwsExecutionTarget, confirmationNonce?: string) { return this.execute('iam.deleteUser', input, target, randomUUID(), confirmationNonce) }
}

export class StsManager extends AwsServiceManager {
  constructor(executor: AwsSchemaExecutor) { super('sts', executor) }
  getCallerIdentity(target: AwsExecutionTarget) { return this.execute('sts.getCallerIdentity', {}, target) }
  assumeRole(input: StsAssumeRoleInput, target: AwsExecutionTarget) { return this.execute('sts.assumeRole', input, target) }
}

export class LambdaManager extends AwsServiceManager {
  constructor(executor: AwsSchemaExecutor) { super('lambda', executor) }
  listFunctions(input: { region: string; maxItems?: number }, target: AwsExecutionTarget) { return this.execute('lambda.listFunctions', input, target) }
  invoke(input: LambdaInvokeInput, target: AwsExecutionTarget) { return this.execute('lambda.invoke', input, target) }
  updateFunctionCode(input: { functionName: string; sourceFile: { handle: string; name: string; size: number }; publish?: boolean; region: string }, target: AwsExecutionTarget) { return this.execute('lambda.updateFunctionCode', input, target) }
  deleteFunction(input: { functionName: string; region: string }, target: AwsExecutionTarget, confirmationNonce?: string) { return this.execute('lambda.deleteFunction', input, target, randomUUID(), confirmationNonce) }
}

export class CloudWatchManager extends AwsServiceManager {
  constructor(executor: AwsSchemaExecutor) { super('cloudwatch', executor) }
  listMetrics(input: { namespace?: string; metricName?: string; dimensions?: Record<string, unknown>; region: string }, target: AwsExecutionTarget) { return this.execute('cloudwatch.listMetrics', input, target) }
  getMetricData(input: { metricDataQueries: unknown[]; startTime: string; endTime: string; scanBy?: number; region: string }, target: AwsExecutionTarget) { return this.execute('cloudwatch.getMetricData', input, target) }
  putMetricAlarm(input: { alarmName: string; alarmDefinition: Record<string, unknown>; region: string }, target: AwsExecutionTarget) { return this.execute('cloudwatch.putMetricAlarm', input, target) }
  deleteAlarms(input: { alarmNames: string[]; region: string }, target: AwsExecutionTarget, confirmationNonce?: string) { return this.execute('cloudwatch.deleteAlarms', input, target, randomUUID(), confirmationNonce) }
}

export class LogsManager extends AwsServiceManager {
  constructor(executor: AwsSchemaExecutor) { super('logs', executor) }
  describeLogGroups(input: { prefix?: string; region: string }, target: AwsExecutionTarget) { return this.execute('logs.describeLogGroups', input, target) }
  filterLogEvents(input: LogsFilterInput, target: AwsExecutionTarget) { return this.execute('logs.filterLogEvents', input, target) }
  tailLogGroup(input: { logGroupName: string; filterPattern?: string; region: string }, target: AwsExecutionTarget, signal?: AbortSignal) { return this.stream('logs.tailLogGroup', input, target, randomUUID(), signal) }
  deleteLogGroup(input: { logGroupName: string; region: string }, target: AwsExecutionTarget, confirmationNonce?: string) { return this.execute('logs.deleteLogGroup', input, target, randomUUID(), confirmationNonce) }
}

export interface AwsManagers {
  s3: S3Manager
  ec2: Ec2Manager
  iam: IamManager
  sts: StsManager
  lambda: LambdaManager
  cloudwatch: CloudWatchManager
  logs: LogsManager
}

export function createAwsManagers(options: AwsSchemaExecutorOptions): AwsManagers {
  const executor = new AwsSchemaExecutor(options)
  return { s3: new S3Manager(executor), ec2: new Ec2Manager(executor), iam: new IamManager(executor), sts: new StsManager(executor), lambda: new LambdaManager(executor), cloudwatch: new CloudWatchManager(executor), logs: new LogsManager(executor) }
}

export function createAwsManagersFromTransport(transport: AwsTransport, onProgress?: AwsSchemaExecutorOptions['onProgress']): AwsManagers {
  return createAwsManagers({ transport, onProgress })
}
