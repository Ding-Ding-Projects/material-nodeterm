// Hand-authored bilingual narration lines for the built-in app-event categories. Kept separate
// from narrator.ts (the queue/voice engine) so the CONTENT is easy to find and review on its own.
//
// Every line here supplies BOTH an English and a Cantonese text — narrator.ts only ever falls
// back from Cantonese to English for genuinely dynamic runtime content (a free-text error
// message) that has no translation; these two built-in categories never hit that fallback.

export interface NarratorPhrase {
  en: string
  yue: string
}

/** An agent turn finished. `context` is the project/folder name (or node title) the way the
 *  existing notification/toast copy already names it in Canvas.tsx. */
export function agentDonePhrase(agentLabel: string, context: string): NarratorPhrase {
  return {
    en: `${agentLabel} finished in ${context}.`,
    yue: `${context} 嗰個 ${agentLabel} 做完喇。`
  }
}

/** An agent needs the user's attention (a permission prompt or a question). */
export function agentNeedsYouPhrase(agentLabel: string, context: string): NarratorPhrase {
  return {
    en: `${agentLabel} needs you in ${context}.`,
    yue: `${context} 嗰個 ${agentLabel} 要你幫手喇。`
  }
}
