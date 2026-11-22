import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, download } from "./lib/api";
import { createPasskey, passkeysSupported } from "./lib/passkeys";
import { useApp } from "./context";
import { Card, ErrorText, Sheet } from "./components";

export function PasskeyHelp() {
  if (passkeysSupported()) return null;
  return (
    <p className="muted">
      Passkeys need a supported browser and a secure domain.
      {window.location.hostname === "127.0.0.1" && (
        <>
          {" "}
          <a
            className="subtle-link"
            href={
              window.location.protocol +
              "//localhost:" +
              window.location.port +
              window.location.pathname
            }
          >
            Open localhost to use passkeys on this computer.
          </a>
        </>
      )}
    </p>
  );
}

export default function AccountSecurity() {
  const { user, notify } = useApp();
  const query = useQuery({
    queryKey: [user.id, "security"],
    queryFn: () => api("/auth/security"),
  });
  const [action, setAction] = useState<
    "passkey" | "recovery" | "remove" | null
  >(null);
  const [removing, setRemoving] = useState<any>();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const close = () => {
    if (!busy) {
      setAction(null);
      setCode("");
      setError(undefined);
    }
  };
  function open(next: "passkey" | "recovery" | "remove") {
    setAction(next);
    setError(undefined);
    setCode("");
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(undefined);
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password"));
    try {
      if (action === "passkey") {
        await createPasskey(password, String(form.get("name")));
        setAction(null);
        notify("Passkey saved. You can now sign in with your device.");
      } else if (action === "remove") {
        await api("/auth/passkeys/" + removing.id, "DELETE", { password });
        setAction(null);
        notify("Passkey removed.");
      } else {
        const result = await api("/auth/recovery-code", "POST", { password });
        setCode(result.code);
      }
      await query.refetch();
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <h2>Sign-in & security</h2>
      <p>
        You stay signed in on this device. Use a passkey when you need to sign
        in again, with Face ID, fingerprint or your device PIN.
      </p>
      <ErrorText error={query.error} />
      {query.data?.passkeys.map((key: any) => (
        <div className="between security-key" key={key.id}>
          <div>
            <b>{key.name}</b>
            <p className="muted">
              {key.last_used_at
                ? "Last used " + new Date(key.last_used_at).toLocaleDateString()
                : "Ready for your next sign-in"}
            </p>
          </div>
          <button
            className="text-button"
            aria-label={"Remove " + key.name}
            onClick={() => {
              setRemoving(key);
              open("remove");
            }}
          >
            Remove
          </button>
        </div>
      ))}
      <button
        className="button full"
        disabled={!passkeysSupported()}
        onClick={() => open("passkey")}
      >
        Add a passkey
      </button>
      <PasskeyHelp />
      <h3>Account recovery</h3>
      <p className="muted">
        {query.data?.has_recovery_code
          ? "You have a recovery code saved. Replacing it makes the old code stop working."
          : "Save a recovery code in your password manager so you can reset your password if you lose access. We show it only once."}
      </p>
      <button className="button full" onClick={() => open("recovery")}>
        {query.data?.has_recovery_code
          ? "Replace recovery code"
          : "Generate recovery code"}
      </button>
      {action && (
        <Sheet
          title={
            code
              ? "Save your recovery code"
              : action === "passkey"
                ? "Add a passkey"
                : action === "remove"
                  ? "Remove this passkey?"
                  : "Generate a recovery code"
          }
          close={close}
        >
          {code ? (
            <>
              <p>
                Keep this in your password manager or another private place.
                Anyone with this code can reset your password.
              </p>
              <label>
                Recovery code
                <textarea
                  aria-label="Recovery code"
                  className="recovery-code"
                  readOnly
                  value={code}
                  onFocus={(e) => e.target.select()}
                />
              </label>
              <button
                className="button primary full"
                onClick={() =>
                  download(
                    new Blob(
                      [
                        "Chindi recovery code for " +
                          user.email +
                          "\n\n" +
                          code +
                          "\n\nKeep this private. It can be used once to reset your password.\n",
                      ],
                      { type: "text/plain" },
                    ),
                    "chindi-recovery-code.txt",
                  )
                }
              >
                Download recovery code
              </button>
              <button className="button full" onClick={close}>
                I've saved it
              </button>
            </>
          ) : (
            <form onSubmit={submit}>
              <p>
                {action === "passkey"
                  ? "Confirm your password once to save a passkey. Your device will ask for Face ID, fingerprint or its PIN."
                  : action === "remove"
                    ? "You can still sign in with your password and any other saved passkeys."
                    : "Confirm your password to generate a new code. Any previous recovery code will stop working."}
              </p>
              {action === "passkey" && (
                <label>
                  Passkey name
                  <input
                    name="name"
                    required
                    maxLength={80}
                    defaultValue="My phone"
                    autoComplete="off"
                  />
                </label>
              )}
              <label>
                Current password
                <input
                  type="password"
                  name="password"
                  autoComplete="current-password"
                  minLength={10}
                  maxLength={128}
                  required
                />
              </label>
              <ErrorText error={error} />
              <button className="button primary full" disabled={busy}>
                {busy
                  ? "Please wait…"
                  : action === "passkey"
                    ? "Save passkey"
                    : action === "remove"
                      ? "Remove passkey"
                      : "Generate code"}
              </button>
            </form>
          )}
        </Sheet>
      )}
    </Card>
  );
}
