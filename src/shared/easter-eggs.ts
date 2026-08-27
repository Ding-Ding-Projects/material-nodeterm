/**
 * The desktop Easter egg catalog.
 *
 * This is deliberately data-first. Each row is a stable public id with an explicit surface,
 * local trigger, copy seed, and safety contract. The renderer can offer a cabinet without
 * teaching individual controls about storage, animation, or School mode.
 */

export type EasterEggSurface =
  | 'canvas'
  | 'nodes'
  | 'title-bar'
  | 'settings'
  | 'command-palette'
  | 'notifications'
  | 'documentation'
  | 'changelog'
  | 'search'
  | 'project-switcher'
  | 'source-control'
  | 'media'
  | 'schedules'
  | 'hosting'
  | 'account'
  | 'converter'
  | 'ollama'
  | 'authenticator'
  | 'support'
  | 'status'

export type EasterEggTrigger =
  | { kind: 'contextual'; event: 'surface-interaction'; minimumInteractions: number }

export interface EasterEggCopy {
  en: readonly [string, string, string, string, string, string, string, string, string, string]
  yue: readonly [string, string, string, string, string, string, string, string, string, string]
}

export interface EasterEggEntry {
  readonly id: string
  readonly title: string
  readonly surface: EasterEggSurface
  readonly trigger: EasterEggTrigger
  readonly copy: EasterEggCopy
  readonly schoolMode: 'suppressed'
  readonly accessibility: string
  readonly reducedMotion: string
  readonly persistence: 'discovery-only'
  readonly reset: string
}

type Seed = { id: string; title: string; surface: EasterEggSurface; en: string; yue: string }

function levels(en: string, yue: string): EasterEggCopy {
  const enTones = [
    en,
    `${en} A small local surprise is ready.`,
    `${en} The interface found a tiny extra bow tie.`,
    `${en} The pixels are doing a polite little jig.`,
    `${en} A pocket-sized delight has clocked in.`,
    `${en} The chrome has hidden one more friendly wink.`,
    `${en} A very serious surface has misplaced its seriousness.`,
    `${en} The UI brought snacks for this exact moment.`,
    `${en} The controls are giggling quietly in a local-only corner.`,
    `${en} Congratulations, you found the deluxe nonsense garnish.`
  ] as const
  const yueTones = [
    yue,
    `${yue} 本機小驚喜準備好喇。`,
    `${yue} 個介面偷偷加咗少少蝴蝶結。`,
    `${yue} 啲像素而家禮貌咁跳緊舞。`,
    `${yue} 迷你開心果已經返工。`,
    `${yue} 個框框又藏咗一個友善眨眼。`,
    `${yue} 一本正經嘅畫面暫時搵唔返本來嘅嚴肅。`,
    `${yue} 呢個介面帶咗零食嚟。`,
    `${yue} 控制項喺本機角落偷偷笑緊。`,
    `${yue} 恭喜你搵到豪華版無聊裝飾。`
  ] as const
  return { en: enTones, yue: yueTones }
}

function egg(seed: Seed): EasterEggEntry {
  return {
    id: seed.id,
    title: seed.title,
    surface: seed.surface,
    trigger: { kind: 'contextual', event: 'surface-interaction', minimumInteractions: 3 },
    copy: levels(seed.en, seed.yue),
    schoolMode: 'suppressed',
    accessibility: 'Announced in a polite status region; the discovery history has a labelled dismiss control.',
    reducedMotion: 'Uses a static sparkle treatment when reduced motion is requested.',
    persistence: 'discovery-only',
    reset: 'Use Reset discoveries in the Easter egg cabinet; no project data is changed.'
  }
}

/** Hand-written catalog. Keep ids stable: they are the only persisted discovery keys. */
export const EASTER_EGG_CATALOG: readonly EasterEggEntry[] = [
  egg({ id: 'canvas-orbit', title: 'Canvas orbit', surface: 'canvas', en: 'The canvas has a tiny orbit.', yue: '畫布有個迷你軌道。' }),
  egg({ id: 'canvas-grid-wink', title: 'Grid wink', surface: 'canvas', en: 'The canvas grid winked once.', yue: '畫布格仔眨咗一下眼。' }),
  egg({ id: 'canvas-compass', title: 'Lost compass', surface: 'canvas', en: 'A compass points politely nowhere.', yue: '指南針好有禮貌咁指住冇嘢。' }),
  egg({ id: 'canvas-undo-toast', title: 'Undo encore', surface: 'canvas', en: 'Undo takes a tiny encore bow.', yue: '復原行咗個迷你謝幕禮。' }),
  egg({ id: 'canvas-zoom', title: 'Zoom moon', surface: 'canvas', en: 'Zoom found a moon-sized setting.', yue: '縮放搵到月光咁大嘅設定。' }),
  egg({ id: 'canvas-focus', title: 'Focus spotlight', surface: 'canvas', en: 'Focus gets a pocket spotlight.', yue: '專注模式收到迷你聚光燈。' }),
  egg({ id: 'nodes-terminal-cat', title: 'Terminal cat', surface: 'nodes', en: 'A terminal cat approves this prompt.', yue: '終端機貓貓批准咗呢句提示。' }),
  egg({ id: 'nodes-sticky-poem', title: 'Sticky poem', surface: 'nodes', en: 'A sticky note remembers one rhyme.', yue: '便利貼記住咗一句押韻。' }),
  egg({ id: 'nodes-group-huddle', title: 'Group huddle', surface: 'nodes', en: 'A group node called a tiny huddle.', yue: '群組節點開咗個迷你圍爐。' }),
  egg({ id: 'nodes-agent-thought', title: 'Agent thought bubble', surface: 'nodes', en: 'An agent node found a thought bubble.', yue: '代理節點搵到個思想泡泡。' }),
  egg({ id: 'nodes-browser-tab', title: 'Browser tab salute', surface: 'nodes', en: 'A browser node gives a tab salute.', yue: '瀏覽器節點向分頁敬禮。' }),
  egg({ id: 'nodes-auth-clock', title: 'Authenticator clock', surface: 'nodes', en: 'The authenticator clock ticks with style.', yue: '驗證器個鐘滴答得好有型。' }),
  egg({ id: 'titlebar-brand-wink', title: 'Brand wink', surface: 'title-bar', en: 'The brand mark remembered a wink.', yue: '品牌標記記返一個眨眼。' }),
  egg({ id: 'titlebar-version-toast', title: 'Version confetti', surface: 'title-bar', en: 'The version label tossed quiet confetti.', yue: '版本標籤撒咗啲安靜紙碎。' }),
  egg({ id: 'titlebar-help-bell', title: 'Help bell', surface: 'title-bar', en: 'Help rang a bell without interrupting.', yue: '幫助掣響咗聲但冇打斷你。' }),
  egg({ id: 'titlebar-drag', title: 'Drag parade', surface: 'title-bar', en: 'The title bar held a tiny parade.', yue: '標題列行咗個迷你巡遊。' }),
  egg({ id: 'settings-sun', title: 'Settings sunbeam', surface: 'settings', en: 'Settings opened a sunbeam.', yue: '設定頁開咗道陽光。' }),
  egg({ id: 'settings-moon', title: 'Settings moon', surface: 'settings', en: 'Settings borrowed a moon.', yue: '設定頁借咗個月亮。' }),
  egg({ id: 'settings-density', title: 'Density accordion', surface: 'settings', en: 'Density played one accordion note.', yue: '密度彈咗一下手風琴。' }),
  egg({ id: 'settings-language', title: 'Language postcard', surface: 'settings', en: 'Language settings mailed a postcard.', yue: '語言設定寄咗張明信片。' }),
  egg({ id: 'settings-emoji', title: 'Emoji drawer', surface: 'settings', en: 'The emoji switch found a drawer.', yue: '表情符號開關搵到個抽屜。' }),
  egg({ id: 'settings-vocabulary', title: 'Vocabulary bookmark', surface: 'settings', en: 'The vocabulary card marked a bookmark.', yue: '詞彙卡留低咗個書籤。' }),
  egg({ id: 'settings-schedule', title: 'Schedule yawn', surface: 'schedules', en: 'A schedule yawned on its own time.', yue: '排程喺自己時間打咗個呵欠。' }),
  egg({ id: 'settings-appearance', title: 'Appearance mirror', surface: 'settings', en: 'Appearance reflected a friendly pixel.', yue: '外觀映返粒友善像素。' }),
  egg({ id: 'settings-logo', title: 'Logo bow', surface: 'settings', en: 'The logo tied a local bow.', yue: '標誌打咗個本機蝴蝶結。' }),
  egg({ id: 'settings-lock', title: 'Toy lock tickle', surface: 'settings', en: 'The toy lock tickled its own latch.', yue: '玩具鎖搔咗下自己個扣。' }),
  egg({ id: 'palette-shortcut', title: 'Palette shortcut', surface: 'command-palette', en: 'The command palette found a secret shelf.', yue: '命令面板搵到條秘密架。' }),
  egg({ id: 'palette-search', title: 'Search telescope', surface: 'command-palette', en: 'Palette search borrowed a telescope.', yue: '面板搜尋借咗支望遠鏡。' }),
  egg({ id: 'palette-command', title: 'Command haiku', surface: 'command-palette', en: 'A command wrote a three-line haiku.', yue: '命令寫咗首三行俳句。' }),
  egg({ id: 'palette-reset', title: 'Palette reset bow', surface: 'command-palette', en: 'The palette reset button bowed politely.', yue: '面板重設掣有禮貌咁鞠躬。' }),
  egg({ id: 'notifications-bell', title: 'Bell echo', surface: 'notifications', en: 'The notification bell kept one friendly echo.', yue: '通知鈴留低一聲友善回音。' }),
  egg({ id: 'notifications-stack', title: 'Toast tower', surface: 'notifications', en: 'The toast stack built a safe tiny tower.', yue: '通知堆起咗座安全迷你塔。' }),
  egg({ id: 'notifications-history', title: 'History bookmark', surface: 'notifications', en: 'Notification history bookmarked itself.', yue: '通知歷史幫自己留咗書籤。' }),
  egg({ id: 'docs-index', title: 'Docs librarian', surface: 'documentation', en: 'The docs librarian whispered “next article”.', yue: '文件圖書館員細聲講「下一篇」。' }),
  egg({ id: 'docs-search', title: 'Docs magnifier', surface: 'documentation', en: 'Documentation search polished a magnifier.', yue: '文件搜尋抹亮咗個放大鏡。' }),
  egg({ id: 'docs-back', title: 'Docs boomerang', surface: 'documentation', en: 'The back button returned like a boomerang.', yue: '返回掣好似回力鏢咁返嚟。' }),
  egg({ id: 'docs-code', title: 'Code fence', surface: 'documentation', en: 'A code fence put on a tiny hat.', yue: '程式碼圍欄戴咗頂迷你帽。' }),
  egg({ id: 'changelog-date', title: 'Date picker time machine', surface: 'changelog', en: 'The date picker visited a harmless yesterday.', yue: '日期揀選器去咗個無害嘅尋日。' }),
  egg({ id: 'changelog-commit', title: 'Commit confetti', surface: 'changelog', en: 'A commit link wore confetti.', yue: '提交連結戴咗紙碎。' }),
  egg({ id: 'changelog-export', title: 'Export postcard', surface: 'changelog', en: 'The changelog export became a postcard.', yue: '變更記錄匯出變咗張明信片。' }),
  egg({ id: 'search-regex', title: 'Regex detective', surface: 'search', en: 'Regex search found a magnifying detective.', yue: '正則搜尋搵到個放大鏡偵探。' }),
  egg({ id: 'search-empty', title: 'Empty result tumbleweed', surface: 'search', en: 'An empty result rolled a quiet tumbleweed.', yue: '空結果滾過一棵安靜風滾草。' }),
  egg({ id: 'project-switcher-cycle', title: 'Project carousel', surface: 'project-switcher', en: 'The project switcher rode a carousel.', yue: '專案切換器坐咗轉木馬。' }),
  egg({ id: 'project-switcher-reorder', title: 'Project queue', surface: 'project-switcher', en: 'Project order queued a tiny conductor.', yue: '專案次序排隊搵咗個迷你指揮。' }),
  egg({ id: 'source-control-branch', title: 'Branch kite', surface: 'source-control', en: 'Source control flew a branch kite.', yue: '版本控制放咗隻分支風箏。' }),
  egg({ id: 'source-control-diff', title: 'Diff binoculars', surface: 'source-control', en: 'A diff put on binoculars.', yue: '差異比較戴咗副望遠鏡。' }),
  egg({ id: 'source-control-refresh', title: 'Refresh drumroll', surface: 'source-control', en: 'Refresh performed a local drumroll.', yue: '重新整理打咗段本機鼓聲。' }),
  egg({ id: 'media-film', title: 'Film reel wink', surface: 'media', en: 'The film reel winked between frames.', yue: '菲林輪喺畫面之間眨眼。' }),
  egg({ id: 'media-gallery', title: 'Gallery frame', surface: 'media', en: 'The gallery framed one imaginary duck.', yue: '相簿框住隻想像中嘅鴨。' }),
  egg({ id: 'media-pulse', title: 'Media pulse', surface: 'media', en: 'Media controls pulsed once, then settled.', yue: '媒體控制跳咗一下就安定返。' }),
  egg({ id: 'schedule-tick', title: 'Schedule tick', surface: 'schedules', en: 'The schedule tick wore a bowler hat.', yue: '排程滴答聲戴咗頂禮帽。' }),
  egg({ id: 'hosting-door', title: 'Hosting doorbell', surface: 'hosting', en: 'Hosting found a doorbell with no door.', yue: '託管搵到個冇門嘅門鐘。' }),
  egg({ id: 'hosting-health', title: 'Health confetti', surface: 'hosting', en: 'Hosting health checked in with confetti.', yue: '託管健康狀態帶住紙碎報到。' }),
  egg({ id: 'account-identity', title: 'Account moustache', surface: 'account', en: 'An account identity grew a paper moustache.', yue: '帳戶身份生咗撇紙鬚。' }),
  egg({ id: 'account-switch', title: 'Account baton', surface: 'account', en: 'Account switching passed a tiny baton.', yue: '帳戶切換傳咗支迷你接力棒。' }),
  egg({ id: 'converter-queue', title: 'Converter parade', surface: 'converter', en: 'The converter queue marched in place.', yue: '轉換器隊列原地行緊步。' }),
  egg({ id: 'ollama-model', title: 'Model teacup', surface: 'ollama', en: 'The local model catalogue served tea.', yue: '本機模型目錄斟咗杯茶。' }),
  egg({ id: 'authenticator-code', title: 'Code confetti', surface: 'authenticator', en: 'The authenticator code wore a safe party hat.', yue: '驗證碼戴住安全派對帽。' }),
  egg({ id: 'support-ticket', title: 'Support rubber stamp', surface: 'support', en: 'The local support desk stamped “just for fun”.', yue: '本機支援台蓋咗個「純粹玩吓」印。' }),
  egg({ id: 'status-heartbeat', title: 'Status heartbeat', surface: 'status', en: 'Status found one calm heartbeat.', yue: '狀態搵到一下平靜心跳。' })
]

export const EASTER_EGG_CATALOG_VERSION = 1

export function eggById(id: string): EasterEggEntry | undefined {
  return EASTER_EGG_CATALOG.find((entry) => entry.id === id)
}

export function eggCopy(entry: EasterEggEntry, language: 'en' | 'yue', level: number): string {
  const safeLevel = Math.max(1, Math.min(10, Math.round(level)))
  return entry.copy[language][safeLevel - 1]
}
