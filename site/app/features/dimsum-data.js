// site/app/features/dimsum-data.js
//
// The dish catalog for the dim sum surprise. Every illustration is a small,
// original SVG drawn for this site (site/app/features/assets/dimsum/) —
// nothing here is downloaded or embedded from a third party. Each dish
// carries its real bilingual name, correct at every funny level (the
// surprise's copy around the name may be styled by the funny sliders; the
// dish's actual name never is).
//
// BASE-PATH SAFETY: an <img src="./assets/...."> attribute set on a DOM
// element resolves against the DOCUMENT's URL (site/index.html), not
// against this module's own file location — so a plain relative string
// here would point at site/assets/... instead of the real
// site/app/features/assets/... directory. `asset()` resolves each path
// against THIS module's `import.meta.url` instead, which is correct
// regardless of the page's deployed base path or how deep the importing
// module happens to live.
function asset(relativePath) {
  return new URL(relativePath, import.meta.url).href
}

export const DISHES = [
  {
    id: 'har-gow',
    en: 'Shrimp dumpling',
    yue: '蝦餃',
    svg: asset('./assets/dimsum/har-gow.svg'),
  },
  {
    id: 'siu-mai',
    en: 'Pork & shrimp dumpling',
    yue: '燒賣',
    svg: asset('./assets/dimsum/siu-mai.svg'),
  },
  {
    id: 'char-siu-bao',
    en: 'BBQ pork bun',
    yue: '叉燒包',
    svg: asset('./assets/dimsum/char-siu-bao.svg'),
  },
  {
    id: 'egg-tart',
    en: 'Egg tart',
    yue: '蛋撻',
    svg: asset('./assets/dimsum/egg-tart.svg'),
  },
  {
    id: 'cheung-fun',
    en: 'Rice noodle roll',
    yue: '腸粉',
    svg: asset('./assets/dimsum/cheung-fun.svg'),
  },
  {
    id: 'turnip-cake',
    en: 'Pan-fried turnip cake',
    yue: '蘿蔔糕',
    svg: asset('./assets/dimsum/turnip-cake.svg'),
  },
]

export function pickRandomDish() {
  return DISHES[Math.floor(Math.random() * DISHES.length)]
}
