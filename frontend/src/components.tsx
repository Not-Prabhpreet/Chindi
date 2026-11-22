import { useEffect, useRef, type ReactNode } from "react";
import {
  ArrowLeft,
  X,
  ShoppingCart,
  Utensils,
  ShoppingBag,
  Ticket,
  Bus,
  Home,
  ChevronRight,
  Coffee,
} from "lucide-react";

export function Coin({
  mood = "smug",
  size = 48,
}: {
  mood?: string;
  size?: number;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <circle
        cx="50"
        cy="50"
        r="44"
        fill="var(--mango)"
        stroke="var(--ink)"
        strokeWidth="6"
      />
      {mood === "happy" ? (
        <path
          d="M24 43q8-12 16 0m20 0q8-12 16 0"
          fill="none"
          stroke="var(--ink)"
          strokeWidth="6"
          strokeLinecap="round"
        />
      ) : (
        <>
          <path
            d={
              mood === "judging" ? "M23 35l19 6m16 0l19-6" : "M23 38h19m16 0h19"
            }
            stroke="var(--ink)"
            strokeWidth="6"
            strokeLinecap="round"
          />
          <circle
            cx="36"
            cy="48"
            r={mood === "shocked" ? 7 : 5}
            fill="var(--ink)"
          />
          <circle
            cx="70"
            cy="48"
            r={mood === "shocked" ? 7 : 5}
            fill="var(--ink)"
          />
        </>
      )}
      {mood === "shocked" ? (
        <circle cx="50" cy="71" r="8" fill="var(--ink)" />
      ) : (
        <path
          d={mood === "judging" ? "M39 70h22" : "M36 69q16 8 29-4"}
          fill="none"
          stroke="var(--ink)"
          strokeWidth="6"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}
export function CategoryIcon({ name }: { name: string }) {
  const Icon =
    (
      {
        cart: ShoppingCart,
        food: Utensils,
        bag: ShoppingBag,
        ticket: Ticket,
        bus: Bus,
        home: Home,
        coffee: Coffee,
      } as any
    )[name] || ShoppingBag;
  return <Icon size={20} />;
}
export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <section className={"card " + className}>{children}</section>;
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <Card className="empty">
      <Coin size={64} />
      <h2>{title}</h2>
      {children && <p>{children}</p>}
    </Card>
  );
}
export function Progress({
  percent,
  state = "normal",
}: {
  percent: string | number;
  state?: string;
}) {
  return (
    <div
      className={"track " + state}
      role="progressbar"
      aria-valuenow={Math.round(Number(percent))}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        style={{ width: Math.min(100, Math.max(0, Number(percent))) + "%" }}
      />
    </div>
  );
}
export function PageTitle({
  title,
  sub,
  back,
  action,
}: {
  title: string;
  sub?: string;
  back?: () => void;
  action?: ReactNode;
}) {
  return (
    <header className="page-title">
      {back && (
        <button className="icon-button" onClick={back} aria-label="Back">
          <ArrowLeft />
        </button>
      )}
      <div className="between">
        <h1>{title}</h1>
        {action}
      </div>
      {sub && <p>{sub}</p>}
    </header>
  );
}
export function Sheet({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onClose = useRef(close);
  onClose.current = close;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose.current();
      if (e.key === "Tab") {
        const items = ref.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input,select,textarea,a[href],[tabindex="0"]',
        );
        if (!items?.length) return;
        const first = items[0],
          last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.body.style.overflow = old;
      document.removeEventListener("keydown", handler);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={ref}
        tabIndex={-1}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="handle" />
        <div className="sheet-heading">
          <button className="icon-button" onClick={close} aria-label="Close">
            <X />
          </button>
          <h2>{title}</h2>
          <span className="spacer" />
        </div>
        {children}
      </div>
    </div>
  );
}
export function NextRow({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button className="next-row" onClick={onClick}>
      {children}
      <ChevronRight size={20} />
    </button>
  );
}
export function ErrorText({ error }: { error: unknown }) {
  return error ? (
    <p className="error" role="alert">
      {error instanceof Error ? error.message : String(error)}
    </p>
  ) : null;
}
