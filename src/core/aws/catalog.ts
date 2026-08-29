import type { AwsFieldSchema, AwsManagerDescriptor, AwsOperationSchema } from '../../shared/aws-managers'

const s = (key: string, label: string, description: string, extra: Partial<AwsFieldSchema> = {}): AwsFieldSchema => ({
  key, label, kind: 'string', description, maxLength: 2048, ...extra
})
const e = (key: string, label: string, description: string, options: string[], extra: Partial<AwsFieldSchema> = {}): AwsFieldSchema => ({
  ...s(key, label, description, extra), kind: 'enum', options: options.map((value) => ({ value, label: value }))
})
const b = (key: string, label: string, description: string, defaultValue = false): AwsFieldSchema => ({
  key, label, kind: 'boolean', description, defaultValue
})
const i = (key: string, label: string, description: string, min: number, max: number, defaultValue?: number): AwsFieldSchema => ({
  key, label, kind: 'integer', description, min, max, defaultValue
})
const list = (key: string, label: string, description: string, item: AwsFieldSchema, extra: Partial<AwsFieldSchema> = {}): AwsFieldSchema => ({
  key, label, kind: 'list', description, item, ...extra
})

const region = s('region', 'Region', 'The AWS region to query or mutate.', { required: true, maxLength: 64, picker: 'region' })
const bucket = s('bucket', 'Bucket', 'The exact S3 bucket name.', { required: true, maxLength: 63 })
const key = s('key', 'Object key', 'The exact object key inside the bucket.', { required: true, maxLength: 1024 })
const instanceIds = list('instanceIds', 'Instance IDs', 'The EC2 instances affected by this operation.', s('instanceId', 'Instance ID', 'An EC2 instance identifier.', { maxLength: 32 }), { required: true })
const functionName = s('functionName', 'Function', 'The Lambda function name or ARN.', { required: true, maxLength: 256 })

function operation(input: Omit<AwsOperationSchema, 'portableIntent'> & { portableIntent?: AwsOperationSchema['portableIntent'] }): AwsOperationSchema {
  return {
    ...input,
    portableIntent: input.portableIntent ?? {
      allowedFields: input.input.filter((field) => !field.sensitive && field.kind !== 'file').map((field) => field.key),
      omittedFields: input.input.filter((field) => field.sensitive || field.kind === 'file').map((field) => field.key)
    }
  }
}

const s3: AwsManagerDescriptor = {
  service: 's3', label: 'S3 manager',
  description: 'Browse buckets and objects, transfer files, and review destructive changes before they run.',
  searchTerms: ['object storage', 'bucket', 'object', 'upload', 'download'],
  operations: [
    operation({ id: 's3.listBuckets', service: 's3', label: 'List buckets', description: 'List buckets visible to the selected identity.', input: [], output: [s('buckets', 'Buckets', 'Returned bucket summaries.', { kind: 'list', item: s('bucket', 'Bucket', 'Bucket summary.') })], requiredPermissions: ['s3:ListAllMyBuckets'], destructive: false, supportsBulk: false }),
    operation({ id: 's3.listObjectsV2', service: 's3', label: 'List objects', description: 'Browse objects with bounded, resumable pagination.', input: [bucket, s('prefix', 'Prefix', 'Only show keys beginning with this prefix.', { maxLength: 1024 }), i('maxKeys', 'Page size', 'Maximum objects requested per page.', 1, 1000, 1000), region], output: [s('contents', 'Objects', 'Object summaries.')], pagination: { inputToken: 'continuationToken', outputToken: 'nextContinuationToken', pageSizeKey: 'maxKeys', maxPages: 1000 }, requiredPermissions: ['s3:ListBucket'], destructive: false, supportsBulk: true }),
    operation({ id: 's3.getObject', service: 's3', label: 'Download object', description: 'Read one object through the approved local file destination picker.', input: [bucket, key, s('destination', 'Destination file', 'A user-selected local destination.', { kind: 'file', required: true, picker: 'file' }), region], output: [s('body', 'Object body', 'The downloaded object stream.')], requiredPermissions: ['s3:GetObject'], destructive: false, supportsBulk: true, stream: { eventMember: 'body', maxRecords: 1, maxRecordBytes: 512 * 1024 * 1024 } }),
    operation({ id: 's3.putObject', service: 's3', label: 'Upload object', description: 'Upload a selected local file without exposing its path in portable state.', input: [bucket, key, s('source', 'Source file', 'A user-selected local source file.', { kind: 'file', required: true, picker: 'file' }), region], output: [s('etag', 'ETag', 'The service response ETag.')], requiredPermissions: ['s3:PutObject'], destructive: false, supportsBulk: true }),
    operation({ id: 's3.deleteObject', service: 's3', label: 'Delete object', description: 'Delete one object after an explicit affected-object preview.', input: [bucket, key, region], output: [], requiredPermissions: ['s3:DeleteObject'], destructive: true, supportsBulk: false }),
    operation({ id: 's3.deleteObjects', service: 's3', label: 'Delete objects', description: 'Delete selected objects as one reviewed bulk action.', input: [bucket, list('keys', 'Object keys', 'The exact keys to delete.', key, { required: true }), region], output: [s('deleted', 'Deleted objects', 'Objects confirmed deleted.')], requiredPermissions: ['s3:DeleteObject'], destructive: true, supportsBulk: true })
  ]
}

const ec2: AwsManagerDescriptor = {
  service: 'ec2', label: 'EC2 manager', description: 'Inspect instances and run reviewed lifecycle actions.', searchTerms: ['instances', 'virtual machines', 'start', 'stop', 'terminate'],
  operations: [
    operation({ id: 'ec2.describeInstances', service: 'ec2', label: 'Describe instances', description: 'List instances with pagination and status details.', input: [region, list('filters', 'Filters', 'Optional instance filters.', s('filter', 'Filter', 'A validated EC2 filter.', { kind: 'object', fields: [s('name', 'Name', 'Filter name.'), s('values', 'Values', 'Filter values.')]}))], output: [s('reservations', 'Reservations', 'Returned reservations.')], pagination: { inputToken: 'nextToken', outputToken: 'nextToken', pageSizeKey: 'maxResults', maxPages: 1000 }, requiredPermissions: ['ec2:DescribeInstances'], destructive: false, supportsBulk: false }),
    operation({ id: 'ec2.startInstances', service: 'ec2', label: 'Start instances', description: 'Start selected stopped instances.', input: [instanceIds, region], output: [s('starting', 'Starting instances', 'Instances entering pending state.')], requiredPermissions: ['ec2:StartInstances'], destructive: false, supportsBulk: true, waiter: { name: 'instance-running', acceptors: [{ state: 'success', matcher: 'pathAll', argument: 'Reservations[].Instances[].State.Name', expected: 'running' }, { state: 'retry', matcher: 'pathAny', argument: 'Reservations[].Instances[].State.Name', expected: 'pending' }], delayMs: 5000, maxAttempts: 60 }),
    operation({ id: 'ec2.stopInstances', service: 'ec2', label: 'Stop instances', description: 'Stop selected instances after showing the exact affected IDs.', input: [instanceIds, b('hibernate', 'Hibernate', 'Request hibernation when supported.', false), region], output: [s('stopping', 'Stopping instances', 'Instances entering stopping state.')], requiredPermissions: ['ec2:StopInstances'], destructive: true, supportsBulk: true, waiter: { name: 'instance-stopped', acceptors: [{ state: 'success', matcher: 'pathAll', argument: 'Reservations[].Instances[].State.Name', expected: 'stopped' }], delayMs: 5000, maxAttempts: 60 }),
    operation({ id: 'ec2.terminateInstances', service: 'ec2', label: 'Terminate instances', description: 'Permanently terminate selected instances after a destructive preview.', input: [instanceIds, region], output: [s('terminating', 'Terminating instances', 'Instances entering shutting-down state.')], requiredPermissions: ['ec2:TerminateInstances'], destructive: true, supportsBulk: true }),
    operation({ id: 'ec2.rebootInstances', service: 'ec2', label: 'Reboot instances', description: 'Reboot selected instances.', input: [instanceIds, b('force', 'Force reboot', 'Force when a graceful reboot is not possible.', false), region], output: [], requiredPermissions: ['ec2:RebootInstances'], destructive: false, supportsBulk: true })
  ]
}

const iam: AwsManagerDescriptor = {
  service: 'iam', label: 'IAM manager', description: 'Review identities and policies with permission-aware controls.', searchTerms: ['users', 'roles', 'policies', 'identity', 'access'],
  operations: [
    operation({ id: 'iam.listUsers', service: 'iam', label: 'List users', description: 'List IAM users with pagination.', input: [i('maxItems', 'Page size', 'Maximum users per page.', 1, 1000, 1000)], output: [s('users', 'Users', 'IAM user summaries.')], pagination: { inputToken: 'Marker', outputToken: 'Marker', pageSizeKey: 'MaxItems', maxPages: 1000 }, requiredPermissions: ['iam:ListUsers'], destructive: false, supportsBulk: false }),
    operation({ id: 'iam.listRoles', service: 'iam', label: 'List roles', description: 'List IAM roles with pagination.', input: [i('maxItems', 'Page size', 'Maximum roles per page.', 1, 1000, 1000)], output: [s('roles', 'Roles', 'IAM role summaries.')], pagination: { inputToken: 'Marker', outputToken: 'Marker', pageSizeKey: 'MaxItems', maxPages: 1000 }, requiredPermissions: ['iam:ListRoles'], destructive: false, supportsBulk: false }),
    operation({ id: 'iam.getPolicy', service: 'iam', label: 'Get policy', description: 'Inspect one policy version.', input: [s('policyArn', 'Policy ARN', 'The exact policy ARN.', { required: true, maxLength: 2048 })], output: [s('policy', 'Policy', 'Policy metadata and document.')], requiredPermissions: ['iam:GetPolicy', 'iam:GetPolicyVersion'], destructive: false, supportsBulk: false }),
    operation({ id: 'iam.createUser', service: 'iam', label: 'Create user', description: 'Create an IAM user from a reviewed name.', input: [s('userName', 'User name', 'A validated IAM user name.', { required: true, maxLength: 64, pattern: '^[A-Za-z0-9+=,.@_-]+$' })], output: [s('user', 'User', 'Created user metadata.')], requiredPermissions: ['iam:CreateUser'], destructive: false, supportsBulk: false }),
    operation({ id: 'iam.deleteUser', service: 'iam', label: 'Delete user', description: 'Delete a user after showing the exact identity and dependencies that remain.', input: [s('userName', 'User name', 'The exact IAM user name.', { required: true, maxLength: 64 })], output: [], requiredPermissions: ['iam:DeleteUser'], destructive: true, supportsBulk: false })
  ]
}

const sts: AwsManagerDescriptor = {
  service: 'sts', label: 'STS manager', description: 'Show the verified caller identity and review role assumptions.', searchTerms: ['caller identity', 'account', 'role', 'session'], operations: [
    operation({ id: 'sts.getCallerIdentity', service: 'sts', label: 'Get caller identity', description: 'Show the account, ARN, and user ID returned by STS.', input: [], output: [s('account', 'Account', 'AWS account identifier.'), s('arn', 'ARN', 'Caller ARN.'), s('userId', 'User ID', 'Caller user ID.')], requiredPermissions: [], destructive: false, supportsBulk: false }),
    operation({ id: 'sts.assumeRole', service: 'sts', label: 'Assume role', description: 'Request a bounded role session without persisting credentials.', input: [s('roleArn', 'Role ARN', 'The target role ARN.', { required: true, maxLength: 2048 }), s('roleSessionName', 'Session name', 'A descriptive session name.', { required: true, maxLength: 64, pattern: '^[A-Za-z0-9+=,.@_-]+$' }), i('durationSeconds', 'Duration', 'Requested session duration.', 900, 43200, 3600), s('externalId', 'External ID', 'Optional external ID from the local credential flow.', { maxLength: 1024, sensitive: true })], output: [s('credentials', 'Credentials', 'Credentials remain in the vault and are never returned to portable state.')], requiredPermissions: ['sts:AssumeRole'], destructive: false, supportsBulk: false, portableIntent: { allowedFields: ['roleArn', 'roleSessionName', 'durationSeconds'], omittedFields: ['externalId', 'credentials'] } })
  ]
}

const lambda: AwsManagerDescriptor = {
  service: 'lambda', label: 'Lambda manager', description: 'Inspect, invoke, update, and delete functions through typed controls.', searchTerms: ['functions', 'invoke', 'runtime', 'code'], operations: [
    operation({ id: 'lambda.listFunctions', service: 'lambda', label: 'List functions', description: 'List Lambda functions with pagination.', input: [region, i('maxItems', 'Page size', 'Maximum functions per page.', 1, 10000, 50)], output: [s('functions', 'Functions', 'Lambda function configurations.')], pagination: { inputToken: 'Marker', outputToken: 'NextMarker', pageSizeKey: 'MaxItems', maxPages: 1000 }, requiredPermissions: ['lambda:ListFunctions'], destructive: false, supportsBulk: false }),
    operation({ id: 'lambda.invoke', service: 'lambda', label: 'Invoke function', description: 'Invoke a function with an optional bounded JSON payload.', input: [functionName, e('invocationType', 'Invocation type', 'Synchronous or asynchronous invocation.', ['RequestResponse', 'Event', 'DryRun'], { required: true, defaultValue: 'RequestResponse' }), s('payload', 'JSON payload', 'Optional invocation JSON, validated before send.', { kind: 'json', maxLength: 6 * 1024 * 1024 }), region], output: [s('payload', 'Response payload', 'The bounded function response.')], stream: { eventMember: 'payload', maxRecords: 1, maxRecordBytes: 6 * 1024 * 1024 }, requiredPermissions: ['lambda:InvokeFunction'], destructive: false, supportsBulk: false }),
    operation({ id: 'lambda.updateFunctionCode', service: 'lambda', label: 'Update function code', description: 'Publish selected source code or image settings after a review.', input: [functionName, s('sourceFile', 'Deployment package', 'A user-selected deployment package.', { kind: 'file', required: true, picker: 'file' }), b('publish', 'Publish', 'Publish a new version after upload.', true), region], output: [s('configuration', 'Configuration', 'Updated function configuration.')], requiredPermissions: ['lambda:UpdateFunctionCode'], destructive: false, supportsBulk: false, waiter: { name: 'function-updated', acceptors: [{ state: 'success', matcher: 'status', expected: 200 }], delayMs: 2000, maxAttempts: 60 }),
    operation({ id: 'lambda.deleteFunction', service: 'lambda', label: 'Delete function', description: 'Delete one function after a destructive preview.', input: [functionName, region], output: [], requiredPermissions: ['lambda:DeleteFunction'], destructive: true, supportsBulk: false })
  ]
}

const cloudwatch: AwsManagerDescriptor = {
  service: 'cloudwatch', label: 'CloudWatch manager', description: 'Explore metrics and manage alarms with typed dimensions and periods.', searchTerms: ['metrics', 'alarms', 'dashboard', 'monitoring'], operations: [
    operation({ id: 'cloudwatch.listMetrics', service: 'cloudwatch', label: 'List metrics', description: 'List matching metrics with pagination.', input: [s('namespace', 'Namespace', 'Metric namespace.', { maxLength: 255 }), s('metricName', 'Metric name', 'Metric name filter.', { maxLength: 255 }), s('dimensions', 'Dimensions', 'Optional dimension map.', { kind: 'map', item: s('dimension', 'Dimension', 'Dimension value.') }), region], output: [s('metrics', 'Metrics', 'Metric descriptors.')], pagination: { inputToken: 'NextToken', outputToken: 'NextToken', maxPages: 1000 }, requiredPermissions: ['cloudwatch:ListMetrics'], destructive: false, supportsBulk: false }),
    operation({ id: 'cloudwatch.getMetricData', service: 'cloudwatch', label: 'Get metric data', description: 'Read bounded metric data for a selected time window.', input: [s('metricDataQueries', 'Metric queries', 'Repeatable metric query definitions.', { kind: 'list', item: s('query', 'Query', 'Metric query.', { kind: 'object' }), required: true }), s('startTime', 'Start time', 'Inclusive ISO date and time.', { kind: 'date-time', required: true }), s('endTime', 'End time', 'Exclusive ISO date and time.', { kind: 'date-time', required: true }), i('scanBy', 'Page size', 'Bounded result size.', 1, 100800, 100800), region], output: [s('metricDataResults', 'Results', 'Metric data results.')], pagination: { inputToken: 'NextToken', outputToken: 'NextToken', maxPages: 1000 }, requiredPermissions: ['cloudwatch:GetMetricData'], destructive: false, supportsBulk: false }),
    operation({ id: 'cloudwatch.putMetricAlarm', service: 'cloudwatch', label: 'Put metric alarm', description: 'Create or update an alarm from a typed definition.', input: [s('alarmName', 'Alarm name', 'A unique alarm name.', { required: true, maxLength: 255 }), s('alarmDefinition', 'Alarm definition', 'Typed alarm properties.', { kind: 'object', required: true }), region], output: [], requiredPermissions: ['cloudwatch:PutMetricAlarm'], destructive: false, supportsBulk: false }),
    operation({ id: 'cloudwatch.deleteAlarms', service: 'cloudwatch', label: 'Delete alarms', description: 'Delete selected alarms after previewing their names.', input: [list('alarmNames', 'Alarm names', 'The exact alarm names to delete.', s('alarmName', 'Alarm name', 'Alarm name.', { maxLength: 255 }), { required: true }), region], output: [], requiredPermissions: ['cloudwatch:DeleteAlarms'], destructive: true, supportsBulk: true })
  ]
}

const logs: AwsManagerDescriptor = {
  service: 'logs', label: 'Logs manager', description: 'Browse log groups, filter events, and tail streams with bounded cancellation.', searchTerms: ['logs', 'log groups', 'events', 'tail'], operations: [
    operation({ id: 'logs.describeLogGroups', service: 'logs', label: 'Describe log groups', description: 'List log groups with pagination.', input: [s('prefix', 'Prefix', 'Optional log group prefix.', { maxLength: 512 }), region], output: [s('logGroups', 'Log groups', 'Log group summaries.')], pagination: { inputToken: 'nextToken', outputToken: 'nextToken', maxPages: 1000 }, requiredPermissions: ['logs:DescribeLogGroups'], destructive: false, supportsBulk: false }),
    operation({ id: 'logs.filterLogEvents', service: 'logs', label: 'Filter log events', description: 'Read matching events with a bounded page and time range.', input: [s('logGroupName', 'Log group', 'The exact log group name.', { required: true, maxLength: 512, picker: 'resource' }), s('filterPattern', 'Filter pattern', 'CloudWatch Logs filter pattern.', { maxLength: 1024 }), s('startTime', 'Start time', 'Inclusive epoch milliseconds.', { kind: 'integer', min: 0, max: 8640000000000000 }), s('endTime', 'End time', 'Exclusive epoch milliseconds.', { kind: 'integer', min: 0, max: 8640000000000000 }), region], output: [s('events', 'Events', 'Filtered log events.')], pagination: { inputToken: 'nextToken', outputToken: 'nextToken', maxPages: 1000 }, requiredPermissions: ['logs:FilterLogEvents'], destructive: false, supportsBulk: false, stream: { eventMember: 'events', maxRecords: 100000, maxRecordBytes: 1024 * 1024 } }),
    operation({ id: 'logs.tailLogGroup', service: 'logs', label: 'Tail log group', description: 'Stream new log events until cancelled by the user.', input: [s('logGroupName', 'Log group', 'The exact log group name.', { required: true, maxLength: 512, picker: 'resource' }), s('filterPattern', 'Filter pattern', 'Optional filter pattern.', { maxLength: 1024 }), region], output: [s('events', 'Events', 'Streamed log events.')], requiredPermissions: ['logs:FilterLogEvents'], destructive: false, supportsBulk: false, stream: { eventMember: 'events', maxRecords: 10000, maxRecordBytes: 1024 * 1024 } }),
    operation({ id: 'logs.deleteLogGroup', service: 'logs', label: 'Delete log group', description: 'Delete one log group after a destructive preview.', input: [s('logGroupName', 'Log group', 'The exact log group name.', { required: true, maxLength: 512 }), region], output: [], requiredPermissions: ['logs:DeleteLogGroup'], destructive: true, supportsBulk: false })
  ]
}

export const AWS_MANAGER_CATALOG: readonly AwsManagerDescriptor[] = [s3, ec2, iam, sts, lambda, cloudwatch, logs]

export function findAwsOperation(operationId: string): AwsOperationSchema | undefined {
  for (const manager of AWS_MANAGER_CATALOG) {
    const found = manager.operations.find((operation) => operation.id === operationId)
    if (found) return found
  }
  return undefined
}
