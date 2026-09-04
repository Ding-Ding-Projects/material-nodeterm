import type { Catalog, FunnyVariants } from './types'

/**
 * ============================================================================================
 * THE RULE THAT MATTERS MOST: the funny level changes VOICE, never FACTS.
 * ============================================================================================
 *
 * It applies to every category of message in this catalogue, with NO exemptions — destructive
 * actions, security prompts, accessibility copy and error text included. At any level 1-10 a
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
 * Adding a new string: pick a dotted id (`surface.element.purpose`), write ten English variants
 * (level 1 plain, level 10 playful, stepping between) and ten Cantonese ones. Legacy five-slot
 * rows are expanded by the resolver with distinct voice-only level 6-10 tails until migrated.
 * See docs/language-modes.md.
 * ============================================================================================
 */

/** For a plain factual label that has no meaningful "funnier" version (a settings-nav noun, an
 *  aria-label) — repeats the same text at all five levels. Still satisfies the five-variant
 *  shape; it just declines to invent forced jokes for something that shouldn't have any. */
function flat(text: string): FunnyVariants {
  return [text, text, text, text, text, text, text, text, text, text]
}

export const CATALOG: Catalog = {
  'subagent.collapse': { en: flat('Collapse'), yue: flat('收埋') },
  'subagent.openOutput': { en: flat('Open output'), yue: flat('打開輸出') },
  'subagent.type': { en: flat('subagent'), yue: flat('subagent') },
  'subagent.working': { en: flat('working'), yue: flat('工作中') },
  'subagent.done': { en: flat('done'), yue: flat('完成') },
  'subagent.workingOutput': { en: flat('Working... live output appears here'), yue: flat('工作中……即時輸出會喺呢度出現') },
  'subagent.noOutput': { en: flat('No output.'), yue: flat('冇輸出。') },
  'subagent.elapsed': { en: flat('{duration}'), yue: flat('{duration}') },
  'subagent.tokens': { en: flat('↓ {tokens} tokens'), yue: flat('↓ {tokens} tokens') },
  'subagent.tools': { en: flat('{count} tools'), yue: flat('{count} 個工具') },
  // Context-window progress. Provider numbers are supplied by the caller, while state words and
  // surrounding copy stay in the same language and funny-level pipeline as every other surface.
  'contextMeter.state.known': { en: flat('reported'), yue: flat('已回報') },
  'contextMeter.state.stale': { en: flat('stale'), yue: flat('過期') },
  'contextMeter.state.unknown': { en: flat('unknown'), yue: flat('未知') },
  'contextMeter.state.not-reported': { en: flat('not reported'), yue: flat('未有回報') },
  'contextMeter.state.unavailable': { en: flat('unavailable'), yue: flat('未能提供') },
  'contextMeter.title': { en: flat('Context window'), yue: flat('上下文視窗') },
  'contextMeter.staleTelemetry': { en: flat('stale telemetry'), yue: flat('遙測過期') },
  'contextMeter.updated': { en: flat('Updated {time}'), yue: flat('{time} 更新') },
  'contextMeter.level.healthy': { en: flat('healthy'), yue: flat('健康') },
  'contextMeter.level.warning': { en: flat('warning'), yue: flat('警告') },
  'contextMeter.level.critical': { en: flat('critical'), yue: flat('危險') },
  'contextMeter.contextState': {
    en: ['Context: {state}', 'Context: {state}', 'Context: {state}', 'Context: {state}', 'Context: {state}, the meter is taking a tea break.'],
    yue: ['上下文：{state}', '上下文：{state}', '上下文：{state}', '上下文：{state}', '上下文：{state}，個計數器去咗飲茶。']
  },
  'contextMeter.summary': {
    en: ['Used {used} / {total} tokens · {remaining} remaining · {percent}%', 'Used {used} / {total} tokens · {remaining} remaining · {percent}%', 'Used {used} / {total} tokens · {remaining} remaining · {percent}%', 'Used {used} / {total} tokens · {remaining} remaining · {percent}%', 'Used {used} / {total} tokens · {remaining} remaining · {percent}%, the context cupboard has spoken.'],
    yue: ['用咗 {used} / {total} tokens · 剩返 {remaining} · {percent}%', '用咗 {used} / {total} tokens · 剩返 {remaining} · {percent}%', '用咗 {used} / {total} tokens · 剩返 {remaining} · {percent}%', '用咗 {used} / {total} tokens · 剩返 {remaining} · {percent}%', '用咗 {used} / {total} tokens · 剩返 {remaining} · {percent}%——個上下文櫃已經出聲。']
  },
  'contextMeter.telemetryState': {
    en: ['Telemetry: {state}', 'Telemetry: {state}', 'Telemetry: {state}', 'Telemetry: {state}', 'Telemetry: {state}, no guessing allowed.'],
    yue: ['遙測：{state}', '遙測：{state}', '遙測：{state}', '遙測：{state}', '遙測：{state}，唔估數。']
  },
  'hud.you': { en: flat('You: '), yue: flat('你：') },
  'hud.remove': { en: flat('Remove from HUD'), yue: flat('喺 HUD 移除') },
  'hud.go': { en: flat('Go'), yue: flat('去') },
  'hud.subagents': { en: flat('{count} subagents'), yue: flat('{count} 個 subagent') },
  'hud.state.working': { en: flat('Working…'), yue: flat('工作中……') },
  'hud.state.needsYou': { en: flat('Needs you'), yue: flat('等你處理') },
  'hud.state.done': { en: flat('Finished'), yue: flat('完成') },
  'hud.state.idle': { en: flat('Idle'), yue: flat('閒置') },
  'kanban.comments.addFiles': { en: flat('Add files'), yue: flat('加入檔案') },
  'kanban.comments.dropHint': { en: flat('Drop files here, paste an image, or attach any file'), yue: flat('拖放檔案、貼上圖片，或者加入任何檔案') },
  'kanban.comments.post': { en: flat('Post comment'), yue: flat('發表留言') },
  'kanban.comments.posting': { en: flat('Posting…'), yue: flat('發表中…') },
  'kanban.comments.remove': { en: flat('Remove'), yue: flat('移除') },
  'kanban.comments.reading': { en: flat('Reading file…'), yue: flat('讀取檔案中…') },
  'kanban.comments.uploading': { en: flat('Uploading…'), yue: flat('上載中…') },
  'kanban.comments.attached': { en: flat('Attached'), yue: flat('已加入') },
  'kanban.comments.previewUnavailable': { en: flat('Media preview is unavailable; the file can still be attached.'), yue: flat('媒體預覽未能使用，檔案仍然可以加入。') },
  'kanban.comments.open': { en: flat('Download'), yue: flat('下載') },
  'kanban.comments.openAgain': { en: flat('Download again'), yue: flat('再次下載') },
  'kanban.comments.integrityFailure': { en: flat('Unavailable or changed'), yue: flat('未能使用或已變更') },
  'kanban.comments.searchQueued': { en: flat('Search queued attachments'), yue: flat('搜尋待加入檔案') },
  'kanban.comments.searchPosted': { en: flat('Search comments and attachments'), yue: flat('搜尋留言及附件') },
  'kanban.comments.selectAll': { en: flat('Select all shown'), yue: flat('選取所有顯示項目') },
  'kanban.comments.invert': { en: flat('Invert shown'), yue: flat('反轉顯示項目') },
  'kanban.comments.export': { en: flat('Export selected'), yue: flat('匯出已選項目') },
  'kanban.comments.select': { en: flat('Select'), yue: flat('選取') },
  'kanban.comments.previewLimit': { en: flat('Image preview exceeds the safe pixel limit; the file can still be attached.'), yue: flat('圖片預覽超出安全像素上限，檔案仍然可以加入。') },
  'kanban.comments.previewDimensions': { en: flat('Image preview dimensions could not be checked safely; the file can still be attached.'), yue: flat('未能安全檢查圖片預覽尺寸，檔案仍然可以加入。') },
  'kanban.comments.previewError': { en: flat('Image preview is unavailable; the file can still be attached.'), yue: flat('圖片預覽未能使用，檔案仍然可以加入。') },
  'kanban.comments.mediaPreview': { en: flat('Media preview is unavailable; the file can still be attached.'), yue: flat('媒體預覽未能使用，檔案仍然可以加入。') },
  'kanban.comments.fileReadError': { en: flat('The file could not be read.'), yue: flat('檔案未能讀取。') },
  'kanban.comments.sessionError': { en: flat('Attachment upload session could not be created.'), yue: flat('未能建立附件上載工作階段。') },
  'kanban.comments.saveError': { en: flat('The attachment could not be saved.'), yue: flat('附件未能儲存。') },
  'kanban.comments.postError': { en: flat('The comment could not be saved. Attachments were rolled back.'), yue: flat('留言未能儲存，附件已回復。') },
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
  'settings.section.provider-accounts': { en: flat('Provider accounts'), yue: flat('服務帳戶') },
  'settings.section.language': { en: flat('Language'), yue: flat('語言') },
  'settings.section.privacy': { en: flat('Privacy'), yue: flat('私隱') },

  // Context-window meter copy. Values are interpolated by the component, while these variants
  // keep status and threshold wording in the same language/funny-level pipeline as other chrome.
  'contextWindow.title': { en: flat('Context window'), yue: flat('內容視窗') },
  'contextWindow.shortLabel': { en: flat('Context'), yue: flat('內容') },
  'contextWindow.provider.unknown': { en: flat('agent'), yue: flat('代理') },
  'contextWindow.updated': { en: flat('updated'), yue: flat('更新於') },
  'contextWindow.status.known': { en: flat('reported'), yue: flat('已回報') },
  'contextWindow.status.stale': { en: flat('stale'), yue: flat('過期') },
  'contextWindow.status.unavailable': { en: flat('unavailable'), yue: flat('未能提供') },
  'contextWindow.status.unknown': { en: flat('unknown'), yue: flat('未知') },
  'contextWindow.status.notReported': { en: flat('not reported'), yue: flat('未有回報') },
  'contextWindow.level.healthy': { en: flat('Healthy'), yue: flat('健康') },
  'contextWindow.level.warning': { en: flat('Warning'), yue: flat('注意') },
  'contextWindow.level.critical': { en: flat('Critical'), yue: flat('危急') },
  'contextWindow.detail': {
    en: [
      'Used {used} of {total} tokens, {remaining} remaining, {percent}% used',
      'Used {used} of {total} tokens, with {remaining} still in the tank, {percent}% used',
      '{used} of {total} tokens used, {remaining} left, {percent}% used',
      '{used}/{total} tokens have joined the queue, {remaining} remain, {percent}% used',
      '{used} of {total} tokens are partying, {remaining} remain, {percent}% used'
    ],
    yue: [
      '已用 {used} / {total} tokens，剩返 {remaining}，已用 {percent}%',
      '用咗 {used} / {total} tokens，仲有 {remaining}，已用 {percent}%',
      '{used} / {total} tokens 已用，剩返 {remaining}，已用 {percent}%',
      '{used} / {total} tokens 排緊隊，仲有 {remaining}，已用 {percent}%',
      '{used} / {total} tokens 開緊派對，仲有 {remaining}，已用 {percent}%'
    ]
  },

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
  'settings.language.level.10': {
    en: flat('10 — Maximum playfulness'),
    yue: flat('10 — 抵死到爆')
  },
  'settings.language.funnyEn.provenance': {
    en: flat('English saved value: level {level}.'),
    yue: flat('英文已儲存值：第 {level} 級。')
  },
  'settings.language.funnyYue.provenance': {
    en: flat('Cantonese saved value: level {level}.'),
    yue: flat('廣東話已儲存值：第 {level} 級。')
  },
  'settings.language.level.1': {
    en: flat('1 — Fully professional'),
    yue: flat('1 — 正正經經')
  },
  'settings.language.level.5': {
    en: flat('5 — Playful'),
    yue: flat('5 — 有啲玩味')
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
  'settings.behavior.wheelZoom.label': {
    en: flat('Scroll wheel zooms'),
    yue: flat('滑鼠滾輪縮放')
  },
  'settings.behavior.wheelZoom.description': {
    en: [
      'Zoom with a plain mouse wheel (no Command). Two-finger trackpad scroll still pans.',
      'A plain mouse wheel zooms; two-finger trackpad scroll keeps panning.',
      'Use the wheel for zoom and two fingers for pan, with both gestures staying distinct.',
      'The wheel handles zooming while two fingers keep the map wandering politely.',
      'Spin the wheel to zoom; let two fingers pan, because even gestures deserve separate jobs.'
    ],
    yue: [
      '用普通滑鼠滾輪縮放（唔使 Command）。雙指觸控板捲動仍然平移。',
      '普通滾輪負責縮放，雙指觸控板捲動繼續平移。',
      '滾輪縮放、雙指平移，兩種手勢各自做返自己份工。',
      '滾輪處理縮放，雙指就禮貌咁帶住張圖周圍行。',
      '轉滾輪就縮放，雙指就平移，手勢都有自己嘅崗位㗎。'
    ]
  },

  // Canvas wheel-zoom speed is a real setting, so its label, explanation, and provenance all
  // follow the live language mode and per-language funny levels. The numeric multiplier remains
  // a factual value and is supplied by the renderer rather than baked into catalogue copy.
  'settings.behavior.wheelZoomSpeed.label': {
    en: flat('Wheel zoom speed'),
    yue: flat('滑輪縮放速度')
  },
  'settings.behavior.wheelZoomSpeed.description': {
    en: [
      'How far one plain wheel click zooms. Lower it if one click jumps too far.',
      'Controls the zoom distance for each plain wheel click. Turn it down for gentler jumps.',
      'Sets how much canvas zoom one plain wheel click spends.',
      'Tunes the canvas jump for each plain wheel click, so the map does not go sightseeing.',
      'Sets the plain-wheel zoom jump. Turn it down before one click sends the canvas on a world tour.'
    ],
    yue: [
      '每一下普通滑輪撳落去縮放幾多。一下跳得太遠就調低啲。',
      '控制普通滑輪每一下縮放幾遠，一下太大步就收細啲。',
      '設定普通滑輪一下會用幾多畫布縮放幅度。',
      '調校普通滑輪每一下嘅畫布跳步，唔好等張圖周圍去旅行。',
      '設定普通滑輪嘅縮放跳步，調低啲先，唔好一下就送張畫布環遊世界。'
    ]
  },
  'settings.behavior.wheelZoomSpeed.provenance.default': {
    en: flat('Matches the compiled-in default of 1.0×. An explicit saved 1.0× cannot be distinguished from that same value.'),
    yue: flat('同編譯入去嘅 1.0× 預設值一致。明確儲存嘅 1.0× 無法同呢個值分辨。')
  },
  'settings.behavior.wheelZoomSpeed.provenance.saved': {
    en: flat('Using the saved value from settings.json.'),
    yue: flat('使用 settings.json 入面儲存嘅數值。')
  },
  'settings.behavior.wheelZoomSpeed.provenance.clamped': {
    en: flat('The saved value is outside 0.2×–2.0×; using the clamped value of {speed}×.'),
    yue: flat('儲存嘅數值唔喺 0.2×–2.0× 範圍內，而家使用夾返正嘅 {speed}×。')
  },
  'settings.behavior.wheelZoomSpeed.provenance.invalid': {
    en: flat('The saved value is invalid; using the compiled-in 1.0× value.'),
    yue: flat('儲存嘅數值無效，而家使用編譯入去嘅 1.0× 數值。')
  },
  'settings.behavior.wheelZoomSpeed.provenance.loading': {
    en: flat('Using the compiled-in 1.0× value while saved settings load.'),
    yue: flat('儲存設定載入緊，暫時使用編譯入去嘅 1.0× 數值。')
  },
  'settings.behavior.wheelZoomSpeed.provenance.scheduled': {
    en: flat('A scheduled value is active. The saved base value is {speed}×.'),
    yue: flat('而家有排程數值生效，儲存嘅基礎值係 {speed}×。')
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
  'nodeCatalog.entry.repository-graph.label': { en: flat('Repository graph universe'), yue: flat('項目關係圖宇宙') },
  'nodeCatalog.entry.repository-graph.description': { en: flat('Explore semantic code and dependency relationships for the active project with source provenance.'), yue: flat('用來源證據檢視目前項目嘅程式同依賴關係。') },
  'nodeCatalog.entry.annotation.label': { en: flat('Drawing annotation'), yue: flat('繪圖註解') },
  'nodeCatalog.entry.annotation.description': { en: flat('Arm the drawing tool, then drag a line or arrow with an optional label and editable thickness.'), yue: flat('啟用繪圖工具，再喺畫布拖出直線或箭嘴，仲可以加標籤同調校粗幼。') },
  'nodeCatalog.entry.browser.label': { en: flat('Browser'), yue: flat('瀏覽器') },
  'nodeCatalog.entry.browser.description': { en: flat('Open a browser node with a blank address bar.'), yue: flat('開個有空白網址列嘅瀏覽器節點。') },
  'nodeCatalog.entry.authenticator.label': { en: flat('Authenticator'), yue: flat('驗證器') },
  'nodeCatalog.entry.authenticator.description': { en: flat('Open the local TOTP authenticator without moving secrets into the project.'), yue: flat('開本機 TOTP 驗證器，唔會將秘密搬入項目。') },
  'nodeCatalog.entry.loop.label': { en: flat('Loop'), yue: flat('循環排程') },
  'nodeCatalog.entry.loop.description': { en: flat('Create a paused local schedule with an explicit next action.'), yue: flat('建立一個暫停中、下一步清清楚楚嘅本機排程。') },
  'nodeCatalog.entry.alarm.label': { en: flat('Alarm clock'), yue: flat('鬧鐘') },
  'nodeCatalog.entry.alarm.description': { en: flat('Create a one-shot or recurring wall-clock alarm with an explicit timezone.'), yue: flat('建立一次性或重複嘅牆鐘時間鬧鐘，時區清清楚楚。') },
  'nodeCatalog.entry.trigger.label': { en: flat('Trigger'), yue: flat('觸發器') },
  'nodeCatalog.entry.trigger.description': { en: flat('Run a reviewed payload on a cron, interval, or one-shot schedule.'), yue: flat('喺經覆核嘅 cron、間隔或一次性排程執行內容。') },
  'trigger.scheduleType': { en: flat('Schedule type'), yue: flat('排程類型') },
  'trigger.interval': { en: flat('Interval'), yue: flat('間隔') },
  'trigger.cron': { en: flat('Cron'), yue: flat('Cron') },
  'trigger.once': { en: flat('Once'), yue: flat('一次') },
  'trigger.everyMinutes': { en: flat('Every minutes'), yue: flat('每隔幾多分鐘') },
  'trigger.cronExpression': { en: flat('Five-field cron'), yue: flat('五欄 cron') },
  'trigger.runAt': { en: flat('Run at'), yue: flat('執行時間') },
  'trigger.timezone': { en: flat('Timezone'), yue: flat('時區') },
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
  'dockerHost.title': { en: flat('Docker host manager'), yue: flat('Docker 主機管理器') },
  'dockerHost.contexts': { en: flat('Docker contexts'), yue: flat('Docker 環境') },
  'dockerHost.searchContexts': { en: flat('Search local and SSH contexts'), yue: flat('搜尋本機同 SSH 環境') },
  'dockerHost.regexContexts': { en: flat('Regex builder for Docker context search'), yue: flat('Docker 環境搜尋正則建立器') },
  'dockerHost.resources': { en: flat('Docker resources'), yue: flat('Docker 資源') },
  'dockerHost.containers': { en: flat('Containers'), yue: flat('容器') },
  'dockerHost.images': { en: flat('Images'), yue: flat('映像') },
  'dockerHost.volumes': { en: flat('Volumes'), yue: flat('儲存卷') },
  'dockerHost.networks': { en: flat('Networks'), yue: flat('網絡') },
  'dockerHost.compose': { en: flat('Compose'), yue: flat('Compose') },
  'dockerHost.typedTasks': { en: flat('Typed tasks'), yue: flat('固定類型工作') },
  'dockerHost.refresh': { en: flat('Refresh'), yue: flat('重新整理') },
  'dockerHost.refreshing': { en: flat('Refreshing…'), yue: flat('重新整理緊…') },
  'dockerHost.createContainer': { en: flat('Create bounded container'), yue: flat('建立有限制容器') },
  'dockerHost.createAndStart': { en: flat('Create and start'), yue: flat('建立並啟動') },
  'dockerHost.pullCatalog': { en: flat('Pull from guided catalog'), yue: flat('由引導式目錄拉取') },
  'dockerHost.remove': { en: flat('Remove'), yue: flat('移除') },
  'dockerHost.runTypedTask': { en: flat('Run a fixed typed task'), yue: flat('執行固定類型工作') },
  'dockerHost.noShell': { en: flat('No shell or free-form arguments are accepted.'), yue: flat('唔接受 shell 或自由輸入參數。') },
  'dockerHost.runTaskReady': { en: flat('Run the selected fixed task'), yue: flat('執行揀好嘅固定工作') },
  'dockerHost.chooseContainer': { en: flat('Choose a container first.'), yue: flat('請先揀一個容器。') },
  'dockerHost.runTask': { en: flat('Run task'), yue: flat('執行工作') },
  // AWS CDK manager. Facts such as paths, commands, stack names and byte counts are supplied by
  // the caller, so these entries contain only localized interface copy.
  'cdk.title': { en: flat('AWS CDK manager'), yue: flat('AWS CDK 管理器') },
  'cdk.description': { en: flat('Select a local CDK project, review its trust boundary, synthesize, inspect the diff, then deploy only after review.'), yue: flat('揀本機 CDK 項目，檢查信任範圍，合成同檢視差異，確認之後先部署。') },
  'cdk.available': { en: flat('CDK ready'), yue: flat('CDK 已準備好') },
  'cdk.versionUnknown': { en: flat('version unavailable'), yue: flat('版本未能取得') },
  'cdk.checking': { en: flat('Checking CDK availability…'), yue: flat('檢查緊 CDK 可用性…') },
  'cdk.projectFolder': { en: flat('CDK project folder'), yue: flat('CDK 項目資料夾') },
  'cdk.folderEmpty': { en: flat('Choose the folder containing cdk.json'), yue: flat('揀包含 cdk.json 嘅資料夾') },
  'cdk.browse': { en: flat('Browse…'), yue: flat('瀏覽…') },
  'cdk.inspect': { en: flat('Inspect project'), yue: flat('檢查項目') },
  'cdk.inspecting': { en: flat('Inspecting…'), yue: flat('檢查緊…') },
  'cdk.folderChosen': { en: flat('Folder selected. Inspect it before allowing CDK code to run.'), yue: flat('已揀資料夾。批准 CDK 程式執行之前，請先檢查。') },
  'cdk.folderHelp': { en: flat('The folder path stays local and is never written to the portable project projection.'), yue: flat('資料夾路徑只留喺本機，唔會寫入可攜項目投影。') },
  'cdk.trustHeading': { en: flat('Trust review'), yue: flat('信任檢查') },
  'cdk.trustIntro': { en: flat('CDK will execute the app command from this folder when you synthesize or deploy. Review these files and warnings first.'), yue: flat('合成或部署時 CDK 會喺呢個資料夾執行程式指令。請先睇檔案同警告。') },
  'cdk.bindingRequired': { en: flat('Choose and save a local AWS profile and region before synth, diff, or deploy can run.'), yue: flat('開始合成、差異或者部署之前，請先揀同儲存本機 AWS profile 同 region。') },
  'cdk.appCommand': { en: flat('App command'), yue: flat('程式指令') },
  'cdk.missingApp': { en: flat('Not declared'), yue: flat('未有宣告') },
  'cdk.configPath': { en: flat('Config'), yue: flat('設定') },
  'cdk.contextKeys': { en: flat('Context keys'), yue: flat('內容鍵') },
  'cdk.none': { en: flat('None detected'), yue: flat('未偵測到') },
  'cdk.files': { en: flat('Project files reviewed'), yue: flat('已檢查嘅項目檔案') },
  'cdk.warnings': { en: flat('Trust warnings'), yue: flat('信任警告') },
  'cdk.trustAck': { en: flat('I reviewed the app command and allow this local project code to run.'), yue: flat('我已檢查程式指令，並批准呢個本機項目程式碼執行。') },
  'cdk.approve': { en: flat('Approve trust review'), yue: flat('批准信任檢查') },
  'cdk.approving': { en: flat('Approving…'), yue: flat('批准緊…') },
  'cdk.trustApproved': { en: flat('Trust approved for this project in this app session.'), yue: flat('呢個項目喺今次應用程式工作階段已批准信任。') },
  'cdk.approved': { en: flat('Trust approved for this app session.'), yue: flat('呢個應用程式工作階段已批准信任。') },
  'cdk.synthesisHeading': { en: flat('Synth and stack selection'), yue: flat('合成同選擇堆疊') },
  'cdk.synthesisHelp': { en: flat('Synth runs the reviewed project app and keeps generated templates in a temporary local folder.'), yue: flat('合成會執行已檢查嘅項目程式，產生嘅範本只會暫時留喺本機資料夾。') },
  'cdk.synth': { en: flat('Synth'), yue: flat('合成') },
  'cdk.synthesizing': { en: flat('Synthesizing…'), yue: flat('合成緊…') },
  'cdk.searchStacks': { en: flat('Search synthesized stacks'), yue: flat('搜尋已合成堆疊') },
  'cdk.searchStacksAria': { en: flat('Search synthesized stacks'), yue: flat('搜尋已合成堆疊') },
  'cdk.regexStacks': { en: flat('Regex builder for synthesized stack search'), yue: flat('已合成堆疊搜尋正則建立器') },
  'cdk.stacksShown': { en: flat('stacks shown'), yue: flat('個堆疊顯示緊') },
  'cdk.selected': { en: flat('selected'), yue: flat('已揀') },
  'cdk.allSelected': { en: flat('all synthesized stacks selected'), yue: flat('已揀全部已合成堆疊') },
  'cdk.stackList': { en: flat('Synthesized stacks'), yue: flat('已合成堆疊') },
  'cdk.synthComplete': { en: flat('Synthesis completed. Review the generated stack list before opening a diff.'), yue: flat('合成完成。開差異之前，請先檢查產生嘅堆疊清單。') },
  'cdk.synthEmpty': { en: flat('No synthesis has been run yet.'), yue: flat('仲未執行合成。') },
  'cdk.openDiff': { en: flat('Open reviewed diff'), yue: flat('開啟差異檢查') },
  'cdk.diffHeading': { en: flat('Infrastructure diff review'), yue: flat('基礎設施差異檢查') },
  'cdk.diffHelp': { en: flat('Read the complete CDK diff. Deployment is unavailable until you acknowledge this exact review.'), yue: flat('請閱讀完整 CDK 差異。確認呢次準確檢查之前，部署唔會啟用。') },
  'cdk.diffing': { en: flat('Opening diff…'), yue: flat('開緊差異…') },
  'cdk.diffReady': { en: flat('Diff ready. Read the complete change list before reviewing deployment.'), yue: flat('差異已準備好。檢查部署之前，請閱讀完整變更清單。') },
  'cdk.diffOutput': { en: flat('CDK diff output'), yue: flat('CDK 差異輸出') },
  'cdk.emptyDiff': { en: flat('CDK returned an empty diff.'), yue: flat('CDK 回傳空白差異。') },
  'cdk.destructiveChanges': { en: flat('Removal or replacement changes found'), yue: flat('搵到移除或替換變更') },
  'cdk.noDestructiveChanges': { en: flat('No removal or replacement parsed'), yue: flat('未解析到移除或替換') },
  'cdk.diffAck': { en: flat('I reviewed this exact diff and its affected stacks.'), yue: flat('我已檢查呢份準確差異同受影響嘅堆疊。') },
  'cdk.deploy': { en: flat('Deploy reviewed diff'), yue: flat('部署已檢查差異') },
  'cdk.deployTitle': { en: flat('Review infrastructure deployment'), yue: flat('檢查基礎設施部署') },
  'cdk.deployDescription': { en: flat('This deployment includes removal or replacement changes. Both confirmation keys and the full slider are required before CDK runs.'), yue: flat('今次部署包括移除或替換變更。CDK 執行之前，需要兩個確認鍵同完整滑桿。') },
  'cdk.deployConfirm': { en: flat('Deploy reviewed changes'), yue: flat('部署已檢查變更') },
  'cdk.deploying': { en: flat('Deploying…'), yue: flat('部署緊…') },
  'cdk.deployComplete': { en: flat('Deployment completed. The CDK CLI returned an operation result.'), yue: flat('部署完成。CDK CLI 已回傳操作結果。') },
  'cdk.allStacks': { en: flat('all synthesized stacks'), yue: flat('全部已合成堆疊') },
  'cdk.confirmationBusy': { en: flat('Another confirmation is open. Finish or cancel it before deploying.'), yue: flat('另一個確認介面開緊。完成或取消之後先可以部署。') },
  'cdk.progress': { en: flat('CDK operation in progress'), yue: flat('CDK 操作進行中') },
  'cdk.cancel': { en: flat('Cancel'), yue: flat('取消') },
  'cdk.privacy': { en: flat('Portable intent stores only safe app and stack intent. Credentials, provider sessions, local paths, generated templates, and process state stay local.'), yue: flat('可攜意圖只儲存安全程式同堆疊意圖。登入資料、provider 工作階段、本機路徑、產生範本同程序狀態留喺本機。') },
  'nextcloudAio.title': { en: flat('Nextcloud AIO hosting'), yue: flat('Nextcloud AIO 託管') },
  'nextcloudAio.authorityTitle': { en: flat('Docker authority disclosure'), yue: flat('Docker 權限披露') },
  'nextcloudAio.authority': { en: flat('This profile mounts the Docker socket read-only so the official AIO master container can manage its child containers. Docker socket access can control the Docker host. It is not a security boundary.'), yue: flat('呢個 profile 會以唯讀方式掛載 Docker socket，等官方 AIO 主容器管理子容器。Docker socket 權限可以控制 Docker 主機，唔係安全邊界。') },
  'nextcloudAio.safety': { en: flat('The image source is pinned to the official Nextcloud AIO image. Privileged mode, arbitrary images, shell commands, Compose text, and free-form environment values are never accepted.'), yue: flat('映像來源鎖定官方 Nextcloud AIO 映像。永遠唔接受 privileged mode、任意映像、shell 指令、Compose 文字或者自由環境值。') },
  'nextcloudAio.source': { en: flat('Review the pinned official source'), yue: flat('查看鎖定嘅官方來源') },
  'nextcloudAio.tabs': { en: flat('Nextcloud AIO sections'), yue: flat('Nextcloud AIO 分區') },
  'nextcloudAio.overview': { en: flat('Overview'), yue: flat('概覽') },
  'nextcloudAio.backups': { en: flat('Backups'), yue: flat('備份') },
  'nextcloudAio.recovery': { en: flat('Restore and rollback'), yue: flat('還原同回滾') },
  'nextcloudAio.search': { en: flat('Search contexts and backups'), yue: flat('搜尋環境同備份') },
  'nextcloudAio.searchContexts': { en: flat('Search Docker contexts'), yue: flat('搜尋 Docker 環境') },
  'nextcloudAio.searchBackups': { en: flat('Search backups'), yue: flat('搜尋備份') },
  'nextcloudAio.regex': { en: flat('Regex builder for Nextcloud AIO search'), yue: flat('Nextcloud AIO 搜尋正則建立器') },
  'nextcloudAio.regexContexts': { en: flat('Regex builder for Docker context search'), yue: flat('Docker 環境搜尋正則建立器') },
  'nextcloudAio.regexBackups': { en: flat('Regex builder for backup search'), yue: flat('備份搜尋正則建立器') },
  'nextcloudAio.refresh': { en: flat('Refresh'), yue: flat('重新整理') },
  'nextcloudAio.refreshing': { en: flat('Refreshing…'), yue: flat('重新整理緊…') },
  'nextcloudAio.contexts': { en: flat('Available Docker contexts'), yue: flat('可用 Docker 環境') },
  'nextcloudAio.noContexts': { en: flat('No available Docker context matches this search. Start Docker or choose another search.'), yue: flat('冇可用 Docker 環境符合搜尋。請啟動 Docker 或換個搜尋。') },
  'nextcloudAio.configure': { en: flat('Configure Nextcloud AIO'), yue: flat('設定 Nextcloud AIO') },
  'nextcloudAio.binding': { en: flat('Local binding'), yue: flat('本機綁定') },
  'nextcloudAio.port': { en: flat('Local port'), yue: flat('本機連接埠') },
  'nextcloudAio.portHint': { en: flat('Loopback keeps the service on this computer. Private network exposes it only on the selected private binding. Port must be between 1024 and 65535.'), yue: flat('Loopback 會將服務留喺呢部電腦。私人網絡只會喺揀好嘅私人綁定公開。連接埠必須係 1024 至 65535。') },
  'nextcloudAio.deploy': { en: flat('Deploy pinned profile'), yue: flat('部署鎖定 profile') },
  'nextcloudAio.createBackupReady': { en: flat('Create a local backup of the selected Nextcloud AIO data volume'), yue: flat('建立揀好嘅 Nextcloud AIO 資料卷本機備份') },
  'nextcloudAio.deployReady': { en: flat('Deploy the pinned profile to the selected Docker context'), yue: flat('將鎖定 profile 部署到揀好嘅 Docker 環境') },
  'nextcloudAio.chooseContext': { en: flat('Choose an available Docker context first.'), yue: flat('請先揀可用 Docker 環境。') },
  'nextcloudAio.operations': { en: flat('Operations'), yue: flat('操作') },
  'nextcloudAio.noBackups': { en: flat('No local backup records are available yet. Create one after deployment.'), yue: flat('暫時冇本機備份紀錄。部署後可以建立一個。') },
  'nextcloudAio.recoveryNote': { en: flat('Restore and rollback are explicit local operations. Choose a discovered backup record; no path or shell input is accepted.'), yue: flat('還原同回滾係明確嘅本機操作。請揀已發現嘅備份紀錄；唔接受路徑或者 shell 輸入。') },
  'nextcloudAio.chooseBackup': { en: flat('Search for and select a discovered backup record first.'), yue: flat('請先搜尋同揀一個已發現嘅備份紀錄。') },
  'nodeCatalog.entry.service.proxmox.label': { en: flat('Proxmox manager'), yue: flat('Proxmox 管理器') },
  'nodeCatalog.entry.service.proxmox.description': { en: flat('Open a typed manager for a saved Proxmox connection.'), yue: flat('開已儲存 Proxmox 連線嘅有類型管理器。') },
  'nodeCatalog.entry.service.gitlab.label': { en: flat('GitLab manager'), yue: flat('GitLab 管理器') },
  'nodeCatalog.entry.service.gitlab.description': { en: flat('Open a typed manager for a saved GitLab connection.'), yue: flat('開已儲存 GitLab 連線嘅有類型管理器。') },
  'nodeCatalog.entry.service.homeassistant.label': { en: flat('Home Assistant manager'), yue: flat('Home Assistant 管理器') },
  'nodeCatalog.entry.service.homeassistant.description': { en: flat('Open a typed manager for a saved Home Assistant connection.'), yue: flat('開已儲存 Home Assistant 連線嘅有類型管理器。') },
  'nodeCatalog.entry.homeassistant-control.label': { en: flat('Home Assistant control'), yue: flat('Home Assistant 控制器') },
  'nodeCatalog.entry.homeassistant-control.description': { en: flat('Control a locally bound Home Assistant entity with rich domain controls and verified service schemas.'), yue: flat('用本機綁定連線、豐富類別控制同已驗證服務格式控制 Home Assistant 實體。') },
  'homeAssistantControl.title': { en: flat('Home Assistant control'), yue: flat('Home Assistant 控制器') },
  'homeAssistantControl.connection.heading': { en: flat('Connection on this computer'), yue: flat('呢部電腦嘅連線') },
  'homeAssistantControl.connection.search': { en: flat('Search connections'), yue: flat('搜尋連線') },
  'homeAssistantControl.connection.label': { en: flat('Connection'), yue: flat('連線') },
  'homeAssistantControl.connection.unbound': { en: flat('Leave unbound'), yue: flat('保持未綁定') },
  'homeAssistantControl.discover': { en: flat('Discover or retry'), yue: flat('探索或重試') },
  'homeAssistantControl.configure': { en: flat('Configure a connection'), yue: flat('設定連線') },
  'homeAssistantControl.entity.heading': { en: flat('Entity'), yue: flat('實體') },
  'homeAssistantControl.entity.search': { en: flat('Search entities'), yue: flat('搜尋實體') },
  'homeAssistantControl.entity.choose': { en: flat('Choose an entity'), yue: flat('揀一個實體') },
  'homeAssistantControl.fallback.heading': { en: flat('Verified schema fallback'), yue: flat('已驗證格式後備控制') },
  'homeAssistantControl.service.search': { en: flat('Search services'), yue: flat('搜尋服務') },
  'homeAssistantControl.service.choose': { en: flat('Choose a service'), yue: flat('揀一項服務') },
  'homeAssistantControl.service.run': { en: flat('Run verified service'), yue: flat('執行已驗證服務') },
  'nodeCatalog.entry.homeassistant-sensor.label': { en: flat('Home Assistant sensor'), yue: flat('Home Assistant 感應器') },
  'nodeCatalog.entry.homeassistant-sensor.description': { en: flat('Display selected Home Assistant values, states, gauges, trends, events, weather, calendars, and attributes through a local binding.'), yue: flat('用本機綁定顯示揀好嘅 Home Assistant 數值、狀態、儀表、趨勢、事件、天氣、日曆同屬性。') },
  'nodeCatalog.entry.service.freepbx.label': { en: flat('FreePBX manager'), yue: flat('FreePBX 管理器') },
  'nodeCatalog.entry.service.freepbx.description': { en: flat('Open a typed manager for a saved FreePBX connection.'), yue: flat('開已儲存 FreePBX 連線嘅有類型管理器。') },
  'nodeCatalog.entry.open-webui-hosting.label': { en: flat('Open WebUI hosting'), yue: flat('Open WebUI 託管') },
  'nodeCatalog.entry.open-webui-hosting.description': { en: flat('Run Open WebUI with persistent data, local Ollama reuse, and a guided provider choice.'), yue: flat('用持久資料、本機 Ollama 重用同引導式供應商選擇執行 Open WebUI。') },
  'nodeCatalog.entry.nextcloud-hosting.label': { en: flat('Managed Nextcloud'), yue: flat('託管 Nextcloud') },
  'nodeCatalog.entry.nextcloud-hosting.description': { en: flat('Create a guided no-socket Nextcloud stack with PostgreSQL, Redis, secret files, and local recovery operations.'), yue: flat('建立有引導、無 socket 嘅 Nextcloud stack，用 PostgreSQL、Redis、秘密檔案同本機復原操作。') },
  'nextcloudManaged.title': { en: flat('Managed Nextcloud hosting'), yue: flat('託管 Nextcloud 主機') },
  'nextcloudManaged.intro': { en: flat('This profile manages PostgreSQL, Redis, and a Nextcloud web service without a container-runtime socket or privileged mode. Importing a project never deploys anything.'), yue: flat('呢個 profile 管理 PostgreSQL、Redis 同 Nextcloud 網頁服務，唔用 container runtime socket 或 privileged mode。匯入專案永遠唔會部署。') },
  'nextcloudManaged.context': { en: flat('Docker context'), yue: flat('Docker 環境') },
  'nextcloudManaged.chooseContext': { en: flat('Choose a verified context'), yue: flat('揀已驗證環境') },
  'nextcloudManaged.projectName': { en: flat('Managed project name'), yue: flat('託管專案名稱') },
  'nextcloudManaged.dataFolder': { en: flat('Data folder'), yue: flat('資料資料夾') },
  'nextcloudManaged.backupFolder': { en: flat('Backup folder'), yue: flat('備份資料夾') },
  'nextcloudManaged.chooseFolder': { en: flat('Choose a local folder'), yue: flat('揀本機資料夾') },
  'nextcloudManaged.browse': { en: flat('Browse'), yue: flat('瀏覽') },
  'nextcloudManaged.port': { en: flat('Loopback port'), yue: flat('本機回送埠') },
  'nextcloudManaged.searchServices': { en: flat('Search managed services'), yue: flat('搜尋託管服務') },
  'nextcloudManaged.regexServices': { en: flat('Regex builder for managed service search'), yue: flat('託管服務搜尋正則建立器') },
  'nextcloudManaged.services': { en: flat('Fixed managed services'), yue: flat('固定託管服務') },
  'nextcloudManaged.searchOperations': { en: flat('Search managed operations'), yue: flat('搜尋託管操作') },
  'nextcloudManaged.regexOperations': { en: flat('Regex builder for managed operation search'), yue: flat('託管操作搜尋正則建立器') },
  'nextcloudManaged.operations': { en: flat('Managed operation choices'), yue: flat('託管操作選擇') },
  'nextcloudManaged.operation.deploy': { en: flat('Deploy managed Nextcloud'), yue: flat('部署託管 Nextcloud') },
  'nextcloudManaged.operation.update': { en: flat('Update web service'), yue: flat('更新網頁服務') },
  'nextcloudManaged.operation.backup': { en: flat('Create backup'), yue: flat('建立備份') },
  'nextcloudManaged.operation.restore': { en: flat('Restore snapshot'), yue: flat('還原快照') },
  'nextcloudManaged.operation.rollback': { en: flat('Rollback update'), yue: flat('回復更新') },
  'nextcloudManaged.sequence': { en: flat('Sequence'), yue: flat('次序') },
  'nextcloudManaged.sequenceHint': { en: flat('Every step is fixed by the profile and can be cancelled while the host reports progress.'), yue: flat('每一步都由 profile 固定，主機報告進度時可以取消。') },
  'nextcloudManaged.searchSnapshots': { en: flat('Search verified snapshots'), yue: flat('搜尋已驗證快照') },
  'nextcloudManaged.regexSnapshots': { en: flat('Regex builder for snapshot search'), yue: flat('快照搜尋正則建立器') },
  'nextcloudManaged.snapshots': { en: flat('Verified snapshots'), yue: flat('已驗證快照') },
  'nextcloudManaged.noSnapshots': { en: flat('No verified snapshots are available yet. Create a backup first.'), yue: flat('暫時冇已驗證快照，先建立備份。') },
  'nextcloudManaged.busy': { en: flat('An operation is already running.'), yue: flat('已有操作進行中。') },
  'nextcloudManaged.missingBinding': { en: flat('Choose a Docker context and both local folders first.'), yue: flat('先揀 Docker 環境同兩個本機資料夾。') },
  'nextcloudManaged.missingSnapshot': { en: flat('Choose a verified snapshot first.'), yue: flat('先揀已驗證快照。') },
  'nextcloudManaged.working': { en: flat('Working…'), yue: flat('處理緊…') },
  'nextcloudManaged.portableIntent': { en: flat('Portable intent'), yue: flat('可攜意圖') },
  'nextcloudManaged.localOnly': { en: flat('Context, folders, secret keys, process state, and generated runtime data stay on this computer. The project file carries only the no-socket profile choice.'), yue: flat('Docker 環境、資料夾、秘密 key、程序狀態同生成嘅 runtime 資料只留喺呢部電腦。專案檔只帶無 socket profile 選擇。') },
  'nodeCatalog.entry.editor.label': { en: flat('Editor'), yue: flat('編輯器') },
  'nodeCatalog.entry.editor.description': { en: flat('Open a selected project file in the embedded editor.'), yue: flat('喺內置編輯器開揀好嘅項目檔案。') },
  'nodeCatalog.entry.diff.label': { en: flat('Diff viewer'), yue: flat('差異檢視器') },
  'nodeCatalog.entry.diff.description': { en: flat('Open a selected project file in the read-only diff viewer.'), yue: flat('喺唯讀差異檢視器開揀好嘅項目檔案。') },
  'nodeCatalog.entry.aws-identity.label': { en: flat('AWS identity'), yue: flat('AWS 身分管理') },
  'nodeCatalog.entry.aws-identity.description': { en: flat('Configure a local AWS profile, SSO session, assumed role, MFA route, endpoint, and region.'), yue: flat('設定本機 AWS profile、SSO 工作階段、角色、MFA 路徑、endpoint 同地區。') },
  'nodeCatalog.entry.aws-resource-explorer.label': { en: flat('AWS Resource Explorer'), yue: flat('AWS Resource Explorer') },
  'nodeCatalog.entry.aws-resource-explorer.description': { en: flat('Search indexed AWS resources through a guided, account-bound manager.'), yue: flat('用引導式、綁定帳戶嘅管理器搜尋已建立索引嘅 AWS 資源。') },
  'nodeCatalog.entry.aws-cloud-control.label': { en: flat('AWS Cloud Control'), yue: flat('AWS Cloud Control') },
  'nodeCatalog.entry.aws-cloud-control.description': { en: flat('Inspect and manage supported AWS resource types through typed controls.'), yue: flat('用有類型控制項檢視同管理支援嘅 AWS 資源類型。') },
  'nodeCatalog.entry.aws-s3.label': { en: flat('Amazon S3'), yue: flat('Amazon S3') },
  'nodeCatalog.entry.aws-s3.description': { en: flat('Browse buckets and objects through guided S3 operations.'), yue: flat('用引導式 S3 操作瀏覽 bucket 同 object。') },
  'nodeCatalog.entry.aws-ec2.label': { en: flat('Amazon EC2'), yue: flat('Amazon EC2') },
  'nodeCatalog.entry.aws-ec2.description': { en: flat('Inspect and manage EC2 instances, images, volumes, and networking through typed controls.'), yue: flat('用有類型控制項檢視同管理 EC2 instance、image、volume 同網絡。') },
  'nodeCatalog.entry.aws-iam.label': { en: flat('AWS IAM'), yue: flat('AWS IAM') },
  'nodeCatalog.entry.aws-iam.description': { en: flat('Review IAM identities and policies through explicit typed operations.'), yue: flat('用清楚嘅有類型操作檢視 IAM 身分同 policy。') },
  'nodeCatalog.entry.aws-sts.label': { en: flat('AWS STS'), yue: flat('AWS STS') },
  'nodeCatalog.entry.aws-sts.description': { en: flat('Inspect caller identity and guided temporary-role operations without storing credentials in the project.'), yue: flat('檢視 caller identity 同引導式臨時角色操作，唔會將憑證寫入項目。') },
  'nodeCatalog.entry.aws-lambda.label': { en: flat('AWS Lambda'), yue: flat('AWS Lambda') },
  'nodeCatalog.entry.aws-lambda.description': { en: flat('Browse and operate Lambda functions through model-backed forms.'), yue: flat('用模型驅動表單瀏覽同操作 Lambda function。') },
  'nodeCatalog.entry.aws-cloudwatch.label': { en: flat('Amazon CloudWatch'), yue: flat('Amazon CloudWatch') },
  'nodeCatalog.entry.aws-cloudwatch.description': { en: flat('Explore metrics, alarms, and dashboards through guided controls.'), yue: flat('用引導式控制項瀏覽 metric、alarm 同 dashboard。') },
  'nodeCatalog.entry.aws-logs.label': { en: flat('Amazon CloudWatch Logs'), yue: flat('Amazon CloudWatch Logs') },
  'nodeCatalog.entry.aws-logs.description': { en: flat('Browse log groups and streams with bounded searches and explicit export actions.'), yue: flat('用有界搜尋同清楚匯出操作瀏覽 log group 同 stream。') },
  'nodeCatalog.entry.aws-cloudformation.label': { en: flat('AWS CloudFormation'), yue: flat('AWS CloudFormation') },
  'nodeCatalog.entry.aws-cloudformation.description': { en: flat('Preview change sets before reviewed stack operations.'), yue: flat('先預覽 change set，再進行經覆核嘅 stack 操作。') },
  'nodeCatalog.entry.aws-cdk.label': { en: flat('AWS CDK'), yue: flat('AWS CDK') },
  'nodeCatalog.entry.aws-cdk.description': { en: flat('Choose a trusted project folder, then synthesize and review changes before deployment.'), yue: flat('揀可信項目資料夾，先 synth 同覆核變更，再部署。') },
  'nodeCatalog.entry.aws-ecr.label': { en: flat('Amazon ECR'), yue: flat('Amazon ECR') },
  'nodeCatalog.entry.aws-ecr.description': { en: flat('Manage container repositories and images through typed controls.'), yue: flat('用有類型控制項管理 container repository 同 image。') },
  'nodeCatalog.entry.aws-ecs.label': { en: flat('Amazon ECS'), yue: flat('Amazon ECS') },
  'nodeCatalog.entry.aws-ecs.description': { en: flat('Inspect clusters, services, tasks, and deployments through guided controls.'), yue: flat('用引導式控制項檢視 cluster、service、task 同 deployment。') },
  'nodeCatalog.entry.aws-eks.label': { en: flat('Amazon EKS'), yue: flat('Amazon EKS') },
  'nodeCatalog.entry.aws-eks.description': { en: flat('Inspect clusters and workloads through explicit model-backed controls.'), yue: flat('用清楚嘅模型驅動控制項檢視 cluster 同 workload。') },
  'nodeCatalog.entry.aws-rds.label': { en: flat('Amazon RDS'), yue: flat('Amazon RDS') },
  'nodeCatalog.entry.aws-rds.description': { en: flat('Manage database instances and clusters through guided controls.'), yue: flat('用引導式控制項管理 database instance 同 cluster。') },
  'nodeCatalog.entry.aws-databases.label': { en: flat('AWS databases'), yue: flat('AWS 資料庫') },
  'nodeCatalog.entry.aws-databases.description': { en: flat('Browse supported AWS database services through typed service models.'), yue: flat('用有類型服務模型瀏覽支援嘅 AWS 資料庫服務。') },
  'nodeCatalog.entry.aws-vpc.label': { en: flat('Amazon VPC'), yue: flat('Amazon VPC') },
  'nodeCatalog.entry.aws-vpc.description': { en: flat('Inspect networks, subnets, routes, gateways, and security groups through guided controls.'), yue: flat('用引導式控制項檢視 network、subnet、route、gateway 同 security group。') },
  'nodeCatalog.entry.aws-route53.label': { en: flat('Amazon Route 53'), yue: flat('Amazon Route 53') },
  'nodeCatalog.entry.aws-route53.description': { en: flat('Manage hosted zones, records, and health checks through reviewed operations.'), yue: flat('用經覆核操作管理 hosted zone、record 同 health check。') },
  'nodeCatalog.entry.aws-cost.label': { en: flat('AWS cost management'), yue: flat('AWS 成本管理') },
  'nodeCatalog.entry.aws-cost.description': { en: flat('Explore cost and usage data with explicit account, period, and grouping controls.'), yue: flat('用清楚嘅帳戶、時段同分組控制項瀏覽成本同使用量資料。') },
  'nodeCatalog.entry.aws-service.label': { en: flat('All AWS services'), yue: flat('所有 AWS 服務') },
  'nodeCatalog.entry.aws-service.description': { en: flat('Create a typed AWS service workspace from installed CLI models without a raw command fallback.'), yue: flat('用已安裝 CLI 模型建立有類型 AWS 服務工作區，唔提供 raw command 後備路徑。') },
  'nodeCatalog.entry.aws-universe.label': { en: flat('AWS Universe'), yue: flat('AWS 宇宙') },
  'nodeCatalog.entry.aws-universe.description': { en: flat('Create an AWS-only child canvas with a dedicated Shop node.'), yue: flat('建立只限 AWS、附有專屬 Shop 節點嘅子畫布。') },
  'awsUniverse.title': { en: flat('AWS Universe'), yue: flat('AWS 宇宙') },
  'awsUniverse.description': { en: flat('An AWS-only canvas. Provider credentials and runtime bindings stay on this computer.'), yue: flat('只限 AWS 嘅畫布。供應商憑證同執行綁定留喺呢部電腦。') },
  'awsUniverse.open': { en: flat('Open AWS Universe'), yue: flat('開啟 AWS 宇宙') },
  'awsUniverse.scope': { en: flat('AWS-only scope'), yue: flat('只限 AWS 範圍') },
  'awsUniverse.search.label': { en: flat('Search AWS Universes'), yue: flat('搜尋 AWS 宇宙') },
  'awsUniverse.search.placeholder': { en: flat('Name or instance id'), yue: flat('名稱或 instance id') },
  'awsUniverse.search.regex': { en: flat('Open regex builder for AWS Universe search'), yue: flat('開啟 AWS 宇宙搜尋正則建立器') },
  'awsUniverse.search.count': { en: flat('{count} AWS Universe instances shown'), yue: flat('顯示 {count} 個 AWS 宇宙 instance') },
  'awsUniverse.empty': { en: flat('No AWS Universe instances match this search.'), yue: flat('冇 AWS 宇宙 instance 符合呢個搜尋。') },
  'awsUniverse.new': { en: flat('New AWS Universe'), yue: flat('新增 AWS 宇宙') },
  'awsUniverse.name': { en: flat('Universe name'), yue: flat('宇宙名稱') },
  'awsUniverse.nameRequired': { en: flat('Enter a name before creating the AWS Universe.'), yue: flat('建立 AWS 宇宙之前請先輸入名稱。') },
  'awsUniverse.create': { en: flat('Create and open'), yue: flat('建立並開啟') },
  'awsUniverse.created': { en: flat('AWS Universe created.'), yue: flat('AWS 宇宙已建立。') },
  'awsUniverse.createFailed': { en: flat('The AWS Universe could not be created.'), yue: flat('AWS 宇宙未能建立。') },
  'awsUniverse.preview': { en: flat('Creates one AWS-only child canvas with one permanent scoped Shop.'), yue: flat('建立一個只限 AWS、附有一個永久範圍 Shop 嘅子畫布。') },

  // ---------------------------------------------------------------------------------------
  // Unified Node Catalog. Registry rows carry stable ids and the picker resolves these keys
  // through the active language mode while retaining English fallbacks for missing additions.
  'nodeCatalog.title': { en: flat('Node Catalog'), yue: flat('節點目錄') },
  'nodeCatalog.description': { en: flat('Choose a node from the typed catalog. Safe defaults are applied now; machine-local details stay local.'), yue: flat('喺有類型嘅目錄揀個節點。安全預設值即刻套用，本機資料留返本機。') },
  'nodeCatalog.search.label': { en: flat('Search node catalog'), yue: flat('搜尋節點目錄') },
  'nodeCatalog.search.regex': { en: flat('Open regex builder for this catalog'), yue: flat('開啟呢個目錄嘅正則建立器') },
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
  'nodeCatalog.empty': { en: flat('No nodes match this search. Try plain text or open the regex builder for a pattern.'), yue: flat('冇節點符合呢個搜尋。試下普通文字，或者開正則建立器整個模式。') },
  'nodeCatalog.keyboardHint': { en: flat('Use Up and Down to choose, Enter to create, and Escape to clear or close. Disabled rows explain what to do next.'), yue: flat('用上下揀選，Enter 建立，Escape 清除或關閉。停用項目會講埋下一步點做。') },
  'nodeCatalog.plannedReason': { en: flat('This capability is planned and not implemented yet.'), yue: flat('呢項功能已規劃但仲未實作。') },
  'nodeCatalog.entry.terminal.label': { en: flat('Terminal'), yue: flat('終端機') },
  'nodeCatalog.entry.terminal.description': { en: flat('Open a real shell with the saved safe profile.'), yue: flat('用已儲存嘅安全設定開真正嘅終端機。') },
  'nodeCatalog.entry.sticky.label': { en: flat('Sticky note'), yue: flat('便利貼') },
  'nodeCatalog.entry.sticky.description': { en: flat('Add an editable note that can carry project context.'), yue: flat('加張可以編輯、用嚟記低項目背景嘅筆記。') },
  'nodeCatalog.entry.group.label': { en: flat('Group frame'), yue: flat('群組框') },
  'nodeCatalog.entry.group.description': { en: flat('Add an empty frame for organizing related nodes.'), yue: flat('加個空框，整理相關節點。') },
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
  'nodeCatalog.entry.web.label': { en: flat('Web view'), yue: flat('網頁檢視') },
  'nodeCatalog.entry.web.description': { en: flat('Open a web view with a URL chosen in its guided address field.'), yue: flat('用引導式網址欄揀網址，再開網頁檢視。') },
  'nodeCatalog.entry.video.label': { en: flat('Video'), yue: flat('影片') },
  'nodeCatalog.entry.video.description': { en: flat('Open a local video node and choose the media file in its picker.'), yue: flat('開本機影片節點，再用選擇器揀媒體檔案。') },
  'nodeCatalog.entry.nsis.label': { en: flat('Installer builder'), yue: flat('安裝程式建立器') },
  'nodeCatalog.entry.nsis.description': { en: flat('Start a guided installer-builder form with safe project defaults.'), yue: flat('用安全項目預設值開始引導式安裝程式表單。') },
  'nodeCatalog.entry.annotation.label': { en: flat('Drawing annotation'), yue: flat('繪圖註解') },
  'nodeCatalog.entry.annotation.description': { en: flat('Arm the drawing tool, then drag a line or arrow on the canvas.'), yue: flat('啟用繪圖工具，再喺畫布拖出直線或箭嘴。') },
  'nodeCatalog.entry.agent.claude.label': { en: flat('Claude'), yue: flat('Claude') },
  'nodeCatalog.entry.agent.claude.description': { en: flat('Start an agent session with the active account and permission plan.'), yue: flat('用目前帳戶同權限方案開始 AI 代理工作階段。') },
  'nodeCatalog.entry.agent.codex.label': { en: flat('Codex'), yue: flat('Codex') },
  'nodeCatalog.entry.agent.codex.description': { en: flat('Start a Codex agent session using a selectable local account.'), yue: flat('用可選嘅本機帳戶開始 Codex 代理工作階段。') },
  'nodeCatalog.entry.agent.gemini.label': { en: flat('Gemini'), yue: flat('Gemini') },
  'nodeCatalog.entry.agent.gemini.description': { en: flat('Start a Gemini agent session with the configured launch command.'), yue: flat('用已設定嘅啟動指令開始 Gemini 代理工作階段。') },
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
  'nodeCatalog.entry.photo.label': { en: flat('Photo'), yue: flat('相片') },
  'nodeCatalog.entry.photo.description': { en: flat('Place a project-owned photo asset with a portable reference.'), yue: flat('用可攜參照放置項目相片資產。') },
  'nodeCatalog.entry.gallery.label': { en: flat('Gallery'), yue: flat('相簿') },
  'nodeCatalog.entry.gallery.description': { en: flat('Arrange project-owned photos and videos in a mixed-media gallery.'), yue: flat('喺混合媒體相簿整理項目相片同影片。') },
  'nodeCatalog.entry.torrent.label': { en: flat('Torrent downloader'), yue: flat('種子下載器') },
  'nodeCatalog.entry.torrent.description': { en: flat('Queue a bounded, resumable torrent download with an explicit destination.'), yue: flat('排程有界、可續傳嘅種子下載，並指定目的地。') },
  'nodeCatalog.entry.linux-vm.label': { en: flat('Linux VM'), yue: flat('Linux 虛擬機') },
  'nodeCatalog.entry.linux-vm.description': { en: flat('Create a guided QEMU Linux VM blueprint with network off by default.'), yue: flat('建立預設關閉網絡嘅引導式 QEMU Linux 虛擬機藍圖。') },
  'nodeCatalog.entry.multiverse-portal.label': { en: flat('Multiverse portal'), yue: flat('多元宇宙入口') },
  'nodeCatalog.entry.multiverse-portal.description': { en: flat('Create a door-only Multiverse canvas below the depth limit.'), yue: flat('喺深度上限內建立只作入口嘅多元宇宙畫布。') },
  'nodeCatalog.entry.aws-universe.label': { en: flat('AWS Universe'), yue: flat('AWS 宇宙') },
  'nodeCatalog.entry.aws-universe.description': { en: flat('Create an AWS-only child canvas with a dedicated Shop node.'), yue: flat('建立只屬 AWS、附專用 Shop 節點嘅子畫布。') },
  'nodeCatalog.entry.aws-service.label': { en: flat('AWS service node'), yue: flat('AWS 服務節點') },
  'nodeCatalog.entry.aws-service.description': { en: flat('Create a typed AWS service blueprint from installed CLI models.'), yue: flat('用已安裝 CLI 模型建立有類型 AWS 服務藍圖。') },
  'nodeCatalog.entry.aws-identity.label': { en: flat('AWS identity'), yue: flat('AWS 身份') },
  'nodeCatalog.entry.aws-identity.description': { en: flat('Inspect the selected AWS identity before creating AWS resources.'), yue: flat('建立 AWS 資源前檢查揀選嘅 AWS 身份。') },
  'nodeCatalog.entry.aws-resource-explorer.label': { en: flat('AWS Resource Explorer'), yue: flat('AWS 資源探索器') },
  'nodeCatalog.entry.aws-resource-explorer.description': { en: flat('Search AWS resources through the verified Resource Explorer capability.'), yue: flat('透過已驗證嘅資源探索器功能搜尋 AWS 資源。') },
  'nodeCatalog.entry.aws-s3.label': { en: flat('AWS S3'), yue: flat('AWS S3') },
  'nodeCatalog.entry.aws-s3.description': { en: flat('Create a guided S3 storage blueprint with binding configured later.'), yue: flat('建立引導式 S3 儲存藍圖，稍後先設定綁定。') },
  'nodeCatalog.entry.aws-ec2.label': { en: flat('AWS EC2'), yue: flat('AWS EC2') },
  'nodeCatalog.entry.aws-ec2.description': { en: flat('Create a guided EC2 compute blueprint with binding configured later.'), yue: flat('建立引導式 EC2 運算藍圖，稍後先設定綁定。') },
  'nodeCatalog.entry.cloudflare-hosting.label': { en: flat('Cloudflare hosting'), yue: flat('Cloudflare 託管') },
  'nodeCatalog.entry.cloudflare-hosting.description': { en: flat('Create a private-first hosting blueprint with explicit tunnel exposure later.'), yue: flat('建立私密優先嘅託管藍圖，稍後先明確開放通道。') },
  'nodeCatalog.entry.gitlab-hosting.label': { en: flat('GitLab hosting'), yue: flat('GitLab 託管') },
  'nodeCatalog.entry.gitlab-hosting.description': { en: flat('Create a guided GitLab hosting blueprint with local credentials later.'), yue: flat('建立引導式 GitLab 託管藍圖，稍後先綁定本機憑證。') },
  'nodeCatalog.entry.nextcloud-hosting.label': { en: flat('Nextcloud hosting'), yue: flat('Nextcloud 託管') },
  'nodeCatalog.entry.nextcloud-hosting.description': { en: flat('Create a managed Nextcloud hosting blueprint with local binding later.'), yue: flat('建立受管理嘅 Nextcloud 託管藍圖，稍後先綁定本機。') },
  'nodeCatalog.entry.open-webui-hosting.label': { en: flat('Open WebUI hosting'), yue: flat('Open WebUI 託管') },
  'nodeCatalog.entry.open-webui-hosting.description': { en: flat('Create an Open WebUI hosting blueprint that can reuse local Ollama.'), yue: flat('建立可重用本機 Ollama 嘅 Open WebUI 託管藍圖。') },
  'nodeCatalog.entry.wild-dim-sum.label': { en: flat('Wild dim sum'), yue: flat('驚喜點心') },
  'nodeCatalog.entry.wild-dim-sum.description': { en: flat('Add a public-catalog dim-sum surprise node without copying the photo.'), yue: flat('加入公共目錄點心驚喜節點，但唔複製相片。') },
  'nodeCatalog.entry.homeassistant-control.label': { en: flat('Home Assistant control'), yue: flat('Home Assistant 控制') },
  'nodeCatalog.entry.homeassistant-control.description': { en: flat('Create a typed Home Assistant control node from a verified domain schema.'), yue: flat('用已驗證領域結構建立有類型 Home Assistant 控制節點。') },
  'nodeCatalog.entry.homeassistant-sensor.label': { en: flat('Home Assistant sensor'), yue: flat('Home Assistant 感測器') },
  'nodeCatalog.entry.homeassistant-sensor.description': { en: flat('Create a typed Home Assistant sensor display with safe binding intent.'), yue: flat('用安全綁定意圖建立有類型 Home Assistant 感測器顯示。') },
  'nodeCatalog.entry.calendar.label': { en: flat('Calendar'), yue: flat('日曆') },
  'nodeCatalog.entry.calendar.description': { en: flat('Create a portable calendar definition with local account binding later.'), yue: flat('建立可攜日曆定義，稍後先綁定本機帳戶。') },
  'nodeCatalog.entry.timer.label': { en: flat('Timer'), yue: flat('計時器') },
  'nodeCatalog.entry.timer.description': { en: flat('Create a timer blueprint with a local execution binding later.'), yue: flat('建立計時器藍圖，稍後先綁定本機執行。') },
  'nodeCatalog.entry.alarm.label': { en: flat('Alarm clock'), yue: flat('鬧鐘') },
  'nodeCatalog.entry.alarm.description': { en: flat('Create an alarm definition without writing a machine-specific schedule.'), yue: flat('建立鬧鐘定義，唔寫入機器專屬排程。') },
  'nodeCatalog.entry.planner.label': { en: flat('Planner'), yue: flat('規劃器') },
  'nodeCatalog.entry.planner.description': { en: flat('Create a planner occurrence definition with explicit local binding.'), yue: flat('建立規劃器事件定義，明確指定本機綁定。') },

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
  'welcome.build.title': {
    en: flat('The build this window is running'),
    yue: flat('呢個視窗而家行緊嘅版本')
  },
  'welcome.build.updated': {
    en: flat('Updated'),
    yue: flat('更新於')
  },
  'welcome.build.unavailable': {
    en: flat('Updated time unavailable'),
    yue: flat('更新時間未能提供')
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
  'terminalProfiles.settings.namedTitle': {
    en: flat('Named terminal profiles'),
    yue: flat('有名終端機設定檔')
  },
  'terminalProfiles.settings.namedDescription': {
    en: flat('Save a shell, start directory, startup command, account, and safe environment values for this machine. These values never travel in a project file.'),
    yue: flat('喺呢部機儲存 Shell、啟動目錄、啟動指令、帳戶同安全環境值。呢啲資料唔會放入項目檔。')
  },
  'terminalProfiles.settings.nameLabel': { en: flat('Profile name'), yue: flat('設定檔名稱') },
  'terminalProfiles.settings.namePlaceholder': { en: flat('Projects'), yue: flat('Projects') },
  'terminalProfiles.settings.shellLabel': { en: flat('Shell profile'), yue: flat('Shell 設定檔') },
  'terminalProfiles.settings.directoryLabel': { en: flat('Start directory'), yue: flat('啟動目錄') },
  'terminalProfiles.settings.chooseDirectory': { en: flat('Choose start directory'), yue: flat('揀啟動目錄') },
  'terminalProfiles.settings.startupLabel': { en: flat('Startup command'), yue: flat('啟動指令') },
  'terminalProfiles.settings.accountLabel': { en: flat('Account'), yue: flat('帳戶') },
  'terminalProfiles.settings.noAccount': { en: flat('No account binding'), yue: flat('唔綁定帳戶') },
  'terminalProfiles.settings.envKey': { en: flat('Environment key'), yue: flat('環境鍵') },
  'terminalProfiles.settings.envValue': { en: flat('Environment value'), yue: flat('環境值') },
  'terminalProfiles.settings.addNamed': { en: flat('Save named profile'), yue: flat('儲存有名設定檔') },
  'terminalProfiles.settings.removeNamed': { en: flat('Remove'), yue: flat('移除') },

  'terminalProfiles.named.heading': {
    en: flat('Named terminal profiles'),
    yue: flat('已命名終端機設定檔')
  },
  'terminalProfiles.named.description': {
    en: flat('Save a name, initial directory, and optional startup command for new terminal or agent nodes. These values stay on this computer and are not written to shared project files.'),
    yue: flat('為新終端機或代理節點儲存名稱、初始目錄同可選啟動指令。呢啲值只留喺呢部電腦，唔會寫入共享項目檔案。')
  },
  'terminalProfiles.named.search': {
    en: flat('Search named profiles'),
    yue: flat('搜尋已命名設定檔')
  },
  'terminalProfiles.named.listLabel': {
    en: flat('Saved named terminal profiles'),
    yue: flat('已儲存嘅已命名終端機設定檔')
  },
  'terminalProfiles.named.empty': {
    en: flat('No named profiles match this search. Create one below.'),
    yue: flat('冇已命名設定檔符合呢次搜尋。可以喺下面建立一個。')
  },
  'terminalProfiles.named.noStartup': {
    en: flat('No startup command'),
    yue: flat('冇啟動指令')
  },
  'terminalProfiles.named.default': {
    en: flat('Default'),
    yue: flat('預設')
  },
  'terminalProfiles.named.useDefault': {
    en: flat('Use for new nodes'),
    yue: flat('用於新節點')
  },
  'terminalProfiles.named.defaultStatus': {
    en: flat('{profile} is used for one-click new nodes.'),
    yue: flat('{profile} 會用於一按建立嘅新節點。')
  },
  'terminalProfiles.named.edit': {
    en: flat('Edit'),
    yue: flat('編輯')
  },
  'terminalProfiles.named.remove': {
    en: flat('Remove'),
    yue: flat('移除')
  },
  'terminalProfiles.named.confirmRemove': {
    en: flat('Confirm remove'),
    yue: flat('確認移除')
  },
  'terminalProfiles.named.editorTitle': {
    en: flat('Create named profile'),
    yue: flat('建立已命名設定檔')
  },
  'terminalProfiles.named.nameLabel': {
    en: flat('Name'),
    yue: flat('名稱')
  },
  'terminalProfiles.named.nameDescription': {
    en: flat('A short label shown in profile pickers.'),
    yue: flat('喺設定檔選擇器顯示嘅簡短標籤。')
  },
  'terminalProfiles.named.cwdLabel': {
    en: flat('Initial directory'),
    yue: flat('初始目錄')
  },
  'terminalProfiles.named.cwdDescription': {
    en: flat('The directory opened before the startup command runs.'),
    yue: flat('啟動指令執行之前先開啟嘅目錄。')
  },
  'terminalProfiles.named.browse': {
    en: flat('Browse…'),
    yue: flat('瀏覽…')
  },
  'terminalProfiles.named.commandLabel': {
    en: flat('Startup command'),
    yue: flat('啟動指令')
  },
  'terminalProfiles.named.commandDescription': {
    en: flat('Optional text sent once after the shell is ready. It is user-authored and runs locally.'),
    yue: flat('Shell 準備好之後可選擇傳送一次嘅文字。由使用者撰寫，並喺本機執行。')
  },
  'terminalProfiles.named.invalid': {
    en: flat('Enter a name and initial directory. Keep each value within its stated limit.'),
    yue: flat('請輸入名稱同初始目錄，每個值都要符合旁邊列出嘅限制。')
  },
  'terminalProfiles.named.cancel': {
    en: flat('Cancel'),
    yue: flat('取消')
  },
  'terminalProfiles.named.saveChanges': {
    en: flat('Save changes'),
    yue: flat('儲存更改')
  },
  'terminalProfiles.named.create': {
    en: flat('Create profile'),
    yue: flat('建立設定檔')
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
    en: flat('This terminal could not be started.'),
    yue: flat('呢個終端機無法啟動。')
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
  // Agent context-link picker and handle descriptions. Provider labels remain factual; the
  // surrounding copy follows the live language mode and both per-language funny levels.
  // ---------------------------------------------------------------------------------------
  'agentLink.handle.out': {
    en: flat('Link out: drag to another context-capable agent node so they can read each other’s context'),
    yue: flat('連出去：拖去另一個支援內容連結嘅代理節點，等佢哋可以互相讀取內容')
  },
  'agentLink.handle.in': {
    en: flat('Link in: drop a link here to share context with this context-capable agent session'),
    yue: flat('連入嚟：將連結放喺呢度，同呢個支援內容連結嘅代理階段分享內容')
  },
  'agentLink.handle.noteOut': {
    en: flat('Link out: drag to a sticky note to attach it as context'),
    yue: flat('連出去：拖去便利貼，將佢附加為內容')
  },
  'agentLink.handle.noteIn': {
    en: flat('Link in: drop a sticky note link here to attach it as context'),
    yue: flat('連入嚟：將便利貼連結放喺呢度，將佢附加為內容')
  },
  'agentLink.headerAction.title': {
    en: flat('Link to another agent'),
    yue: flat('連結另一個代理')
  },
  'agentLink.headerAction.aria': {
    en: flat('Link {title} to another agent'),
    yue: flat('將 {title} 連結到另一個代理')
  },
  'agentLink.dialog.title': {
    en: [
      'Link {source} to another agent',
      'Pick an agent to link with {source}',
      'Choose a context partner for {source}',
      'Choose who {source} can read with',
      'Pick {source}’s context buddy'
    ],
    yue: [
      '將 {source} 連結到另一個代理',
      '揀一個代理同 {source} 連結',
      '為 {source} 揀一個內容夥伴',
      '揀邊個可以同 {source} 互相讀取',
      '幫 {source} 揀個內容拍檔'
    ]
  },
  'agentLink.dialog.description': {
    en: flat('Choose a context-capable agent. No transcript is sent automatically.'),
    yue: flat('揀一個支援內容連結嘅代理。系統唔會自動傳送對話記錄。')
  },
  'agentLink.dialog.filter': {
    en: flat('Filter link targets'),
    yue: flat('篩選連結目標')
  },
  'agentLink.dialog.filterPlaceholder': {
    en: flat('Filter agents…'),
    yue: flat('篩選代理…')
  },
  'agentLink.dialog.filterPlaceholderRegex': {
    en: flat('Filter agents… (regex)'),
    yue: flat('篩選代理…（正則表達式）')
  },
  'agentLink.dialog.regexLabel': {
    en: flat('Regex — agent link picker'),
    yue: flat('正則表達式 — 代理連結選擇器')
  },
  'agentLink.dialog.targets': {
    en: flat('Available agent link targets'),
    yue: flat('可用代理連結目標')
  },
  'agentLink.dialog.empty': {
    en: flat('No other context-capable agents are available.'),
    yue: flat('目前沒有其他支援內容連結嘅代理。')
  },
  'agentLink.dialog.noMatch': {
    en: flat('No agents match that filter.'),
    yue: flat('冇代理符合呢個篩選。')
  },
  'agentLink.dialog.untitled': {
    en: flat('Untitled agent'),
    yue: flat('未命名代理')
  },
  'agentLink.dialog.cancel': {
    en: flat('Cancel'),
    yue: flat('取消')
  },
  'agentLink.result.stale': {
    en: flat('That agent link is no longer available.'),
    yue: flat('嗰個代理連結已經唔再可用。')
  },
  'agentLink.result.duplicate': {
    en: flat('Those agents are already linked.'),
    yue: flat('嗰兩個代理已經連結。')
  },
  'regex.trigger.openTitle': {
    en: flat('Switch to regex and open the builder'),
    yue: flat('切換到正則表達式並開啟建立器')
  },
  'regex.trigger.activeTitle': {
    en: flat('Regex mode: open the builder'),
    yue: flat('正則表達式模式：開啟建立器')
  },
  'regex.trigger.aria': {
    en: flat('Open regex builder'),
    yue: flat('開啟正則表達式建立器')
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
  },

  // ---------------------------------------------------------------------------------------
  // Special-universe Shop node. Scope and catalog counts are caller-owned facts; the catalogue
  // only styles the surrounding copy for the selected language and funny level.
  // ---------------------------------------------------------------------------------------
  'universeShop.title': {
    en: flat('Shop'),
    yue: flat('商店')
  },
  'universeShop.scope': {
    en: flat('{scope} catalog'),
    yue: flat('{scope} 目錄')
  },
  'universeShop.description': {
    en: [
      'Choose a node to create in this universe. The catalog is scoped and stays local to this Shop.',
      'Pick something for this universe. This Shop keeps the catalog in its lane.',
      'Choose a node here; the catalog knows which universe it belongs to.',
      'Pick a node for this universe, with the catalog politely staying in bounds.',
      'Choose a node and let this Shop do the shopping, without wandering into another universe.'
    ],
    yue: [
      '揀一個節點喺呢個宇宙建立。目錄有範圍，留喺呢間商店入面。',
      '揀啱呢個宇宙用嘅嘢，間商店會守好自己條界線。',
      '喺呢度揀節點，目錄會認得自己屬於邊個宇宙。',
      '揀個節點畀呢個宇宙，目錄乖乖留返喺範圍內。',
      '揀個節點，等間商店幫你買，唔好行錯去第二個宇宙。'
    ]
  },
  'universeShop.search.label': {
    en: flat('Search catalog'),
    yue: flat('搜尋目錄')
  },
  'universeShop.search.placeholder': {
    en: flat('Search nodes'),
    yue: flat('搜尋節點')
  },
  'universeShop.search.regex': {
    en: flat('Open regex builder for this catalog'),
    yue: flat('開啟呢個目錄嘅正則建立器')
  },
  'universeShop.search.error': {
    en: flat('Pattern is invalid. Showing all scoped entries.'),
    yue: flat('模式無效，依家顯示全部範圍內項目。')
  },
  'universeShop.search.count': {
    en: flat('{count} scoped entries'),
    yue: flat('{count} 個範圍內項目')
  },
  'universeShop.empty': {
    en: flat('No catalog entries match this search.'),
    yue: flat('冇目錄項目符合呢個搜尋。')
  },
  'universeShop.catalogUnavailable': {
    en: flat('The unified Node Catalog is unavailable in this build. Enable the catalog dependency before creating nodes.'),
    yue: flat('呢個版本未有共用節點目錄。請先啟用目錄功能，之後先可以建立節點。')
  },
  'universeShop.invalidScope': {
    en: flat('This Shop has incomplete universe scope metadata, so catalog creation is unavailable.'),
    yue: flat('呢間商店嘅宇宙範圍資料唔完整，所以暫時未可以建立目錄項目。')
  },
  'universeShop.entryUnavailable': {
    en: flat('This catalog entry is unavailable until its executor is available.'),
    yue: flat('呢個目錄項目要等執行功能可用先可以使用。')
  },
  'universeShop.entries.aria': {
    en: flat('Available catalog entries'),
    yue: flat('可用目錄項目')
  },
  'universeShop.selected': {
    en: flat('{entry} selected. Use the shared creation action to continue.'),
    yue: flat('已揀 {entry}，用共用建立動作繼續。')
  },
  'universeShop.hint': {
    en: flat('This Shop stays available as the one catalog entry point for this universe.'),
    yue: flat('呢間商店會一直做呢個宇宙唯一嘅目錄入口。')
  },
  'universeShop.aria.label': {
    en: flat('Shop for {scope}'),
    yue: flat('{scope} 商店')
  },
  'universeShop.fixed.title': {
    en: flat('This Shop belongs to its universe and cannot be moved or deleted.'),
    yue: flat('呢間商店屬於自己嘅宇宙，唔可以移動或者刪除。')
  },
  // ---------------------------------------------------------------------------------------
  // Multiverse door construction. Part names and material names are localized here rather
  // than embedded in the guided picker, so the constructor follows every language mode.
  // ---------------------------------------------------------------------------------------
  'doorConstruction.title': { en: flat('Construct a Multiverse door'), yue: flat('砌一度多重宇宙門') },
  'doorConstruction.description': {
    en: [
      'Build the frame, hinges, panel, handle, and activation core. Only safe door intent travels with the project; local credentials and runtime state stay on this computer.',
      'Choose each physical door part and arm its activation core. The project carries safe intent, while local credentials and runtime state stay here.',
      'Pick the frame, hinges, panel, handle, and core. Portable data remembers the design, not this computer\'s credentials or running state.',
      'Assemble the five parts, then arm the core. A copied project gets the door plan and none of the machine-local baggage.',
      'Build the whole door, wake its core, and let the project pack only the safe blueprint. Local secrets and live machinery stay home.'
    ],
    yue: [
      '砌好門框、鉸鏈、門板、門柄同啟動核心。專案只會帶安全門意圖，本機憑證同執行狀態留返喺呢部電腦。',
      '逐件揀實體門零件，再啟動核心。專案只帶安全意圖，本機憑證同執行狀態留返喺度。',
      '揀門框、鉸鏈、門板、門柄同核心。可攜資料記住設計，唔會帶走呢部電腦嘅憑證或者執行狀態。',
      '砌齊五件零件，再啟動核心。拎走專案只會拎走門嘅藍圖，唔會順手拎埋本機資料。',
      '砌完整度門、叫醒個核心，等專案只打包安全藍圖。本機秘密同執行中嘅機件留喺屋企。'
    ]
  },
  'doorConstruction.route': { en: flat('Route: {from} → {to}'), yue: flat('路線：{from} → {to}') },
  'doorConstruction.name': { en: flat('Door name'), yue: flat('門名稱') },
  'doorConstruction.parts': { en: flat('Door parts'), yue: flat('門零件') },
  'doorConstruction.part.frame': { en: flat('Frame'), yue: flat('門框') },
  'doorConstruction.part.hinges': { en: flat('Hinges'), yue: flat('鉸鏈') },
  'doorConstruction.part.panel': { en: flat('Panel'), yue: flat('門板') },
  'doorConstruction.part.handle': { en: flat('Handle'), yue: flat('門柄') },
  'doorConstruction.part.activationCore': { en: flat('Activation core'), yue: flat('啟動核心') },
  'doorConstruction.picker.hint': { en: flat('Choose a real part, then continue to the next step.'), yue: flat('揀一件真正零件，再去下一步。') },
  'doorConstruction.search.label': { en: flat('Search available parts'), yue: flat('搜尋可用零件') },
  'doorConstruction.search.placeholder': { en: flat('Name or material'), yue: flat('名稱或物料') },
  'doorConstruction.search.regex': { en: flat('Open regex builder for this part search'), yue: flat('開啟呢個零件搜尋嘅正則建立器') },
  'doorConstruction.search.count': { en: flat('{count} parts shown'), yue: flat('顯示 {count} 件零件') },
  'doorConstruction.search.empty': { en: flat('No parts match this search.'), yue: flat('冇零件符合呢個搜尋。') },
  'doorConstruction.nameRequired': { en: flat('Give the door a name before continuing.'), yue: flat('繼續之前請先幫道門改個名。') },
  'doorConstruction.missingParts': { en: flat('Configure {parts} before activating the door.'), yue: flat('啟動道門之前請先設定 {parts}。') },
  'doorConstruction.armed': { en: flat('Activation core armed. Review the construction, then activate the door.'), yue: flat('啟動核心已上膛。檢查好門，再啟動。') },
  'doorConstruction.core.armed': { en: flat('Armed and ready for activation.'), yue: flat('已上膛，準備啟動。') },
  'doorConstruction.core.waiting': { en: flat('Waiting until the other four parts are configured.'), yue: flat('等緊其餘四件零件設定好。') },
  'doorConstruction.core.disabled': { en: flat('Configure the four physical parts first.'), yue: flat('請先設定四件實體零件。') },
  'doorConstruction.arm': { en: flat('Arm activation core'), yue: flat('啟動核心上膛') },
  'doorConstruction.cancel': { en: flat('Cancel'), yue: flat('取消') },
  'doorConstruction.activate': { en: flat('Activate door'), yue: flat('啟動道門') },
  'doorConstruction.choice.frame.stone.title': { en: flat('Stone frame'), yue: flat('石門框') },
  'doorConstruction.choice.frame.stone.description': { en: flat('A sturdy frame that marks the doorway.'), yue: flat('穩陣門框，清楚標示門口。') },
  'doorConstruction.choice.frame.wood.title': { en: flat('Wood frame'), yue: flat('木門框') },
  'doorConstruction.choice.frame.wood.description': { en: flat('A warm frame with a simple grain.'), yue: flat('帶住簡單木紋嘅溫暖門框。') },
  'doorConstruction.choice.frame.metal.title': { en: flat('Metal frame'), yue: flat('金屬門框') },
  'doorConstruction.choice.frame.metal.description': { en: flat('A clean frame for a technical doorway.'), yue: flat('俐落嘅技術門口門框。') },
  'doorConstruction.choice.hinges.metal.title': { en: flat('Metal hinges'), yue: flat('金屬鉸鏈') },
  'doorConstruction.choice.hinges.metal.description': { en: flat('A pair of visible hinges for the swing.'), yue: flat('一對睇得見、負責擺動嘅鉸鏈。') },
  'doorConstruction.choice.hinges.stone.title': { en: flat('Stone pivots'), yue: flat('石樞紐') },
  'doorConstruction.choice.hinges.stone.description': { en: flat('Heavy pivots for a grounded door.'), yue: flat('沉實門扉用嘅厚重樞紐。') },
  'doorConstruction.choice.panel.wood.title': { en: flat('Wood panel'), yue: flat('木門板') },
  'doorConstruction.choice.panel.wood.description': { en: flat('A solid panel that fills the frame.'), yue: flat('填滿門框嘅實心門板。') },
  'doorConstruction.choice.panel.metal.title': { en: flat('Metal panel'), yue: flat('金屬門板') },
  'doorConstruction.choice.panel.metal.description': { en: flat('A durable panel with a crisp finish.'), yue: flat('耐用又俐落嘅門板。') },
  'doorConstruction.choice.panel.glass.title': { en: flat('Glass panel'), yue: flat('玻璃門板') },
  'doorConstruction.choice.panel.glass.description': { en: flat('A transparent panel that keeps the room visible.'), yue: flat('透明門板，入面間房照樣睇得見。') },
  'doorConstruction.choice.handle.metal.title': { en: flat('Metal handle'), yue: flat('金屬門柄') },
  'doorConstruction.choice.handle.metal.description': { en: flat('A tactile handle for deliberate activation.'), yue: flat('一掂就知、用嚟有意識啟動嘅門柄。') },
  'doorConstruction.choice.handle.wood.title': { en: flat('Wood handle'), yue: flat('木門柄') },
  'doorConstruction.choice.handle.wood.description': { en: flat('A compact handle matching a timber door.'), yue: flat('配合木門嘅細巧門柄。') },
  'multiverse.door.failed': { en: flat('The door could not be attached to the new canvas.'), yue: flat('道門未能連接到新畫布。') },
  'multiverse.door.created': { en: flat('Door constructed and paired.'), yue: flat('道門已砌好並完成配對。') },
  'wildDimSum.title': { en: flat('Wild dim sum'), yue: flat('野生點心') },
  'wildDimSum.aria': { en: flat('Wild dim sum node'), yue: flat('野生點心節點') },
  'wildDimSum.close': { en: flat('Close'), yue: flat('關閉') },
  'wildDimSum.closeAria': { en: flat('Close Wild dim sum node'), yue: flat('關閉野生點心節點') },
  'wildDimSum.random': { en: flat('Surprise me'), yue: flat('隨機點一籠') },
  'wildDimSum.randomReady': { en: flat('Choose a random published dish'), yue: flat('隨機揀一款已發布點心') },
  'wildDimSum.randomDisabled': { en: flat('The public catalog must finish loading first'), yue: flat('要等公開目錄載入完成先可以隨機揀') },
  'wildDimSum.retry': { en: flat('Retry catalog'), yue: flat('重試目錄') },
  'wildDimSum.refresh': { en: flat('Refresh catalog'), yue: flat('重新整理目錄') },
  'wildDimSum.cancel': { en: flat('Cancel'), yue: flat('取消') },
  'wildDimSum.cancelled': { en: flat('Catalog loading was cancelled. The saved dish remains unchanged.'), yue: flat('目錄載入已取消，已儲存嘅點心保持不變。') },
  'wildDimSum.chooseAria': { en: flat('Choose a public catalog dish'), yue: flat('揀一款公開目錄點心') },
  'wildDimSum.search': { en: flat('Search published dishes'), yue: flat('搜尋已發布點心') },
  'wildDimSum.searchPlaceholder': { en: flat('Name, category, or subcategory'), yue: flat('名稱、分類或者子分類') },
  'wildDimSum.regex': { en: flat('Regex builder for published dishes'), yue: flat('已發布點心正則建立器') },
  'wildDimSum.invalidPattern': { en: flat('Invalid pattern. All dishes remain visible.'), yue: flat('模式無效，全部點心仍然顯示。') },
  'wildDimSum.count': { en: flat('{shown} of {total} dishes shown.'), yue: flat('顯示 {shown} 款，共 {total} 款點心。') },
  'wildDimSum.listAria': { en: flat('Published dishes'), yue: flat('已發布點心') },
  'wildDimSum.empty': { en: flat('No published dishes match this search.'), yue: flat('冇已發布點心符合呢個搜尋。') },
  // Linux ISO VM node. These labels are flat because they identify controls, while operation
  // details and digest values remain facts supplied by the VM manager.
  'virtualMachine.title': { en: flat('Linux ISO VM'), yue: flat('Linux ISO 虛擬機') },
  'virtualMachine.iso': { en: flat('Linux ISO'), yue: flat('Linux ISO 映像') },
  'virtualMachine.disk': { en: flat('Persistent disk'), yue: flat('持久磁碟') },
  'virtualMachine.mode': { en: flat('Mode'), yue: flat('模式') },
  'virtualMachine.mode.disposable': { en: flat('Disposable live, changes are discarded'), yue: flat('即用即棄，變更會丟棄') },
  'virtualMachine.mode.persistent': { en: flat('Persistent install, keep the selected disk'), yue: flat('持久安裝，保留所選磁碟') },
  'virtualMachine.mode.filter': { en: flat('Filter VM modes'), yue: flat('篩選虛擬機模式') },
  'virtualMachine.mode.filterRegex': { en: flat('Filter VM modes with regex'), yue: flat('用正規表示式篩選虛擬機模式') },
  'virtualMachine.mode.regex': { en: flat('Regex for VM modes'), yue: flat('虛擬機模式正規表示式') },
  'virtualMachine.expectedHash': { en: flat('Expected ISO SHA-256 (optional)'), yue: flat('預期 ISO SHA-256（可選）') },
  'virtualMachine.memory': { en: flat('Memory (MiB)'), yue: flat('記憶體（MiB）') },
  'virtualMachine.cpus': { en: flat('CPUs'), yue: flat('CPU 數量') },
  'virtualMachine.network': { en: flat('Enable user-mode network'), yue: flat('啟用使用者模式網絡') },
  'virtualMachine.whpx': { en: flat('Prefer WHPX acceleration'), yue: flat('優先使用 WHPX 加速') },
  'virtualMachine.save': { en: flat('Save configuration'), yue: flat('儲存設定') },
  'virtualMachine.start': { en: flat('Start'), yue: flat('啟動') },
  'virtualMachine.stop': { en: flat('Stop'), yue: flat('停止') },
  'virtualMachine.snapshot': { en: flat('Snapshot'), yue: flat('快照') },
  'virtualMachine.restore': { en: flat('Restore'), yue: flat('還原') },
  'virtualMachine.openDisplay': { en: flat('Open display'), yue: flat('開啟顯示畫面') },
  'virtualMachine.createDisk': { en: flat('Create disk'), yue: flat('建立磁碟') },
  'virtualMachine.browse': { en: flat('Browse'), yue: flat('瀏覽') },
  'virtualMachine.note': { en: flat('Linux ISO VM is separate from WSL. It runs one isolated QEMU machine with a loopback-only display.'), yue: flat('Linux ISO 虛擬機同 WSL 分開，會用只限本機回環顯示嘅 QEMU 隔離機器。') },
  'virtualMachine.snapshot.newName': { en: flat('New snapshot name'), yue: flat('新快照名稱') },
  'virtualMachine.snapshot.filter': { en: flat('Filter saved snapshots'), yue: flat('篩選已儲存快照') },
  'virtualMachine.snapshot.filterRegex': { en: flat('Filter snapshots with regex'), yue: flat('用正規表示式篩選快照') },
  'virtualMachine.snapshot.regex': { en: flat('Regex for saved snapshots'), yue: flat('已儲存快照正規表示式') },
  'virtualMachine.snapshot.restoreChoice': { en: flat('Saved snapshot to restore'), yue: flat('要還原嘅已儲存快照') },
  'virtualMachine.snapshot.noMatch': { en: flat('No snapshots match the filter'), yue: flat('冇快照符合篩選') },
  'virtualMachine.snapshot.none': { en: flat('Create a snapshot before restoring'), yue: flat('還原之前先建立快照') },
  // WSL creation dialog (WslCreateDialog.tsx). Labels stay flat, while explanatory copy gets
  // five honest levels. Runtime distribution names, versions, instance names, paths, operation
  // ids, parser details, and executable names are supplied by the caller and never live here.
  // ---------------------------------------------------------------------------------------
  'wsl.create.title': { en: flat('New {brand} instance'), yue: flat('新增 {brand} 實例') },
  'wsl.create.actions.cancel': { en: flat('Cancel'), yue: flat('取消') },
  'wsl.create.actions.create': { en: flat('Create'), yue: flat('建立') },
  'wsl.create.actions.cancelling': { en: flat('Cancelling…'), yue: flat('正在取消…') },
  'wsl.create.actions.creating': { en: flat('Creating…'), yue: flat('正在建立…') },
  'wsl.create.actions.bindCreated': { en: flat('Bind created instance'), yue: flat('綁定已建立實例') },
  'wsl.create.actions.bindingCreated': { en: flat('Binding created instance…'), yue: flat('正在綁定已建立實例…') },
  'wsl.create.description': {
    en: [
      'Choose a distribution from the live {brand} catalogue, then give this machine-local instance a unique name.',
      'Pick a distribution from the live {brand} catalogue, then give this local instance a unique name.',
      'Choose the distribution first, then name this local {brand} instance something unique.',
      'Pick a distribution and give the new local {brand} instance a name that will not bump into another one.',
      'Choose your distribution, then give this local {brand} instance a name so tidy even the catalogue smiles.'
    ],
    yue: [
      '喺即時 {brand} 目錄揀一個發行版，再為呢個本機實例改個獨一無二嘅名。',
      '先揀即時 {brand} 目錄入面嘅發行版，再幫本機實例改個唔撞名嘅名。',
      '揀好發行版，再為本機 {brand} 實例改個獨特名稱。',
      '揀個發行版，再幫新嘅本機 {brand} 實例改個唔會同其他實例打交嘅名。',
      '揀好發行版，再幫本機 {brand} 實例改個連目錄都會點頭嘅靚名。'
    ]
  },
  'wsl.create.filter.label': { en: flat('Filter distributions'), yue: flat('篩選發行版') },
  'wsl.create.filter.regex': { en: flat('Regex for {brand} distributions'), yue: flat('{brand} 發行版 Regex') },
  'wsl.create.list.aria': { en: flat('Available {brand} distributions'), yue: flat('可用 {brand} 發行版') },
  'wsl.create.status.loading': { en: flat('Loading available distributions…'), yue: flat('正在載入可用發行版…') },
  'wsl.create.error.cataloguePrefix': { en: flat('Could not load available distributions:'), yue: flat('無法載入可用發行版：') },
  'wsl.create.error.catalogueNotInstalled': {
    en: [
      'WSL is not installed on this machine, so the online catalogue is unavailable.',
      'WSL is not installed here, so the online catalogue cannot be shown.',
      'This machine has no WSL installation to query for the online catalogue.',
      'The catalogue has nowhere to look because WSL is not installed on this machine.',
      'The catalogue went looking for WSL and found an empty cupboard: WSL is not installed here.'
    ],
    yue: [
      '呢部電腦未安裝 WSL，所以無法使用線上目錄。',
      '呢部機未有 WSL，所以睇唔到線上目錄。',
      '呢部電腦冇 WSL 可以查詢線上目錄。',
      'WSL 未安裝，目錄冇地方可以查喇。',
      '目錄搵 WSL 搵到個空櫃：呢部機根本未裝 WSL。'
    ]
  },
  'wsl.create.error.catalogueCommandFailed': {
    en: [
      'The WSL catalogue command could not be completed.',
      'The WSL catalogue command did not finish successfully.',
      'The WSL catalogue command stopped before it returned a list.',
      'The WSL catalogue command stumbled before bringing back the list.',
      'The WSL catalogue command tripped over its own shoelaces before the list arrived.'
    ],
    yue: [
      'WSL 目錄指令無法完成。',
      'WSL 目錄指令未能成功完成。',
      'WSL 目錄指令未傳回清單就停止咗。',
      'WSL 目錄指令未拎返清單就絆咗一跤。',
      'WSL 目錄指令未拎返清單就自己踩親鞋帶喇。'
    ]
  },
  'wsl.create.error.catalogueParseFailed': {
    en: [
      'The WSL catalogue response could not be parsed.',
      'The WSL catalogue response was not in a readable shape.',
      'The WSL catalogue response did not match the expected table.',
      'The WSL catalogue response arrived, but its table shape went sideways.',
      'The WSL catalogue response arrived wearing a table costume with none of the right pockets.'
    ],
    yue: [
      '無法解析 WSL 目錄回應。',
      'WSL 目錄回應唔係可讀嘅格式。',
      'WSL 目錄回應唔符合預期表格。',
      'WSL 目錄回應到咗，但表格形狀歪咗。',
      'WSL 目錄回應著住表格衫到場，但啲袋全部唔啱位。'
    ]
  },
  'wsl.create.empty.none': { en: flat('No distributions available.'), yue: flat('沒有可用發行版。') },
  'wsl.create.empty.noMatch': { en: flat('No distributions match that filter.'), yue: flat('沒有發行版符合呢個篩選。') },
  'wsl.create.field.name': { en: flat('Instance name'), yue: flat('實例名稱') },
  'wsl.create.field.nameAria': { en: flat('{brand} instance name'), yue: flat('{brand} 實例名稱') },
  'wsl.create.field.placeholder': { en: flat('my-project'), yue: flat('my-project') },
  'wsl.create.field.support': {
    en: flat('Letters, numbers, spaces, dots, hyphens, and underscores are accepted.'),
    yue: flat('接受字母、數字、空格、句點、連字號同底線。')
  },
  'wsl.create.error.prefix': { en: flat('The {brand} operation reported an error:'), yue: flat('{brand} 操作回報錯誤：') },
  'wsl.create.error.placementFailed': {
    en: flat('{brand} instance "{name}" was created, but its frame and first terminal could not be placed: {error}'),
    yue: flat('{brand} 實例「{name}」已建立，但無法放置框架同第一個終端機：{error}')
  },
  'wsl.create.progress.starting': {
    en: [
      'Starting {brand} creation…',
      'Starting the {brand} creation operation…',
      'Beginning local {brand} setup…',
      'Starting {brand} setup, with the progress board ready…',
      'Starting {brand} creation, the tiny progress parade is leaving the station…'
    ],
    yue: [
      '正在開始建立 {brand}…',
      '而家開始 {brand} 建立操作…',
      '開始設定本機 {brand}…',
      '開始設定 {brand}，進度板已經準備好…',
      '開始建立 {brand}，迷你進度巡遊而家出發…'
    ]
  },
  'wsl.create.progress.cancelling': {
    en: [
      'Cancelling {brand} creation…',
      'Requesting cancellation of {brand} creation…',
      'Stopping the local {brand} operation…',
      'Asking {brand} creation to step aside safely…',
      'Cancelling {brand} creation before the progress parade gets too dramatic…'
    ],
    yue: [
      '正在取消建立 {brand}…',
      '正在要求取消建立 {brand}…',
      '正在停止本機 {brand} 操作…',
      '請 {brand} 建立操作安全咁行埋一邊…',
      '趁 {brand} 進度巡遊未變大龍先取消佢…'
    ]
  },
  'wsl.create.progress.checking': {
    en: ['Checking WSL availability and the current distribution list.', 'Checking WSL and the current distribution list.', 'Checking WSL availability and the current list.', 'Checking whether WSL and the list are behaving.', 'Checking WSL and asking the list to keep its shoes on.'],
    yue: ['正在檢查 WSL 可用狀態同目前發行版清單。', '正在檢查 WSL 同目前發行版清單。', '正在檢查 WSL 可用狀態同目前清單。', '睇吓 WSL 同清單係咪乖乖運作緊。', '檢查 WSL，同清單講聲唔好周街甩鞋。']
  },
  'wsl.create.progress.validating': {
    en: [
      'Validating the selected distribution and name.',
      'Validating the selected distribution and instance name.',
      'Checking the selected distribution and name before creation.',
      'Confirming the selected distribution and name before the operation begins.',
      'Validating the selected distribution and name, keeping the setup orderly.',
      'Validating the selected distribution and name, with the paperwork lined up.',
      'Validating the selected distribution and name, so the setup does not improvise.',
      'Validating the selected distribution and name, while the progress board checks its list.',
      'Validating the selected distribution and name, before the tiny progress parade marches.',
      'Validating the selected distribution and name, because even a Linux instance deserves its name tag checked twice.'
    ],
    yue: [
      '正在驗證所選發行版同名稱。',
      '正在檢查所選發行版同實例名稱。',
      '建立之前，先確認所選發行版同名稱。',
      '操作開始之前，確認所選發行版同名稱。',
      '正在驗證所選發行版同名稱，等設定有條理咁行。',
      '正在驗證所選發行版同名稱，文件已經排隊。',
      '正在驗證所選發行版同名稱，唔畀設定自己亂作主張。',
      '正在驗證所選發行版同名稱，進度板順便對緊清單。',
      '正在驗證所選發行版同名稱，迷你進度巡遊出發前先點名。',
      '正在驗證所選發行版同名稱，Linux 實例都有名牌，梗係要對兩次。'
    ]
  },
  'wsl.create.progress.recording': {
    en: ['Recording ownership for "{name}" so this app can manage the new instance.', 'Recording ownership for "{name}" so this app can manage it.', 'Saving ownership for "{name}" before management is enabled.', 'Writing down that "{name}" belongs to this app before the knobs appear.', 'Giving "{name}" an ownership note tidy enough for future housekeeping.'],
    yue: ['正在記錄「{name}」嘅擁有權，等呢個程式可以管理新實例。', '正在記錄「{name}」嘅擁有權，等呢個程式可以管理佢。', '開啟管理之前，先儲存「{name}」嘅擁有權。', '先寫低「{name}」係呢個程式嘅，之後先拎出啲掣。', '幫「{name}」寫張整齊到未來都想收埋嘅擁有權紙仔。']
  },
  'wsl.create.progress.completed': {
    en: ['WSL instance "{name}" was created and ownership was recorded.', 'WSL instance "{name}" was created and ownership is saved.', 'WSL instance "{name}" exists and its ownership record is saved.', 'WSL instance "{name}" is ready, with its ownership paperwork filed.', 'WSL instance "{name}" is ready, and its ownership paperwork has stopped doing cartwheels.'],
    yue: ['WSL 實例「{name}」已建立，亦已記錄擁有權。', 'WSL 實例「{name}」已建立，擁有權亦已儲存。', 'WSL 實例「{name}」存在，擁有權紀錄亦已儲存。', 'WSL 實例「{name}」準備好喇，擁有權文件亦已入檔。', 'WSL 實例「{name}」準備好喇，擁有權文件終於唔再翻筋斗。']
  },
  'wsl.create.progress.failed': {
    en: ['WSL instance creation failed: {error}', 'WSL instance creation did not finish: {error}', 'WSL could not create the instance: {error}', 'WSL creation hit a snag: {error}', 'WSL creation tripped over a very specific banana peel: {error}'],
    yue: ['建立 WSL 實例失敗：{error}', '建立 WSL 實例未能完成：{error}', 'WSL 無法建立實例：{error}', '建立 WSL 實例撞到個小障礙：{error}', '建立 WSL 實例俾一塊好有針對性嘅香蕉皮跣親：{error}']
  },
  'wsl.create.progress.cancelled': {
    en: ['WSL instance creation was cancelled.', 'WSL instance creation was stopped by cancellation.', 'WSL instance creation ended because it was cancelled.', 'WSL creation was politely asked to stop, and it did.', 'WSL creation has packed its little suitcase because cancellation won.'],
    yue: ['建立 WSL 實例已取消。', '建立 WSL 實例因取消而停止。', '建立 WSL 實例因取消而結束。', 'WSL 建立收到取消通知，乖乖停低咗。', 'WSL 建立執好個細喼，因為取消贏咗。']
  },
  'wsl.create.progress.cancelledLate': {
    en: ['WSL instance "{name}" was created before cancellation completed; no canvas frame was bound.', 'WSL instance "{name}" was created before cancellation finished, so no canvas frame was bound.', 'WSL instance "{name}" already existed when cancellation completed; no canvas frame was bound.', 'WSL instance "{name}" beat cancellation to the finish line, so no canvas frame was bound.', 'WSL instance "{name}" crossed the finish line before cancellation, and the canvas wisely kept its hands in its pockets.'],
    yue: ['取消完成之前，WSL 實例「{name}」已建立；沒有綁定畫布框架。', '取消完成之前，WSL 實例「{name}」已建立，所以沒有綁定畫布框架。', '取消完成時 WSL 實例「{name}」已存在；沒有綁定畫布框架。', 'WSL 實例「{name}」跑贏取消先到終點，所以沒有綁定畫布框架。', 'WSL 實例「{name}」早過取消衝線，畫布就醒目咁冇伸手亂拎。']
  },
  'wsl.create.progress.stage.validating': { en: flat('validating'), yue: flat('驗證中') },
  'wsl.create.progress.stage.checking': { en: flat('checking'), yue: flat('檢查中') },
  'wsl.create.progress.stage.installing': { en: flat('installing'), yue: flat('安裝中') },
  'wsl.create.progress.stage.recording': { en: flat('recording'), yue: flat('記錄中') },
  'wsl.create.progress.stage.completed': { en: flat('completed'), yue: flat('已完成') },
  'wsl.create.progress.stage.failed': { en: flat('failed'), yue: flat('失敗') },
  'wsl.create.progress.stage.cancelled': { en: flat('cancelled'), yue: flat('已取消') },
  'wsl.create.progress.step': { en: flat('Step'), yue: flat('步驟') },
  'wsl.create.progress.of': { en: flat('of'), yue: flat('共') },
  'wsl.create.progress.aria': { en: flat('WSL creation phase progress'), yue: flat('WSL 建立階段進度') },
  'wsl.create.progress.value': {
    en: ['Step {step} of {steps}, {stage}. {detail}', 'Step {step} of {steps}, currently {stage}. {detail}', 'Phase {step} of {steps}: {stage}. {detail}', 'Phase {step} of {steps} is {stage}; {detail}', 'Step {step} of {steps}: {stage} is on duty. {detail}'],
    yue: ['第 {step} 步，共 {steps} 步，{stage}。{detail}', '第 {step} 步，共 {steps} 步，而家係 {stage}。{detail}', '第 {step} 階段，共 {steps} 階段：{stage}。{detail}', '第 {step} 階段，共 {steps} 階段，狀態係 {stage}；{detail}', '第 {step} 步，共 {steps} 步：{stage} 當值中。{detail}']
  },
  'wsl.create.progress.elapsed': { en: flat('Elapsed time:'), yue: flat('已用時間：') },
  'wsl.create.progress.seconds': { en: flat('seconds.'), yue: flat('秒。') },
  'wsl.create.progress.installing': {
    en: [
      'Installing "{catalogue}" as "{name}" for operation {operationId}. Installation progress is reported by phase because wsl.exe provides no byte or percentage telemetry.',
      'Installing "{catalogue}" as "{name}" for operation {operationId}. Progress is reported by phase because wsl.exe provides no byte or percentage telemetry.',
      'Installing "{catalogue}" as "{name}" for operation {operationId}; wsl.exe reports phases, not bytes or percentages.',
      'Installing "{catalogue}" as "{name}" for operation {operationId}; wsl.exe is counting phases instead of bytes.',
      'Installing "{catalogue}" as "{name}" for operation {operationId}; wsl.exe brought a phase counter and left the byte ruler at home.'
    ],
    yue: [
      '正在用操作 {operationId} 將「{catalogue}」安裝成「{name}」。由於 wsl.exe 沒有提供位元組或百分比遙測，安裝進度會按階段報告。',
      '正在用操作 {operationId} 將「{catalogue}」安裝成「{name}」。wsl.exe 只按階段報告，冇位元組或百分比。',
      '正在用操作 {operationId} 安裝「{catalogue}」成為「{name}」；wsl.exe 報告階段，唔報位元組或百分比。',
      '正在用操作 {operationId} 安裝「{catalogue}」成為「{name}」；wsl.exe 而家數階段，唔數位元組。',
      '正在用操作 {operationId} 安裝「{catalogue}」成為「{name}」；wsl.exe 帶咗階段計數器，偏偏將位元組尺留咗喺屋企。'
    ]
  },
  'wsl.create.progress.installingDetail': {
    en: flat('Installation progress is reported by phase because wsl.exe provides no byte or percentage telemetry.'),
    yue: flat('由於 wsl.exe 沒有提供位元組或百分比遙測，安裝進度會按階段報告。')
  },
  'wsl.create.progress.cancellable': { en: flat('The operation is bounded and can be cancelled.'), yue: flat('呢個操作有界限，而且可以取消。') },
  'wsl.create.error.noActive': { en: flat('Cancellation could not be sent because there is no active {brand} operation.'), yue: flat('因為沒有進行中嘅 {brand} 操作，所以無法送出取消。') },
  'wsl.create.error.cancelRejected': { en: flat('Cancellation was not accepted because the {brand} operation is no longer active. You can retry or close this dialog.'), yue: flat('取消未被接受，因為 {brand} 操作已經唔再進行中。你可以再試，或者關閉呢個對話框。') },
  'wsl.create.error.cancelPrefix': { en: flat('Could not cancel {brand} creation:'), yue: flat('無法取消建立 {brand}：') },
  'wsl.create.validation.required': { en: flat('Name is required.'), yue: flat('必須輸入名稱。') },
  'wsl.create.validation.whitespace': { en: flat('Name cannot start or end with whitespace.'), yue: flat('名稱開頭同結尾唔可以有空白。') },
  'wsl.create.validation.length': { en: flat('Name must be 64 characters or fewer.'), yue: flat('名稱最多 64 個字元。') },
  'wsl.create.validation.characters': { en: flat('Name contains characters that are not allowed.'), yue: flat('名稱包含唔容許嘅字元。') },
  'wsl.create.validation.shape': { en: flat('Use letters, numbers, spaces, dots, hyphens, or underscores, starting and ending with a letter or number.'), yue: flat('請用字母、數字、空格、句點、連字號或底線，而且要由字母或數字開頭同結尾。') },
  'wsl.create.validation.chooseDistribution': { en: flat('Choose a distribution.'), yue: flat('請揀一個發行版。') },
  'wsl.create.validation.duplicate': { en: flat('A WSL instance with this name already exists.'), yue: flat('已經有一個同名嘅 WSL 實例。') }
}
