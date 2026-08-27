// site/app/shared/data.js
//
// Static content tables ported from the imported design's component.js.
// Copy and structure are carried across verbatim where possible; the two
// deliberate divergences from the design are:
//
//   1. Every GitHub link is repointed from the upstream project (see
//      UPSTREAM_URL below) to this fork (REPO_URL below), except the
//      single "forked from" attribution link rendered by
//      app/core/render.js's room footer.
//   2. CHANGELOG is NOT the design's tiny 5-entry sample — the "What
//      changed" room reads the real, generated site/content/changelog.json
//      instead (20 historical entries with real commit SHAs plus one verified
//      current-release overlay). See app/features/changelog.js.

export const REPO_URL = 'https://github.com/Ding-Ding-Projects/material-nodeterm'
export const UPSTREAM_URL = 'https://github.com/eneskirca/nodeterm'
export const REPO_BLOB_DOCS = REPO_URL + '/blob/main/docs/features/README.md'
export const REPO_RELEASES = REPO_URL + '/releases'
export const REPO_ISSUES = REPO_URL + '/issues'
export const REPO_CHANGELOG = REPO_URL + '/blob/main/CHANGELOG.md'

export const FEATURES = [
  { id: 'nodes', icon: '🖥', color: 'var(--yellow)', title: 'Real terminals as blocks', body: 'Every block runs its own shell. Drag them, resize them, zoom out and see the whole map at once.' },
  { id: 'tmux', icon: '♻️', color: 'var(--green)', title: 'Nothing gets lost', body: 'tmux keeps your terminals — and whatever they were running — alive across restarts, even a full reboot.' },
  { id: 'projects', icon: '🗂', color: 'var(--blue)', title: 'Projects and tabs', body: 'Each project is its own canvas with its own folder. Reorder them, close them, bring them back from history.' },
  { id: 'agents', icon: '🤖', color: 'var(--pink)', title: 'Robot helpers', body: 'Claude Code, Codex, Gemini, opencode, Grok and your own CLIs — one click each, with a live status badge.' },
  { id: 'super', icon: '✦', color: 'var(--purple)', title: 'Helper superpowers', body: 'Link two helpers so they read each other, branch a conversation, or let a helper open new blocks for you.' },
  { id: 'editor', icon: '✏️', color: 'var(--orange)', title: 'Editor and diff blocks', body: 'A real code editor and a side-by-side diff sit right next to your shells. Image previews too.' },
  { id: 'git', icon: '⎇', color: 'var(--green)', title: 'Git without the fear', body: 'Stage, diff, branch, commit and push from a panel — plus one-step worktrees bound to a canvas frame.' },
  { id: 'kanban', icon: '🗃️', color: 'var(--yellow)', title: 'A board of live sessions', body: 'Every project is also a card board. The cards are the running sessions; drag them while they keep working.' },
  { id: 'ssh', icon: '📡', color: 'var(--blue)', title: 'Someone else’s computer', body: 'Open a project on a remote machine over SSH. Terminals, files, git and the board all run over there.' },
  { id: 'server', icon: '🌍', color: 'var(--pink)', title: 'Server Edition', body: 'The same canvas, self-hosted, in any browser — so you can reach your terminals from anywhere.' },
  { id: 'voice', icon: '🎙', color: 'var(--purple)', title: 'Talk to your terminal', body: 'Hold a key, say it out loud, read what it heard, then press send. Your voice never leaves the machine.' },
  { id: 'palette', icon: '✨', color: 'var(--orange)', title: 'Jump anywhere', body: 'A command box that hops to any block, project or action. Plus a file explorer and undo/redo.' },
  { id: 'update', icon: '⬆️', color: 'var(--green)', title: 'Keeps itself fresh', body: 'The app checks its own update feed and shows news right inside the window.' },
  { id: 'offline', icon: '📴', color: 'var(--blue)', title: 'Works with no internet', body: 'Projects save to a plain file next to your code, so you can share it or carry it to another machine.' },
]

export const DOCS = [
  ['Agent support', 'Claude, Codex, Gemini, opencode, Grok', 'agent-support'],
  ['Canvas & node lifecycle', 'how blocks are born and cleaned up', 'canvas-lifecycle'],
  ['Changelog viewer', 'the date picker and the commit links', 'changelog-viewer'],
  ['Dim sum surprise', 'the little treat that shows up one visit in ten', 'dim-sum-surprise'],
  ['Wild dim sum node', 'public catalog browsing and portable dish selection', 'wild-dim-sum-node'],
  ['Exports, notifications & local history', 'ten shapes, one honest warning', 'exports-and-history'],
  ['Kanban board', 'live session cards', 'kanban-board'],
  ['Language modes, funny levels & emoji', 'English, Cantonese, or both', 'language-modes'],
  ['Narrator', 'the page reads itself out loud', 'narrator'],
  ['Node kinds', 'terminal, agent, sticky, group, editor, diff, web', 'node-kinds'],
  ['Packaging & auto-update', 'how builds are made and shipped', 'packaging-updates'],
  ['Personal vocabulary', 'swap words for your own', 'personal-vocabulary'],
  ['Projects & tabs', 'one canvas per project', 'projects-and-tabs'],
  ['Remote & SSH projects', 'work on another machine', 'remote-ssh-projects'],
  ['School mode', 'plain English, locked with a PIN', 'school-mode'],
  ['Server Edition', 'self-host it in a browser', 'server-edition'],
  ['Source control & worktrees', 'a git panel, and a branch per helper', 'source-control-worktrees'],
  ['Speech / dictation', 'on-device Whisper', 'speech-dictation'],
  ['Terminal sessions & continuity', 'tmux, and the Windows session host', 'terminal-sessions'],
  ['Toy locks', 'a padlock for fun, not for safety', 'toy-locks'],
  ['Windows support', 'what works and what does not yet', 'windows-support'],
]

// A hand-picked six from the design's dumpling list, kept to exactly the
// six dishes this repo already ships an original illustration for (see
// app/features/assets/dimsum/*.svg) — the design's "Lo mai gai" has no
// illustration so it was dropped, and "turnip cake" (an existing
// illustration with no design entry) was added in its place. "Dan tat" is
// the same dish as "egg tart" (蛋撻) so it maps onto the existing SVG.
export const DISHES = [
  { id: 'har-gow', en: 'Har gow', yue: '蝦餃', body: 'A pleated shrimp dumpling with a see-through skin.' },
  { id: 'siu-mai', en: 'Siu mai', yue: '燒賣', body: 'An open-topped pork and shrimp parcel with a yellow wrapper.' },
  { id: 'char-siu-bao', en: 'Char siu bao', yue: '叉燒包', body: 'A soft white bun that cracks open around sweet roast pork.' },
  { id: 'cheung-fun', en: 'Cheung fun', yue: '腸粉', body: 'Silky rice noodle rolls under a puddle of sweet soy.' },
  { id: 'egg-tart', en: 'Egg tart (dan tat)', yue: '蛋撻', body: 'An egg tart in flaky pastry, best while it is still warm.' },
  { id: 'turnip-cake', en: 'Turnip cake', yue: '蘿蔔糕', body: 'Pan-fried radish cake, crisp outside and soft in the middle.' },
]

export const OLLAMA = [
  { id: 'llama3.2:1b', gb: 1.3, tag: 'q4_K_M', updated: '2026-06-02' },
  { id: 'llama3.2:3b', gb: 2.0, tag: 'q4_K_M', updated: '2026-06-02' },
  { id: 'qwen2.5-coder:7b', gb: 4.7, tag: 'q4_K_M', updated: '2026-05-19' },
  { id: 'mistral:7b', gb: 4.4, tag: 'q4_0', updated: '2026-04-28' },
  { id: 'gemma2:9b', gb: 5.4, tag: 'q4_K_M', updated: '2026-05-03' },
  { id: 'deepseek-r1:14b', gb: 9.0, tag: 'q4_K_M', updated: '2026-07-11' },
  { id: 'llama3.1:70b', gb: 40.0, tag: 'q4_K_M', updated: '2026-03-30' },
]

export const COVERAGE = [
  ['Three language modes + two silliness sliders', 'Settings → Words and jokes', 'done'],
  ['Search bar on every surface', 'Header, sidebar, every room, every menu, the jump box', 'done'],
  ['Regex builder anchored to every search', 'the .* button beside each field', 'done'],
  ['Right-click menus everywhere, each with its own filter', 'header, sidebar, rooms, cards, rows, settings', 'done'],
  ['Command palette on Ctrl+Shift+F that jumps to the exact thing', 'the ✨ Jump box', 'done'],
  ['Appearance: colours, presets, export, import, reset', 'Settings → How it looks', 'done'],
  ['App logo you can change, with reset', 'Settings → How it looks → Badge picture', 'done'],
  ['Toy password locks on any box, each with its own password', 'the 🔒 button on every settings box', 'done'],
  ['Built-in authenticator with pairing and live codes', 'Code maker room', 'done'],
  ['Non-blocking messages with a place to read them all', 'toasts, and the Messages room', 'done'],
  ['Bulk actions on every list with a preview before it runs', 'pick / flip picks / throw away', 'done'],
  ['Export in every shape that can carry the data', 'Take it home room — ten shapes', 'done'],
  ['Local version history you can put back', 'Time machine room', 'done'],
  ['Changelog viewer with a date picker and commit links', 'What changed room', 'done'],
  ['Scheduled settings', 'Settings → Timers', 'done'],
  ['Guided forms', 'the add rows in Code maker, and the 1·2·3 export steps', 'done'],
  ['Super-confirmation before anything destructive', 'type-the-word gate', 'done'],
  ['A real local file converter with honest unsupported cases', 'Turn-it-into lab', 'done'],
  ['Ollama browser with hardware-fit verdicts and a basket', 'Model shop room', 'done'],
  ['The dim sum surprise, one visit in ten', 'Dim sum room', 'done'],
  ['School mode that forces plain English and hides the rest', 'Settings → School mode', 'done'],
  ['Narrator that reads the page out loud', 'Settings → Read it to me', 'done'],
  ['Personal vocabulary swaps', 'Settings → My own words', 'done'],
  ['Download-capture demonstration', 'Settings → Download demo', 'partial'],
  ['Three working games that keep score', 'Playroom room', 'done'],
  ['Little sounds on every win, miss and message', 'Settings → About you → Little sounds', 'done'],
  ['A landing page that actually sells the app', 'the hallway page, under the doors', 'done'],
  ['Works on a phone from 320px, no sideways scrolling', 'the whole page', 'done'],
  ['Everything local: no CDN script, no analytics, no network calls', 'the whole page', 'partial'],
]

export const FORMATS = [
  { id: 'json', label: 'JSON', loss: '' },
  { id: 'jsonl', label: 'JSONL', loss: '' },
  { id: 'yaml', label: 'YAML', loss: '' },
  { id: 'toml', label: 'TOML', loss: '' },
  { id: 'xml', label: 'XML', loss: '' },
  { id: 'csv', label: 'CSV', loss: 'CSV is a flat grid. Nested bits get squashed into text and each value forgets whether it was a number.' },
  { id: 'tsv', label: 'TSV', loss: 'TSV is a flat grid too, and any tab inside a value has to become a space.' },
  { id: 'md', label: 'Markdown', loss: 'A Markdown table is for reading. Long values get folded onto one line and cannot be loaded back.' },
  { id: 'html', label: 'HTML', loss: 'HTML is for looking at. Turning it back into data is not something this page can promise.' },
  { id: 'sql', label: 'SQL', loss: 'Every value is written as text, so numbers and true/false come back as strings.' },
]

export const CONV_IN = [
  { id: 'json', label: 'JSON' }, { id: 'jsonl', label: 'JSON Lines' }, { id: 'yaml', label: 'YAML (simple)' },
  { id: 'csv', label: 'CSV' }, { id: 'tsv', label: 'TSV' }, { id: 'xml', label: 'XML' },
  { id: 'base64', label: 'Base64 text' }, { id: 'hex', label: 'Hex text' }, { id: 'text', label: 'Plain text' },
]
export const CONV_OUT = [
  { id: 'json', label: 'JSON' }, { id: 'jsonl', label: 'JSON Lines' }, { id: 'yaml', label: 'YAML' }, { id: 'toml', label: 'TOML' },
  { id: 'csv', label: 'CSV' }, { id: 'tsv', label: 'TSV' }, { id: 'xml', label: 'XML' }, { id: 'md', label: 'Markdown table' },
  { id: 'html', label: 'HTML table' }, { id: 'sql', label: 'SQL inserts' }, { id: 'base64', label: 'Base64 text' }, { id: 'hex', label: 'Hex text' }, { id: 'text', label: 'Plain text' },
]

export const SWATCHES = [
  ['Sunshine', '#ffd93d'], ['Bubblegum', '#ff8fc7'], ['Sky', '#4dabf7'], ['Grape', '#9775fa'], ['Lime', '#3fce7f'], ['Tangerine', '#ffa41b'],
]
export const PRESETS = {
  playground: { name: 'Playground', accent: '#ffd93d', theme: 'day' },
  bubblegum: { name: 'Bubblegum', accent: '#ff8fc7', theme: 'day' },
  rocket: { name: 'Rocket night', accent: '#9775fa', theme: 'night' },
  frog: { name: 'Frog pond', accent: '#3fce7f', theme: 'day' },
}

export const RX_TOKENS = [
  ['any letter', '\\w', 'var(--yellow)', 'One letter, digit or underscore'],
  ['any digit', '\\d', 'var(--blue)', 'One number from 0 to 9'],
  ['a space', '\\s', 'var(--green)', 'A space, a tab or a new line'],
  ['anything', '.', 'var(--pink)', 'Any single character'],
  ['1 or more', '+', 'var(--orange)', 'Repeat the thing before it at least once'],
  ['0 or more', '*', 'var(--purple)', 'Repeat the thing before it any number of times'],
  ['maybe', '?', 'var(--yellow)', 'The thing before it is optional'],
  ['starts with', '^', 'var(--blue)', 'Only match at the very beginning'],
  ['ends with', '$', 'var(--green)', 'Only match at the very end'],
  ['catch ( )', '()', 'var(--pink)', 'Catch a piece so you can see it below'],
  ['this|that', '|', 'var(--orange)', 'Match the left side or the right side'],
]

export const SECTIONS = [
  { id: 'home', icon: '🏠', label: 'Home', kicker: 'start here', title: 'The terminal playground', sub: 'Everything nodeterm can do, in plain words. Search the cards, or right-click one for more.', ph: 'Search the cards…' },
  { id: 'docs', icon: '📚', label: 'Guide book', kicker: 'read about it', title: 'The guide book', sub: 'One page per feature: what it does, how to set it up, and what happens when it goes wrong.', ph: 'Search the guide…' },
  { id: 'changelog', icon: '📝', label: 'What changed', kicker: 'newest first', title: 'What changed lately', sub: 'Real releases from the project history, each with the exact commit it was built from.', ph: 'Search the changes…' },
  { id: 'notes', icon: '🔔', label: 'Messages', kicker: 'your inbox', title: 'Messages', sub: 'Nothing here ever blocks you. Read them whenever you like and tick off the ones you are done with.', ph: 'Search messages…' },
  { id: 'history', icon: '⏳', label: 'Time machine', kicker: 'restore saved changes', title: 'The time machine', sub: 'Saved setting changes carry their prior state and can be put back. Other events stay here honestly as record-only log entries.', ph: 'Search the log…' },
  { id: 'auth', icon: '🔐', label: 'Code maker', kicker: 'six digits', title: 'The code maker', sub: 'Pair a code with a secret, then watch it change every thirty seconds. It all happens in this page.', ph: 'Search your codes…' },
  { id: 'shop', icon: '🧠', label: 'Model shop', kicker: 'browse only', title: 'The model shop', sub: 'Local Ollama models, with an honest guess at whether this computer can actually run each one.', ph: 'Search models…' },
  { id: 'convert', icon: '🧪', label: 'Turn-it-into', kicker: 'lab', title: 'The turn-it-into lab', sub: 'Drop text in one side, pick a shape, take it out the other side. All of it stays in your browser.', ph: 'Search the lab…' },
  { id: 'export', icon: '📦', label: 'Take it home', kicker: 'save a copy', title: 'Take it home', sub: 'Pick a pile, pick a shape. We warn you first if that shape cannot carry everything.', ph: 'Search the shapes…' },
  { id: 'dish', icon: '🥟', label: 'Dim sum', kicker: 'a little treat', title: 'The dim sum trolley', sub: 'One visit in ten, a dish rolls past by itself. You can also just look at the whole trolley here.', ph: 'Search the trolley…' },
  { id: 'coverage', icon: '✅', label: 'Checklist', kicker: 'nothing hidden', title: 'The big checklist', sub: 'Every promise this page makes, and exactly where it lives. Anything only half-done says so.', ph: 'Search the checklist…' },
  { id: 'shots', icon: '🖼️', label: 'Screenshots', kicker: 'the real app', title: 'What nodeterm actually looks like', sub: 'Captures of the built desktop app, taken from a running build — never a mockup. Select one to open it full size.', ph: 'Search the screenshots…' },
  { id: 'pair', icon: '📱', label: 'Remote access', kicker: 'browser or iPhone', title: 'Use nodeterm remotely', sub: 'Open a real Server Edition host in your browser, or pair with nodeterm mobile. This tour never asks for access.', ph: 'Search remote access…' },
  { id: 'play', icon: '🎮', label: 'Playroom', kicker: 'three games', title: 'The playroom', sub: 'Memory pairs, dumpling maths and whack-a-block. Every button really works, and your best score is kept.', ph: 'Search the playroom…' },
  { id: 'settings', icon: '⚙️', label: 'Settings', kicker: 'make it yours', title: 'Make it yours', sub: 'Colours, words, sound, timers, and a toy padlock for any box. Everything is saved in this browser only.', ph: 'Search settings…' },
]

export const YUE = {
  'The terminal playground': '終端遊樂場',
  'The guide book': '說明書',
  'What changed lately': '最近改咗乜',
  Messages: '訊息',
  'The time machine': '時光機',
  'The code maker': '密碼機',
  'The model shop': '模型店',
  'The turn-it-into lab': '變變實驗室',
  'Take it home': '帶返家',
  'The dim sum trolley': '點心車',
  'The big checklist': '大清單',
  'The playroom': '遊戲房',
  'Make it yours': '整成你嘅',
  'Everything nodeterm can do, in plain words. Search the cards, or right-click one for more.': 'nodeterm 做得到嘅一切，用簡單字講。搵下卡片，或者右鍵睇多啲。',
  'One page per feature: what it does, how to set it up, and what happens when it goes wrong.': '每個功能一頁：做乜、點設定、出錯時會點。',
  'Real releases from the project history, each with the exact commit it was built from.': '真實嘅版本記錄，每個都有對應嘅 commit。',
  'Nothing here ever blocks you. Read them whenever you like and tick off the ones you are done with.': '呢啲訊息唔會擋住你。想睇就睇，睇完打勾。',
  'Saved setting changes carry their prior state and can be put back. Other events stay here honestly as record-only log entries.': '已儲存嘅設定改動會保留之前狀態，可以還原；其他事件會老實標示為只供查看嘅記錄。',
  'Pair a code with a secret, then watch it change every thirty seconds. It all happens in this page.': '配對一個密碼，每三十秒變一次，全部在呢一頁完成。',
  'Local Ollama models, with an honest guess at whether this computer can actually run each one.': '本機 Ollama 模型，並老實估下部機跑唔跑得起。',
  'Drop text in one side, pick a shape, take it out the other side. All of it stays in your browser.': '一邊放文字，揀個格式，另一邊取出。全部留在你嘅瀏覽器。',
  'Pick a pile, pick a shape. We warn you first if that shape cannot carry everything.': '揀一堆資料，揀個格式。如果個格式載唔齊，我們會先講。',
  'One visit in ten, a dish rolls past by itself. You can also just look at the whole trolley here.': '十次入嚟有一次會有點心經過。你都可以在呢度睇齊整車。',
  'Every promise this page makes, and exactly where it lives. Anything only half-done says so.': '呢一頁嘅每個承諾同佢住喺邊。做一半嘅都會照講。',
  'Use nodeterm remotely': '遠程使用 nodeterm',
  'Open a real Server Edition host in your browser, or pair with nodeterm mobile. This tour never asks for access.': '用瀏覽器開啟真正嘅 Server Edition 主機，或者用 nodeterm mobile 配對。呢個導覽不會要求存取權。',
  'Memory pairs, dumpling maths and whack-a-block. Every button really works, and your best score is kept.': '記憶配對、點心數學、打地鼠。每個掣都真係work，最佳分數會留住。',
  'Colours, words, sound, timers, and a toy padlock for any box. Everything is saved in this browser only.': '顏色、文字、聲音、定時器，同每個格嘅玩具鎖。全部只存喺呢個瀏覽器。',
  'Every door opens a different room. Some rooms you can lock with your own password, and every single one has a search box and a right-click menu.': '每道門通去唔同房。有啲房可以用你自己嘅密碼鎖起，每間都有搵嘢格同右鍵菜單。',
}
