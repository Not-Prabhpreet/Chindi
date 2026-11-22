import { useState } from "react";
import { api } from "./lib/api";
import { Card, ErrorText, PageTitle } from "./components";

export default function RecoverAccount({
  emailAvailable,
  token,
  back,
  onReset,
}: {
  emailAvailable: boolean;
  token: string | null;
  back: () => void;
  onReset: () => void;
}) {
  const [method, setMethod] = useState(emailAvailable ? "email" : "code");
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(undefined);
    setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      if (!token && method === "email") {
        setMessage(
          (
            await api("/auth/password/forgot", "POST", {
              email: form.get("email"),
            })
          ).message,
        );
      } else {
        if (form.get("password") !== form.get("confirm_password"))
          throw new Error("Your passwords don't match.");
        const result = await api("/auth/password/reset", "POST", {
          email: form.get("email") || "",
          secret: token || form.get("code"),
          method: token ? "email" : "code",
          password: form.get("password"),
          confirm_password: form.get("confirm_password"),
        });
        onReset();
        setMessage(result.message);
        setDone(true);
      }
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth">
      <PageTitle
        title="Reset your password."
        sub="Let's get you back to your money."
      />
      <Card>
        {done ? (
          <p role="status">{message}</p>
        ) : (
          <>
            {!token && (
              <>
                <p>
                  {emailAvailable
                    ? "Use an email reset link or a recovery code you saved earlier."
                    : "Email recovery isn't set up on this installation. Use a recovery code you saved earlier, or go back and sign in with a passkey."}
                </p>
                {emailAvailable && (
                  <div className="segmented">
                    <button
                      className={method === "email" ? "on" : ""}
                      onClick={() => {
                        setMethod("email");
                        setError(undefined);
                        setMessage("");
                      }}
                    >
                      Email reset link
                    </button>
                    <button
                      className={method === "code" ? "on" : ""}
                      onClick={() => {
                        setMethod("code");
                        setError(undefined);
                        setMessage("");
                      }}
                    >
                      Recovery code
                    </button>
                  </div>
                )}
              </>
            )}
            <form onSubmit={submit}>
              {!token && (
                <label>
                  Email
                  <input
                    type="email"
                    name="email"
                    autoComplete="username"
                    required
                    maxLength={254}
                  />
                </label>
              )}
              {!token && method === "code" && (
                <label>
                  Recovery code
                  <input
                    name="code"
                    autoComplete="off"
                    required
                    minLength={20}
                    maxLength={200}
                    spellCheck={false}
                  />
                </label>
              )}
              {(token || method === "code") && (
                <>
                  <label>
                    New password
                    <input
                      type="password"
                      name="password"
                      autoComplete="new-password"
                      minLength={10}
                      maxLength={128}
                      required
                    />
                  </label>
                  <label>
                    Confirm new password
                    <input
                      type="password"
                      name="confirm_password"
                      autoComplete="new-password"
                      minLength={10}
                      maxLength={128}
                      required
                    />
                  </label>
                </>
              )}
              <ErrorText error={error} />
              {message && <p role="status">{message}</p>}
              <button className="button primary full" disabled={busy}>
                {busy
                  ? "Please wait…"
                  : !token && method === "email"
                    ? "Send reset link"
                    : "Reset password"}
              </button>
            </form>
            {!token && (
              <p className="muted">
                If you haven't saved a recovery code or passkey, ask the person
                hosting this installation for help.
              </p>
            )}
          </>
        )}
      </Card>
      <button className="button full" onClick={back}>
        Back to log in
      </button>
    </main>
  );
}
