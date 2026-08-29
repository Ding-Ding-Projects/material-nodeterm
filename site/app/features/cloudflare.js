// site/app/features/cloudflare.js
//
// The static documentation site's Cloudflare room is a truthful control-plane explanation. The
// site cannot hold the desktop's credential store or call Cloudflare directly, so it never renders
// a fake connected state or a connector button.
import { registerListRoom } from '../core/engine.js'

export function registerCloudflare(store, deps) {
  registerListRoom('cloudflare', {
    getRows: () => [
      { id: 'inventory', title: 'Account and tunnel inventory', body: 'Accounts, zones, tunnels, connections, routes and DNS records are read by the installed app through the privileged core.', tag: 'control plane', meta: 'read-only documentation', right: '☁️' },
      { id: 'preserve', title: 'Unmanaged route preservation', body: 'Typed configuration previews carry unmanaged routes forward unchanged and block hostname conflicts before Apply.', tag: 'preview', meta: 'no blind overwrite', right: '🛡️' },
      { id: 'dns', title: 'DNS ownership proof', body: 'DNS adoption requires an existing CNAME in the selected zone pointing to a Cloudflare tunnel hostname.', tag: 'proof required', meta: 'no record replacement', right: '🔎' },
      { id: 'local', title: 'Machine-local binding', body: 'The token is presence-only in the UI. Account, zone, tunnel and hostname binding stay on the computer that owns the credential.', tag: 'local only', meta: 'connector not included', right: '📍' },
    ],
    emptyText: 'No Cloudflare documentation matches that.',
    footnote: () => 'This page documents the installed manager and cannot connect to Cloudflare or launch a connector runtime.',
    panelActions: () => [{ label: '📚 Read the Cloudflare tunnel article', run: () => deps.toast('📚', 'Cloudflare tunnels', 'Open the documentation room and choose the Cloudflare tunnel article.') }],
  })
}

