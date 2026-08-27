import type { Catalog, FiveVariants } from './types'

function flat(text: string): FiveVariants {
  return [text, text, text, text, text]
}

/** Localized copy for the door-entry panel. Kept separate so the entry lane can land alongside
 * the portal implementation without coupling credentials to the application's general catalog. */
export const UNIVERSE_DOOR_ENTRY_CATALOG: Catalog = {
  'universeDoorEntry.title': {
    en: flat('Enter the door credential'),
    yue: flat('輸入道門憑證')
  },
  'universeDoorEntry.destination': {
    en: flat('Destination: {destination}'),
    yue: flat('目的地：{destination}')
  },
  'universeDoorEntry.description': {
    en: [
      'Choose an enabled method and enter its credential to open this portal door.',
      'Choose a door method, then enter the matching credential to continue.',
      'Pick the enabled method that belongs to this door and enter its credential.',
      'Choose the door credential method, then give the portal the matching answer.',
      'Pick the door method and let the portal hear the credential it is actually waiting for.'
    ],
    yue: [
      '揀一個已啟用嘅方法，再輸入憑證開啟呢道傳送門。',
      '揀道門方法，再輸入相符憑證繼續。',
      '揀返屬於呢道門嘅方法，再輸入佢嘅憑證。',
      '揀道門憑證方法，再畀傳送門一個相符答案。',
      '揀啱道門方法，等傳送門聽到佢真正等緊嘅憑證。'
    ]
  },
  'universeDoorEntry.search.label': {
    en: flat('Search entry methods'),
    yue: flat('搜尋進入方法')
  },
  'universeDoorEntry.search.placeholder': {
    en: flat('Filter methods'),
    yue: flat('篩選方法')
  },
  'universeDoorEntry.search.regex': {
    en: flat('Open regex builder for entry methods'),
    yue: flat('開啟進入方法正則建立器')
  },
  'universeDoorEntry.numericCode': {
    en: flat('Numeric code'),
    yue: flat('數字編碼')
  },
  'universeDoorEntry.passphrase': {
    en: flat('Passphrase'),
    yue: flat('通關短語')
  },
  'universeDoorEntry.numericHint': {
    en: flat('Enter exactly {digits} digits. The value stays on this computer.'),
    yue: flat('請輸入剛好 {digits} 個數字。個值只會留喺呢部電腦。')
  },
  'universeDoorEntry.passphraseHint': {
    en: flat('Enter at least {length} characters. The value stays on this computer.'),
    yue: flat('請輸入至少 {length} 個字元。個值只會留喺呢部電腦。')
  },
  'universeDoorEntry.submit': {
    en: flat('Open door'),
    yue: flat('開道門')
  },
  'universeDoorEntry.submitting': {
    en: flat('Opening door…'),
    yue: flat('正在開道門…')
  },
  'universeDoorEntry.cancel': {
    en: flat('Cancel'),
    yue: flat('取消')
  },
  'universeDoorEntry.noMethod': {
    en: flat('No enabled entry method matches this search.'),
    yue: flat('冇已啟用嘅進入方法符合呢個搜尋。')
  },
  'universeDoorEntry.invalidSearch': {
    en: flat('This pattern is invalid. Showing all enabled methods.'),
    yue: flat('呢個模式無效，而家顯示全部已啟用方法。')
  },
  'universeDoorEntry.validation.method': {
    en: flat('Choose one of the credential methods enabled for this door.'),
    yue: flat('請揀一個呢道門已啟用嘅憑證方法。')
  },
  'universeDoorEntry.validation.numericRequired': {
    en: flat('Enter the numeric door code.'),
    yue: flat('請輸入道門數字編碼。')
  },
  'universeDoorEntry.validation.numericShape': {
    en: flat('Enter exactly {digits} digits.'),
    yue: flat('請輸入剛好 {digits} 個數字。')
  },
  'universeDoorEntry.validation.passphraseRequired': {
    en: flat('Enter the door passphrase.'),
    yue: flat('請輸入道門通關短語。')
  },
  'universeDoorEntry.validation.passphraseShort': {
    en: flat('Use at least {length} characters.'),
    yue: flat('請用至少 {length} 個字元。')
  },
  'universeDoorEntry.validation.passphraseLong': {
    en: flat('Use no more than 256 characters.'),
    yue: flat('請唔好超過 256 個字元。')
  }
}
