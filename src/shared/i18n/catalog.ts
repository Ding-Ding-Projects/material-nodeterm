import type { Catalog, FiveVariants } from './types'

/**
 * ============================================================================================
 * THE RULE THAT MATTERS MOST: the funny level changes VOICE, never FACTS.
 * ============================================================================================
 *
 * It applies to every category of message in this catalogue, with NO exemptions — destructive
 * actions, security prompts, accessibility copy and error text included. At any level 1-5 a
 * string must still name, in unambiguous words, what happened, what is affected, and what the
 * user's options are: which file, which account, which action is irreversible, what the error
 * actually was. Level 5 may wrap those facts in a joke; it must never REPLACE, SOFTEN or OMIT
 * them. A destructive confirm at level 5 still says "Delete" and still says what gets deleted —
 * it just says it with more character.
 *
 * Cantonese copy stays respectful at every level: humour never mocks the user, their data loss,
 * their money, or their disability. When in doubt, write the boring-but-correct version and move
 * on — a flat joke is a UI bug waiting to be filed; a dishonest one is worse.
 *
 * Placeholders: a string may contain `{token}` markers (e.g. `{version}`) that callers fill in
 * with `formatText()`/`tf()`/`tsf()` from ./resolve. Never bake a live value (a filename, a
 * version number, a count) into the catalogue text itself — that value belongs to the CALLER,
 * which is the one place that actually knows it.
 *
 * Adding a new string: pick a dotted id (`surface.element.purpose`), write five English variants
 * (level 1 plain, level 5 playful, 2-4 stepping between) and five Cantonese ones. Reusing a
 * neighbour's text across levels is fine and often correct for a plain label — the array must
 * still have five entries. See docs/language-modes.md.
 * ============================================================================================
 */

/** For a plain factual label that has no meaningful "funnier" version (a settings-nav noun, an
 *  aria-label) — repeats the same text at all five levels. Still satisfies the five-variant
 *  shape; it just declines to invent forced jokes for something that shouldn't have any. */
function flat(text: string): FiveVariants {
  return [text, text, text, text, text]
}

export const CATALOG: Catalog = {
  // ---------------------------------------------------------------------------------------
  // Settings navigation — group headings shown in the sidebar (SettingsSidebar.tsx). A group
  // heading is a category label, not a message, so it stays level-invariant.
  // ---------------------------------------------------------------------------------------
  'settings.nav.backToApp': {
    en: flat('Back to app'),
    yue: flat('返去個 App')
  },
  'settings.nav.search': {
    en: flat('Search settings'),
    yue: flat('搜尋設定')
  },
  'settings.group.ai': {
    en: flat('AI capabilities'),
    yue: flat('AI 功能')
  },
  'settings.group.workspace': {
    en: flat('Workspace'),
    yue: flat('工作空間')
  },
  'settings.group.interface': {
    en: flat('Interface'),
    yue: flat('介面')
  },
  'settings.group.connectivity': {
    en: flat('Remote & team'),
    yue: flat('遠端 & 團隊')
  },
  'settings.group.application': {
    en: flat('Application'),
    yue: flat('應用程式')
  },

  // A representative subset of section headings gets real bilingual copy. The rest still route
  // through t() (SettingsSidebar.tsx) but simply fall back to their English label — that is the
  // documented "unknown id" behaviour, not a bug: this catalogue is a living document, not a
  // one-shot conversion of every string in the app.
  'settings.section.agents': { en: flat('Agents'), yue: flat('AI 代理') },
  'settings.section.terminal': { en: flat('Terminal'), yue: flat('終端機') },
  'settings.section.appearance': { en: flat('Appearance'), yue: flat('外觀') },
  'settings.section.notifications': {
    en: flat('Notifications'),
    yue: flat('通知')
  },
  'settings.section.updates': { en: flat('Updates'), yue: flat('更新') },
  'settings.section.accounts': { en: flat('Accounts'), yue: flat('帳戶') },
  'settings.section.language': { en: flat('Language'), yue: flat('語言') },
  'settings.section.privacy': { en: flat('Privacy'), yue: flat('私隱') },

  // ---------------------------------------------------------------------------------------
  // Language settings section — this feature's own copy. Playful escalation across levels,
  // because a sentence about a joke slider is a fair place to demonstrate the joke slider.
  // ---------------------------------------------------------------------------------------
  'settings.language.description': {
    en: [
      'Choose the language nodeterm speaks to you in, and how playful each language sounds.',
      'Pick a language, then dial in how playful it sounds while you work.',
      'Set your language, then decide how much personality comes along with it.',
      'Pick your language, and how much personality it brings to the party.',
      'Pick your language, then crank the personality dial until it starts telling jokes.'
    ],
    yue: [
      '揀 nodeterm 用邊種語言同你講嘢，再揀有幾抵死。',
      '揀個語言，再調校下有幾抵死。',
      '揀語言，再決定佢有幾多性格。',
      '揀你嘅語言，再決定佢帶幾多性格嚟。',
      '揀你嘅語言，再扭盡個「抵死掣」直至佢開始講笑。'
    ]
  },
  'settings.language.mode.label': {
    en: flat('Language mode'),
    yue: flat('語言模式')
  },
  'settings.language.mode.option.en': {
    en: flat('English'),
    yue: flat('英文')
  },
  'settings.language.mode.option.yue': {
    en: flat('Cantonese'),
    yue: flat('廣東話')
  },
  'settings.language.mode.option.bilingual': {
    en: flat('Bilingual'),
    yue: flat('雙語')
  },
  'settings.language.funnyEn.label': {
    en: flat('English funny level'),
    yue: flat('英文抵死程度')
  },
  'settings.language.funnyYue.label': {
    en: flat('Cantonese funny level'),
    yue: flat('廣東話抵死程度')
  },
  'settings.language.level.1': {
    en: flat('1 — Fully professional'),
    yue: flat('1 — 正正經經')
  },
  'settings.language.level.5': {
    en: flat('5 — Maximum playfulness'),
    yue: flat('5 — 抵死到爆')
  },
  'settings.language.disclosure': {
    en: [
      'This changes the tone of every message, including errors and warnings — never the facts inside them. Change or reset it at any time.',
      'This changes the TONE of every message — errors and warnings included — never the facts. Change it whenever you like.',
      'This dials the personality on every message, errors and warnings included. The facts inside them never move. Change or reset it any time.',
      'Every message gets the personality dial — yes, even the scary red ones. The facts stay exactly the facts. Change it whenever, no hard feelings.',
      'Every single message rides this dial, including the ones that ruin your day — but the facts never budge an inch. Twist it back whenever you like.'
    ],
    yue: [
      '呢個掣會改變所有訊息（包括錯誤同警告）嘅語氣，但唔會改變當中嘅事實。可以隨時改返或重設。',
      '呢個掣改變所有訊息嘅語氣（連錯誤警告都計），事實永遠唔變。想改幾時都得。',
      '呢個掣調校所有訊息嘅性格，連嗰啲紅色警告都唔例外，事實依然一字不改。隨時可以改返。',
      '每一個訊息都食呢個掣，連整親你個心情嘅嗰啲都計——但事實一個字都唔會走樣。想扭返幾時都得，唔使不好意思。',
      '每個訊息都逃唔過呢個掣，連毀你一日嘅嗰啲都計——但事實永遠企定定唔郁。想扭返隨時得。'
    ]
  },
  'settings.language.emoji.label': {
    en: flat('Show emojis in dialogs and message boxes'),
    yue: flat('喺對話框同訊息框度顯示表情符號')
  },
  'settings.language.emoji.description': {
    en: [
      'Adds a relevant decoration to dialogs and message boxes; never appears in buttons, labels, or other control text.',
      'Adds a matching emoji to dialogs and message boxes. Buttons and labels stay emoji-free.',
      'Sprinkles a relevant emoji onto dialogs and message boxes — never on buttons or field labels.',
      'Adds a little emoji flair to dialogs and message boxes. Buttons, labels, and anything you can click stay emoji-free.',
      'Lets your dialogs and message boxes wear a tasteful emoji. Buttons and labels remain strictly emoji-free zones.'
    ],
    yue: [
      '喺對話框同訊息框加返個貼題嘅表情符號；按鈕、標籤同控制項文字唔會出現。',
      '喺對話框同訊息框加個貼題表情符號，按鈕同標籤照舊乾淨。',
      '喺對話框同訊息框灑少少表情符號，按鈕標籤永遠唔會有。',
      '俾對話框同訊息框加少少表情符號情趣，按鈕標籤同任何可以撳嘅嘢一律唔會有。',
      '等你嘅對話框同訊息框戴返個得體嘅表情符號，按鈕標籤依然係表情符號禁區。'
    ]
  },

  // ---------------------------------------------------------------------------------------
  // Unified Node Catalog. Registry rows carry stable ids and English fallbacks; this catalogue
  // supplies the live language mode and funny-level voice for the picker itself and its common
  // entries. Descriptors remain data so server and portable layers do not import UI copy.
  // ---------------------------------------------------------------------------------------
  'nodeCatalog.title': { en: flat('Node Catalog'), yue: flat('節點目錄') },
  'nodeCatalog.description': {
    en: [
      'Choose a node from the typed catalog. Safe defaults are applied now; machine-local details stay local.',
      'Pick a typed node. Safe defaults do the boring setup while local details stay put.',
      'Choose a node and let the catalog handle the sensible starting values.',
      'Pick a node from the catalog and let it do the setup dance for you.',
      'Choose a node. The catalog has brought sensible defaults and left your private machine details at home.'
    ],
    yue: [
      '喺有類型嘅目錄揀個節點。安全預設值即刻套用，本機資料留返本機。',
      '揀個節點，安全預設值幫你做啲悶嘢，本機資料照留本機。',
      '揀個節點，目錄會處理好合理嘅起步設定。',
      '喺目錄揀個節點，等佢幫你跳一跳設定舞。',
      '揀個節點啦。合理預設值已經帶到，本機私事就留喺屋企。'
    ]
  },
  'nodeCatalog.search.label': { en: flat('Search node catalog'), yue: flat('搜尋節點目錄') },
  'nodeCatalog.categories': { en: flat('Node categories'), yue: flat('節點分類') },
  'nodeCatalog.results': { en: flat('Node catalog results'), yue: flat('節點目錄結果') },
  'nodeCatalog.docs': { en: flat('Documentation'), yue: flat('文件') },
  'nodeCatalog.results.count': { en: flat('{count} nodes shown'), yue: flat('顯示 {count} 個節點') },
  'nodeCatalog.mode.required': { en: flat('Ready when required capabilities are available'), yue: flat('所需功能齊就可以用') },
  'nodeCatalog.mode.configureLater': { en: flat('Configure later'), yue: flat('稍後設定') },
  'nodeCatalog.category.all': { en: flat('All'), yue: flat('全部') },
  'nodeCatalog.category.terminals': { en: flat('Terminals'), yue: flat('終端機') },
  'nodeCatalog.category.agents': { en: flat('Agents'), yue: flat('AI 代理') },
  'nodeCatalog.category.canvas': { en: flat('Canvas'), yue: flat('畫布') },
  'nodeCatalog.category.files': { en: flat('Files'), yue: flat('檔案') },
  'nodeCatalog.category.media': { en: flat('Media'), yue: flat('媒體') },
  'nodeCatalog.category.managers': { en: flat('Managers'), yue: flat('管理器') },
  'nodeCatalog.category.automation': { en: flat('Automation'), yue: flat('自動化') },
  'nodeCatalog.category.tools': { en: flat('Tools'), yue: flat('工具') },
  'nodeCatalog.category.universes': { en: flat('Universes'), yue: flat('宇宙') },
  'nodeCatalog.category.hosting': { en: flat('Hosting'), yue: flat('託管') },
  'nodeCatalog.empty': {
    en: [
      'No nodes match this search. Try plain text or open the regex builder for a pattern.',
      'Nothing matches yet. Try a simpler search or build a regex.',
      'No catalog row survived that search. The regex builder is ready if you want it.',
      'The catalog found zilch. Try another phrase, or let the regex builder wear the thinking cap.',
      'No node made it through that search. Give the regex builder a turn; it enjoys a puzzle.'
    ],
    yue: [
      '冇節點符合呢個搜尋。試下普通文字，或者開正則建立器整個模式。',
      '暫時冇嘢啱。試下簡單啲，或者砌個正則。',
      '呢次搜尋冇目錄項目留低，正則建立器隨時候命。',
      '目錄搵唔到半粒。換句話，或者叫正則建立器戴頂思考帽。',
      '冇節點捱得過呢次搜尋。俾正則建立器玩下謎題啦。'
    ]
  },
  'nodeCatalog.keyboardHint': {
    en: flat('Use Up and Down to choose, Enter to create, and Escape to clear or close. Disabled rows explain what to do next.'),
    yue: flat('用上下揀選，Enter 建立，Escape 清除或關閉。停用項目會講埋下一步點做。')
  },
  'nodeCatalog.entry.terminal.label': { en: flat('Terminal'), yue: flat('終端機') },
  'nodeCatalog.entry.terminal.description': { en: flat('Open a real shell with the saved safe profile.'), yue: flat('用已儲存嘅安全設定開真正嘅終端機。') },
  'nodeCatalog.entry.sticky.label': { en: flat('Sticky note'), yue: flat('便利貼') },
  'nodeCatalog.entry.sticky.description': { en: flat('Add an editable note that can carry project context.'), yue: flat('加張可以編輯、用嚟記低項目背景嘅筆記。') },
  'nodeCatalog.entry.group.label': { en: flat('Group frame'), yue: flat('群組框') },
  'nodeCatalog.entry.group.description': { en: flat('Add an empty frame for organizing related nodes.'), yue: flat('加個空框，整理相關節點。') },
  'nodeCatalog.entry.annotation.label': { en: flat('Drawing annotation'), yue: flat('繪圖註解') },
  'nodeCatalog.entry.annotation.description': { en: flat('Arm the drawing tool, then drag a line or arrow on the canvas.'), yue: flat('啟用繪圖工具，再喺畫布拖出直線或箭嘴。') },
  'nodeCatalog.entry.browser.label': { en: flat('Browser'), yue: flat('瀏覽器') },
  'nodeCatalog.entry.browser.description': { en: flat('Open a browser node with a blank address bar.'), yue: flat('開個有空白網址列嘅瀏覽器節點。') },
  'nodeCatalog.entry.authenticator.label': { en: flat('Authenticator'), yue: flat('驗證器') },
  'nodeCatalog.entry.authenticator.description': { en: flat('Open the local TOTP authenticator without moving secrets into the project.'), yue: flat('開本機 TOTP 驗證器，唔會將秘密搬入項目。') },
  'nodeCatalog.entry.loop.label': { en: flat('Loop'), yue: flat('循環排程') },
  'nodeCatalog.entry.loop.description': { en: flat('Create a paused local schedule with an explicit next action.'), yue: flat('建立一個暫停中、下一步清清楚楚嘅本機排程。') },
  'nodeCatalog.entry.dino.label': { en: flat('Dino game'), yue: flat('恐龍遊戲') },
  'nodeCatalog.entry.dino.description': { en: flat('Open the small local canvas game.'), yue: flat('開個細細嘅本機畫布遊戲。') },
  'nodeCatalog.entry.remote-terminal.label': { en: flat('Remote terminal'), yue: flat('遠端終端機') },
  'nodeCatalog.entry.remote-terminal.description': { en: flat('Open a terminal through a selected saved remote connection.'), yue: flat('透過揀好嘅遠端連線開終端機。') },
  'nodeCatalog.entry.agent.claude.label': { en: flat('Claude'), yue: flat('Claude') },
  'nodeCatalog.entry.agent.claude.description': { en: flat('Start an agent session with the active account and permission plan.'), yue: flat('用目前帳戶同權限方案開始 AI 代理工作階段。') },
  'nodeCatalog.entry.agent.codex.label': { en: flat('Codex'), yue: flat('Codex') },
  'nodeCatalog.entry.agent.codex.description': { en: flat('Start a Codex agent session using a selectable local account.'), yue: flat('用可選嘅本機帳戶開始 Codex 代理工作階段。') },
  'nodeCatalog.entry.agent.gemini.label': { en: flat('Gemini'), yue: flat('Gemini') },
  'nodeCatalog.entry.agent.gemini.description': { en: flat('Start a Gemini agent session with the configured launch command.'), yue: flat('用已設定嘅啟動指令開始 Gemini 代理工作階段。') },
  'nodeCatalog.entry.web.label': { en: flat('Web view'), yue: flat('網頁檢視') },
  'nodeCatalog.entry.web.description': { en: flat('Open a web view with a URL chosen in its guided address field.'), yue: flat('用引導式網址欄揀網址，再開網頁檢視。') },
  'nodeCatalog.entry.video.label': { en: flat('Video'), yue: flat('影片') },
  'nodeCatalog.entry.video.description': { en: flat('Open a local video node and choose the media file in its picker.'), yue: flat('開本機影片節點，再用選擇器揀媒體檔案。') },
  'nodeCatalog.entry.nsis.label': { en: flat('Installer builder'), yue: flat('安裝程式建立器') },
  'nodeCatalog.entry.nsis.description': { en: flat('Start a guided installer-builder form with safe project defaults.'), yue: flat('用安全項目預設值開始引導式安裝程式表單。') },
  'nodeCatalog.entry.service.minecraft.label': { en: flat('Minecraft manager'), yue: flat('Minecraft 管理器') },
  'nodeCatalog.entry.service.minecraft.description': { en: flat('Open a manager for a locally bound Minecraft service.'), yue: flat('開本機已綁定 Minecraft 服務嘅管理器。') },
  'nodeCatalog.entry.service.dockerhost.label': { en: flat('Docker host manager'), yue: flat('Docker 主機管理器') },
  'nodeCatalog.entry.service.dockerhost.description': { en: flat('Open a typed manager for a local or saved Docker host.'), yue: flat('開本機或已儲存 Docker 主機嘅有類型管理器。') },
  'nodeCatalog.entry.service.proxmox.label': { en: flat('Proxmox manager'), yue: flat('Proxmox 管理器') },
  'nodeCatalog.entry.service.proxmox.description': { en: flat('Open a typed manager for a saved Proxmox connection.'), yue: flat('開已儲存 Proxmox 連線嘅有類型管理器。') },
  'nodeCatalog.entry.service.gitlab.label': { en: flat('GitLab manager'), yue: flat('GitLab 管理器') },
  'nodeCatalog.entry.service.gitlab.description': { en: flat('Open a typed manager for a saved GitLab connection.'), yue: flat('開已儲存 GitLab 連線嘅有類型管理器。') },
  'nodeCatalog.entry.service.homeassistant.label': { en: flat('Home Assistant manager'), yue: flat('Home Assistant 管理器') },
  'nodeCatalog.entry.service.homeassistant.description': { en: flat('Open a typed manager for a saved Home Assistant connection.'), yue: flat('開已儲存 Home Assistant 連線嘅有類型管理器。') },
  'nodeCatalog.entry.service.freepbx.label': { en: flat('FreePBX manager'), yue: flat('FreePBX 管理器') },
  'nodeCatalog.entry.service.freepbx.description': { en: flat('Open a typed manager for a saved FreePBX connection.'), yue: flat('開已儲存 FreePBX 連線嘅有類型管理器。') },
  'nodeCatalog.entry.editor.label': { en: flat('Editor'), yue: flat('編輯器') },
  'nodeCatalog.entry.editor.description': { en: flat('Open a selected project file in the embedded editor.'), yue: flat('喺內置編輯器開揀好嘅項目檔案。') },
  'nodeCatalog.entry.diff.label': { en: flat('Diff viewer'), yue: flat('差異檢視器') },
  'nodeCatalog.entry.diff.description': { en: flat('Open a selected project file in the read-only diff viewer.'), yue: flat('喺唯讀差異檢視器開揀好嘅項目檔案。') },

  // ---------------------------------------------------------------------------------------
  // Confirm / delete dialog defaults (ConfirmDialog.tsx). Custom labels a caller passes in
  // (e.g. "Remove worktree") are that caller's own copy and stay in English for now — only the
  // component's own DEFAULTS are localized here.
  // ---------------------------------------------------------------------------------------
  'dialog.confirm.cancel': {
    en: ['Cancel', 'Cancel', 'Never mind', 'Nope, not today', "Nope, I'll pass"],
    yue: ['取消', '取消', '算把啦', '唔得，今日唔好', '唔使喇，走先']
  },
  'dialog.confirm.delete': {
    en: ['Delete', 'Delete', 'Yes, delete it', 'Do it, delete it', 'Send it to the void'],
    yue: ['刪除', '刪除', '好，刪除佢', '掂佢，刪除佢', '送佢返天國']
  },
  'dialog.confirm.ok': {
    en: flat('OK'),
    yue: flat('好')
  },

  // ---------------------------------------------------------------------------------------
  // Welcome screen (WelcomeScreen.tsx).
  // ---------------------------------------------------------------------------------------
  'welcome.tagline': {
    en: [
      'A canvas of terminals. Start a project to begin.',
      'A canvas of terminals. Start a project to begin.',
      'A canvas full of terminals, waiting for a project.',
      'A whole canvas of terminals, and not one is doing anything yet. Start a project.',
      'A canvas of terminals, all dressed up with nowhere to go. Fix that — start a project.'
    ],
    yue: [
      '一個放滿終端機嘅畫布。開個項目就開始喇。',
      '一個放滿終端機嘅畫布。開個項目就開始喇。',
      '成個畫布嘅終端機，齊齊等緊個項目。',
      '成畫布嘅終端機，一個都仲未做嘢。開個項目啦。',
      '成畫布嘅終端機打扮到靚靚，就係未有嘢做。快啲開個項目喇。'
    ]
  },
  'welcome.card.newProject': {
    en: flat('New project'),
    yue: flat('新項目')
  },
  'welcome.card.openFolder': {
    en: flat('Open folder…'),
    yue: flat('開啟資料夾…')
  },
  'welcome.card.cloneRepo': {
    en: flat('Clone repo…'),
    yue: flat('複製 repo…')
  },
  'welcome.card.connectSsh': {
    en: flat('Connect over SSH…'),
    yue: flat('用 SSH 連接…')
  },
  'welcome.back': {
    en: flat('Back to your projects'),
    yue: flat('返去你嘅項目')
  },
  'welcome.back.note': {
    en: [
      "They're untouched — nothing here changes them.",
      "They're untouched — nothing here changes them.",
      'Untouched, promise — nothing on this screen can touch them.',
      "Not one of them moved. This screen can't get anywhere near your other projects.",
      "Your other projects are just sitting there, blissfully untouched — this screen couldn't lay a finger on them if it tried."
    ],
    yue: [
      '佢哋原封不動 — 呢度乜都唔會郁到佢哋。',
      '佢哋原封不動 — 呢度乜都唔會郁到佢哋。',
      '放心，佢哋原封不動 — 呢個畫面郁佢哋唔到。',
      '一個都冇郁過，呢個畫面近佢哋都近唔到。',
      '你啲其他項目照舊喺度嘆世界，原封不動 — 呢度半隻手指都掂唔到佢哋。'
    ]
  },
  'welcome.close': {
    en: flat('Close'),
    yue: flat('關閉')
  },
  'welcome.recent.title': {
    en: flat('Recently closed'),
    yue: flat('最近關閉')
  },
  'welcome.recent.deleteTitle': {
    en: flat('Delete permanently (ends its sessions)'),
    yue: flat('永久刪除（會結束佢嘅工作階段）')
  },
  'welcome.recent.deleteAria': {
    en: flat('Delete permanently'),
    yue: flat('永久刪除')
  },
  'welcome.subtitle': {
    en: [
      'Open a project to place shells, agents and notes on one canvas — every project is also a board of its live sessions.',
      'Open a project to place shells, agents and notes on one canvas — every project is also a board of its live sessions.',
      'Open a project and start dropping shells, agents and notes onto one canvas — it doubles as a board of your live sessions too.',
      "Open a project, then throw shells, agents and notes onto one canvas — and yes, it's secretly a kanban board of your live sessions as well.",
      "Open a project and start flinging shells, agents and notes onto one big canvas — which, plot twist, is also a kanban board of everything that's currently running."
    ],
    yue: [
      '開個項目，就可以將終端機、AI 助手同筆記擺喺同一個畫布度 — 每個項目仲可以睇返做緊嘅工作階段嘅睇板。',
      '開個項目，就可以將終端機、AI 助手同筆記擺喺同一個畫布度 — 每個項目仲可以睇返做緊嘅工作階段嘅睇板。',
      '開個項目，隨便將終端機、AI 助手、筆記擺上同一個畫布 — 佢仲兼職做緊嘅工作階段嘅睇板。',
      '開個項目，將終端機、AI 助手、筆記統統擺上一個畫布度 — 仲要偷偷做埋你啲工作階段嘅睇板。',
      '開個項目，將終端機、AI 助手同筆記亂咁掟落一個大畫布度 — 原來佢仲兼職做緊你啲工作階段嘅睇板，一畫兩用。'
    ]
  },
  'welcome.card.newProject.desc': {
    en: flat('An empty canvas'),
    yue: flat('一個空白畫布')
  },
  'welcome.card.openFolder.desc': {
    en: flat('Point at a repo'),
    yue: flat('揀返個 repo')
  },
  'welcome.card.cloneRepo.desc': {
    en: flat('From GitHub or a URL'),
    yue: flat('用 GitHub 或者網址')
  },
  'welcome.card.connectSsh.desc': {
    en: flat('Work on a remote host'),
    yue: flat('喺遠端主機度做嘢')
  },

  // ---------------------------------------------------------------------------------------
  // Update card (UpdateCard.tsx). {version} / {minSupported} are filled in by the caller with
  // the real version string — never guess or paraphrase a version number.
  // ---------------------------------------------------------------------------------------
  'update.title.checking': {
    en: flat('Checking for updates…'),
    yue: flat('檢查緊有冇更新…')
  },
  'update.title.downloading': {
    en: flat('Downloading Update'),
    yue: flat('下載緊更新')
  },
  'update.title.manual': {
    en: flat('Update available'),
    yue: flat('有更新')
  },
  'update.title.ready': {
    en: flat('Update ready'),
    yue: flat('更新準備好喇')
  },
  'update.title.upToDate': {
    en: flat("You're up to date"),
    yue: flat('你已經係最新版本')
  },
  'update.title.required': {
    en: flat('Update required'),
    yue: flat('一定要更新')
  },
  'update.title.error': {
    en: flat('Update failed'),
    yue: flat('更新失敗')
  },
  'update.minimize': {
    en: flat('Minimize'),
    yue: flat('縮小')
  },
  'update.pill.ready': {
    en: flat('Ready'),
    yue: flat('準備好')
  },
  'update.body.checking': {
    en: [
      'Looking for a newer version…',
      'Looking for a newer version…',
      'Checking whether a newer version exists…',
      'Poking the update server to see if there is anything newer…',
      'Nosing around the update server for anything newer than what you have…'
    ],
    yue: [
      '搵緊有冇新版本…',
      '搵緊有冇新版本…',
      '查緊有冇新版本…',
      '同更新伺服器打聲招呼，睇下有冇新版本…',
      '偷偷問下更新伺服器有冇仲新嘅版本…'
    ]
  },
  'update.body.downloading': {
    en: [
      'nodeterm v{version} is downloading.',
      'nodeterm v{version} is downloading.',
      'nodeterm v{version} is on its way in.',
      'nodeterm v{version} is downloading; the progress bar has no measured percentage.',
      'nodeterm v{version} is downloading; the updater is keeping the finish line to itself.'
    ],
    yue: [
      'nodeterm v{version} 下載緊。',
      'nodeterm v{version} 下載緊。',
      'nodeterm v{version} 落緊嚟緊。',
      'nodeterm v{version} 下載緊；個進度條冇實測百分比。',
      'nodeterm v{version} 下載緊；更新器唔會扮知仲有幾遠。'
    ]
  },
  'update.body.downloadingUnknown': {
    en: [
      'A newer nodeterm version is downloading.',
      'A newer nodeterm version is downloading.',
      'A newer nodeterm version is on its way in.',
      'A newer nodeterm version is downloading; the progress bar has no measured percentage.',
      'A newer nodeterm version is downloading; the updater is keeping the finish line to itself.'
    ],
    yue: [
      '新版本 nodeterm 下載緊。',
      '新版本 nodeterm 下載緊。',
      '新版本 nodeterm 落緊嚟。',
      '新版本 nodeterm 下載緊；個進度條冇實測百分比。',
      '新版本 nodeterm 下載緊；更新器唔會扮知仲有幾遠。'
    ]
  },
  'update.downloadingPct': {
    en: flat('Downloading… {percent}%'),
    yue: flat('下載緊… {percent}%')
  },
  'update.releaseNotes': {
    en: flat('Release notes'),
    yue: flat('版本說明')
  },
  'update.body.manual': {
    en: [
      'nodeterm v{version} is available. Download it to update.',
      'nodeterm v{version} is available. Download it to update.',
      'nodeterm v{version} is out — grab it to update.',
      'nodeterm v{version} is out there waiting for you. Go get it.',
      'nodeterm v{version} has landed and it will not install itself — go download it.'
    ],
    yue: [
      'nodeterm v{version} 已推出，下載嚟更新。',
      'nodeterm v{version} 已推出，下載嚟更新。',
      'nodeterm v{version} 出咗喇，下載嚟更新啦。',
      'nodeterm v{version} 喺度等緊你，去攞返嚟啦。',
      'nodeterm v{version} 已經降落，但佢唔會自己裝落去架，快啲落嚟啦。'
    ]
  },
  'update.body.manualUnknown': {
    en: [
      'A newer nodeterm version is available. Download it to update.',
      'A newer nodeterm version is available. Download it to update.',
      'A newer nodeterm version is out — grab it to update.',
      'A newer nodeterm version is waiting for you. Download it to update.',
      'A newer nodeterm version has landed and it will not install itself — go download it.'
    ],
    yue: [
      'nodeterm 有新版本，下載嚟更新。',
      'nodeterm 有新版本，下載嚟更新。',
      'nodeterm 新版本出咗喇，下載嚟更新啦。',
      'nodeterm 新版本喺度等緊你，去下載嚟更新啦。',
      'nodeterm 新版本已經降落，但佢唔會自己裝落去架，快啲下載啦。'
    ]
  },
  'update.download': {
    en: flat('Download'),
    yue: flat('下載')
  },
  'update.body.ready': {
    en: [
      'nodeterm v{version} is ready to install.',
      'nodeterm v{version} is ready to install.',
      'nodeterm v{version} is downloaded and ready to install.',
      'nodeterm v{version} is sitting here, all packed and ready to install.',
      'nodeterm v{version} is fully downloaded and standing by, itching to install.'
    ],
    yue: [
      'nodeterm v{version} 已經準備好安裝。',
      'nodeterm v{version} 已經準備好安裝。',
      'nodeterm v{version} 已經下載好，可以安裝喇。',
      'nodeterm v{version} 已經執拾好行李，隨時可以安裝。',
      'nodeterm v{version} 已經全套下載完，企喺度等緊安裝。'
    ]
  },
  'update.body.readyUnknown': {
    en: [
      'A nodeterm update is ready to install.',
      'A nodeterm update is ready to install.',
      'A nodeterm update is downloaded and ready to install.',
      'A nodeterm update is sitting here, all packed and ready to install.',
      'A nodeterm update is fully downloaded and standing by, itching to install.'
    ],
    yue: [
      'nodeterm 更新已經準備好安裝。',
      'nodeterm 更新已經準備好安裝。',
      'nodeterm 更新已經下載好，可以安裝喇。',
      'nodeterm 更新已經執拾好行李，隨時可以安裝。',
      'nodeterm 更新已經全套下載完，企喺度等緊安裝。'
    ]
  },
  'update.restart': {
    en: flat('Restart to update'),
    yue: flat('重新開機更新')
  },
  'update.body.upToDate': {
    en: [
      'nodeterm is on the latest version.',
      'nodeterm is on the latest version.',
      'nodeterm is already on the latest version.',
      'nodeterm is already the newest version there is. Nothing to do here.',
      'nodeterm is the freshest version currently in existence. Go build something.'
    ],
    yue: [
      'nodeterm 已經係最新版本。',
      'nodeterm 已經係最新版本。',
      'nodeterm 已經係最新版本喇。',
      'nodeterm 已經係現時最新嘅版本，唔使做嘢。',
      'nodeterm 已經係全宇宙最新版本，去整啲嘢啦。'
    ]
  },
  'update.body.required': {
    en: [
      'This version is no longer supported{minSupportedClause}. Please update to continue.',
      'This version is no longer supported{minSupportedClause}. Please update to continue.',
      'This version is no longer supported{minSupportedClause} — an update is needed to continue.',
      'This version has aged out of support{minSupportedClause}. Update to keep going.',
      'This version is officially retired{minSupportedClause}. Update it or it stays retired.'
    ],
    yue: [
      '呢個版本已經冇支援{minSupportedClause}。請更新先可以繼續用。',
      '呢個版本已經冇支援{minSupportedClause}。請更新先可以繼續用。',
      '呢個版本已經停止支援{minSupportedClause}，要更新先可以繼續。',
      '呢個版本已經退咗休{minSupportedClause}，要更新先繼續得到。',
      '呢個版本正式榮休喇{minSupportedClause}，唔更新就企喺度榮休。'
    ]
  },
  /** Appended to `update.body.required` only when a minimum-supported-version is known. Kept as
   *  its own entry (rather than baked into the parent string) so the clause can be omitted
   *  cleanly when there's nothing to report. */
  'update.minSupportedClause': {
    en: flat(' (minimum {minSupported})'),
    yue: flat('（最低要求 {minSupported}）')
  },
  'update.updateNow': {
    en: flat('Update now'),
    yue: flat('立即更新')
  },
  'update.downloadManually': {
    en: flat('Download manually'),
    yue: flat('手動下載')
  },

  // ---------------------------------------------------------------------------------------
  // Windows terminal profiles. Profile labels, WSL distribution names, executable paths and
  // trusted-core error details are caller-owned values and stay verbatim in the placeholders.
  // Only the surrounding renderer copy is localized here.
  // ---------------------------------------------------------------------------------------
  'terminalProfiles.common.detectingProfiles': {
    en: flat('Detecting profiles…'),
    yue: flat('正在偵測設定檔…')
  },
  'terminalProfiles.common.profilesUnavailable': {
    en: flat('Profiles unavailable'),
    yue: flat('設定檔無法使用')
  },
  'terminalProfiles.common.noProfilesDetected': {
    en: flat('No Windows terminal profiles were detected.'),
    yue: flat('偵測唔到任何 Windows 終端機設定檔。')
  },
  'terminalProfiles.common.detectionPending': {
    en: flat('Profile detection has not finished yet.'),
    yue: flat('設定檔偵測尚未完成。')
  },
  'terminalProfiles.common.detectionFailed': {
    en: flat('Terminal profile detection failed.'),
    yue: flat('終端機設定檔偵測失敗。')
  },
  'terminalProfiles.common.unavailableOnMachine': {
    en: flat('This profile is unavailable on this machine.'),
    yue: flat('呢個設定檔喺呢部電腦用唔到。')
  },
  'terminalProfiles.common.unavailableHereTitle': {
    en: flat('Windows profile unavailable here'),
    yue: flat('呢度用唔到 Windows 設定檔')
  },
  'terminalProfiles.common.unavailableHereBody': {
    en: flat('Local Windows profiles cannot be applied to an SSH or relay terminal.'),
    yue: flat('本機 Windows 設定檔唔可以套用喺 SSH 或中繼終端機。')
  },
  'terminalProfiles.common.noReasonProvided': {
    en: flat('No reason was provided.'),
    yue: flat('沒有提供原因。')
  },
  'terminalProfiles.common.available': {
    en: flat('Available'),
    yue: flat('可用')
  },
  'terminalProfiles.common.unavailable': {
    en: flat('Unavailable'),
    yue: flat('無法使用')
  },

  // Fallback labels shown only while detection has not supplied a descriptor. Product names and
  // WSL distribution names remain verbatim; these generic renderer-owned labels are localized.
  'terminalProfiles.label.default': {
    en: flat('Default profile'),
    yue: flat('預設設定檔')
  },
  'terminalProfiles.label.automatic': {
    en: flat('Automatic'),
    yue: flat('自動')
  },
  'terminalProfiles.label.custom': {
    en: flat('Custom executable'),
    yue: flat('自訂執行檔')
  },
  'terminalProfiles.label.unavailable': {
    en: flat('Unavailable terminal profile'),
    yue: flat('無法使用嘅終端機設定檔')
  },
  'terminalProfiles.label.unknown': {
    en: flat('Unknown profile'),
    yue: flat('未知設定檔')
  },

  'terminalProfiles.settings.sectionTitle': {
    en: flat('Shell'),
    yue: flat('Shell')
  },
  'terminalProfiles.settings.sectionDescription': {
    en: flat('Choose the Windows profile used for new local terminals.'),
    yue: flat('揀新本機終端機要用嘅 Windows 設定檔。')
  },
  'terminalProfiles.settings.legacySectionDescription': {
    en: flat('The shell new terminals launch. Empty uses the system default.'),
    yue: flat('新終端機啟動嘅 Shell。留空會用系統預設值。')
  },
  'terminalProfiles.settings.legacyDefaultLabel': {
    en: flat('Default shell'),
    yue: flat('預設 Shell')
  },
  'terminalProfiles.settings.legacyDefaultDescription': {
    en: flat('Shell executable (leave empty to use $SHELL or the system default)'),
    yue: flat('Shell 執行檔（留空以使用 $SHELL 或系統預設值）')
  },
  'terminalProfiles.settings.systemDefaultPlaceholder': {
    en: flat('system default'),
    yue: flat('系統預設值')
  },
  'terminalProfiles.settings.defaultLabel': {
    en: flat('Default terminal profile'),
    yue: flat('預設終端機設定檔')
  },
  'terminalProfiles.settings.defaultDescription': {
    en: flat(
      'Used by every one-click New terminal action. Existing nodes keep their selected profile.'
    ),
    yue: flat('所有一按「新增終端機」動作都會用佢。現有節點會保留已揀嘅設定檔。')
  },
  'terminalProfiles.settings.availabilityRowTitle': {
    en: flat('Detected profile availability'),
    yue: flat('偵測到嘅設定檔可用狀態')
  },
  'terminalProfiles.settings.customLabel': {
    en: flat('Custom executable'),
    yue: flat('自訂執行檔')
  },
  'terminalProfiles.settings.customNeedsRefresh': {
    en: flat('Refresh detection to verify this executable.'),
    yue: flat('重新偵測以驗證呢個執行檔。')
  },
  'terminalProfiles.settings.customChooseFirst': {
    en: flat('Choose a custom executable before using this profile.'),
    yue: flat('使用呢個設定檔之前，請先揀一個自訂執行檔。')
  },
  'terminalProfiles.settings.detectingInstalled': {
    en: flat('Detecting installed terminal profiles…'),
    yue: flat('正在偵測已安裝嘅終端機設定檔…')
  },
  'terminalProfiles.settings.detectionFailedSavedDefault': {
    en: flat('Profile detection failed. The saved default was not changed.'),
    yue: flat('設定檔偵測失敗。已儲存嘅預設值沒有改變。')
  },
  'terminalProfiles.settings.selectedAvailable': {
    en: flat('{profile} is available.'),
    yue: flat('{profile} 可以使用。')
  },
  'terminalProfiles.settings.selectedUnavailable': {
    en: flat('{profile} is unavailable: {reason}'),
    yue: flat('{profile} 無法使用：{reason}')
  },
  'terminalProfiles.settings.savedProfileMissing': {
    en: flat(
      '{profile} is unavailable: this saved profile is no longer detected on this computer.'
    ),
    yue: flat('{profile} 無法使用：呢部電腦已經偵測唔到呢個已儲存設定檔。')
  },
  'terminalProfiles.settings.customEmptyNote': {
    en: flat(
      'Unavailable until an executable is chosen. New terminals will not silently fall back.'
    ),
    yue: flat('揀好執行檔之前都無法使用。新終端機唔會靜靜鷄轉用其他設定。')
  },
  'terminalProfiles.settings.customUnavailable': {
    en: flat('Unavailable: {reason}'),
    yue: flat('無法使用：{reason}')
  },
  'terminalProfiles.settings.executableUnresolved': {
    en: flat('The executable could not be resolved.'),
    yue: flat('無法解析呢個執行檔。')
  },
  'terminalProfiles.settings.saveBeforeDetectionFailed': {
    en: flat('Could not save settings before detection.'),
    yue: flat('偵測之前無法儲存設定。')
  },
  'terminalProfiles.settings.optionDetecting': {
    en: flat('{profile} — detecting…'),
    yue: flat('{profile} — 正在偵測…')
  },
  'terminalProfiles.settings.optionDetectionFailed': {
    en: flat('{profile} — detection failed'),
    yue: flat('{profile} — 偵測失敗')
  },
  'terminalProfiles.settings.optionUnavailable': {
    en: flat('{profile} — unavailable'),
    yue: flat('{profile} — 無法使用')
  },
  'terminalProfiles.settings.optionUnavailableSuffix': {
    en: flat(' — unavailable'),
    yue: flat(' — 無法使用')
  },
  'terminalProfiles.settings.detectedHeading': {
    en: flat('Detected profiles'),
    yue: flat('偵測到嘅設定檔')
  },
  'terminalProfiles.settings.detectedDescription': {
    en: flat(
      'Missing shells and WSL distributions stay unavailable instead of opening a different profile.'
    ),
    yue: flat('缺少嘅 Shell 同 WSL 發行版會保持無法使用，唔會轉開另一個設定檔。')
  },
  'terminalProfiles.settings.detecting': {
    en: flat('Detecting…'),
    yue: flat('正在偵測…')
  },
  'terminalProfiles.settings.refresh': {
    en: flat('Refresh detection'),
    yue: flat('重新偵測')
  },
  'terminalProfiles.settings.detectionFailedStale': {
    en: flat('Detection failed: {error} Previous availability may be stale.'),
    yue: flat('偵測失敗：{error} 之前嘅可用狀態可能已過時。')
  },
  'terminalProfiles.settings.availabilityAria': {
    en: flat('Detected terminal profile availability'),
    yue: flat('偵測到嘅終端機設定檔可用狀態')
  },
  'terminalProfiles.settings.noProfilesReturned': {
    en: flat('No terminal profiles were returned.'),
    yue: flat('沒有傳回任何終端機設定檔。')
  },
  'terminalProfiles.settings.customDescription': {
    en: flat(
      'Executable name or absolute path. Paths with spaces are supported; enter no arguments or quotes.'
    ),
    yue: flat('輸入執行檔名稱或絕對路徑。支援有空格嘅路徑；唔好輸入參數或引號。')
  },
  'terminalProfiles.settings.chooseExecutableAria': {
    en: flat('Choose custom terminal executable'),
    yue: flat('揀自訂終端機執行檔')
  },
  'terminalProfiles.settings.chooseExecutable': {
    en: flat('Choose executable…'),
    yue: flat('揀執行檔…')
  },

  'terminalProfiles.create.menuLabel': {
    en: flat('New terminal with profile…'),
    yue: flat('用設定檔新增終端機…')
  },
  'terminalProfiles.create.chooseProfileAria': {
    en: flat('Choose terminal profile'),
    yue: flat('揀終端機設定檔')
  },
  'terminalProfiles.create.backToNewNodes': {
    en: flat('Back to new nodes'),
    yue: flat('返去新節點')
  },
  'terminalProfiles.create.backToNewSessions': {
    en: flat('Back to new sessions'),
    yue: flat('返去新階段')
  },
  'terminalProfiles.create.unavailableInView': {
    en: flat('Terminal profile creation is unavailable in this view.'),
    yue: flat('呢個檢視無法用設定檔建立終端機。')
  },
  'terminalProfiles.create.detectionReturnedNone': {
    en: flat('Profile detection has not returned any profiles.'),
    yue: flat('設定檔偵測尚未傳回任何設定檔。')
  },
  'terminalProfiles.create.commandLabel': {
    en: flat('New terminal — {profile}'),
    yue: flat('新終端機 — {profile}')
  },

  'terminalProfiles.restart.menuLabel': {
    en: flat('Restart with profile…'),
    yue: flat('用設定檔重新啟動…')
  },
  'terminalProfiles.restart.hostCannotConfirm': {
    en: flat('This host cannot confirm that the old persistent session ended.'),
    yue: flat('呢部主機無法確認舊嘅持續階段已經結束。')
  },
  'terminalProfiles.restart.noLongerLocal': {
    en: flat('This node is no longer a local Windows terminal.'),
    yue: flat('呢個節點已經唔再係本機 Windows 終端機。')
  },
  'terminalProfiles.restart.confirmedUnavailable': {
    en: flat('Confirmed persistent-session recycling is unavailable on this host.'),
    yue: flat('呢部主機無法使用經確認嘅持續階段重新建立。')
  },
  'terminalProfiles.restart.busy': {
    en: flat('This terminal is already restarting. Wait for that restart to finish.'),
    yue: flat('呢個終端機已經重新啟動緊。請等呢次重新啟動完成。')
  },
  'terminalProfiles.restart.progress': {
    en: flat('Restarting with profile…'),
    yue: flat('正在用設定檔重新啟動…')
  },
  'terminalProfiles.restart.customAgentMissingConfig': {
    en: flat(
      'This custom agent is no longer configured. Restore its launch command before restarting; the live process was not changed.'
    ),
    yue: flat('呢個自訂代理已經沒有設定。重新啟動之前請還原佢嘅啟動指令；現時嘅過程沒有改變。')
  },
  'terminalProfiles.restart.crossEnvironmentUnavailable': {
    en: flat(
      'This agent cannot be restarted across Windows and WSL environments because its CLI and conversation store cannot be verified there. Choose a profile in the current environment.'
    ),
    yue: flat(
      '呢個代理無法跨 Windows 同 WSL 環境重新啟動，因為無法驗證嗰邊嘅 CLI 同對話儲存。請揀當前環境內嘅設定檔。'
    )
  },
  'terminalProfiles.restart.newBuiltInConversationWarning': {
    en: flat(
      'No resumable conversation id is available. The agent will start a new conversation after the profile switch.'
    ),
    yue: flat('沒有可以繼續嘅對話 ID。轉換設定檔之後，代理會開始新對話。')
  },
  'terminalProfiles.restart.newCustomConversationWarning': {
    en: flat(
      'This custom agent will restart from its configured launch command in a new conversation.'
    ),
    yue: flat('呢個自訂代理會用已設定嘅啟動指令重新啟動，並開始新對話。')
  },
  'terminalProfiles.restart.projectChanged': {
    en: flat('The project changed before confirmation, so nothing was restarted.'),
    yue: flat('確認之前項目已經改變，所以沒有重新啟動任何東西。')
  },
  'terminalProfiles.restart.confirmTitle': {
    en: flat('Restart “{node}” with {profile}'),
    yue: flat('用 {profile} 重新啟動「{node}」')
  },
  'terminalProfiles.restart.confirmDescription': {
    en: flat(
      'The live process and persistent session will end, including anything still running inside it. The node will then be recreated with {profile}.'
    ),
    yue: flat(
      '即時過程同持續階段都會結束，包括內裡仲行緊嘅所有程式。之後會用 {profile} 重新建立呢個節點。'
    )
  },
  'terminalProfiles.restart.confirmButton': {
    en: flat('Restart'),
    yue: flat('重新啟動')
  },
  'terminalProfiles.restart.failedTitle': {
    en: flat('Restart with profile failed'),
    yue: flat('用設定檔重新啟動失敗')
  },
  'terminalProfiles.restart.defaultNodeLabel': {
    en: flat('terminal'),
    yue: flat('終端機')
  },

  'terminalProfiles.header.statusAvailable': {
    en: flat('available'),
    yue: flat('可用')
  },
  'terminalProfiles.header.statusUnavailable': {
    en: flat('unavailable'),
    yue: flat('無法使用')
  },
  'terminalProfiles.header.statusUnknown': {
    en: flat('availability unknown'),
    yue: flat('可用狀態不明')
  },
  'terminalProfiles.header.ariaLabel': {
    en: flat('Terminal profile: {profile}, {status}'),
    yue: flat('終端機設定檔：{profile}，{status}')
  },
  'terminalProfiles.header.ariaLabelWithHint': {
    en: flat('Terminal profile: {profile}, {status}: {hint}'),
    yue: flat('終端機設定檔：{profile}，{status}：{hint}')
  },
  'terminalProfiles.header.title': {
    en: flat('Terminal profile: {profile}'),
    yue: flat('終端機設定檔：{profile}')
  },
  'terminalProfiles.header.checkingAvailability': {
    en: flat('Checking whether this terminal profile is available on this machine.'),
    yue: flat('正在檢查呢個終端機設定檔喺呢部電腦係否可用。')
  },
  'terminalProfiles.header.noLongerDetected': {
    en: flat('This selected profile is no longer detected on this machine.'),
    yue: flat('呢部電腦已經偵測唔到已揀嘅設定檔。')
  },
  'terminalProfiles.header.availableTitle': {
    en: flat('{profile} terminal profile'),
    yue: flat('{profile} 終端機設定檔')
  },
  'terminalProfiles.header.unavailableTitle': {
    en: flat('{profile} is unavailable.'),
    yue: flat('{profile} 無法使用。')
  },
  'terminalProfiles.header.unavailableTitleWithReason': {
    en: flat('{profile} is unavailable: {reason}'),
    yue: flat('{profile} 無法使用：{reason}')
  },

  'terminalProfiles.error.unresolved': {
    en: flat('The terminal profile could not be resolved.'),
    yue: flat('無法解析終端機設定檔。')
  },
  'terminalProfiles.error.spawnLead': {
    en: flat('This terminal could not be started. {error}'),
    yue: flat('呢個終端機無法啟動。{error}')
  },
  'terminalProfiles.error.recovery': {
    en: flat('Choose Restart with profile… from this card’s menu, then try again.'),
    yue: flat('喺呢張卡嘅選單揀「用設定檔重新啟動…」，然後再試。')
  },
  'terminalProfiles.error.nodeRecovery': {
    en: flat('Choose Restart with profile… from this node’s menu, then try again.'),
    yue: flat('喺呢個節點嘅選單揀「用設定檔重新啟動…」，然後再試。')
  },
  'terminalProfiles.error.tryAgain': {
    en: flat('Try again'),
    yue: flat('再試')
  },
  'terminalProfiles.error.agentRelaunchLead': {
    en: flat('This agent could not be relaunched. {reason}'),
    yue: flat('呢個代理無法重新啟動。{reason}')
  },
  'terminalProfiles.error.agentCustomMissing': {
    en: flat(
      'This custom agent is no longer configured. Restore its launch command, then try again. No agent was launched in the replacement shell.'
    ),
    yue: flat(
      '呢個自訂代理已經沒有設定。請還原佢嘅啟動指令，然後再試。替換 Shell 內沒有啟動任何代理。'
    )
  },
  'terminalProfiles.error.agentRecycleUnavailable': {
    en: flat(
      'This host cannot confirm that the blank replacement session ended. Nothing was restarted.'
    ),
    yue: flat('呢部主機無法確認空白替換階段已經結束。沒有重新啟動任何東西。')
  },
  'terminalProfiles.error.agentRecycleFailed': {
    en: flat('Could not safely replace the blank terminal session. Nothing was restarted.'),
    yue: flat('無法安全替換空白終端機階段。沒有重新啟動任何東西。')
  },
  'terminalProfiles.error.agentRecycleFailedWithDetail': {
    en: flat(
      'Could not safely replace the blank terminal session: {detail} Nothing was restarted.'
    ),
    yue: flat('無法安全替換空白終端機階段：{detail} 沒有重新啟動任何東西。')
  },
  'terminalProfiles.error.agentRetryPreparing': {
    en: flat('Preparing a fresh session…'),
    yue: flat('正在準備新階段…')
  },
  'terminalProfiles.error.agentTryAgain': {
    en: flat('Try agent again'),
    yue: flat('再試代理')
  },
  'terminalProfiles.error.sessionEnded': {
    en: flat(
      'This persistent session ended before a replacement was ready. Nothing was restarted.'
    ),
    yue: flat('替換階段準備好之前，呢個持續階段已經結束。沒有重新啟動任何東西。')
  },
  'terminalProfiles.error.openCanvasToReopen': {
    en: flat('Open on canvas to reopen'),
    yue: flat('喺畫布開啟再重新打開')
  },

  // ---------------------------------------------------------------------------------------
  // Announcement banner (AnnouncementBanner.tsx). The title/body TEXT itself comes from the
  // remote feed and is not localized here — only the surrounding chrome is.
  // ---------------------------------------------------------------------------------------
  'announce.learnMore': {
    en: flat('Learn more'),
    yue: flat('了解更多')
  },
  'announce.dismiss': {
    en: flat('Dismiss'),
    yue: flat('關閉')
  }
}
