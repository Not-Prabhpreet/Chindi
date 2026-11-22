import { useCallback, useEffect, useState } from "react";
import {
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Home,
  ChartNoAxesColumn,
  Hourglass,
  Amphora,
  List,
  Plus,
  WifiOff,
  RefreshCw,
  X,
} from "lucide-react";
import { AppContext } from "./context";
import {
  api,
  cache,
  cached,
  refresh,
  queue,
  syncQueue,
  removePending,
  clearToken,
} from "./lib/api";
import { cents, formatMoney } from "./lib/money";
import { localDate, optimisticHome } from "./lib/budgetProjection";
import { Card, ErrorText, Sheet } from "./components";
import QuickAdd from "./QuickAdd";
import {
  HomePage,
  HistoryPage,
  WishlistPage,
  AboutToBuyPage,
} from "./pages/BudgetPages";
import {
  GoalsPage,
  RulesPage,
  InsightsPage,
  ReviewPage,
  WrappedPage,
} from "./pages/HabitPages";
import {
  AuthPage,
  Onboarding,
  InstallPage,
  SettingsPage,
  ManagePage,
  QuizPage,
} from "./pages/SetupPages";

export default function App() {
  const [user, setUserState] = useState<any>(null);
  const [booting, setBooting] = useState(true);
  const [online, setOnline] = useState(navigator.onLine);
  const client = useQueryClient();
  const [toast, setToast] = useState("");
  const [draft, setDraft] = useState<any>();
  const [pending, setPending] = useState<any[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<unknown>();
  const [payday, setPayday] = useState<any>();
  const [, setCalendarDay] = useState("");
  const nav = useNavigate();
  const location = useLocation();
  const notify = useCallback((text: string) => setToast(text), []);
  const setUser = useCallback(
    (value: any) => {
      setUserState(value);
      if (value) localStorage.setItem("chindi:session", JSON.stringify(value));
      else {
        clearToken();
        localStorage.removeItem("chindi:session");
        client.clear();
      }
    },
    [client],
  );
  useEffect(() => {
    let active = true;
    (async () => {
      let profile = null;
      try {
        if (navigator.onLine && (await refresh())) profile = await api("/me");
        else if (!navigator.onLine)
          profile = JSON.parse(
            localStorage.getItem("chindi:session") || "null",
          );
      } catch {
        if (!navigator.onLine)
          profile = JSON.parse(
            localStorage.getItem("chindi:session") || "null",
          );
      }
      if (active) {
        setUser(profile);
        setBooting(false);
      }
    })();
    const change = () => setOnline(navigator.onLine);
    window.addEventListener("online", change);
    window.addEventListener("offline", change);
    return () => {
      active = false;
      window.removeEventListener("online", change);
      window.removeEventListener("offline", change);
    };
  }, [setUser]);
  const homeQuery = useQuery({
    queryKey: [user?.id, "home"],
    queryFn: async () => {
      const data = await api("/home");
      await cache(user.id, "home", data);
      return data;
    },
    enabled: !!user && online,
    retry: 1,
  });
  useEffect(() => {
    if (!user) return;
    let day = localDate(user.timezone);
    const checkDate = () => {
      const next = localDate(user.timezone);
      if (next === day) return;
      day = next;
      setCalendarDay(next);
      if (navigator.onLine)
        void client.invalidateQueries({ queryKey: [user.id] });
    };
    const timer = window.setInterval(checkDate, 30_000);
    window.addEventListener("focus", checkDate);
    document.addEventListener("visibilitychange", checkDate);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", checkDate);
      document.removeEventListener("visibilitychange", checkDate);
    };
  }, [user?.id, user?.timezone, client]);
  useEffect(() => {
    if (user) {
      cached(user.id, "home").then((value) => {
        if (value && !client.getQueryData([user.id, "home"]))
          client.setQueryData([user.id, "home"], value);
      });
      queue(user.id).then(setPending);
    } else setPending([]);
  }, [user?.id, client]);
  const reload = useCallback(async () => {
    if (user && navigator.onLine) {
      await client.invalidateQueries({ queryKey: [user.id] });
    }
    if (user) setPending(await queue(user.id));
  }, [user, client]);
  const sync = useCallback(async () => {
    if (!user || !navigator.onLine) return;
    setSyncing(true);
    setSyncError(undefined);
    try {
      const result = await syncQueue(user.id);
      setPending(result.pending);
      if (result.synced) {
        await client.invalidateQueries({ queryKey: [user.id] });
        notify(
          result.synced === 1
            ? "Expense synced."
            : result.synced + " entries synced.",
        );
      }
    } catch (e) {
      setSyncError(e);
    } finally {
      setSyncing(false);
    }
  }, [user, client, notify]);
  useEffect(() => {
    if (user && online) void sync();
  }, [user?.id, online]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const handler = (e: Event) => setPayday((e as CustomEvent).detail);
    window.addEventListener("chindi-payday", handler);
    return () => window.removeEventListener("chindi-payday", handler);
  }, []);
  useEffect(() => {
    if (
      user &&
      new URLSearchParams(location.search).get("add") === "1" &&
      homeQuery.data
    ) {
      setDraft({});
      nav(location.pathname, { replace: true });
    }
  }, [user, homeQuery.data, location.search]);
  const closeAdd = useCallback(() => setDraft(undefined), []);
  const openAdd = useCallback((value: any = {}) => setDraft(value), []);
  const projection = homeQuery.data
    ? optimisticHome(homeQuery.data, pending, user)
    : null;
  if (booting)
    return (
      <div className="boot">
        <img src="/icons/icon.svg" width={80} height={80} alt="Chindi" />
        <p>Getting your wallet in order…</p>
      </div>
    );
  if (!user || location.pathname === "/reset-password")
    return <AuthPage onUser={setUser} />;
  const hideFab = !["/", "/insights", "/goals"].includes(location.pathname);
  return (
    <AppContext.Provider
      value={{
        user,
        home: projection,
        reload,
        notify,
        openAdd,
        setUser,
        online,
        pending,
        sync,
      }}
    >
      <div className="app-shell">
        <main className="main-content">
          {!online && (
            <div className="status-bar" role="status">
              <WifiOff size={16} /> You're offline. New expenses stay on this
              device.
            </div>
          )}
          {pending.length > 0 && (
            <details className="pending">
              <summary>
                {pending.length} {pending.length === 1 ? "entry" : "entries"}{" "}
                waiting to sync{" "}
                {pending.some((p) => p.error) ? "· needs attention" : ""}
              </summary>
              {pending.map((p) => (
                <div key={p.payload.client_id}>
                  <p>
                    {p.payload.merchant || p.payload.kind} ·{" "}
                    {formatMoney(p.payload.amount, user.currency)}
                  </p>
                  {p.error && <p className="error">{p.error}</p>}
                  <div className="chips">
                    <button className="chip" onClick={() => openAdd(p.payload)}>
                      Edit
                    </button>
                    <button
                      className="chip"
                      onClick={async () => {
                        await removePending(user.id, p.payload.client_id);
                        setPending(await queue(user.id));
                      }}
                    >
                      Discard
                    </button>
                  </div>
                </div>
              ))}
              <button
                className="button compact"
                onClick={sync}
                disabled={!online || syncing}
              >
                <RefreshCw size={16} />
                {syncing ? "Syncing…" : "Sync now"}
              </button>
            </details>
          )}
          <ErrorText error={syncError || homeQuery.error} />
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/wishlist" element={<WishlistPage />} />
            <Route path="/about-to-buy" element={<AboutToBuyPage />} />
            <Route path="/goals" element={<GoalsPage />} />
            <Route path="/rules" element={<RulesPage />} />
            <Route path="/insights" element={<InsightsPage />} />
            <Route path="/review" element={<ReviewPage />} />
            <Route path="/wrapped/:month" element={<WrappedPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route
              path="/accounts"
              element={<ManagePage key="accounts" type="accounts" />}
            />
            <Route
              path="/categories"
              element={<ManagePage key="categories" type="categories" />}
            />
            <Route
              path="/subscriptions"
              element={<ManagePage key="subscriptions" type="subscriptions" />}
            />
            <Route path="/quiz" element={<QuizPage />} />
            <Route
              path="/welcome"
              element={<Onboarding existing={user} onUser={setUser} />}
            />
            <Route path="/install" element={<InstallPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
        {!hideFab && (
          <button
            className="fab"
            aria-label="Add expense"
            onClick={() => openAdd()}
          >
            <Plus size={32} />
          </button>
        )}
        <nav className="tab-bar" aria-label="Main navigation">
          {[
            ["/", "Home", Home],
            ["/insights", "Insights", ChartNoAxesColumn],
            ["/wishlist", "Wishlist", Hourglass],
            ["/goals", "Goals", Amphora],
            ["/rules", "Rules", List],
          ].map(([path, label, Icon]: any) => (
            <NavLink key={path} to={path} end>
              <span className="tab-icon">
                <Icon size={23} />
              </span>
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
      </div>
      {draft !== undefined && <QuickAdd draft={draft} close={closeAdd} />}
      {payday && (
        <Payday
          value={payday}
          home={projection}
          close={() => setPayday(undefined)}
          reload={reload}
          notify={notify}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </AppContext.Provider>
  );
}

function Payday({
  value,
  home,
  close,
  reload,
  notify,
}: {
  value: any;
  home: any;
  close: () => void;
  reload: () => Promise<void>;
  notify: (s: string) => void;
}) {
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  const [completed, setCompleted] = useState<string[]>([]);
  async function submit() {
    if (busy) return;
    setBusy(true);
    try {
      const entries = Object.entries(allocations).filter(
        ([, amount]) => Number(amount) > 0,
      );
      const total = entries.reduce(
        (sum, [, amount]) => sum + cents(amount),
        0n,
      );
      if (total > cents(value.amount))
        throw new Error("Your split is greater than this income.");
      for (const [id, amount] of entries) {
        if (completed.includes(id)) continue;
        await api("/goals/" + id + "/deposit", "POST", {
          amount,
          source: "payday",
          from_account_id: value.account_id,
        });
        setCompleted((old) => [...old, id]);
      }
      await reload();
      notify("Payday, with a plan.");
      close();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  const available =
    home?.goals.filter(
      (g: any) =>
        g.account_id &&
        g.account_id !== value.account_id &&
        home.accounts.some((a: any) => a.id === g.account_id),
    ) || [];
  return (
    <Sheet title="Payday! Where's it going?" close={close}>
      <p>Give it a job before you spend it.</p>
      {available.length ? (
        available.map((g: any) => (
          <label key={g.id}>
            {g.name}
            <input
              inputMode="decimal"
              placeholder={g.monthly_suggestion || "0.00"}
              value={allocations[g.id] || ""}
              disabled={completed.includes(g.id)}
              onChange={(e) =>
                setAllocations({ ...allocations, [g.id]: e.target.value })
              }
            />
          </label>
        ))
      ) : (
        <Card>
          <p>
            Link a jar or sinking fund to a savings account in Goals to split
            payday with transfers.
          </p>
        </Card>
      )}
      <ErrorText error={error} />
      {available.length > 0 && (
        <button
          className="button primary full"
          onClick={submit}
          disabled={busy}
        >
          Confirm transfers
        </button>
      )}
      <button className="text-button full" onClick={close}>
        Skip for now
      </button>
    </Sheet>
  );
}
