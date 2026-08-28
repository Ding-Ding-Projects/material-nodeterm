# Repository graph universe

The Repository graph universe is a project-scoped canvas node with three views: Code, Dependency,
and Combined. It is an inspection surface, not a second project store. The source root is resolved
by the host from the active project identity, so a renderer cannot submit an arbitrary machine path.

## Code view

The bundled TypeScript compiler parses TypeScript, TSX, JavaScript, JSX, MJS, and CJS files. The
graph records files and symbols plus imports, exports, calls, references, and class inheritance.
Literal module resolution is linked to a file when it succeeds. Dynamic imports, reflection,
generated code, and unresolved module resolution remain visible as unresolved nodes or edges.

## Dependency view

Explicit adapters cover npm, Yarn, pnpm, Bun, Python, Cargo, Go, Maven, Gradle, .NET, Ruby,
Composer, Dart, Swift, CMake, vcpkg, Conan, containers, Compose, and `.gitmodules`. JSON manifests
and line-oriented lock or manifest formats are bounded and produce package nodes with the adapter
identity that supplied each edge. Unsupported or malformed records are listed in the omissions
section, never converted into an empty successful graph.

## Truth and storage

Every edge carries its source path, optional line and column, adapter id and version, source
revision, relationship kind, and confidence. Each refresh has a content hash, byte and file counts,
and a revision fingerprint. Derived snapshots are stored in the host's private application data,
with the previous verified snapshot retained for comparison and safe recovery. A cancellation or
failure retains the previous snapshot and reports the current state honestly. Resource caps cover
files, bytes, nodes, edges, per-file bytes, and elapsed time.

The canvas node persists only mode, query, layout, and bounded expanded-node ids. It never persists
absolute paths, parser caches, symbol indexes, or operation output in `.nodeterm/project.json`.
Relay sessions receive an explicit unsupported response because indexing on the viewing computer
would inspect the wrong machine. Server Edition indexes the server host's own registered project.

## Search, expansion, navigation, and export

The node has local plain-text search with an adjacent anchored full regex builder. Rows are
progressively expanded instead of mounting one component per symbol. Source navigation revalidates
the selected relative path against the host-resolved root and refuses paths outside that project.
JSON, JSONL, CSV, TSV, Markdown, HTML, GraphML, and DOT exports include revision, stale state,
provenance, confidence, and omissions where the format supports them.

The node is available from the Node Catalog as **Repository graph universe**. It is not included in
the normal project node list until the user creates it, and creating a second one is a normal canvas
action rather than a hidden global singleton.

## Verification boundary for the accelerated lane

This feature lane uses the supported Windows build and packaging paths only. Tests, type checks,
lint, reviews, accessibility checks, security checks, runtime interaction, and screenshots are
intentionally not run in the accelerated delivery lane. Those checks remain required follow-up
evidence before a broader release-grade shutdown.

Suggested articles: [Node Catalog](../canvas/node-catalog.md), [portable canvas projection](./portable-canvas-projection.md), and [local version history](../../local-history.md).
