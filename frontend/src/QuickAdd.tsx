import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Delete, ChevronDown } from "lucide-react";
import { api, ApiError, enqueue, queue } from "./lib/api";
import {
  cents,
  fromCents,
  formatMoney,
  padAmount,
  subtract,
} from "./lib/money";
import { accountTypeName } from "./lib/accounts";
import { localDateTime, transactionInstant } from "./lib/transactionDate";
import { useApp } from "./context";
import { Sheet, ErrorText } from "./components";
import FeelingPicker from "./FeelingPicker";

export default function QuickAdd({
  draft = {},
  close,
}: {
  draft?: any;
  close: () => void;
}) {
  const { user, home, reload, notify, sync, online } = useApp();
  const [createdCategories, setCreatedCategories] = useState<any[]>([]);
  const categories = [
    ...(home?.categories || []),
    ...createdCategories.filter(
      (c) => !home?.categories.some((saved: any) => saved.id === c.id),
    ),
  ];
  const accounts = home?.accounts || [];
  const recent = JSON.parse(localStorage.getItem(user.id + ":recent") || "{}");
  const [amount, setAmount] = useState(String(draft.amount || "0"));
  const [category, setCategory] = useState(
    "category_id" in draft
      ? draft.category_id || ""
      : categories.some((c: any) => c.id === recent.category)
        ? recent.category
        : "",
  );
  const [account, setAccount] = useState(
    (draft.id ? draft.account_id : undefined) ||
      [draft.account_id, recent.account].find((id) =>
        accounts.some((a: any) => a.id === id),
      ) ||
      accounts[0]?.id ||
      "",
  );
  const [merchant, setMerchant] = useState(draft.merchant ?? "");
  const [feeling, setFeeling] = useState(draft.feeling || "");
  const [kind, setKind] = useState(draft.kind || "expense");
  const [toAccount, setToAccount] = useState(draft.to_account_id || "");
  const [note, setNote] = useState(draft.note || "");
  const [originalInstant] = useState(
    () => draft.occurred_at || new Date().toISOString(),
  );
  const [date, setDate] = useState(() =>
    localDateTime(originalInstant, user.timezone),
  );
  const [goal, setGoal] = useState(draft.goal_id || "");
  const [track, setTrack] = useState(draft.track_uses || false);
  const [busy, setBusy] = useState(false);
  const [clientId] = useState(() => draft.client_id || crypto.randomUUID());
  const [error, setError] = useState<unknown>();
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [categoryName, setCategoryName] = useState("");
  const [categoryLimit, setCategoryLimit] = useState("");
  const [categoryFixed, setCategoryFixed] = useState(false);
  const [categoryBusy, setCategoryBusy] = useState(false);
  useEffect(() => {
    if (!account && accounts.length) setAccount(accounts[0].id);
  }, [home?.accounts, account]);
  async function createCategory() {
    if (categoryBusy) return;
    setCategoryBusy(true);
    setError(undefined);
    try {
      const name = categoryName.trim();
      if (!name) throw new Error("Enter a category name.");
      const existing = categories.find(
        (c: any) => c.name.toLowerCase() === name.toLowerCase(),
      );
      if (existing) {
        setCategory(existing.id);
        setCreatingCategory(false);
        return;
      }
      if (categoryLimit && cents(categoryLimit) < 0n)
        throw new Error("The limit cannot be negative.");
      const saved = await api("/categories", "POST", {
        name,
        kind: categoryFixed ? "fixed" : "flexible",
        limit_amount: categoryLimit || null,
      });
      setCreatedCategories((old) => [
        ...old,
        {
          ...saved,
          left: saved.limit_amount,
          spent: "0.00",
          percent: "0",
          state: "normal",
        },
      ]);
      setCategory(saved.id);
      setCreatingCategory(false);
      setCategoryName("");
      setCategoryLimit("");
      setCategoryFixed(false);
      await reload();
    } catch (e) {
      setError(e);
    } finally {
      setCategoryBusy(false);
    }
  }
  const merchants = useQuery({
    queryKey: [user.id, "merchants", category],
    queryFn: () => api("/merchants/recent?category_id=" + category),
    enabled: online,
  });
  const cat = categories.find((c: any) => c.id === category);
  const currentMonth =
    home?.monthly_buckets?.month ||
    localDateTime(new Date().toISOString(), user.timezone).slice(0, 7);
  const originalCategory = categories.find(
    (c: any) => c.id === draft.category_id,
  );
  const restoreAmount =
    draft.id &&
    draft.kind === "expense" &&
    localDateTime(originalInstant, user.timezone).slice(0, 7) ===
      currentMonth &&
    (draft.category_id === cat?.id || originalCategory?.parent_id === cat?.id)
      ? cents(String(draft.amount))
      : 0n;
  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const body = {
        client_id: clientId,
        kind,
        amount: amount.endsWith(".") ? amount + "00" : amount,
        category_id: kind === "expense" ? category || null : null,
        account_id: account,
        to_account_id: kind === "transfer" ? toAccount : null,
        merchant,
        note,
        feeling: feeling || null,
        occurred_at: transactionInstant(date, user.timezone, originalInstant),
        impulse_override: !!draft.impulse_override,
        track_uses: track,
        goal_id: goal || null,
      };
      if (!account) throw new Error("Add an account in Settings first.");
      if (kind === "transfer" && (!toAccount || toAccount === account))
        throw new Error("Choose a different destination account.");
      if (kind !== "adjustment" && cents(body.amount) <= 0n)
        throw new Error("Enter an amount greater than zero.");
      if (draft.id) {
        if (!online) throw new Error("Reconnect to edit an existing entry.");
        await api("/transactions/" + draft.id, "PATCH", body);
      } else {
        // Queue first: retries always use the same client_id, including ambiguous network failures.
        await enqueue(user.id, body);
        if (online) await sync();
        const pending = (await queue(user.id)).find(
          (p) => p.payload.client_id === clientId,
        );
        if (pending?.error) throw new Error(pending.error);
      }
      localStorage.setItem(
        user.id + ":recent",
        JSON.stringify({ category, account }),
      );
      navigator.vibrate?.(20);
      notify(
        draft.id
          ? "Entry updated."
          : !(await queue(user.id)).some(
                (p) => p.payload.client_id === clientId,
              )
            ? "Entry saved."
            : "Saved on this device. Will sync when you reconnect.",
      );
      await reload();
      close();
      if (
        kind === "income" &&
        !draft.id &&
        home?.goals.some(
          (g: any) =>
            g.account_id &&
            g.account_id !== account &&
            accounts.some((a: any) => a.id === g.account_id),
        ) &&
        !(await queue(user.id)).some((p) => p.payload.client_id === clientId)
      )
        window.dispatchEvent(
          new CustomEvent("chindi-payday", {
            detail: { amount, account_id: account },
          }),
        );
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err
          : new Error(String(err instanceof Error ? err.message : err)),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      title={
        draft.id
          ? "Edit entry"
          : kind === "expense"
            ? "New expense"
            : kind === "income"
              ? "New income"
              : "Transfer"
      }
      close={close}
    >
      {kind === "expense" && (
        <>
          <label className="category-select">
            <span className="sr-only">Category</span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">Uncategorized</option>
              {draft.id &&
                draft.category_id &&
                !categories.some((c: any) => c.id === draft.category_id) && (
                  <option value={draft.category_id}>
                    {draft.category_name || "Archived category"} (archived)
                  </option>
                )}
              {categories.map((c: any) => (
                <option key={c.id} value={c.id}>
                  {c.parent_id ? "↳ " : ""}
                  {c.name}
                  {c.left != null && date.slice(0, 7) === currentMonth
                    ? " · " +
                      (c.max_count
                        ? c.left + " left"
                        : formatMoney(c.left, user.currency) + " left")
                    : ""}
                </option>
              ))}
            </select>
            <ChevronDown size={16} />
          </label>
          <div className="between">
            <button
              className="text-button"
              disabled={!online}
              onClick={() => {
                setCreatingCategory(!creatingCategory);
                setError(undefined);
              }}
            >
              + New category
            </button>
          </div>
          {!online && (
            <p className="muted">
              Log uncategorized now, or reconnect to create a category.
            </p>
          )}
          {creatingCategory && (
            <div className="card">
              <label>
                Category name
                <input
                  value={categoryName}
                  maxLength={80}
                  onChange={(e) => setCategoryName(e.target.value)}
                  placeholder="Whatever fits your spending"
                />
              </label>
              <label>
                Monthly limit (optional)
                <input
                  inputMode="decimal"
                  value={categoryLimit}
                  onChange={(e) => setCategoryLimit(e.target.value)}
                  placeholder="No limit"
                />
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={categoryFixed}
                  onChange={(e) => setCategoryFixed(e.target.checked)}
                />{" "}
                Fixed bill
              </label>
              <button
                className="button primary compact"
                onClick={createCategory}
                disabled={categoryBusy}
              >
                {categoryBusy ? "Creating…" : "Create category"}
              </button>
              <button
                className="text-button"
                onClick={() => setCreatingCategory(false)}
              >
                Cancel
              </button>
            </div>
          )}
          {!category && (
            <p className="muted">You can choose a category later in History.</p>
          )}
        </>
      )}
      <label className="amount-entry">
        <span className="sr-only">Amount</span>
        <input
          aria-label="Amount"
          inputMode="decimal"
          value={amount}
          onChange={(e) => {
            if (
              (kind === "adjustment"
                ? /^-?\d{0,10}(\.\d{0,2})?$/
                : /^\d{0,10}(\.\d{0,2})?$/
              ).test(e.target.value)
            )
              setAmount(e.target.value || "0");
          }}
          onFocus={(e) => e.target.select()}
        />
        <span>{user.currency}</span>
      </label>
      {kind === "expense" &&
        cat?.limit_amount &&
        date.slice(0, 7) === currentMonth && (
          <p className="amount-hint">
            Leaves{" "}
            {formatMoney(
              subtract(
                fromCents(cents(String(cat.left || "0")) + restoreAmount),
                amount.endsWith(".") ? amount + "0" : amount,
              ),
              user.currency,
            )}{" "}
            in {cat.name}
          </p>
        )}
      <label>
        Transaction date
        <input
          type="date"
          value={date.slice(0, 10)}
          aria-describedby="transaction-date-help"
          onChange={(e) =>
            setDate(
              e.target.value
                ? e.target.value + "T" + (date.slice(11) || "12:00")
                : "",
            )
          }
        />
      </label>
      <p className="muted" id="transaction-date-help">
        Pick the day it happened. Counts toward that month’s spending.
      </p>
      <label>
        Where
        <input
          placeholder="Merchant (optional)"
          value={merchant}
          onChange={(e) => setMerchant(e.target.value)}
          maxLength={120}
        />
      </label>
      <div className="chips">
        {merchants.data?.map((m: string) => (
          <button
            key={m}
            className={"chip " + (merchant === m ? "selected" : "")}
            onClick={() => setMerchant(m)}
          >
            {m}
          </button>
        ))}
      </div>
      <label>Paid {kind === "income" ? "into" : "with"}</label>
      <div
        className="chips"
        role="group"
        aria-label={kind === "income" ? "Paid into" : "Paid with"}
      >
        {draft.id && !accounts.some((a: any) => a.id === draft.account_id) && (
          <button
            className={
              "chip account-choice " +
              (account === draft.account_id ? "selected" : "")
            }
            aria-pressed={account === draft.account_id}
            onClick={() => setAccount(draft.account_id)}
          >
            <span>{draft.account_name || "Archived account"}</span>
            <small>
              {draft.account_kind
                ? accountTypeName(draft.account_kind) + " · "
                : ""}
              Archived
            </small>
          </button>
        )}
        {accounts.map((a: any) => (
          <button
            key={a.id}
            className={
              "chip account-choice " + (account === a.id ? "selected" : "")
            }
            aria-pressed={account === a.id}
            onClick={() => setAccount(a.id)}
          >
            <span>{a.name}</span>
            <small>{accountTypeName(a.kind)}</small>
          </button>
        ))}
      </div>
      {kind === "transfer" && (
        <label>
          To account
          <select
            value={toAccount}
            onChange={(e) => setToAccount(e.target.value)}
          >
            <option value="">Choose account</option>
            {draft.id &&
              draft.to_account_id &&
              !accounts.some((a: any) => a.id === draft.to_account_id) && (
                <option value={draft.to_account_id}>
                  {draft.to_account_name || "Archived account"} (archived)
                  {draft.to_account_kind
                    ? " · " + accountTypeName(draft.to_account_kind)
                    : ""}
                </option>
              )}
            {accounts
              .filter((a: any) => a.id !== account)
              .map((a: any) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {accountTypeName(a.kind)}
                </option>
              ))}
          </select>
        </label>
      )}
      {kind === "expense" && (
        <>
          <label>
            How does it feel? <small>(optional)</small>
          </label>
          <FeelingPicker
            value={feeling}
            onChange={setFeeling}
            disabled={busy}
          />
        </>
      )}
      <details className="extras">
        <summary>Note, time & more</summary>
        <label>
          Entry type
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              setGoal("");
            }}
          >
            <option value="expense">Expense</option>
            <option value="income">Income</option>
            <option value="transfer">Transfer / card payment</option>
            {draft.kind === "adjustment" && (
              <option value="adjustment">Balance adjustment</option>
            )}
          </select>
        </label>
        <label>
          Note
          <textarea value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <label>
          Time
          <input
            type="time"
            value={date.slice(11)}
            onChange={(e) => setDate(date.slice(0, 10) + "T" + e.target.value)}
          />
        </label>
        <p className="muted">
          Dates and times use your budget timezone: {user.timezone}.
        </p>
        {kind === "expense" && (
          <>
            <label>
              Pay from a sinking fund
              <select value={goal} onChange={(e) => setGoal(e.target.value)}>
                <option value="">None</option>
                {home?.goals
                  ?.filter((g: any) => g.kind === "sinking_fund")
                  .map((g: any) => (
                    <option value={g.id} key={g.id}>
                      {g.name}
                    </option>
                  ))}
              </select>
            </label>
            {user.preferences?.cost_per_use && (
              <label className="check">
                <input
                  type="checkbox"
                  checked={track}
                  onChange={(e) => setTrack(e.target.checked)}
                />{" "}
                Track cost per use
              </label>
            )}
          </>
        )}
      </details>
      <div className="amount-pad">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "delete"].map(
          (key) => (
            <button
              key={key}
              className="key"
              aria-label={key === "delete" ? "Delete digit" : key}
              onClick={() => setAmount(padAmount(amount, key))}
            >
              {key === "delete" ? <Delete /> : key}
            </button>
          ),
        )}
      </div>
      <ErrorText error={error} />
      <button
        className="button primary full"
        onClick={submit}
        disabled={
          busy ||
          (kind === "adjustment" ? !Number(amount) : Number(amount) <= 0)
        }
      >
        {busy
          ? "Saving…"
          : `${draft.id ? "Save" : "Add"} ${formatMoney(amount, user.currency)}`}
      </button>
    </Sheet>
  );
}
