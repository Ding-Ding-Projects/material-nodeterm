// Remote access routes for the static Pages playground.
//
// This page is not a terminal client. The old implementation generated an SSH keypair, installed
// the public key on a desktop, then discarded both the private key and the host's pairing response
// (`agentToken` and optional relay token). It could therefore grant access without retaining any
// credential capable of using or revoking that access. Keep pairing in clients that implement the
// complete protocol; this page should point people to those clients without pretending to be one.

import { registerRoom } from '../core/engine.js'

export const IOS_APP_STORE_URL = 'https://apps.apple.com/app/nodeterm/id6790581233'
export const SERVER_EDITION_DOC_URL = new URL('../../docs/server-edition.html', import.meta.url).href

export function remoteAccessRoomHtml() {
  return `
    <section class="pair-room">
      <p>
        This playground is a local product tour, not a terminal client. It does not ask for a
        pairing code or install an SSH key. Choose a real client below so the credentials stay
        with the client that will use them.
      </p>
      <div class="pair-route-grid">
        <article class="pair-route">
          <h3>Use the browser client</h3>
          <p>
            Run Server Edition on a host you control, including its Docker image, then open that
            host's HTTPS address from this browser. The full canvas and terminal bridge run there;
            this static site never proxies or stores the session.
          </p>
          <a class="pair-btn" href="${SERVER_EDITION_DOC_URL}">Server Edition and Docker guide</a>
        </article>
        <article class="pair-route">
          <h3>Use nodeterm mobile</h3>
          <p>
            The iOS companion implements the complete desktop pairing protocol and keeps its
            private key and device tokens on the phone, where reconnect and revoke can work.
          </p>
          <a class="pair-btn" href="${IOS_APP_STORE_URL}" target="_blank" rel="noopener noreferrer">
            Get nodeterm mobile on the App Store
          </a>
        </article>
      </div>
      <p class="pair-note">
        Already running a Docker host? Open its own URL directly. Pairing a desktop and signing in
        to a self-hosted Server Edition are separate routes; neither happens inside this tour.
      </p>
    </section>`
}

export function registerPairDevice() {
  registerRoom('pair', { render: remoteAccessRoomHtml })
}
