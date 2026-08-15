// site/app/features/download-demo.js
//
// The "Download demo" settings card: a honest three-step demonstration of
// the surfaces a real download catcher would show (start / progress /
// finished) — WITHOUT pretending any bytes actually moved. This is the one
// row in the big checklist marked "partial": a static page cannot hand a
// transfer to an installed browser extension, so this shows the surfaces
// and says so plainly rather than faking a real capture.

import { registerSettingsCard } from '../core/engine.js'

export function registerDownloadDemo(store, deps, registerAction, registerBinding) {
  registerAction('demo-run', (s, id, el, h) => {
    h.toast('⬇️', 'Start the download?', 'This is a pretend transfer so you can see the three steps.', 'step 1 of 3')
    setTimeout(() => h.toast('📶', 'Downloading…', 'A real capture extension would show speed and progress here.', 'step 2 of 3'), 1400)
    setTimeout(() => {
      h.toast('✅', 'Finished', 'Pretend file complete. A page like this cannot hand a transfer to an installed extension, so nothing was actually fetched.', 'step 3 of 3')
      h.notify('Download demo ran', 'Three surfaces were shown: the start decision, the progress surface, and the completion notice. No bytes were transferred — a static page cannot drive a native download manager.', 'demo')
    }, 3000)
  })

  registerSettingsCard('demo', {
    icon: '⬇️',
    title: 'Download demo',
    desc: 'Shows the three surfaces a download catcher would use: the start question, the progress window, and the finished notice.',
    note: 'Honest limit: a page on its own cannot hand a transfer to an installed browser extension, so this shows the surfaces without pretending any bytes moved.',
    controls: () => [{ label: 'Run the demo', isButton: true, action: 'demo-run', toggleLabel: 'Show me the three steps' }],
  })
}
