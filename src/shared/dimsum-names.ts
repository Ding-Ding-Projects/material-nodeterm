/**
 * The dim-sum dish names, and nothing else.
 *
 * They live in `src/shared` rather than beside the illustrations in
 * `src/renderer/lib/dimsum/catalog.ts` because TWO surfaces need the names and only one of them
 * can have the pictures: the renderer's dim-sum surprise draws the bundled SVGs, while the Server
 * Edition's login page asks a text-only dim-sum question during an unlock ladder and has no Vite
 * asset pipeline to resolve an `import … from '*.svg'` through.
 *
 * Keeping one table is the point. A second hand-copied list of nine dishes is a list that drifts:
 * the surprise would name a dish the quiz has never heard of, and the quiz's "wrong" answers would
 * stop being dishes the user has actually seen.
 *
 * The `en`/`zhHant` pair is a FACT and stays exact at every funny level and in every language
 * mode — humour styles the copy around a dish, never the dish's own name.
 */
export interface DimSumName {
  id: string
  en: string
  zhHant: string
}

export const DIM_SUM_NAMES: readonly DimSumName[] = [
  { id: 'har-gow', en: 'Shrimp dumpling', zhHant: '蝦餃' },
  { id: 'siu-mai', en: 'Pork & shrimp dumpling', zhHant: '燒賣' },
  { id: 'char-siu-bao', en: 'BBQ pork bun', zhHant: '叉燒包' },
  { id: 'egg-tart', en: 'Egg tart', zhHant: '蛋撻' },
  { id: 'turnip-cake', en: 'Turnip cake', zhHant: '蘿蔔糕' },
  { id: 'cheung-fun', en: 'Rice noodle roll', zhHant: '腸粉' },
  { id: 'spring-roll', en: 'Spring roll', zhHant: '春卷' },
  { id: 'sesame-ball', en: 'Sesame ball', zhHant: '煎堆' },
  { id: 'lo-mai-gai', en: 'Sticky rice in lotus leaf', zhHant: '糯米雞' }
]

/** Bilingual label, e.g. "Shrimp dumpling · 蝦餃". */
export function dimSumNameLabel(d: DimSumName): string {
  return `${d.en} · ${d.zhHant}`
}
