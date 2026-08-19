/**
 * Shared window-chrome geometry — currently just the app bar's height, exported so main and
 * the renderer's stylesheet cannot silently drift apart on it.
 *
 * The renderer's own copy of this number lives in `src/renderer/styles.css` as the
 * `--app-bar-h` custom property (`.tabbar`'s height, and every floating panel/overlay that
 * positions itself below it via `calc(var(--app-bar-h) + …)`). This constant is main's copy,
 * consumed by the win32 `titleBarOverlay` height so the native caption-button overlay lines up
 * with `.tabbar` instead of floating over the canvas below it. The two are independent CSS/TS
 * values with no shared build-time link — if you change one, change the other.
 */
export const APP_BAR_HEIGHT = 44
