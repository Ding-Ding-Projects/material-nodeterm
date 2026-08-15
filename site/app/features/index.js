// site/app/features/index.js
//
// Placeholder entry point — owned by the site-content lane, not this one.
// This file exists only so site/index.html's <script type="module"
// src="./app/features/index.js"> never 404s before that lane fills it in.
//
// The contract: import { registerTab, registerSetting, registerCommand }
// from "../core/registry.js" and call them; the shell (tabs.js,
// settings.js, palette.js) picks up whatever is registered here
// automatically, including registrations that arrive after this module
// has already loaded (e.g. behind a further async import).
export {}
