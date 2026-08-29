// site/app/features/cloudflare.js
//
// Site equivalent for the Cloudflare manager. A static page cannot safely reach a visitor's
// provider account, so this room documents the bounded desktop/Server Edition controls and keeps
// an explicit no-network boundary instead of presenting a fake connected dashboard.

import { registerRoom } from '../core/engine.js'
import { REPO_URL } from '../shared/data.js'

export function registerCloudflare(store, deps, registerAction, registerBinding) {
  registerRoom('cloudflare', {
    render: () => `<div class="two-col"><section class="card"><h2>Cloudflare manager</h2><p>Guided accounts, zones, DNS, SSL/TLS, rulesets, redirects, cache purge and analytics.</p><p class="note-box">This documentation room makes no provider request. The installed manager uses the fixed Cloudflare v4 REST API through its privileged core boundary.</p><a class="btn" href="${REPO_URL}/blob/main/docs/features/integrations/cloudflare-manager.md">Read the full manager article</a></section><section class="card"><h2>What the manager offers</h2><ul><li>Discovered account and zone pickers with pagination</li><li>Searchable DNS, ruleset and redirect lists</li><li>Typed forms, permission status and bounded rate-limit recovery</li><li>Fresh destructive previews for deletion and cache purge</li><li>Local sealed token vault and non-secret partial snapshots</li></ul></section></div>`
  })
}
