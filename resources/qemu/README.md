This directory is the package boundary for the pinned QEMU runtime used by the Linux ISO VM node.

The release packaging job supplies the verified, platform-matched `qemu-system-x86_64` and
`qemu-img` binaries here before packaging. The application resolves these files only from its
installed resources directory, never from PATH and never from a user-provided executable path.
Unsigned third-party binaries are not accepted as a substitute for the verified package payload.
