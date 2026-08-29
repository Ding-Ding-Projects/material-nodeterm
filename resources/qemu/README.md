This directory is the package boundary for the pinned QEMU runtime used by the Linux ISO VM node.

The pinned provenance is QEMU 10.1.0, Windows x64 installer revision 20250826. QEMU is distributed
under GPL-2.0-or-later. The installer and its bundled notices are retained only for the package
boundary; the application does not alter or sign these third-party binaries.

The release packaging job supplies the verified, platform-matched `qemu-system-x86_64` and
`qemu-img` binaries here before packaging. The application resolves these files only from its
installed resources directory, never from PATH and never from a user-provided executable path.
Unsigned third-party binaries are not accepted as a substitute for the verified package payload.
The bootstrap writes `manifest.json` beside them with the installer SHA-512, exact versions,
PE-signature result, byte sizes, and SHA-256 for each required executable. Existing files are
revalidated before they are reused; a missing or mismatched manifest makes the package
unavailable.
