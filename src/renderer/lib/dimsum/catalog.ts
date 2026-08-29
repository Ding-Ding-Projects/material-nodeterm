import harGow from '../../assets/dimsum/har-gow.svg'
import siuMai from '../../assets/dimsum/siu-mai.svg'
import charSiuBao from '../../assets/dimsum/char-siu-bao.svg'
import eggTart from '../../assets/dimsum/egg-tart.svg'
import turnipCake from '../../assets/dimsum/turnip-cake.svg'
import cheungFun from '../../assets/dimsum/cheung-fun.svg'
import springRoll from '../../assets/dimsum/spring-roll.svg'
import sesameBall from '../../assets/dimsum/sesame-ball.svg'
import loMaiGai from '../../assets/dimsum/lo-mai-gai.svg'
import { DIM_SUM_NAMES } from '@shared/dimsum-names'

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

/** id → bundled local illustration. Kept HERE rather than in the shared name table because a
 *  Vite `?asset` import only resolves in the renderer build; the server quizzes on names alone. */
const IMAGES: Record<string, string> = {
  'har-gow': harGow,
  'siu-mai': siuMai,
  'char-siu-bao': charSiuBao,
  'egg-tart': eggTart,
  'turnip-cake': turnipCake,
  'cheung-fun': cheungFun,
  'spring-roll': springRoll,
  'sesame-ball': sesameBall,
  'lo-mai-gai': loMaiGai
}

// Derived from the ONE shared name table, so the surprise and the unlock ladder's dim-sum
// question can never disagree about which dishes exist or what they are called. A dish added to
// the table without an illustration is dropped here rather than rendering a broken image.
export const DIM_SUM_CATALOG: readonly DimSumDish[] = DIM_SUM_NAMES.filter((d) => IMAGES[d.id]).map(
  (d) => ({ id: d.id, name: { en: d.en, zhHant: d.zhHant }, image: IMAGES[d.id] })
)

/** Bilingual label, e.g. "Shrimp dumpling · 蝦餃" — the dish's name stays this exact pair
 *  regardless of the active language mode or funny level. */
export function dimSumLabel(dish: DimSumDish): string {
  return `${dish.name.en} · ${dish.name.zhHant}`
}
