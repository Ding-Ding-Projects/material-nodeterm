# Wild dim-sum nodes

During a live canvas node creation, nodeterm performs one fresh one-percent draw for that requested node. A successful draw adds one adjacent Wild dim-sum node, with a distinct immutable event id. Placement is offset from the requested node so the two cards do not overlap.

Dish metadata is resolved from the public catalog at `https://raw.githubusercontent.com/Ding-Ding-Projects/dim-sum-photos/main/catalog/index.json`. A bounded metadata cache in browser storage records the catalog revision and bilingual name. If the catalog cannot be reached, the node keeps its safe bundled dish name and reports when its public image is unavailable. No catalog request happens during project import or hydration, so opening a saved project never redraws a dish.

There is no opt-out control. School mode suppresses the capability through its existing optional-feature policy. The dish id, bilingual name, public image URL, catalog revision, and immutable event id persist with the project. Credentials and machine-only state are not stored in it.

The draw is idempotent. A per-requested-node ledger prevents a second draw after rerender, retry, or hydration, and the event id is written once on the created node. The UI is a resizable Material surface with an accessible name, image alternative text, delete action, and an honest no-image state.

## Suggested articles

- [Dim-sum surprise](dim-sum.md)
- [Projects and tabs](features/projects-and-tabs.md)
- [Local history](local-history.md)
