import type { AccountPresentation } from "../lib/accountPresentation";

export function AccountIdentityPills({
  account,
  selected = false,
  warning = false,
  className = "",
}: {
  account: AccountPresentation;
  selected?: boolean;
  warning?: boolean;
  className?: string;
}): React.JSX.Element {
  return (
    <span
      className={`account-identity-pills${warning ? " account-identity-pills--warning" : ""}${className ? ` ${className}` : ""}`}
      title={account.tooltip}
    >
      <span className="account-identity-pill">{account.identity}</span>
      <span className="account-provenance-pill">{account.provenance}</span>
      {selected ? (
        <span className="account-identity-check" aria-label="Selected">
          ✓
        </span>
      ) : null}
    </span>
  );
}
