import { useEffect, useState } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Clock,
  Plus,
  Settings2,
  History,
  Trash2,
  Pencil,
  Hourglass,
} from "lucide-react";
import { api } from "../lib/api";
import { formatMoney } from "../lib/money";
import { accountLabel, accountTypeName } from "../lib/accounts";
import { useApp } from "../context";
import FeelingPicker, { feelingLabel } from "../FeelingPicker";
import {
  Card,
  Coin,
  Empty,
  Progress,
  CategoryIcon,
  PageTitle,
  ErrorText,
  Sheet,
} from "../components";

export function HomePage() {
  const { user, home, openAdd } = useApp();
  const nav = useNavigate();
  const [expanded, setExpanded] = useState<string[]>([]);
  const [dismissed, setDismissed] = useState(
    localStorage.getItem(user.id + ":fresh") || "",
  );
  if (!home) return <Empty title="Your budget is loading…" />;
  const date = new Date();
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: user.timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
  const month = new Intl.DateTimeFormat("en-CA", {
    timeZone: user.timezone,
    month: "long",
  }).format(date);
  const m = (v: any) => formatMoney(v, user.currency);
  const buckets = home.monthly_buckets;
  const hasMonthlyBuckets = buckets?.has_limits;
  const resetDate = buckets
    ? new Intl.DateTimeFormat("en-CA", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      }).format(new Date(buckets.next_reset + "T00:00:00Z"))
    : "";
  const cats = home.categories.filter(
    (c: any) => c.kind === "flexible" && !c.parent_id,
  );
  return (
    <>
      <header className="home-header">
        <div className="brand">
          <Coin mood={home.quip?.mood} />
          <div>
            <strong>chindi</strong>
            <p>
              {today} · {month}
            </p>
          </div>
        </div>
        <Link
          className="icon-button outlined"
          aria-label="Settings"
          to="/settings"
        >
          <Settings2 size={22} />
        </Link>
      </header>
      <div className="quip">
        {home.quip?.text || "A little awareness goes a long way."}
      </div>
      <section className="hero">
        <label>
          {hasMonthlyBuckets ? "Left in monthly buckets" : "Spent this month"}
        </label>
        <div
          className={
            "hero-amount " +
            (hasMonthlyBuckets && Number(buckets.remaining) < 0
              ? "over-text"
              : "")
          }
        >
          {m(hasMonthlyBuckets ? buckets.remaining : home.spent)}
        </div>
        {hasMonthlyBuckets ? (
          <>
            {Number(buckets.remaining) < 0 && (
              <p className="over-text">Over your monthly bucket budget.</p>
            )}
            <dl className="budget-breakdown">
              <div>
                <dt>Assigned this month</dt>
                <dd>{m(buckets.assigned)}</dd>
              </div>
              <div>
                <dt>Spent from buckets</dt>
                <dd>{m(buckets.spent)}</dd>
              </div>
            </dl>
            <p className="budget-note">
              Amount limits renew on {resetDate}. Unused amounts don’t carry
              over.
            </p>
            {Number(buckets.unbudgeted_spent) > 0 && (
              <p className="budget-note">
                {m(buckets.unbudgeted_spent)} spent outside buckets with amount
                limits.
              </p>
            )}
            <Link className="subtle-link budget-edit" to="/categories">
              Edit monthly amounts →
            </Link>
          </>
        ) : (
          <p>
            No monthly amount limits set.{" "}
            <Link className="subtle-link" to="/categories">
              Set your own limits →
            </Link>
          </p>
        )}
        <div className="hero-stats">
          <div>
            <small>Daily average · {month}</small>
            <strong>{m(home.daily_average)}</strong>
            <span>Flexible spending this month.</span>
            {home.has_previous_month ? (
              <span>
                {m(
                  Math.abs(
                    Number(home.daily_average) -
                      Number(home.last_month_average),
                  ),
                )}{" "}
                {Number(home.daily_average) <= Number(home.last_month_average)
                  ? "less"
                  : "more"}{" "}
                than {home.last_month_name}
              </span>
            ) : (
              <span>No previous month to compare yet.</span>
            )}
          </div>
          <div>
            <small>No-spend streak</small>
            <strong>
              {home.streak.current} {home.streak.current === 1 ? "day" : "days"}
            </strong>
            <span>certified chindi</span>
          </div>
        </div>
      </section>
      <Link className="button dark pause-cta" to="/about-to-buy">
        <span>✋</span> About to buy something?
      </Link>
      {home.review_ready && (
        <button className="review-banner" onClick={() => nav("/review")}>
          <div>
            <b>Swipe Sunday is ready.</b>
            <span>{home.review_count} purchases to judge.</span>
          </div>
          <ArrowRight />
        </button>
      )}
      {home.fresh_start && dismissed !== today && (
        <Card className="pink">
          <h3>A fresh page for your money.</h3>
          <p>Take a minute to review your rules.</p>
          <div className="between">
            <Link to="/rules">Review rules →</Link>
            <button
              className="text-button"
              onClick={() => {
                localStorage.setItem(user.id + ":fresh", today);
                setDismissed(today);
              }}
            >
              Dismiss
            </button>
          </div>
        </Card>
      )}
      <div className={cats.length ? "category-card" : undefined}>
        {cats.map((c: any) => {
          const children = home.categories.filter(
            (x: any) => x.parent_id === c.id,
          );
          return (
            <div
              key={c.id}
              className={c.state === "over" ? "category-over" : ""}
            >
              <div className="category-wrap">
                <button
                  className="category-row"
                  onClick={() => openAdd({ category_id: c.id })}
                >
                  <span className={"tile " + c.color}>
                    <CategoryIcon name={c.icon} />
                  </span>
                  <div className="category-content">
                    <div className="between">
                      <b>{c.name}</b>
                      <span className={c.state === "over" ? "over-text" : ""}>
                        {c.left !== null ? (
                          <>
                            <b>
                              {c.max_count
                                ? Math.abs(c.left)
                                : m(Math.abs(Number(c.left)))}
                            </b>
                            <small>
                              {" "}
                              {Number(c.left) < 0
                                ? "over"
                                : c.max_count
                                  ? "left of " + c.max_count
                                  : "left of " + m(c.limit_amount)}
                            </small>
                          </>
                        ) : (
                          <b>{m(c.spent)} spent</b>
                        )}
                      </span>
                    </div>
                    <Progress percent={c.percent} state={c.state} />
                  </div>
                </button>
                {children.length > 0 && (
                  <button
                    className="icon-button expand"
                    aria-label={`${expanded.includes(c.id) ? "Collapse" : "Expand"} ${c.name}`}
                    onClick={() =>
                      setExpanded(
                        expanded.includes(c.id)
                          ? expanded.filter((id) => id !== c.id)
                          : [...expanded, c.id],
                      )
                    }
                  >
                    {expanded.includes(c.id) ? (
                      <ChevronUp size={18} />
                    ) : (
                      <ChevronDown size={18} />
                    )}
                  </button>
                )}
              </div>
              {expanded.includes(c.id) &&
                children.map((s: any) => (
                  <button
                    className="subcategory between"
                    key={s.id}
                    onClick={() => openAdd({ category_id: s.id })}
                  >
                    <span>{s.name}</span>
                    <b>
                      {s.max_count
                        ? s.left + " of " + s.max_count + " left"
                        : s.limit_amount
                          ? m(s.left) + " left"
                          : m(s.spent) + " spent"}
                    </b>
                  </button>
                ))}
            </div>
          );
        })}
      </div>
      {cats.length === 0 && (
        <Empty title="Your categories, your choice.">
          Create your own categories now or while logging. Limits are optional.{" "}
          <Link to="/categories">Manage categories →</Link>
        </Empty>
      )}
      {home.uncategorized_count > 0 && (
        <Card>
          <Link className="next-row" to="/history?uncategorized=1">
            {home.uncategorized_count} uncategorized{" "}
            {home.uncategorized_count === 1 ? "expense" : "expenses"} · Organize
            anytime →
          </Link>
        </Card>
      )}
      <details className="fixed-bills">
        <summary>
          Fixed bills{" "}
          <span>
            {m(
              home.categories
                .filter((c: any) => c.kind === "fixed" && !c.parent_id)
                .reduce((n: number, c: any) => n + Number(c.spent), 0),
            )}{" "}
            paid
          </span>
        </summary>
        {home.categories
          .filter((c: any) => c.kind === "fixed")
          .map((c: any) => (
            <button
              className="next-row"
              key={c.id}
              onClick={() => openAdd({ category_id: c.id })}
            >
              {c.name}
              <b>{m(c.spent)}</b>
            </button>
          ))}
      </details>
      <div className="between section-label">
        <h3>Your money spots</h3>
        <Link to="/history" className="subtle-link">
          <History size={16} /> History
        </Link>
      </div>
      <Card>
        {home.accounts.map((a: any) => (
          <div key={a.id} className="between account-line">
            <span>
              {a.name}
              <small className="account-type">
                {accountTypeName(a.kind)}
                {a.kind === "credit_card" ? " · owed" : ""}
              </small>
            </span>
            <b>{m(a.kind === "credit_card" ? a.owed : a.balance)}</b>
          </div>
        ))}
        <button
          className="text-button"
          onClick={() => openAdd({ kind: "income" })}
        >
          + Log income
        </button>
      </Card>
      {home.goals.slice(0, 1).map((g: any) => (
        <Link className="card goal-preview" key={g.id} to="/goals">
          <div className="between">
            <h3>{g.name}</h3>
            <b>{Math.round(Number(g.percent))}%</b>
          </div>
          <Progress percent={g.percent} />
          <p>{g.note || "A little closer, one choice at a time."}</p>
        </Link>
      ))}
      {user.preferences?.levels !== false && (
        <p className="level-line">
          {home.level} · {home.points} points
        </p>
      )}
    </>
  );
}

function TransactionAccounts({
  transaction,
  accounts,
}: {
  transaction: any;
  accounts: any[];
}) {
  const source = accountLabel(
    accounts.find((a) => a.id === transaction.account_id),
  );
  return (
    <p className="muted transaction-accounts">
      {transaction.kind === "transfer" ? (
        <>
          From {source}
          <br />
          To{" "}
          {accountLabel(
            accounts.find((a) => a.id === transaction.to_account_id),
          )}{" "}
          · transfer
        </>
      ) : (
        <>
          {source} · {transaction.kind}
        </>
      )}
    </p>
  );
}

export function HistoryPage() {
  const [params] = useSearchParams();
  const { user, home, openAdd, notify, reload, pending, online } = useApp();
  const [q, setQ] = useState("");
  const [category, setCategory] = useState(
    params.get("uncategorized") === "1" ? "__uncategorized" : "",
  );
  const [account, setAccount] = useState("");
  const [error, setError] = useState<unknown>();
  const [deleting, setDeleting] = useState<any>(null);
  const [rating, setRating] = useState<any>(null);
  const [selectedFeeling, setSelectedFeeling] = useState("");
  const [ratingBusy, setRatingBusy] = useState(false);
  const [ratingError, setRatingError] = useState<unknown>();
  const labels = useQuery({
    queryKey: [user.id, "history-filters"],
    queryFn: () => api("/transactions/filters"),
  });
  const accounts = labels.data?.accounts || [];
  const knownAccounts = [...accounts, ...(home?.accounts || [])];
  const categories = labels.data?.categories || [];
  useEffect(() => {
    if (!labels.data) return;
    if (
      category === "__uncategorized"
        ? !labels.data.has_uncategorized
        : category &&
          !labels.data.categories.some((c: any) => c.id === category)
    )
      setCategory("");
    if (account && !labels.data.accounts.some((a: any) => a.id === account))
      setAccount("");
  }, [labels.data, category, account]);
  const query = useQuery({
    queryKey: [user.id, "transactions", q, category, account],
    queryFn: () =>
      api(
        "/transactions?limit=5000&q=" +
          encodeURIComponent(q) +
          "&category_id=" +
          encodeURIComponent(category) +
          "&account_id=" +
          encodeURIComponent(account),
      ),
  });
  async function remove() {
    try {
      await api("/transactions/" + deleting.id, "DELETE");
      await query.refetch();
      await reload();
      setDeleting(null);
      notify("Entry deleted.");
    } catch (e) {
      setError(e);
    }
  }
  async function saveRating() {
    if (ratingBusy || !online) return;
    setRatingBusy(true);
    setRatingError(undefined);
    try {
      await api("/transactions/" + rating.id, "PATCH", {
        feeling: selectedFeeling || null,
      });
      await query.refetch();
      await reload();
      setRating(null);
      notify(selectedFeeling ? "Rating saved." : "Rating removed.");
    } catch (e) {
      setRatingError(e);
    } finally {
      setRatingBusy(false);
    }
  }
  const items = query.data || [];
  const filtered = !!(q || category || account);
  const hasHistory = labels.data?.has_transactions ?? items.length > 0;
  const showCategoryFilter =
    categories.length > 0 || labels.data?.has_uncategorized;
  const clearFilters = () => {
    setQ("");
    setCategory("");
    setAccount("");
  };
  let last = "";
  return (
    <>
      <PageTitle
        title="The receipts."
        sub="Every little thing, all in one place."
        action={
          <Link className="button compact" to="/categories?create=1">
            <Plus size={16} />
            Add category
          </Link>
        }
      />
      <p className="muted">
        Categories are optional. Use your own labels, or leave expenses
        Uncategorized.
      </p>
      <Link className="subtle-link" to="/categories">
        Manage categories
      </Link>
      <label>
        Search
        <input
          type="search"
          placeholder="Merchant or note"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </label>
      {hasHistory && (
        <div className={showCategoryFilter ? "two-col" : undefined}>
          {showCategoryFilter && (
            <label>
              Category
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="">All categories</option>
                {labels.data?.has_uncategorized && (
                  <option value="__uncategorized">Uncategorized</option>
                )}
                {categories.map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.archived ? " (archived)" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Account
            <select
              value={account}
              onChange={(e) => setAccount(e.target.value)}
            >
              <option value="">All accounts</option>
              {accounts.map((a: any) => (
                <option key={a.id} value={a.id}>
                  {accountLabel(a)}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {hasHistory && filtered && (
        <button className="text-button" onClick={clearFilters}>
          Clear filters
        </button>
      )}
      <ErrorText error={error || query.error || labels.error} />
      {pending.length > 0 && (
        <Card>
          <h3>Waiting to sync</h3>
          {pending.map((p: any) => (
            <div className="between" key={p.payload.client_id}>
              <div>
                <span>
                  {p.payload.merchant || p.payload.kind} ·{" "}
                  {formatMoney(p.payload.amount, user.currency)}
                </span>
                <TransactionAccounts
                  transaction={p.payload}
                  accounts={knownAccounts}
                />
                {p.payload.kind === "expense" && (
                  <div className="transaction-ratings">
                    <span
                      className={
                        "rating-badge " + (p.payload.feeling || "unrated")
                      }
                    >
                      Rating: <b>{feelingLabel(p.payload.feeling)}</b>
                    </span>
                  </div>
                )}
              </div>
              <small>{p.error || "On this device"}</small>
            </div>
          ))}
        </Card>
      )}
      {!query.isLoading && !items.length && (
        <Empty
          title={
            hasHistory && filtered
              ? "No matching entries."
              : "No receipts. Yet."
          }
        >
          {hasHistory && filtered
            ? "Try another search or clear your filters."
            : "Your logged entries will show up here. You can add them without a category."}
        </Empty>
      )}
      {items.map((t: any) => {
        const day = new Intl.DateTimeFormat("en-CA", {
          timeZone: user.timezone,
          weekday: "long",
          day: "numeric",
          month: "short",
        }).format(new Date(t.occurred_at));
        const showDay = last !== day;
        last = day;
        return (
          <div key={t.id}>
            {showDay && <h3 className="section-label">{day}</h3>}
            <Card>
              <div className="between">
                <div>
                  <b>
                    {t.merchant ||
                      categories.find((c: any) => c.id === t.category_id)
                        ?.name ||
                      t.kind}
                  </b>
                  <TransactionAccounts
                    transaction={t}
                    accounts={knownAccounts}
                  />
                </div>
                <strong>
                  {t.kind === "income" ? "+" : ""}
                  {formatMoney(t.amount, user.currency)}
                </strong>
              </div>
              {t.kind === "expense" && (
                <div className="transaction-ratings">
                  <button
                    className={"rating-badge " + (t.feeling || "unrated")}
                    aria-label={`${t.feeling ? "Change" : "Add"} rating for ${t.merchant || "expense"}`}
                    aria-description={`Current rating: ${feelingLabel(t.feeling)}`}
                    disabled={!online}
                    onClick={() => {
                      setRating(t);
                      setSelectedFeeling(t.feeling || "");
                      setRatingError(undefined);
                    }}
                  >
                    {t.feeling && (
                      <i className={"dot " + t.feeling} aria-hidden="true" />
                    )}
                    <span>
                      {t.feeling ? "Rating: " : ""}
                      <b>{feelingLabel(t.feeling)}</b>
                      {!t.feeling && " · Add rating"}
                    </span>
                    <Pencil size={14} aria-hidden="true" />
                  </button>
                  {t.verdict && (
                    <span
                      className={
                        "rating-badge " +
                        (t.verdict === "worth_it" ? "worth-it" : "regret")
                      }
                    >
                      Review:{" "}
                      <b>{t.verdict === "worth_it" ? "Worth it" : "Regret"}</b>
                    </span>
                  )}
                </div>
              )}
              {t.note && <p>{t.note}</p>}
              <div className="chips">
                <button
                  className="chip"
                  onClick={() =>
                    openAdd({
                      ...t,
                      account_name: accounts.find(
                        (a: any) => a.id === t.account_id,
                      )?.name,
                      account_kind: accounts.find(
                        (a: any) => a.id === t.account_id,
                      )?.kind,
                      category_name: categories.find(
                        (c: any) => c.id === t.category_id,
                      )?.name,
                      to_account_name: accounts.find(
                        (a: any) => a.id === t.to_account_id,
                      )?.name,
                      to_account_kind: accounts.find(
                        (a: any) => a.id === t.to_account_id,
                      )?.kind,
                    })
                  }
                >
                  <Pencil size={16} /> Edit
                </button>
                <button className="chip" onClick={() => setDeleting(t)}>
                  <Trash2 size={16} /> Delete
                </button>
                {t.track_uses && user.preferences?.cost_per_use && (
                  <button
                    className="chip"
                    onClick={async () => {
                      try {
                        await api("/transactions/" + t.id + "/uses", "POST");
                        await query.refetch();
                      } catch (e) {
                        setError(e);
                      }
                    }}
                  >
                    {t.uses
                      ? formatMoney(Number(t.amount) / t.uses, user.currency) +
                        "/use"
                      : "No uses yet"}{" "}
                    · +1 use
                  </button>
                )}
              </div>
            </Card>
          </div>
        );
      })}
      {rating && (
        <Sheet
          title="Rate this expense"
          close={() => {
            if (!ratingBusy) setRating(null);
          }}
        >
          <p>
            <b>{rating.merchant || "This expense"}</b> ·{" "}
            {formatMoney(rating.amount, user.currency)}
          </p>
          <p>How does this purchase feel?</p>
          <FeelingPicker
            value={selectedFeeling}
            onChange={setSelectedFeeling}
            disabled={ratingBusy}
          />
          <button
            className="text-button"
            disabled={ratingBusy || !selectedFeeling}
            onClick={() => setSelectedFeeling("")}
          >
            Clear rating
          </button>
          <ErrorText error={ratingError} />
          <button
            className="button primary full"
            disabled={ratingBusy || !online}
            onClick={saveRating}
          >
            {ratingBusy ? "Saving…" : "Save rating"}
          </button>
        </Sheet>
      )}
      {deleting && (
        <Sheet title="Delete this entry?" close={() => setDeleting(null)}>
          <p>
            {deleting.merchant || "This entry"} ·{" "}
            {formatMoney(deleting.amount, user.currency)}
          </p>
          <p>Your totals will update immediately.</p>
          <ErrorText error={error} />
          <button className="button danger full" onClick={remove}>
            Delete entry
          </button>
        </Sheet>
      )}
    </>
  );
}

export function WishlistPage() {
  const { user, openAdd, notify, reload, online } = useApp();
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const client = useQueryClient();
  const nav = useNavigate();
  const query = useQuery({
    queryKey: [user.id, "wishlist"],
    queryFn: () => api("/wishlist"),
    refetchInterval: 60000,
  });
  const waiting =
    query.data?.items.filter((w: any) => w.status === "waiting") || [];
  const ready = waiting.filter((w: any) => new Date(w.ready_at) <= new Date());
  const later = waiting.filter((w: any) => new Date(w.ready_at) > new Date());
  async function decide(w: any, decision: string) {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await api("/wishlist/" + w.id + "/decide", "POST", {
        decision,
      });
      notify(result.quip.text);
      await query.refetch();
      await reload();
      if (result.draft) openAdd(result.draft);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function remove(w: any) {
    if (busy) return;
    setBusy(true);
    setDeleting(w.id);
    setError(undefined);
    try {
      await api("/wishlist/" + w.id, "DELETE");
      client.setQueryData([user.id, "wishlist"], (data: any) =>
        data
          ? {
              ...data,
              items: data.items.filter((item: any) => item.id !== w.id),
            }
          : data,
      );
      await reload();
      notify(w.name + " deleted.");
    } catch (error) {
      setError(error);
      await query.refetch();
    } finally {
      setBusy(false);
      setDeleting(null);
    }
  }
  function deleteButton(w: any) {
    return (
      <div className="chips">
        <button
          className="chip"
          type="button"
          aria-label={"Delete " + w.name}
          disabled={busy || !online}
          onClick={() => remove(w)}
        >
          <Trash2 size={16} />
          {deleting === w.id ? "Deleting…" : "Delete"}
        </button>
      </div>
    );
  }
  return (
    <>
      <PageTitle
        title="Wishlist"
        sub="Want it? Sleep on it. A few times."
        action={
          <button
            className="icon-button outlined"
            aria-label="Add wishlist item"
            onClick={() => nav("/about-to-buy")}
          >
            <Plus />
          </button>
        }
      />
      <section className="hero">
        <label>Money not wasted</label>
        <div className="between">
          <strong className="big-number">
            {formatMoney(query.data?.money_not_wasted, user.currency)}
          </strong>
          {Number(query.data?.available_to_allocate) > 0 && (
            <Link to="/goals?source=wishlist" className="button dark compact">
              Move to a jar
            </Link>
          )}
        </div>
        <p>
          {query.data?.items.filter((w: any) => w.status === "let_go").length ||
            0}{" "}
          things you let go
        </p>
        {Number(query.data?.money_not_wasted) > 0 && (
          <p className="muted">
            {formatMoney(query.data.available_to_allocate, user.currency)}{" "}
            available to move
          </p>
        )}
      </section>
      <ErrorText error={error || query.error} />
      <h2 className="section-label">Ready to decide</h2>
      {!ready.length && (
        <p className="muted">Nothing needs a decision right now.</p>
      )}
      {ready.map((w: any) => (
        <Card className="pink" key={w.id}>
          <div className="between">
            <h2>{w.name}</h2>
            <strong className="card-amount">
              {formatMoney(w.price, user.currency)}
            </strong>
          </div>
          <p className="muted">
            Added {new Date(w.created_at).toLocaleDateString()}
          </p>
          {w.reasons_for && <p>Past you said: “{w.reasons_for}”</p>}
          <div className="two-col">
            <button
              className="button"
              disabled={busy || !online}
              onClick={() => decide(w, "buy")}
            >
              Still want it
            </button>
            <button
              className="button primary"
              disabled={busy || !online}
              onClick={() => decide(w, "let_go")}
            >
              Let it go
            </button>
          </div>
          {deleteButton(w)}
        </Card>
      ))}
      <h2 className="section-label">Waiting it out</h2>
      {later.map((w: any) => {
        const hours = Math.ceil(
          (new Date(w.ready_at).getTime() - Date.now()) / 3600000,
        );
        return (
          <Card key={w.id}>
            <div className="between">
              <div>
                <h3>{w.name}</h3>
                <span className="timer">
                  <Clock size={16} />
                  {hours >= 24 ? Math.floor(hours / 24) + "d " : ""}
                  {hours % 24}h left
                </span>
              </div>
              <strong className="card-amount">
                {formatMoney(w.price, user.currency)}
              </strong>
            </div>
            {deleteButton(w)}
          </Card>
        );
      })}
      {!waiting.length && (
        <Empty title="A little room to think.">
          Next time something catches your eye, park it here first.
        </Empty>
      )}
    </>
  );
}

export function AboutToBuyPage() {
  const { user, home, openAdd, notify, reload } = useApp();
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [category, setCategory] = useState(
    home?.categories.find((c: any) => c.name === "Shopping")?.id ||
      home?.categories[0]?.id ||
      "",
  );
  const [reasonsFor, setFor] = useState("");
  const [against, setAgainst] = useState("");
  const [preview, setPreview] = useState<any>();
  const [hours, setHours] = useState("");
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const body = () => ({
    name,
    price,
    category_id: category || null,
    reasons_for: reasonsFor,
    reasons_against: against,
    from_pause: true,
    ...(hours ? { wait_hours: Number(hours) } : {}),
  });
  async function check() {
    try {
      setPreview(await api("/about-to-buy/preview", "POST", body()));
      setError(undefined);
    } catch (e) {
      setError(e);
    }
  }
  async function wait() {
    setBusy(true);
    try {
      await api("/wishlist", "POST", body());
      notify("Parked it. Future you gets a vote.");
      await reload();
      nav("/wishlist");
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageTitle
        title="Hold up."
        sub={"Need it, or “treat yourself” again?"}
        back={() => nav(-1)}
        action={<Coin mood="judging" size={48} />}
      />
      <Card>
        <div className="two-col item-price">
          <label>
            What is it?
            <input
              value={name}
              placeholder="Wireless earbuds"
              onChange={(e) => {
                setName(e.target.value);
                setPreview(undefined);
              }}
              maxLength={160}
            />
          </label>
          <label>
            Price
            <input
              inputMode="decimal"
              placeholder="129.00"
              value={price}
              onChange={(e) => {
                setPrice(e.target.value);
                setPreview(undefined);
              }}
            />
          </label>
        </div>
        <label>
          Category
          <select
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setPreview(undefined);
            }}
          >
            <option value="">Uncategorized</option>
            {home?.categories.map((c: any) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <button
          className="button full"
          onClick={check}
          disabled={!name || Number(price) <= 0}
        >
          Check this purchase
        </button>
      </Card>
      {preview?.goal && (
        <Card className="dark-card">
          <label>Note from past you</label>
          <h2>“{preview.goal.note || "Give your bigger plans a chance."}”</h2>
          <div className="between">
            <p>{preview.goal.name}</p>
            <span>
              {formatMoney(preview.goal.saved, user.currency)} of{" "}
              {formatMoney(preview.goal.target, user.currency)}
            </span>
          </div>
          <Progress
            percent={
              (100 * Number(preview.goal.saved)) / Number(preview.goal.target)
            }
          />
          {preview.goal_impact && (
            <p>
              This would eat {Math.round(Number(preview.goal_impact))}% of
              what's left to save.
            </p>
          )}
        </Card>
      )}
      {preview &&
        (preview.regret_rate !== null || preview.broken_rules.length > 0) && (
          <Card className="regret-card">
            {preview.regret_rate !== null && (
              <p>
                You regretted {Math.round(Number(preview.regret_rate))}% of
                reviewed buys in this category.
              </p>
            )}
            {preview.broken_rules.map((r: any) => (
              <p className="over-text" key={r.id}>
                Breaks your rule: {r.name}
              </p>
            ))}
          </Card>
        )}
      <Card>
        <h2>Quick gut check</h2>
        <div className="two-col">
          <label>
            Reasons to buy
            <textarea
              value={reasonsFor}
              onChange={(e) => setFor(e.target.value)}
              placeholder="What would it change?"
              maxLength={1000}
            />
          </label>
          <label>
            Reasons to wait
            <textarea
              value={against}
              onChange={(e) => setAgainst(e.target.value)}
              placeholder="What could wait?"
              maxLength={1000}
            />
          </label>
        </div>
        <label>
          Cooling-off timer
          <select value={hours} onChange={(e) => setHours(e.target.value)}>
            <option value="">
              Automatic ·{" "}
              {Number(price) < 100
                ? "72 hours"
                : Number(price) <= 300
                  ? "7 days"
                  : "30 days"}
            </option>
            <option value="72">72 hours</option>
            <option value="168">7 days</option>
            <option value="720">30 days</option>
          </select>
        </label>
      </Card>
      <ErrorText error={error} />
      <button
        className="button primary full"
        onClick={wait}
        disabled={busy || !name || Number(price) <= 0}
      >
        <Hourglass size={20} />{" "}
        {busy
          ? "Saving…"
          : "Wait " +
            (hours
              ? Number(hours) / 24 + " days"
              : Number(price) < 100
                ? "72 hours"
                : Number(price) <= 300
                  ? "7 days"
                  : "30 days")}
      </button>
      <button
        className="text-button full"
        disabled={!name || Number(price) <= 0}
        onClick={() =>
          openAdd({
            amount: price,
            merchant: name,
            category_id: category,
            impulse_override: true,
          })
        }
      >
        Buy it anyway (I'll remember this)
      </button>
    </>
  );
}
