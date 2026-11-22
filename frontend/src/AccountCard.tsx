import { Card } from "./components";
import { accountTypeName } from "./lib/accounts";
import { formatMoney } from "./lib/money";

export default function AccountCard({
  account,
  currency,
  busy,
  pending,
  onEdit,
  onAction,
}: {
  account: any;
  currency: string;
  busy: boolean;
  pending: boolean;
  onEdit: () => void;
  onAction: (action: "archive" | "restore" | "delete") => void;
}) {
  return (
    <Card>
      <div className="between">
        <div>
          <h3>{account.name}</h3>
          <p className="muted">{accountTypeName(account.kind)}</p>
        </div>
        <div className="account-amount">
          <b>
            {formatMoney(
              account.kind === "credit_card" ? account.owed : account.balance,
              currency,
            )}
          </b>
          <small>
            {account.kind === "credit_card" ? "Amount owed" : "Balance"}
          </small>
        </div>
      </div>
      <div className="chips">
        {account.archived ? (
          <button
            className="chip"
            disabled={busy}
            onClick={() => onAction("restore")}
          >
            Restore
          </button>
        ) : (
          <>
            <button className="chip" disabled={busy} onClick={onEdit}>
              Edit
            </button>
            <button
              className="chip"
              disabled={busy || pending}
              onClick={() => onAction("archive")}
            >
              Archive
            </button>
          </>
        )}
        <button
          className="chip"
          disabled={busy || pending || !account.can_delete}
          onClick={() => onAction("delete")}
        >
          Delete
        </button>
      </div>
      {pending ? (
        <p className="muted">
          Sync or discard this account's pending entries before archiving or
          deleting it.
        </p>
      ) : account.has_transactions ? (
        <p className="muted">
          Transaction history is kept. Archive this account when you stop using
          it.
        </p>
      ) : account.has_linked_goals ? (
        <p className="muted">
          Linked to a goal. Unlink it before deleting this account.
        </p>
      ) : null}
    </Card>
  );
}
