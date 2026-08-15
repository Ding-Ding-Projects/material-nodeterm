import harGow from '../../assets/dimsum/har-gow.svg'
import siuMai from '../../assets/dimsum/siu-mai.svg'
import charSiuBao from '../../assets/dimsum/char-siu-bao.svg'
import eggTart from '../../assets/dimsum/egg-tart.svg'
import turnipCake from '../../assets/dimsum/turnip-cake.svg'
import cheungFun from '../../assets/dimsum/cheung-fun.svg'
import springRoll from '../../assets/dimsum/spring-roll.svg'
import sesameBall from '../../assets/dimsum/sesame-ball.svg'
import loMaiGai from '../../assets/dimsum/lo-mai-gai.svg'

/**
 * The dim-sum surprise's dish catalog. Every image is an ORIGINAL illustration bundled as a
 * local asset (Vite hands us a hashed local URL, same convention as `lib/brandPulse.ts`'s agent
 * marks) — never a downloaded stock photo, never a CDN/network fetch.
 *
 * Each dish's `en`/`zhHant` name is the fact that must stay correct at every funny level and in
 * every language mode: humour styles the SURROUNDING copy, never the dish's own name.
 */
export interface DimSumDish {
  id: string
  name: { en: string; zhHant: string }
  /** Bundled local image URL (never a network URL). */
  image: string
}

export const DIM_SUM_CATALOG: readonly DimSumDish[] = [
  { id: 'har-gow', name: { en: 'Shrimp dumpling', zhHant: '蝦餃' }, image: harGow },
  { id: 'siu-mai', name: { en: 'Pork & shrimp dumpling', zhHant: '燒賣' }, image: siuMai },
  { id: 'char-siu-bao', name: { en: 'BBQ pork bun', zhHant: '叉燒包' }, image: charSiuBao },
  { id: 'egg-tart', name: { en: 'Egg tart', zhHant: '蛋撻' }, image: eggTart },
  { id: 'turnip-cake', name: { en: 'Turnip cake', zhHant: '蘿蔔糕' }, image: turnipCake },
  { id: 'cheung-fun', name: { en: 'Rice noodle roll', zhHant: '腸粉' }, image: cheungFun },
  { id: 'spring-roll', name: { en: 'Spring roll', zhHant: '春卷' }, image: springRoll },
  { id: 'sesame-ball', name: { en: 'Sesame ball', zhHant: '煎堆' }, image: sesameBall },
  { id: 'lo-mai-gai', name: { en: 'Sticky rice in lotus leaf', zhHant: '糯米雞' }, image: loMaiGai }
]

/** Bilingual label, e.g. "Shrimp dumpling · 蝦餃" — the dish's name stays this exact pair
 *  regardless of the active language mode or funny level. */
export function dimSumLabel(dish: DimSumDish): string {
  return `${dish.name.en} · ${dish.name.zhHant}`
}
