# /updates

This directory is the **macOS/Linux `electron-updater` feed** served at
`https://nodeterm.dev/updates/`. It is not the Windows feed. Packaged Windows builds use
Electron's built-in Squirrel updater and read `RELEASES` plus its full `.nupkg` from the stable
GitHub Release at `releases/latest/download`.

On each release, drop the build artifacts from `dist/` here (overwriting `latest-mac.yml`):

```
latest-mac.yml
nodeterm-<version>-arm64.dmg        (+ .blockmap)
nodeterm-<version>.dmg              (+ .blockmap)   # Intel
nodeterm-<version>-arm64-mac.zip    (+ .blockmap)   # used by auto-update
nodeterm-<version>-mac.zip          (+ .blockmap)
```

These files are intentionally **not** committed to git (they are large binaries); deploy them
straight to the host. Do not copy Windows Squirrel assets here or point a Windows build at this
metadata: `latest-mac.yml` is not a Squirrel protocol response.
