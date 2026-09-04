# AWS identity manager

The AWS identity manager is a guided, local-only surface for named AWS profiles, AWS SSO, role
assumption, MFA, caller identity, permission checks, regions, and service endpoint overrides. It
is available in Settings → AWS identity and in the command palette.

## Behaviour

The manager reads the user's AWS `config` and `credentials` files for profile metadata. It never
returns access keys, secret keys, SSO tokens, role credentials, MFA values, or the contents of a
`credential_process` response to the renderer. Static credentials are shown only as “configured”.
Profiles may also be created as local metadata overlays, which keeps the user's AWS files intact.

SSO uses the AWS CLI's supported PKCE login by default, with an explicit device-code route for
headless environments. The profile's SSO start URL and SSO region are validated before login. The
AWS CLI owns its own provider cache; nodeterm records no bearer token and exposes only the resulting
status. A successful login can be checked with Caller identity.

Role assumption accepts a validated IAM role ARN and session name. When MFA is requested, the
one-time code is written to the trusted child process's stdin and is never placed in argv, logs,
settings, exports, or project files. Temporary role expiry is surfaced as an ISO timestamp. The
manager never stores the returned credentials.

Caller identity uses STS and returns the account, ARN, user id, check time, and an honest unavailable
or failed state. Permission checks use the selected profile and IAM policy simulation for bounded,
validated action names, returning allowed, explicit deny, implicit deny, or unknown. Unknown is not
treated as allowed.

Regions come from the selected profile's `describe-regions` response when available, with a
bounded catalog as the offline fallback. Endpoint overrides are HTTPS-only and are kept in the
machine-local manager state. They never enter a portable project projection.

## Configuration and persistence

The manager reads:

- `~/.aws/config` and `~/.aws/credentials` for metadata only;
- `<application-data>/aws-manager/state.json` for user-created profile metadata and endpoint
  overrides, written with restrictive permissions;
- the AWS CLI's own SSO cache, which remains outside nodeterm's renderer and project data boundary.

The local state can be cleared from the AWS identity surface. Clearing removes only nodeterm's
metadata and endpoint overlay. It does not claim to revoke a provider session or delete the AWS
CLI's own cache.

## Credential-process trust

An imported `credential_process` is visible but untrusted. Trust is offered only when its first
token is a plain executable name without shell operators. nodeterm never accepts a shell string,
command concatenation, or arbitrary argv from project data. Trust is an explicit local metadata
choice and does not reveal or copy the process output.

## Failure modes and recovery

| Situation | Result |
| --- | --- |
| AWS CLI is absent | The operation reports unavailable; profile metadata remains usable. |
| AWS config is missing or unreadable | The list remains an honest empty or partial metadata view; it is not evidence that credentials do not exist. |
| SSO browser or device flow is cancelled | The login reports failed and leaves existing provider state untouched. |
| Role trust or MFA fails | No credentials are retained; the result names the recovery area without echoing secret material. |
| IAM simulation cannot establish a verdict | The action is `unknown`, never allowed by assumption. |
| Endpoint is not HTTPS or is malformed | It is rejected before persistence or network use. |
| Profile or region input is malformed | It is rejected inline and no state is changed. |

## Security boundary

AWS credentials and provider sessions are machine-local. They are excluded from schema 3 project
exports/imports, canvas nodes, portable settings, local history snapshots, logs, telemetry, issue
comments, and renderer state. Import performs no network call, provider mutation, process launch, or
download. The manager's child process launch uses `spawn` with `shell: false`, a fixed AWS CLI
command family, bounded output, and a restricted environment. No arbitrary command textbox exists.

This feature does not revoke AWS sessions, rotate provider credentials, or replace the AWS CLI's
credential cache. Those are explicit provider-side actions and remain outside this manager's local
metadata role.

## Verification notes

The implementation paths are `src/shared/aws.ts`, `src/core/aws/aws-profile-manager.ts`,
`src/core/aws/register-ipc.ts`, `src/renderer/components/settings/sections/AwsSection.tsx`, and
the desktop/server/preload bridge registrations. This lane intentionally did not run tests, type
checks, lint, builds, packaging, runtime interaction, or UI captures. Those checks remain required
before release evidence is claimed.

## Suggested articles

- [Global and project settings](features/global-and-project-settings.md)
- [Local history](local-history.md)
- [Scheduled settings](scheduled-settings.md)
- [Project archives](features/projects/project-history-and-archives.md)
