export interface AccountPresentation {
  /** Human identity: a chosen account name, otherwise the login email. */
  identity: string;
  /** Short origin pill rendered beside the identity on every account surface. */
  provenance: string;
  /** Full, stable explanation for native tooltips. */
  tooltip: string;
}

const GENERATED_LABELS = new Set([
  "new account",
  "new codex account",
  "system account",
  "system codex account",
]);

function chosenLabel(label: string | null | undefined): string | undefined {
  const value = label?.trim();
  if (!value || GENERATED_LABELS.has(value.toLowerCase())) return undefined;
  return value;
}

/**
 * Single account-display contract shared by settings, node chrome, and account menus.
 * Credential storage kind (system/managed) is deliberately not user-facing: users select a
 * person/login and the machine it lives on, not an implementation directory.
 */
export function presentAccount({
  label,
  email,
  host,
  machineLabel,
}: {
  label?: string | null;
  email?: string | null;
  /** Canonical SSH address (`user@host`). Omit for an account on this Mac. */
  host?: string | null;
  /** Friendly saved SSH-machine name. */
  machineLabel?: string | null;
}): AccountPresentation {
  const displayLabel = chosenLabel(label);
  const cleanEmail = email?.trim() || undefined;
  const identity = displayLabel || cleanEmail || "Default account";
  const provenance = host ? `SSH · ${machineLabel?.trim() || host}` : "Local";
  const originDetail = host ? `SSH ${host}` : "This Mac";
  const identityDetail =
    cleanEmail && cleanEmail !== identity
      ? `${identity} (${cleanEmail})`
      : identity;
  return {
    identity,
    provenance,
    tooltip: `${identityDetail} · ${originDetail}`,
  };
}
