# Per-account node colours and bindings

Managed Claude and Codex accounts can carry an optional default colour for nodes created under
that account. The setting is stored with the account record in the normal settings store and is
available from Settings > Accounts for local and remote account rows.

## Behaviour

When a new Claude or Codex node is created, nodeterm resolves the account binding and then looks up
the colour in that provider's account list. A configured account colour wins over the provider's
built-in agent colour. An account without a colour keeps the agent colour. Existing nodes retain
their stored colour, so changing an account setting does not unexpectedly repaint an established
canvas.

Claude and Codex account lists are intentionally independent. Equal account IDs in the two lists do
not cross-colour nodes. Custom agents never inherit a managed account binding, even when their
launch command resembles a built-in agent.

## Persistence and live updates

Changing a swatch updates the account record through the existing settings state and persistence
path. New nodes created after the update observe the current value without restarting the app.
Account creation, removal, and login state continue to use their existing flows. Removing an
account clears its node binding as before, while existing node colours remain part of each node's
own persisted data.

## Safe fallback

Settings are hand-editable. The resolver accepts only a non-empty string colour after trimming it.
Missing, non-string, or whitespace-only values fall back to the provider colour instead of
throwing or producing an empty CSS value. Unknown agents and invalid account bindings do not gain
an account from a matching ID.

The phone registration path accepts the account ID as presentation input, but the host remains the
authority for validating the binding and resolving the account colour. The host writes the
provider-specific node field only after the shared binding rule accepts it.

## Accessibility and appearance

Each account row exposes a labelled colour group with an explicit default option, pressed state,
and accessible labels for every swatch. The account colour is a creation default, not an implicit
appearance override for existing nodes. Existing node appearance editing remains available from
the node context menu and the per-element appearance editor, where a node's own colour can be
changed independently.

## Related articles

- [Accounts and provider logins](../../features/agents/agent-support.md)
- [Appearance customization](../../appearance.md)
- [Projects and tabs](../projects/projects-and-tabs.md)
