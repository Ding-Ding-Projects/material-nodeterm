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
  'settings.section.notifications': { en: flat('Notifications'), yue: flat('通知') },
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
      'nodeterm v{version} is downloading — nearly there.',
      'nodeterm v{version} is streaming in as fast as your connection allows.'
    ],
    yue: [
      'nodeterm v{version} 下載緊。',
      'nodeterm v{version} 下載緊。',
      'nodeterm v{version} 落緊嚟緊。',
      'nodeterm v{version} 下載緊，就嚟得喇。',
      'nodeterm v{version} 用盡你網速咁樣落緊嚟。'
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
