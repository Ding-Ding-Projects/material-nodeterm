# AWS identity manager

The AWS identity manager is a guided node for selecting a profile that is already configured on the
host. It keeps the project portable by writing only safe intent to the shared project projection.
Profile names, provider sessions, credentials, MFA codes, local paths, and process state remain on
the host that owns the node.

## Reachability and behavior

Create **AWS identity manager** from the AWS Universe Shop or from the Managers menu. The AWS
Universe Shop now exposes this node as an available, scope-bound entry. The rendered node is
registered in the canvas node-type map and displays the identity manager directly in its body.

The manager scans the standard AWS config and shared credentials files through the host-owned core
service. It reads profile section names and bounded non-secret metadata only. A missing pair of files
is an explicit empty state, and an unreadable or oversized file is an unavailable state with a
recovery message.

The profile picker, region picker, AWS-service endpoint picker, and saved-endpoint list each have a
local plain-text search field plus an adjacent anchored regular-expression builder. Invalid patterns
remain visible as an honest search error instead of deleting the available choices.

## SSO, roles, and MFA

IAM Identity Center profiles show their validated start URL when one is present and display the fixed
`aws sso login --profile <name>` argument plan. The host-owned action runs that fixed argument vector,
opens the normal AWS sign-in flow, and reports only queued, running, completed, cancelled, or failed
state. SSO session state and browser credentials are never stored in the canvas.

Profiles with `role_arn` show role-assumption metadata and a fixed `aws sts assume-role` preview. The
preview never returns temporary credentials. The portable requirement switch records only whether
role assumption is required, while the selected profile remains a host-local binding.

Profiles with `mfa_serial` expose an MFA requirement switch. No MFA code is accepted, persisted,
exported, logged, or returned by the identity manager. The AWS CLI remains responsible for its own
interactive MFA prompt when a later host-owned operation runs.

## Regions and endpoint overrides

The region list is an explicit bounded catalog covering commercial, government, China, and isolated
AWS region forms, combined with any valid region discovered in local profile metadata. A selected
region is safe portable intent only when it is not tied to a credential or host path.

Endpoint overrides are local and service-scoped. The manager accepts HTTPS endpoints and loopback
HTTP endpoints for approved local emulators. It rejects unsupported schemes, embedded usernames or
passwords, fragments, control characters, duplicate service entries, and oversized values. Removing
an override returns that service to its standard AWS endpoint.

## Portability and duplication

The portable projection keeps `awsIdentityIntent`, including schema version, mode, preferred region,
MFA requirement, role requirement, and endpoint service names. The machine-local overlay keeps the
selected profile, region override, endpoint URLs, and verification timestamp. Import performs no AWS
call and opens with an explicit local profile rebinding path.

Duplicating an AWS identity node keeps safe intent but clears the local profile binding. The new node
therefore cannot silently reuse another node's host identity.

## Host action boundary

The identity discovery route and fixed action runner are registered on the desktop host and Server
Edition through the shared core platform seam. The AWS CLI dependency is the immutable `aws-cli-v2`
catalog entry. SSO login, caller identity verification, and assumed-role verification use a bounded,
cancellable host-owned process with fixed arguments. No renderer field can provide a shell command,
executable path, arbitrary argument vector, credential, token, session value, or MFA value.

## Failure modes and recovery

- No local AWS files: configure a profile using the AWS CLI's normal local configuration flow, then
  choose **Rescan profiles**.
- Unreadable or oversized config: the manager reports the file-read failure and leaves the previous
  binding unchanged.
- A profile removed after binding: the node reports **profile missing** and offers the local rebind
  path rather than selecting a different profile.
- Invalid local binding: the node reports the binding as invalid and requires choosing a profile
  again.
- Missing AWS CLI operation runner: fixed SSO, identity, and role actions remain visibly unavailable
  with that exact boundary. The UI never enables a fake action.

## Verification boundary

This implementation lane intentionally did not run tests, type checks, lint, builds, packaging,
installer execution, runtime interaction, accessibility checks, security checks, reviews, or UI
captures. The commits prove source integration and the pushed feature branch only. Those checks must
run against the exact candidate commit during coordinating integration.

## Suggested articles

- [AWS Universe portal](../canvas/aws-universe.md)
- [Special-universe Shop nodes](aws-universe-shop.md)
- [AWS CLI v2](../dependencies/aws-cli-v2.md)
- [AWS CLI model documentation](aws-cli-model-documentation.md)
- [Portable schema 3](../projects/portable-schema3.md)
