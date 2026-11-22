import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toPng } from "html-to-image";
import { Download, Plus, LogOut, Bell, ArrowRight } from "lucide-react";
import {
  api,
  authenticate,
  logout,
  downloadExport,
  importFile,
  clearCache,
} from "../lib/api";
import { cents, formatMoney, fromCents } from "../lib/money";
import {
  DEFAULT_BUDGET_CATEGORIES,
  budgetPayload,
  budgetTotals,
  type BudgetCategory,
} from "../lib/onboardingBudget";
import { useApp } from "../context";
import AccountSecurity, { PasskeyHelp } from "../AccountSecurity";
import AccountCard from "../AccountCard";
import { accountTypeName } from "../lib/accounts";
import RecoverAccount from "../RecoverAccount";
import { passkeysSupported, signInWithPasskey } from "../lib/passkeys";
import {
  Card,
  Coin,
  Empty,
  PageTitle,
  Sheet,
  ErrorText,
  NextRow,
} from "../components";

const QUIZ = [
  "Add to cart at 2 am?",
  "'I deserve this' after a bad day?",
  "A $7 coffee every single morning?",
  "A subscription you forgot you have?",
  "Can't say no when friends say 'let's go out'?",
  "You check your balance before buying gum?",
];
const PERSONALITIES = [
  "Midnight Cart Goblin",
  "Treat Yourself Repeat Offender",
  "Latte Leak",
  "Subscription Hoarder",
  "Social Butterfly (Wallet Moth)",
  "Secret Chindi",
];
function quizResult(answers: boolean[]) {
  const scores: number[] = answers.map((a) => (a ? 2 : 0));
  scores[5] += answers.filter((a) => !a).length;
  return PERSONALITIES[scores.indexOf(Math.max(...scores))];
}
const ONBOARDING_KEY = "chindi:onboarding";

export function AuthPage({ onUser }: { onUser: (u: any) => void }) {
  const nav = useNavigate();
  const [mode, setMode] = useState(
    window.location.pathname === "/reset-password" ? "forgot" : "login",
  );
  const [resetToken, setResetToken] = useState(() =>
    new URLSearchParams(window.location.hash.slice(1)).get("token"),
  );
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<any>();
  useEffect(() => {
    api("/auth/status").then(setStatus).catch(setError);
  }, []);
  useEffect(() => {
    if (resetToken) nav("/reset-password", { replace: true });
  }, [resetToken, nav]);
  function back() {
    setMode("login");
    setResetToken(null);
    setError(undefined);
    nav("/", { replace: true });
  }
  async function passkey() {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      onUser(await signInWithPasskey());
      nav("/");
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }
  async function login(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    const data = new FormData(e.currentTarget);
    try {
      const user = await authenticate("login", {
        email: data.get("email"),
        password: data.get("password"),
      });
      onUser(user);
      nav("/", { replace: true });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  if (mode === "setup")
    return <Onboarding onUser={onUser} cancel={() => setMode("login")} />;
  if (mode === "forgot")
    return (
      <RecoverAccount
        emailAvailable={!!status?.password_email_available}
        token={resetToken}
        back={back}
        onReset={() => onUser(null)}
      />
    );
  if (mode === "closed")
    return (
      <main className="auth">
        <PageTitle title="Create an account." />
        <Card>
          <p>
            This private installation isn't accepting new accounts. Ask the
            owner to enable registration.
          </p>
        </Card>
        <button className="button full" onClick={back}>
          Back to log in
        </button>
      </main>
    );
  return (
    <main className="auth">
      <div className="auth-logo">
        <Coin size={72} />
        <h1>chindi</h1>
        <p>Keep more. Regret less.</p>
      </div>
      <Card>
        <h2>Your wallet called.</h2>
        <p>Let's give it a little breathing room.</p>
        <button
          className="text-button auth-create"
          disabled={!status}
          onClick={() => setMode(status.registration_open ? "setup" : "closed")}
        >
          Create account <ArrowRight size={18} />
        </button>
        <form onSubmit={login}>
          <label>
            Email
            <input
              type="email"
              name="email"
              autoComplete="email"
              required
              maxLength={254}
            />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              minLength={10}
              maxLength={128}
              required
            />
          </label>
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setError(undefined);
              setMode("forgot");
            }}
          >
            Forgot password?
          </button>
          <ErrorText error={error} />
          <button className="button primary full" disabled={busy}>
            {busy ? "Logging in…" : "Log in"}
          </button>
        </form>
        <button
          className="button full"
          onClick={passkey}
          disabled={busy || !passkeysSupported()}
        >
          Sign in with a passkey
        </button>
        <PasskeyHelp />
        <p className="muted">
          You stay signed in on this device. Use Face ID, fingerprint or your
          device PIN with a saved passkey.
        </p>
      </Card>
      <p className="auth-foot">
        No bank linking. No judgment.
        <br />
        Okay, a little judgment.
      </p>
    </main>
  );
}

export function Onboarding({
  onUser,
  cancel,
  existing,
}: {
  onUser: (u: any) => void;
  cancel?: () => void;
  existing?: any;
}) {
  const nav = useNavigate();
  const persisted = JSON.parse(localStorage.getItem(ONBOARDING_KEY) || "{}");
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<any>({
    answers: [],
    tone: "sweet",
    accounts: [],
    budgetCategories: DEFAULT_BUDGET_CATEGORIES,
    budgetConfigured: false,
    goalName: "",
    goalTarget: "",
    goalNote: "",
    ...persisted,
  });
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    localStorage.setItem(ONBOARDING_KEY, JSON.stringify(draft));
  }, [draft]);
  const update = (key: string, value: any) =>
    setDraft((d: any) => ({ ...d, [key]: value }));
  const result =
    draft.answers.length === 6 ? quizResult(draft.answers) : "Secret Chindi";
  const budgetCategories: BudgetCategory[] = draft.budgetCategories;
  let totals: ReturnType<typeof budgetTotals> | undefined;
  try {
    totals = budgetTotals(budgetCategories);
  } catch {
    /* Show validation on Continue. */
  }
  function changeCategory(index: number, values: Partial<BudgetCategory>) {
    update(
      "budgetCategories",
      budgetCategories.map((category, i) =>
        i === index ? { ...category, ...values } : category,
      ),
    );
  }
  function validateAccounts() {
    return draft.accounts.map((account: any, index: number) => {
      const name = account.name.trim();
      if (!name)
        throw new Error(`Give account ${index + 1} a name, or remove it.`);
      const balance = cents(account.opening_balance);
      if (balance <= -1000000000000n || balance >= 1000000000000n)
        throw new Error(`${name}: enter a balance below 10 billion.`);
      return { ...account, name, opening_balance: fromCents(balance) };
    });
  }
  async function share() {
    if (!ref.current) return;
    try {
      const url = await toPng(ref.current, {
        width: 360,
        height: 640,
        pixelRatio: 3,
      });
      const a = document.createElement("a");
      a.download = "my-chindi-personality.png";
      a.href = url;
      a.click();
    } catch (e) {
      setError(e);
    }
  }
  async function finish(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const categories = draft.budgetConfigured
        ? budgetPayload(budgetCategories)
        : undefined;
      const accounts = validateAccounts();
      const f = new FormData(e.currentTarget);
      const user =
        existing ||
        (await authenticate("register", {
          name: f.get("name") || "You",
          email: f.get("email"),
          password: f.get("password"),
        }));
      const payload: any = {
        tone: draft.tone,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        accounts,
        ...(draft.answers.length === 6 ? { answers: draft.answers } : {}),
      };
      if (draft.goalName && Number(draft.goalTarget) > 0)
        payload.goal = {
          name: draft.goalName,
          target: draft.goalTarget,
          note: draft.goalNote,
        };
      if (categories) payload.categories = categories;
      try {
        await api("/onboarding/complete", "POST", payload);
      } catch (error) {
        onUser(user);
        nav("/welcome");
        throw error;
      }
      localStorage.removeItem(ONBOARDING_KEY);
      onUser(await api("/me"));
      nav("/install");
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  const next = () => {
    setError(undefined);
    setStep((s) => s + 1);
  };
  return (
    <main className="onboarding">
      <div className="between">
        <Link to="/" className="brand-word">
          chindi
        </Link>
        {cancel && (
          <button className="text-button" onClick={cancel}>
            Log in instead
          </button>
        )}
      </div>
      <div className="step-dots">
        {Array.from({ length: 8 }, (_, i) => (
          <span key={i} className={step >= i ? "on" : ""} />
        ))}
      </div>
      {step === 0 && (
        <div className="hello">
          <Coin size={120} />
          <h1>Hi, I'm Chindi.</h1>
          <p>
            I'm here to judge your spending.
            <br />
            Lovingly.
          </p>
          <button className="button primary full" onClick={next}>
            Let's go
          </button>
          <button className="text-button full" onClick={() => setStep(7)}>
            Skip setup
          </button>
        </div>
      )}
      {step === 1 && (
        <>
          <PageTitle
            title="Sound familiar?"
            sub="Six quick questions. Be honest."
          />
          {draft.answers.length < 6 ? (
            <Card className="quiz-card">
              <p>{draft.answers.length + 1} of 6</p>
              <Coin size={76} />
              <h2>{QUIZ[draft.answers.length]}</h2>
              <div className="two-col">
                <button
                  className="button"
                  onClick={() => update("answers", [...draft.answers, false])}
                >
                  ← Never
                </button>
                <button
                  className="button primary"
                  onClick={() => update("answers", [...draft.answers, true])}
                >
                  That's me →
                </button>
              </div>
            </Card>
          ) : (
            <button className="button primary full" onClick={next}>
              Meet your personality
            </button>
          )}
          <button
            className="text-button full"
            onClick={() => {
              update("answers", []);
              setStep(3);
            }}
          >
            Skip quiz
          </button>
        </>
      )}
      {step === 2 && (
        <>
          <div className="personality-preview">
            <div className="personality story" ref={ref}>
              <div className="story-brand">
                <Coin size={48} />
                <b>chindi</b>
              </div>
              <p>Your spending personality</p>
              <Coin size={120} />
              <h1>{result}</h1>
              <p>Know your patterns. Keep more of what matters.</p>
              <small>Keep more. Regret less.</small>
            </div>
          </div>
          <button className="button full" onClick={share}>
            <Download size={20} /> Share your personality
          </button>
          <button className="button primary full" onClick={next}>
            That's me. What's next?
          </button>
        </>
      )}
      {step === 3 && (
        <>
          <PageTitle
            title="Pick a vibe."
            sub="Same numbers. Different side-eye."
          />
          {["sweet", "savage"].map((t) => (
            <button
              key={t}
              className={"tone-card card " + (draft.tone === t ? "chosen" : "")}
              onClick={() => update("tone", t)}
            >
              <Coin mood={t === "sweet" ? "happy" : "judging"} size={58} />
              <div>
                <h2>{t === "sweet" ? "Sweet" : "Savage"}</h2>
                <p>
                  {t === "sweet"
                    ? "A little encouragement. You've got this."
                    : "Money doesn't grow on trees, bestie."}
                </p>
              </div>
            </button>
          ))}
          <button className="button primary full" onClick={next}>
            Continue
          </button>
        </>
      )}
      {step === 4 && (
        <>
          <PageTitle
            title="Your money spots."
            sub="Start with the accounts you use."
          />
          {draft.accounts.map((a: any, i: number) => (
            <Card key={i}>
              <label>
                Name
                <input
                  value={a.name}
                  onChange={(e) =>
                    update(
                      "accounts",
                      draft.accounts.map((x: any, n: number) =>
                        n === i ? { ...x, name: e.target.value } : x,
                      ),
                    )
                  }
                />
              </label>
              <div className="two-col">
                <label>
                  Type
                  <select
                    value={a.kind}
                    onChange={(e) =>
                      update(
                        "accounts",
                        draft.accounts.map((x: any, n: number) =>
                          n === i ? { ...x, kind: e.target.value } : x,
                        ),
                      )
                    }
                  >
                    {[
                      "chequing",
                      "savings",
                      "credit_card",
                      "cash",
                      "other",
                    ].map((k) => (
                      <option key={k} value={k}>
                        {k.replace("_", " ")}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Opening balance
                  <input
                    inputMode="decimal"
                    value={a.opening_balance}
                    onChange={(e) =>
                      update(
                        "accounts",
                        draft.accounts.map((x: any, n: number) =>
                          n === i
                            ? { ...x, opening_balance: e.target.value }
                            : x,
                        ),
                      )
                    }
                  />
                </label>
              </div>
              <p className="muted">
                For credit cards, enter what you owe as a negative amount.
              </p>
              <button
                className="text-button"
                aria-label={`Remove account ${i + 1}`}
                onClick={() =>
                  update(
                    "accounts",
                    draft.accounts.filter((_: any, n: number) => n !== i),
                  )
                }
              >
                Remove account
              </button>
            </Card>
          ))}
          <button
            className="button full"
            onClick={() =>
              update("accounts", [
                ...draft.accounts,
                { name: "", kind: "chequing", opening_balance: "0.00" },
              ])
            }
          >
            <Plus size={18} /> Add account
          </button>
          <button
            className="button primary full"
            onClick={() => {
              try {
                update("accounts", validateAccounts());
                next();
              } catch (e) {
                setError(e);
              }
            }}
          >
            Continue
          </button>
          <button
            className="text-button full"
            onClick={() => {
              update("accounts", []);
              next();
            }}
          >
            Skip · use a blank chequing account
          </button>
        </>
      )}
      {step === 5 && (
        <>
          <PageTitle
            title="Your categories."
            sub="Make this fit how you spend."
          />
          <Card>
            <p>
              Add your own categories, with optional monthly limits. You can
              also create them while logging an expense, or organize
              uncategorized expenses later.
            </p>
            {budgetCategories.map((category, index) => (
              <div key={index} className="onboarding-category">
                <label>
                  Category name
                  <input
                    aria-label={`Category ${index + 1} name`}
                    maxLength={80}
                    value={category.name}
                    onChange={(e) =>
                      changeCategory(index, { name: e.target.value })
                    }
                    placeholder="e.g. Groceries, Rent, Hobbies"
                  />
                </label>
                <label>
                  Monthly limit ({existing?.currency || "CAD"})
                  <input
                    aria-label={`${category.name} monthly limit`}
                    inputMode="decimal"
                    value={category.amount}
                    disabled={!category.enabled}
                    placeholder="No limit"
                    onChange={(e) =>
                      changeCategory(index, { amount: e.target.value })
                    }
                  />
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    aria-label={`${category.name} is a fixed bill`}
                    disabled={!category.enabled}
                    checked={category.kind === "fixed"}
                    onChange={(e) =>
                      changeCategory(index, {
                        kind: e.target.checked ? "fixed" : "flexible",
                      })
                    }
                  />{" "}
                  Fixed bill
                </label>
                <button
                  className="text-button"
                  onClick={() =>
                    update(
                      "budgetCategories",
                      budgetCategories.filter((_, i) => i !== index),
                    )
                  }
                >
                  Remove category
                </button>
              </div>
            ))}
            <button
              className="button full"
              onClick={() =>
                update("budgetCategories", [
                  ...budgetCategories,
                  {
                    name: "",
                    amount: "",
                    kind: "flexible",
                    enabled: true,
                    icon: "bag",
                    color: "sky-soft",
                  },
                ])
              }
            >
              <Plus size={18} /> Add category
            </button>
            <div className="between">
              <strong>Monthly flexible total</strong>
              <output aria-label="Monthly flexible total">
                {totals
                  ? formatMoney(totals.flexible, existing?.currency || "CAD")
                  : "Check amounts"}
              </output>
            </div>
            <div className="between">
              <span>Fixed bills total</span>
              <output aria-label="Fixed bills total">
                {totals
                  ? formatMoney(totals.fixed, existing?.currency || "CAD")
                  : "Check amounts"}
              </output>
            </div>
            <p className="muted">
              Home combines these amount limits, including fixed bills. They
              renew on the 1st of each month. Unused amounts don’t carry over.
            </p>
          </Card>
          <button
            className="button primary full"
            onClick={() => {
              try {
                budgetPayload(budgetCategories);
                update("budgetConfigured", true);
                next();
              } catch (error) {
                setError(error);
              }
            }}
          >
            Continue
          </button>
          <button
            className="text-button full"
            onClick={() => {
              update("budgetCategories", DEFAULT_BUDGET_CATEGORIES);
              update("budgetConfigured", false);
              next();
            }}
          >
            Skip · add categories as you go
          </button>
        </>
      )}
      {step === 6 && (
        <>
          <PageTitle
            title="What's your why?"
            sub="Give future you a little motivation."
          />
          <Card>
            <label>
              First goal
              <input
                value={draft.goalName}
                onChange={(e) => update("goalName", e.target.value)}
                placeholder="Japan trip"
              />
            </label>
            <label>
              Target
              <input
                inputMode="decimal"
                value={draft.goalTarget}
                onChange={(e) => update("goalTarget", e.target.value)}
                placeholder="3000.00"
              />
            </label>
            <label>
              Note to future you
              <textarea
                value={draft.goalNote}
                onChange={(e) => update("goalNote", e.target.value)}
                placeholder="I want to land in Tokyo without stressing about money."
              />
            </label>
          </Card>
          <button className="button primary full" onClick={next}>
            Continue
          </button>
          <button
            className="text-button full"
            onClick={() => {
              update("goalName", "");
              next();
            }}
          >
            Skip for now
          </button>
        </>
      )}
      {step === 7 && (
        <>
          <PageTitle
            title={existing ? "Make it yours." : "Save your stuff."}
            sub="Your budget belongs to you."
          />
          <Card>
            <form onSubmit={finish}>
              {!existing && (
                <>
                  <label>
                    Name
                    <input
                      name="name"
                      maxLength={80}
                      autoComplete="given-name"
                    />
                  </label>
                  <label>
                    Email
                    <input
                      name="email"
                      type="email"
                      autoComplete="email"
                      maxLength={254}
                      required
                    />
                  </label>
                  <label>
                    Password
                    <input
                      name="password"
                      type="password"
                      minLength={10}
                      maxLength={128}
                      autoComplete="new-password"
                      required
                    />
                    <small>At least 10 characters.</small>
                  </label>
                </>
              )}
              <ErrorText error={error} />
              <button className="button primary full" disabled={busy}>
                {busy
                  ? "Saving…"
                  : existing
                    ? "Finish setup"
                    : "Create account"}
              </button>
            </form>
          </Card>
        </>
      )}
      {step > 0 && step < 7 && (
        <button
          className="text-button"
          onClick={() => setStep(Math.max(0, step - 1))}
        >
          ← Back
        </button>
      )}
      <ErrorText error={step === 7 ? undefined : error} />
    </main>
  );
}

export function InstallPage() {
  const { openAdd } = useApp();
  return (
    <>
      <PageTitle
        title="Put me on your home screen."
        sub="I'll be watching. Lovingly."
      />
      <Card>
        <Coin size={90} />
        <h2>Your pocket-sized side-eye.</h2>
        <p>
          On iPhone: open this site in Safari, tap Share, then Add to Home
          Screen.
        </p>
        <p>
          On Android: open your browser's menu and choose Install app or Add to
          Home screen.
        </p>
        <p>
          Install from your HTTPS domain for the full offline and notification
          experience.
        </p>
      </Card>
      <Link className="button full" to="/settings">
        Set up a passkey & recovery code
      </Link>
      <Link className="button primary full" to="/" onClick={() => openAdd()}>
        Log your first expense
      </Link>
      <Link className="text-button full" to="/">
        Nothing spent? Who even are you?
      </Link>
    </>
  );
}

export function SettingsPage() {
  const { user, setUser, notify, pending, reload } = useApp();
  const nav = useNavigate();
  const [error, setError] = useState<unknown>();
  const [confirm, setConfirm] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const updateQueue = useRef<Promise<any>>(Promise.resolve(user));
  const updateVersion = useRef(0);
  const confirmedProfile = useRef(user);
  async function update(body: any) {
    const version = ++updateVersion.current;
    setUser({ ...user, ...body });
    setError(undefined);
    const request = updateQueue.current
      .catch(() => undefined)
      .then(() => api("/me", "PATCH", body));
    updateQueue.current = request;
    try {
      const next = await request;
      confirmedProfile.current = next;
      if (version === updateVersion.current) {
        setUser(next);
        await reload();
        notify("Settings saved.");
      }
    } catch (e) {
      if (version === updateVersion.current) {
        setUser(confirmedProfile.current);
        setError(e);
      }
    }
  }
  async function push() {
    try {
      const key = await api("/push/key");
      if (!key.public_key)
        throw new Error("Web push needs VAPID keys on your server.");
      if (!("serviceWorker" in navigator) || !("PushManager" in window))
        throw new Error(
          "Install the app on your home screen first, then try again.",
        );
      if ((await Notification.requestPermission()) !== "granted")
        throw new Error(
          "Notifications were not enabled. You can change this in your browser settings.",
        );
      const reg = await navigator.serviceWorker.ready;
      const padded =
        key.public_key + "=".repeat((4 - (key.public_key.length % 4)) % 4);
      const bytes = Uint8Array.from(
        atob(padded.replace(/-/g, "+").replace(/_/g, "/")),
        (c) => c.charCodeAt(0),
      );
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: bytes,
      });
      await api("/push/subscribe", "POST", subscription.toJSON());
      await update({
        preferences: { ...user.preferences, notifications: true },
      });
    } catch (e) {
      setError(e);
    }
  }
  async function importNow() {
    if (!confirm || busy) return;
    setBusy(true);
    try {
      await importFile(confirm);
      await clearCache(user.id);
      setConfirm(null);
      setUser(await api("/me"));
      window.location.reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageTitle
        title="Your settings."
        back={() => nav("/")}
        sub="A budget that fits you."
      />
      <ErrorText error={error} />
      <Card>
        <h2>{user.name}</h2>
        <p>{user.email}</p>
        <label>
          Tone
          <select
            value={user.tone}
            onChange={(e) => update({ tone: e.target.value })}
          >
            <option value="sweet">Sweet</option>
            <option value="savage">Savage</option>
          </select>
        </label>
        <label>
          Currency
          <select
            value={user.currency}
            onChange={(e) => update({ currency: e.target.value })}
          >
            {["CAD", "USD", "GBP", "EUR", "INR", "AUD", "NZD", "JPY"].map(
              (c) => (
                <option key={c}>{c}</option>
              ),
            )}
          </select>
          <small>
            Changing currency changes labels; it does not convert your balances.
          </small>
        </label>
        <label>
          Timezone
          <input
            key={user.timezone}
            defaultValue={user.timezone}
            onBlur={(e) => {
              if (e.target.value !== user.timezone)
                void update({ timezone: e.target.value });
            }}
          />
        </label>
        <label>
          Week starts
          <select
            value={user.preferences?.week_start || "monday"}
            onChange={(e) =>
              update({
                preferences: {
                  ...user.preferences,
                  week_start: e.target.value,
                },
              })
            }
          >
            <option value="monday">Monday</option>
            <option value="sunday">Sunday</option>
          </select>
        </label>
      </Card>
      <AccountSecurity />
      <Card>
        <h2>Your money</h2>
        <NextRow onClick={() => nav("/accounts")}>Accounts</NextRow>
        <NextRow onClick={() => nav("/categories")}>
          Categories & limits
        </NextRow>
        <NextRow onClick={() => nav("/history")}>Transaction history</NextRow>
        <NextRow onClick={() => nav("/quiz")}>
          Retake your personality quiz
        </NextRow>
        <NextRow onClick={() => nav("/subscriptions")}>Subscriptions</NextRow>
      </Card>
      <Card>
        <h2>A little more depth.</h2>
        {[
          ["rules", "Rule nudges"],
          ["levels", "Levels & celebrations"],
          ["subscriptions", "Subscription reminders"],
          ["cost_per_use", "Cost per use"],
        ].map(([key, label]) => (
          <label className="switch-row" key={key}>
            {label}
            <input
              type="checkbox"
              checked={
                user.preferences?.[key] ?? ["rules", "levels"].includes(key)
              }
              onChange={(e) =>
                update({
                  preferences: { ...user.preferences, [key]: e.target.checked },
                })
              }
            />
          </label>
        ))}
      </Card>
      <Card>
        <h2>A helpful nudge.</h2>
        <p>
          Opt in to evening check-ins, Swipe Sunday, wishlist timers and
          Wrapped. On iPhone, install Chindi first.
        </p>
        <button className="button full" onClick={push}>
          <Bell size={18} /> Enable notifications
        </button>
        <label className="switch-row">
          Notification reminders
          <input
            type="checkbox"
            checked={!!user.preferences?.notifications}
            onChange={(e) =>
              update({
                preferences: {
                  ...user.preferences,
                  notifications: e.target.checked,
                },
              })
            }
          />
        </label>
        <label>
          Evening reminder
          <input
            type="time"
            defaultValue={user.preferences?.nudge_time || "20:00"}
            onBlur={(e) =>
              update({
                preferences: {
                  ...user.preferences,
                  nudge_time: e.target.value,
                },
              })
            }
          />
        </label>
      </Card>
      <Card>
        <h2>Your data. Always.</h2>
        <div className="two-col">
          {["json", "csv"].map((f) => (
            <button
              key={f}
              className="button"
              onClick={() => downloadExport(f).catch(setError)}
            >
              <Download size={18} /> {f.toUpperCase()}
            </button>
          ))}
        </div>
        <input
          className="sr-only"
          ref={fileRef}
          type="file"
          accept=".json,.csv"
          onChange={(e) => {
            setConfirm(e.target.files?.[0] || null);
            e.target.value = "";
          }}
        />
        <button
          className="button full"
          disabled={pending.length > 0}
          onClick={() => fileRef.current?.click()}
        >
          Restore an export
        </button>
        <small>Sync pending entries before restoring a backup.</small>
      </Card>
      <button
        className="button full"
        onClick={async () => {
          try {
            await logout();
            await clearCache(user.id);
            localStorage.removeItem("chindi:session");
            setUser(null);
          } catch (e) {
            setError(e);
          }
        }}
      >
        <LogOut size={18} /> Log out
      </button>
      <p className="auth-foot">chindi · Keep more. Regret less.</p>
      {confirm && (
        <Sheet title="Restore this backup?" close={() => setConfirm(null)}>
          <p>
            Restoring {confirm.name} replaces your current budget data. Download
            an export first if you want to keep it.
          </p>
          <ErrorText error={error} />
          <button
            className="button danger full"
            onClick={importNow}
            disabled={busy}
          >
            {busy ? "Restoring…" : "Replace data with this backup"}
          </button>
        </Sheet>
      )}
    </>
  );
}

export function ManagePage({
  type,
}: {
  type: "accounts" | "categories" | "subscriptions";
}) {
  const { user, home, reload, notify, pending, online } = useApp();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [edit, setEdit] = useState<any>();
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<any>(null);
  useEffect(() => {
    if (type === "categories" && params.get("create") === "1") {
      setEdit({});
      setError(undefined);
      const next = new URLSearchParams(params);
      next.delete("create");
      setParams(next, { replace: true });
    }
  }, [params, setParams, type]);
  const query = useQuery({
    queryKey: [user.id, type],
    queryFn: () =>
      api("/" + type + (type === "accounts" ? "?include_archived=true" : "")),
  });
  const hasPending = (item: any) =>
    pending.some(
      (p) =>
        p.payload.account_id === item.id || p.payload.to_account_id === item.id,
    );
  const singular =
    type === "categories"
      ? "category"
      : type === "accounts"
        ? "account"
        : "subscription";
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const f = new FormData(e.currentTarget);
    let body: any = { name: f.get("name") };
    if (type === "accounts")
      body = {
        ...body,
        kind: f.get("kind"),
        opening_balance: f.get("opening_balance"),
      };
    else if (type === "categories")
      body = {
        ...body,
        kind: f.get("kind"),
        limit_amount: f.get("limit_amount") || null,
        max_count: f.get("max_count") ? Number(f.get("max_count")) : null,
        parent_id: f.get("parent_id") || null,
        position: Number(f.get("position") || 0),
        color: f.get("color"),
        icon: edit.icon || "bag",
      };
    else
      body = {
        ...body,
        amount: f.get("amount"),
        cycle: f.get("cycle"),
        next_date: f.get("next_date"),
      };
    try {
      await api(
        "/" + type + (edit.id ? "/" + edit.id : ""),
        edit.id ? "PATCH" : "POST",
        body,
      );
      await query.refetch();
      await reload();
      setEdit(undefined);
      notify("Saved.");
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function archive(item: any) {
    if (busy) return;
    if (type === "accounts" && hasPending(item)) {
      setError(
        new Error("Sync or discard this account's pending entries first."),
      );
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await api(
        "/" + type + "/" + item.id,
        type === "subscriptions" ? "PATCH" : "DELETE",
        type === "subscriptions" ? { active: false } : undefined,
      );
      await query.refetch();
      await reload();
      notify(
        type === "subscriptions"
          ? "Subscription stopped."
          : "Archived. History is preserved.",
      );
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function restore(item: any) {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await api("/accounts/" + item.id, "PATCH", { archived: false });
      await query.refetch();
      await reload();
      notify("Account restored.");
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }
  async function removeAccount() {
    if (busy || !deleting) return;
    if (hasPending(deleting)) {
      setError(
        new Error("Sync or discard this account's pending entries first."),
      );
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await api("/accounts/" + deleting.id + "/permanent", "DELETE");
      await query.refetch();
      await reload();
      setDeleting(null);
      notify("Account deleted.");
    } catch (error) {
      setError(error);
      await query.refetch();
    } finally {
      setBusy(false);
    }
  }
  function renderAccount(item: any) {
    return (
      <AccountCard
        key={item.id}
        account={item}
        currency={user.currency}
        busy={busy || !online}
        pending={hasPending(item)}
        onEdit={() => {
          setEdit(item);
          setError(undefined);
        }}
        onAction={(action) => {
          setError(undefined);
          if (action === "delete") setDeleting(item);
          else if (action === "restore") void restore(item);
          else void archive(item);
        }}
      />
    );
  }
  return (
    <>
      <PageTitle
        title={
          type === "accounts"
            ? "Money spots."
            : type === "categories"
              ? "Your categories."
              : "The recurring cast."
        }
        sub={
          type === "subscriptions"
            ? "Are you still using what you pay for?"
            : type === "accounts"
              ? "Archive accounts you no longer use. Delete unused ones."
              : "Create your own labels for spending. Categories and limits are optional."
        }
        back={() => nav("/settings")}
        action={
          <button
            className="icon-button outlined"
            aria-label={"Add " + singular}
            onClick={() => {
              setEdit({});
              setError(undefined);
            }}
          >
            <Plus />
          </button>
        }
      />
      <ErrorText error={error || query.error} />
      {type === "categories" && (
        <p className="muted">
          Monthly limits renew on the 1st. Unused amounts don’t carry over.
          Subcategory amounts are included in their parent’s amount limit.
        </p>
      )}
      {type === "subscriptions" && !user.preferences?.subscriptions && (
        <p className="notice">
          Subscription reminders are off. Enable them in Settings when you want
          them.
        </p>
      )}
      {query.data
        ?.filter((i: any) => !i.archived && i.active !== false)
        .map((item: any) =>
          type === "accounts" ? (
            renderAccount(item)
          ) : (
            <Card key={item.id}>
              <div className="between">
                <h3>
                  {item.parent_id ? "↳ " : ""}
                  {item.name}
                </h3>
                <b>
                  {type === "categories"
                    ? item.max_count
                      ? item.max_count + "/month"
                      : item.limit_amount
                        ? formatMoney(item.limit_amount, user.currency) +
                          "/month"
                        : "No limit"
                    : formatMoney(item.amount, user.currency)}
                </b>
              </div>
              {type === "subscriptions" && (
                <>
                  <p>
                    {item.cycle} · Next: {item.next_date}
                  </p>
                  {item.unused_months >= 2 && (
                    <p className="over-text">
                      Unused {item.unused_months} months in a row. Still worth
                      it?
                    </p>
                  )}
                  <label>Used it this month?</label>
                  <div className="chips">
                    {[true, false].map((used) => (
                      <button
                        className="chip"
                        key={String(used)}
                        disabled={
                          item.last_checked_month ===
                          new Date().toISOString().slice(0, 7)
                        }
                        onClick={async () => {
                          try {
                            await api(
                              "/subscriptions/" + item.id + "/check",
                              "POST",
                              { used },
                            );
                            await query.refetch();
                          } catch (e) {
                            setError(e);
                          }
                        }}
                      >
                        {used ? "Yes" : "No"}
                      </button>
                    ))}
                  </div>
                </>
              )}
              <div className="chips">
                <button
                  className="chip"
                  onClick={() => {
                    setEdit(item);
                    setError(undefined);
                  }}
                >
                  Edit
                </button>
                <button className="chip" onClick={() => archive(item)}>
                  {type === "subscriptions" ? "Stop tracking" : "Archive"}
                </button>
              </div>
            </Card>
          ),
        )}
      {!query.isLoading &&
        !query.data?.some((i: any) => !i.archived && i.active !== false) &&
        (type === "accounts" && query.data?.length ? (
          <Empty title="No active accounts.">
            Restore an archived account below, or add a new one.
          </Empty>
        ) : (
          <Empty title={"Your first " + singular + " starts here."} />
        ))}
      {type === "accounts" && query.data?.some((a: any) => a.archived) && (
        <details className="archived-accounts">
          <summary>
            Archived accounts (
            {query.data.filter((a: any) => a.archived).length})
          </summary>
          <p className="muted">
            Hidden from new entries. Their balances and history are kept.
          </p>
          {query.data.filter((a: any) => a.archived).map(renderAccount)}
        </details>
      )}
      {deleting && (
        <Sheet
          title="Delete this account?"
          close={() => {
            if (!busy) setDeleting(null);
          }}
        >
          <h3>{deleting.name}</h3>
          <p className="muted">{accountTypeName(deleting.kind)}</p>
          <p>
            This permanently removes this account and its opening balance of{" "}
            {formatMoney(deleting.opening_balance, user.currency)}. This cannot
            be undone.
          </p>
          <ErrorText error={error} />
          <button
            className="button danger full"
            onClick={removeAccount}
            disabled={busy || !online}
          >
            {busy ? "Deleting…" : "Delete account"}
          </button>
          <button
            className="button full"
            disabled={busy}
            onClick={() => setDeleting(null)}
          >
            Keep account
          </button>
        </Sheet>
      )}
      {edit && (
        <Sheet
          title={(edit.id ? "Edit " : "New ") + singular}
          close={() => setEdit(undefined)}
        >
          <form onSubmit={save}>
            <label>
              Name
              <input
                name="name"
                defaultValue={edit.name}
                required
                maxLength={80}
              />
            </label>
            {type === "accounts" ? (
              <>
                <label>
                  Type
                  <select name="kind" defaultValue={edit.kind || "chequing"}>
                    {[
                      "chequing",
                      "savings",
                      "credit_card",
                      "cash",
                      "other",
                    ].map((k) => (
                      <option key={k} value={k}>
                        {k.replace("_", " ")}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Opening balance
                  <input
                    name="opening_balance"
                    inputMode="decimal"
                    defaultValue={edit.opening_balance || "0.00"}
                    required
                  />
                </label>
                <p className="muted">
                  Use a negative opening balance for money owed on a credit
                  card.
                </p>
              </>
            ) : type === "categories" ? (
              <>
                <label>
                  Budget type
                  <select name="kind" defaultValue={edit.kind || "flexible"}>
                    <option value="flexible">Flexible</option>
                    <option value="fixed">Fixed bill</option>
                  </select>
                </label>
                <label>
                  Parent category
                  <select name="parent_id" defaultValue={edit.parent_id || ""}>
                    <option value="">None · top-level</option>
                    {home?.categories
                      .filter((c: any) => !c.parent_id && c.id !== edit.id)
                      .map((c: any) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                </label>
                <div className="two-col">
                  <label>
                    Monthly amount limit
                    <input
                      name="limit_amount"
                      inputMode="decimal"
                      defaultValue={edit.limit_amount || ""}
                    />
                  </label>
                  <label>
                    Or monthly count limit
                    <input
                      name="max_count"
                      type="number"
                      min={1}
                      defaultValue={edit.max_count || ""}
                    />
                  </label>
                </div>
                <label>
                  Display order
                  <input
                    name="position"
                    type="number"
                    defaultValue={edit.position || 0}
                  />
                </label>
                <label>
                  Colour
                  <select name="color" defaultValue={edit.color || "sky-soft"}>
                    {[
                      "sky-soft",
                      "mango-soft",
                      "bubblegum-soft",
                      "mint-soft",
                      "tomato-soft",
                    ].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
              </>
            ) : (
              <>
                <label>
                  Amount
                  <input
                    name="amount"
                    inputMode="decimal"
                    defaultValue={edit.amount}
                    required
                  />
                </label>
                <label>
                  Cycle
                  <select name="cycle" defaultValue={edit.cycle || "monthly"}>
                    {["weekly", "monthly", "yearly"].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Next date
                  <input
                    name="next_date"
                    type="date"
                    defaultValue={edit.next_date}
                    required
                  />
                </label>
              </>
            )}
            <ErrorText error={error} />
            <button className="button primary full" disabled={busy}>
              Save {singular}
            </button>
          </form>
        </Sheet>
      )}
    </>
  );
}

export function QuizPage() {
  const { setUser, notify } = useApp();
  const nav = useNavigate();
  const [answers, setAnswers] = useState<boolean[]>([]);
  const [result, setResult] = useState<any>();
  const [error, setError] = useState<unknown>();
  const ref = useRef<HTMLDivElement>(null);
  async function answer(value: boolean) {
    const next = [...answers, value];
    setAnswers(next);
    if (next.length === 6) {
      try {
        setResult(await api("/quiz/score", "POST", { answers: next }));
        setUser(await api("/me"));
        notify("Personality updated.");
      } catch (e) {
        setError(e);
      }
    }
  }
  return (
    <>
      <PageTitle
        title="Still you?"
        sub="Six cards. A little self-awareness."
        back={() => nav("/settings")}
      />
      <ErrorText error={error} />
      {result ? (
        <>
          <div className="personality-preview">
            <div className="personality story" ref={ref}>
              <div className="story-brand">
                <Coin />
                <b>chindi</b>
              </div>
              <p>Your spending personality</p>
              <Coin size={120} />
              <h1>{result.personality}</h1>
              <p>{result.line}</p>
              <small>Keep more. Regret less.</small>
            </div>
          </div>
          <button
            className="button primary full"
            onClick={async () => {
              try {
                if (!ref.current) return;
                const url = await toPng(ref.current, {
                  width: 360,
                  height: 640,
                  pixelRatio: 3,
                });
                const a = document.createElement("a");
                a.download = "chindi-personality.png";
                a.href = url;
                a.click();
              } catch (e) {
                setError(e);
              }
            }}
          >
            Save personality card
          </button>
        </>
      ) : answers.length < 6 ? (
        <Card className="quiz-card">
          <p>{answers.length + 1} / 6</p>
          <Coin size={80} />
          <h2>{QUIZ[answers.length]}</h2>
          <div className="two-col">
            <button className="button" onClick={() => answer(false)}>
              ← Never
            </button>
            <button className="button primary" onClick={() => answer(true)}>
              That's me →
            </button>
          </div>
        </Card>
      ) : (
        <p>Scoring your side-eye…</p>
      )}
    </>
  );
}
