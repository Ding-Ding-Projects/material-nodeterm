import { formatHostMessage, hostText, type HostVocabularyMap } from '../lib/personalVocabulary/hostMessage'

/** Widget status markers are app-authored text. Keep the terminal's brackets and ANSI framing in
 * the widget, and map only the marker payload through the validated vocabulary boundary. */
export function widgetTerminalMarker(text: string, map: HostVocabularyMap): string {
  return formatHostMessage([hostText(text)], map)
}
