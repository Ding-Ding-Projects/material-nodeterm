# The NSIS installer node

A canvas node for authoring a Windows **NSIS installer script** for another project. It is a GUI
over the script: application name, version, install root, shortcuts, compression, files to
include — with a live preview of the `.nsi` it will produce.

This is emphatically **not** how nodeterm packages itself. That stays Squirrel.Windows (see the
packaging notes), and the two must not be confused: this node is a tool you point at somebody
else's project.

## What is shared and what is not

The node's data splits along the same line every other node's does, and it matters more here than
usual because half of it is absolute paths on your disk.

- The **spec** — names, version, install-root choice, shortcut and compression options — is
  content, and rides `.nodeterm/project.json`, which travels with git.
- The **local paths** — the source folder, the licence file, the icon — are machine-local and are
  stripped before that file is written. They live beside the project's other machine-local values.

A colleague who clones the repository therefore gets your installer's *shape* and none of your
directory layout, and nothing in a shared file can point this machine's build at a path somebody
else chose.

## Refusing rather than guessing

The renderer that turns a spec into a script refuses inputs it cannot express safely rather than
emitting something plausible. A refusal is shown in the preview as a readable comment saying what
is missing — never a half-written script that would fail at compile time with a less useful error.
