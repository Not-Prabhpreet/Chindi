import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { motion, useReducedMotion } from "motion/react";
import { ArrowLeft, ArrowRight, Plus, Download } from "lucide-react";
import { toPng } from "html-to-image";
import { api } from "../lib/api";
import { formatMoney } from "../lib/money";
import { useApp } from "../context";
import {
  Card,
  Coin,
  Empty,
  Progress,
  PageTitle,
  Sheet,
  ErrorText,
} from "../components";

export function GoalsPage() {
  const { user, home, reload, notify } = useApp();
  const [params] = useSearchParams();
  const [form, setForm] = useState(false);
  const [deposit, setDeposit] = useState<any>(null);
  const [error, setError] = useState<unknown>();
  const [edit, setEdit] = useState<any>(null);
  const [source, setSource] = useState(
    params.get("source") === "wishlist" ? "wishlist" : "manual",
  );
  const [busy, setBusy] = useState(false);
  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const f = new FormData(e.currentTarget);
    try {
      await api(
        "/goals" + (edit ? "/" + edit.id : ""),
        edit ? "PATCH" : "POST",
        {
          name: f.get("name"),
          target: f.get("target"),
          note: f.get("note"),
          kind: f.get("kind"),
          due_date: f.get("due_date") || null,
          account_id: f.get("account_id") || null,
        },
      );
      await reload();
      setForm(false);
      setEdit(null);
      notify("Your bigger plan is saved.");
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const f = new FormData(e.currentTarget);
    try {
      await api("/goals/" + deposit.id + "/deposit", "POST", {
        amount: f.get("amount"),
        source,
        from_account_id: f.get("from_account_id") || null,
      });
      await reload();
      setDeposit(null);
      notify("A little closer. Look at you go.");
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageTitle
        title="Bigger plans."
        sub="Give your future self something good."
        action={
          <button
            className="icon-button outlined"
            aria-label="Add goal"
            onClick={() => {
              setEdit(null);
              setForm(true);
              setError(undefined);
            }}
          >
            <Plus />
          </button>
        }
      />
      {home?.goals.map((g: any) => (
        <Card key={g.id}>
          <div className="between">
            <h2>{g.name}</h2>
            <span className="pill">
              {g.kind === "sinking_fund" ? "Sinking fund" : "Goal jar"}
            </span>
          </div>
          <p>{g.note}</p>
          <div className="between">
            <strong>{formatMoney(g.saved, user.currency)}</strong>
            <span>of {formatMoney(g.target, user.currency)}</span>
          </div>
          <Progress percent={g.percent} />
          {g.due_date && (
            <p className="muted">
              By {g.due_date}
              {g.monthly_suggestion
                ? " · " +
                  formatMoney(g.monthly_suggestion, user.currency) +
                  "/month suggested"
                : ""}
            </p>
          )}
          <div className="chips">
            <button
              className="button primary compact"
              onClick={() => {
                setDeposit(g);
                setError(undefined);
              }}
            >
              Add money
            </button>
            <button
              className="chip"
              onClick={() => {
                setEdit(g);
                setForm(true);
              }}
            >
              Edit
            </button>
          </div>
        </Card>
      ))}
      {!home?.goals.length && (
        <Empty title="What are you keeping it for?">
          A trip, a rainy day, a little breathing room. Give it a jar.
        </Empty>
      )}
      <h2 className="section-label">A little less spending.</h2>
      <Card>
        <div className="between">
          <h3>No-spend days</h3>
          <b>{home?.streak.current || 0}-day streak</b>
        </div>
        <div className="calendar-grid">
          {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
            <small key={"label" + i}>{d}</small>
          ))}
          {Array.from(
            {
              length:
                (new Date(home?.streak.days[0]?.date + "T12:00:00").getDay() ||
                  7) - 1 || 0,
            },
            (_, i) => (
              <span key={"blank" + i} />
            ),
          )}
          {home?.streak.days.map((d: any) => (
            <span
              title={
                d.date +
                (d.no_spend === true
                  ? " · no flexible spending"
                  : d.no_spend === false
                    ? " · flexible spending"
                    : "")
              }
              className={
                d.no_spend === true
                  ? "no-spend"
                  : d.no_spend === false
                    ? "spent-day"
                    : "future-day"
              }
              key={d.date}
            >
              {Number(d.date.slice(-2))}
            </span>
          ))}
        </div>
        <p className="muted">
          Filled days had no flexible spending. Best streak:{" "}
          {home?.streak.best || 0} days.
        </p>
      </Card>
      {form && (
        <Sheet
          title={edit ? "Edit goal" : "A new goal"}
          close={() => {
            setForm(false);
            setEdit(null);
          }}
        >
          <form onSubmit={create}>
            <label>
              Name
              <input
                name="name"
                defaultValue={edit?.name}
                required
                maxLength={100}
              />
            </label>
            <label>
              Target ({user.currency})
              <input
                name="target"
                inputMode="decimal"
                defaultValue={edit?.target}
                required
                pattern="\d+(\.\d{1,2})?"
              />
            </label>
            <label>
              Kind
              <select name="kind" defaultValue={edit?.kind || "jar"}>
                <option value="jar">Goal jar</option>
                <option value="sinking_fund">Sinking fund</option>
              </select>
            </label>
            <label>
              Due date (optional)
              <input
                name="due_date"
                type="date"
                defaultValue={edit?.due_date}
              />
            </label>
            <label>
              Note to future you
              <textarea
                name="note"
                maxLength={500}
                defaultValue={edit?.note}
                placeholder="Why does this matter to you?"
              />
            </label>
            <label>
              Linked savings account (for transfers)
              <select name="account_id" defaultValue={edit?.account_id || ""}>
                <option value="">No linked account</option>
                {home?.accounts.map((a: any) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <ErrorText error={error} />
            <button className="button primary full" disabled={busy}>
              Save goal
            </button>
          </form>
        </Sheet>
      )}
      {deposit && (
        <Sheet title={"Add to " + deposit.name} close={() => setDeposit(null)}>
          <form onSubmit={add}>
            <label>
              Amount
              <input
                name="amount"
                inputMode="decimal"
                pattern="\d+(\.\d{1,2})?"
                required
              />
            </label>
            <label>
              Source
              <select
                value={source}
                onChange={(e) => setSource(e.target.value)}
              >
                <option value="manual">Money already set aside</option>
                <option value="wishlist">Money not wasted</option>
                {home?.month_end && (
                  <option value="month_leftover">Month-end leftover</option>
                )}
                <option value="payday">Payday transfer</option>
              </select>
            </label>
            <label>
              Transfer from account (optional)
              <select name="from_account_id">
                <option value="">No transfer · record allocation only</option>
                {home?.accounts
                  .filter((a: any) => a.id !== deposit.account_id)
                  .map((a: any) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </select>
            </label>
            <p className="muted">
              An allocation records money set aside; a transfer also updates
              account balances.
            </p>
            <ErrorText error={error} />
            <button className="button primary full" disabled={busy}>
              Add money
            </button>
          </form>
        </Sheet>
      )}
    </>
  );
}

export function RulesPage() {
  const { user, home, notify, reload } = useApp();
  const [form, setForm] = useState(false);
  const [kind, setKind] = useState("custom");
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const query = useQuery({
    queryKey: [user.id, "rules"],
    queryFn: () => api("/rules"),
  });
  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const f = new FormData(e.currentTarget);
    try {
      await api("/rules", "POST", {
        name: f.get("name"),
        kind,
        category_id: kind === "custom" ? null : f.get("category_id"),
        max_count: kind === "count" ? Number(f.get("max_count")) : null,
        until: kind === "no_buy" ? f.get("until") : null,
      });
      await query.refetch();
      await reload();
      setForm(false);
      notify("A promise to future you.");
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function change(id: string, body: any) {
    try {
      await api("/rules/" + id, "PATCH", body);
      await query.refetch();
    } catch (e) {
      setError(e);
    }
  }
  return (
    <>
      <PageTitle
        title="Your rules."
        sub="A few boundaries. Less buyer’s remorse."
        action={
          <button
            aria-label="Add rule"
            className="icon-button outlined"
            onClick={() => setForm(true)}
          >
            <Plus />
          </button>
        }
      />
      <ErrorText error={error || query.error} />
      {user.preferences?.rules === false && (
        <p className="notice">
          Rule nudges are off. Turn them on in Settings to see warnings.
        </p>
      )}
      {query.data?.map((r: any) => (
        <Card key={r.id}>
          <div className="between">
            <div>
              <h3>{r.name}</h3>
              <p className="muted">
                {r.kind === "count"
                  ? r.max_count + " per month"
                  : r.kind === "no_buy"
                    ? "Until " + r.until
                    : "A personal reminder"}
              </p>
            </div>
            <label className="check">
              <input
                aria-label={"Enable " + r.name}
                type="checkbox"
                checked={r.active}
                onChange={(e) => change(r.id, { active: e.target.checked })}
              />
            </label>
          </div>
          <button
            className="text-button"
            onClick={async () => {
              try {
                await api("/rules/" + r.id, "DELETE");
                await query.refetch();
              } catch (e) {
                setError(e);
              }
            }}
          >
            Delete rule
          </button>
        </Card>
      ))}
      {!query.data?.length && !query.isLoading && (
        <Empty title="Make your own ground rules.">
          Three takeouts a month? No shopping until payday? Start small.
        </Empty>
      )}
      {form && (
        <Sheet title="New rule" close={() => setForm(false)}>
          <form onSubmit={add}>
            <label>
              Your rule
              <input
                name="name"
                required
                maxLength={200}
                placeholder="No new tech until January"
              />
            </label>
            <label>
              Type
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="custom">Personal one-liner</option>
                <option value="count">Monthly count limit</option>
                <option value="no_buy">No buying until a date</option>
              </select>
            </label>
            {kind !== "custom" && (
              <label>
                Category
                <select name="category_id" required>
                  {home?.categories.map((c: any) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {kind === "count" && (
              <label>
                Purchases per month
                <input name="max_count" type="number" min={1} required />
              </label>
            )}
            {kind === "no_buy" && (
              <label>
                Until
                <input name="until" type="date" required />
              </label>
            )}
            <ErrorText error={error} />
            <button className="button primary full" disabled={busy}>
              Save rule
            </button>
          </form>
        </Sheet>
      )}
    </>
  );
}

export function InsightsPage() {
  const { user, home } = useApp();
  const query = useQuery({
    queryKey: [user.id, "insights"],
    queryFn: () => api("/insights"),
  });
  const month = home?.wrapped_month;
  return (
    <>
      <PageTitle title="Insights" sub="Your spending, in plain English." />
      {month ? (
        <Link className="wrapped-banner" to={"/wrapped/" + month}>
          <span>
            Ready to watch (it's a roast)
            <strong>
              Your{" "}
              {new Date(month + "-15T12:00:00Z").toLocaleString("en-CA", {
                month: "long",
                timeZone: user.timezone,
              })}{" "}
              Wrapped
            </strong>
          </span>
          <ArrowRight />
        </Link>
      ) : (
        home && (
          <p className="notice">
            Your first Wrapped needs a completed month of spending.
          </p>
        )
      )}
      <ErrorText error={query.error} />
      {query.data?.map((i: any) => (
        <Card className="insight" key={i.id}>
          <h2>{i.text}</h2>
        </Card>
      ))}
      {!query.isLoading && !query.data?.length && (
        <Empty title="A few more receipts first.">
          Insights need at least 10 expenses and enough history to spot a useful
          pattern.
        </Empty>
      )}
      <Link className="subtle-link" to="/history">
        See your transaction history →
      </Link>
    </>
  );
}

export function ReviewPage() {
  const { user, home, reload, notify, openAdd } = useApp();
  const nav = useNavigate();
  const reduced = useReducedMotion();
  const [tags, setTags] = useState<string[]>([]);
  const [classification, setClassification] = useState("");
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<any>();
  const [balances, setBalances] = useState<Record<string, string>>({});
  const query = useQuery({
    queryKey: [user.id, "review"],
    queryFn: () => api("/reviews/current"),
  });
  const data = query.data;
  const purchase = data?.transactions[0];
  const wish = !purchase ? data?.wishlist[0] : null;
  async function verdict(direction: string) {
    if (busy) return;
    setBusy(true);
    try {
      if (purchase)
        await api("/reviews/current/verdicts", "POST", {
          verdicts: [
            {
              id: purchase.id,
              verdict: direction,
              classification: classification || null,
              trigger_tags: tags,
            },
          ],
        });
      else if (wish) {
        const result = await api("/wishlist/" + wish.id + "/decide", "POST", {
          decision: direction === "worth_it" ? "buy" : "let_go",
        });
        if (result.draft) openAdd(result.draft);
        notify(result.quip.text);
      }
      setTags([]);
      setClassification("");
      await query.refetch();
      await reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function complete() {
    if (busy) return;
    setBusy(true);
    try {
      const result = await api("/reviews/current/complete", "POST", {
        balances: data.accounts.map((a: any) => ({
          account_id: a.id,
          balance: balances[a.id] ?? a.balance,
        })),
      });
      setDone(result);
      await reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  if (query.isLoading) return <Empty title="Getting the receipts…" />;
  if (done || data?.complete)
    return (
      <>
        <PageTitle title="Books balanced." sub="Go touch grass." />
        <Empty
          title={`${Math.round(Number(done?.worth_it_rate || data?.worth_it_rate || 0))}% worth it.`}
        >
          Another week understood. That counts.
        </Empty>
        <button className="button primary full" onClick={() => nav("/")}>
          Back home
        </button>
      </>
    );
  return (
    <>
      <PageTitle
        title="Swipe Sunday"
        sub={"Week of " + (data?.week || "")}
        back={() => nav("/")}
        action={
          <span className="pill">{data?.transactions.length || 0} left</span>
        }
      />
      <ErrorText error={error || query.error} />
      {purchase || wish ? (
        <>
          <motion.div
            key={purchase?.id || wish?.id}
            drag={reduced ? false : "x"}
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.8}
            onDragEnd={(_, info) => {
              if (Math.abs(info.offset.x) > window.innerWidth * 0.3)
                void verdict(info.offset.x > 0 ? "worth_it" : "regret");
            }}
            className="swipe-card card"
          >
            <div className="between">
              <div>
                <p className="muted">
                  {purchase
                    ? new Date(purchase.occurred_at).toLocaleDateString(
                        "en-CA",
                        {
                          timeZone: user.timezone,
                          weekday: "short",
                          hour: "numeric",
                          minute: "2-digit",
                        },
                      )
                    : "Your timer is done."}
                </p>
                <h2>
                  {purchase?.merchant || wish?.name || "A little purchase"}
                </h2>
              </div>
              <strong className="card-amount">
                {formatMoney(purchase?.amount || wish?.price, user.currency)}
              </strong>
            </div>
            {purchase ? (
              <>
                <p>
                  {
                    home?.categories.find(
                      (c: any) => c.id === purchase.category_id,
                    )?.name
                  }
                </p>
                {purchase.feeling && (
                  <div className="notice">
                    At the time you said: {purchase.feeling}
                  </div>
                )}
                <h2 className="section-label">Looking back, worth it?</h2>
                <label>What was going on?</label>
                <div className="chips">
                  {[
                    "bored",
                    "tired",
                    "stressed",
                    "social",
                    "treating myself",
                  ].map((t) => (
                    <button
                      key={t}
                      className={"chip " + (tags.includes(t) ? "selected" : "")}
                      onClick={() =>
                        setTags(
                          tags.includes(t)
                            ? tags.filter((x) => x !== t)
                            : [...tags, t],
                        )
                      }
                    >
                      {t}
                    </button>
                  ))}
                </div>
                <label>Need, want or waste?</label>
                <div className="segmented">
                  {["need", "want", "waste"].map((c) => (
                    <button
                      className={classification === c ? "on" : ""}
                      key={c}
                      onClick={() => setClassification(c)}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <p>
                Past you said: {wish.reasons_for || "Give it a little time."}
              </p>
            )}
            <p className="swipe-hint">Swipe left or right, or tap below</p>
          </motion.div>
          <div className="two-col verdict-buttons">
            <button
              className="button danger"
              disabled={busy}
              onClick={() => verdict("regret")}
            >
              <ArrowLeft size={20} />
              {purchase ? "Nah, regret" : "Let it go"}
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={() => verdict("worth_it")}
            >
              {purchase ? "Worth it" : "Still want it"}
              <ArrowRight size={20} />
            </button>
          </div>
        </>
      ) : (
        <Card>
          <h2>One last balance check.</h2>
          <p>Does your bank agree with your books?</p>
          {data?.accounts.map((a: any) => (
            <label key={a.id}>
              {a.name}
              <input
                inputMode="decimal"
                value={balances[a.id] ?? a.balance}
                onChange={(e) =>
                  setBalances({ ...balances, [a.id]: e.target.value })
                }
              />
            </label>
          ))}
          <p className="muted">
            Changed balances create an adjustment, which never counts as
            spending.
          </p>
          <button
            className="button primary full"
            onClick={complete}
            disabled={busy}
          >
            Confirm balances & finish
          </button>
        </Card>
      )}
    </>
  );
}

export function WrappedPage() {
  const { user } = useApp();
  const nav = useNavigate();
  const month = location.pathname.split("/").pop();
  const query = useQuery({
    queryKey: [user.id, "wrapped", month],
    queryFn: () => api("/wrapped/" + month),
  });
  const [index, setIndex] = useState(0);
  const [hidden, setHidden] = useState(false);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState<unknown>();
  const ref = useRef<HTMLDivElement>(null);
  const slide = query.data?.slides[index];
  useEffect(() => {
    if (paused || !slide) return;
    const timer = setTimeout(() => setIndex((i) => Math.min(5, i + 1)), 6500);
    return () => clearTimeout(timer);
  }, [index, paused, slide]);
  async function share() {
    if (!ref.current) return;
    try {
      const url = await toPng(ref.current, {
        width: 360,
        height: 640,
        pixelRatio: 3,
        cacheBust: false,
      });
      const link = document.createElement("a");
      link.download = `chindi-${month}-${index + 1}.png`;
      link.href = url;
      link.click();
    } catch (e) {
      setError(e);
    }
  }
  return (
    <>
      <PageTitle title="Your Wrapped." back={() => nav("/insights")} />
      <ErrorText error={error || query.error} />
      {query.data && !query.data.slides.length && (
        <Empty title="No spending to wrap yet.">
          A completed month of logged spending will appear here.
        </Empty>
      )}
      {slide && (
        <>
          <div className="story-progress">
            {query.data.slides.map((_: any, i: number) => (
              <button
                key={i}
                aria-label={"Slide " + (i + 1)}
                onClick={() => setIndex(i)}
                className={i <= index ? "filled" : ""}
              />
            ))}
          </div>
          <div
            ref={ref}
            className="story"
            onPointerDown={() => setPaused(true)}
            onPointerUp={() => setPaused(false)}
            onPointerCancel={() => setPaused(false)}
          >
            <div className="story-brand">
              <Coin size={44} />
              <b>chindi</b>
            </div>
            <p>{month}</p>
            <h1>{slide.title}</h1>
            {slide.amount !== null && (
              <strong className="story-number">
                {hidden
                  ? slide.percent
                    ? Math.round(Number(slide.percent)) + "%"
                    : "A little more kept"
                  : formatMoney(slide.amount, user.currency)}
              </strong>
            )}
            <p className="story-copy">{slide.text}</p>
            <small>Keep more. Regret less.</small>
          </div>
          <div className="between">
            <button
              className="icon-button"
              aria-label="Previous slide"
              disabled={index === 0}
              onClick={() => setIndex(index - 1)}
            >
              <ArrowLeft />
            </button>
            <span>{index + 1} / 6</span>
            <button
              className="icon-button"
              aria-label="Next slide"
              disabled={index === 5}
              onClick={() => setIndex(index + 1)}
            >
              <ArrowRight />
            </button>
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={hidden}
              onChange={(e) => setHidden(e.target.checked)}
            />{" "}
            Hide my numbers
          </label>
          <button className="button primary full" onClick={share}>
            <Download size={20} /> Save share card
          </button>
        </>
      )}
    </>
  );
}
