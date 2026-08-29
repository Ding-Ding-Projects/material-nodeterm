# Claude skill visibility

Settings → Claude skills shows metadata-only discovery for local, managed-account, and connected
remote Claude configuration scopes. Available, missing, and unavailable states stay distinct. The
catalogue never reads or transmits SKILL.md contents, credentials, provider sessions, transcripts,
or absolute machine paths.

## Search and refresh

The panel has plain-text search and an adjacent anchored full regex builder. Searching a scope
matches its label, relative location, state, and diagnosis. Searching a skill matches its validated
folder name and state. Refresh reads current local scopes and connected remote scopes without
opening any skill document.

## Verification boundary

Implementation lives in `src/core/claude-skills.ts`, `src/main/index.ts`,
`src/main/remote-ssh/ssh-project.ts`, `src/server/handlers/index.ts`, and
`src/renderer/components/settings/sections/ClaudeSkillsSection.tsx`. The metadata boundary is
deliberate: the panel reports whether a skill can be found, never what its provider-authored file
contains.

## Suggested articles

- [Agent support](./agent-support.md)
- [Remote and SSH projects](../remote/README.md)
- [Local history](../../local-history.md)
