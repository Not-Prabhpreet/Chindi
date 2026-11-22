import { get, set, del, createStore } from "idb-keyval";

const store = createStore("chindi", "private-data");
let token = "";
let refreshing: Promise<boolean> | null = null;
export const API = "/api/v1";
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function refresh(): Promise<boolean> {
  if (!refreshing)
    refreshing = fetch(API + "/auth/refresh", {
      method: "POST",
      credentials: "include",
    })
      .then(async (r) => {
        if (!r.ok) {
          token = "";
          return false;
        }
        token = (await r.json()).access_token;
        return true;
      })
      .catch(() => false)
      .finally(() => {
        refreshing = null;
      });
  return refreshing;
}

export async function api<T = any>(
  path: string,
  method = "GET",
  body?: unknown,
  retry = true,
): Promise<T> {
  const response = await fetch(API + path, {
    method,
    credentials: "include",
    headers: {
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 401 && retry && !path.startsWith("/auth/")) {
    if (await refresh()) return api(path, method, body, false);
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new ApiError(
      data.error?.message || "Something went wrong. Please try again.",
      response.status,
    );
  }
  return response.json();
}

export async function authenticate(mode: string, body: unknown) {
  const result = await api("/auth/" + mode, "POST", body);
  return finishAuthentication(result);
}

export async function finishAuthentication(result: { access_token: string }) {
  token = result.access_token;
  return api("/me");
}

export async function logout() {
  await api("/auth/logout", "POST");
  token = "";
}
export function clearToken() {
  token = "";
}

export async function cache(owner: string, key: string, value: any) {
  await set(owner + ":" + key, value, store);
}
export async function cached(owner: string, key: string) {
  return get(owner + ":" + key, store);
}
export async function clearCache(owner: string) {
  const { keys } = await import("idb-keyval");
  for (const key of await keys(store))
    if (
      typeof key === "string" &&
      key.startsWith(owner + ":") &&
      key !== owner + ":queue"
    )
      await del(key, store);
}
export type Pending = { payload: any; error?: string };
export async function queue(owner: string): Promise<Pending[]> {
  return (await cached(owner, "queue")) || [];
}
// Serialize queue writes and syncs to avoid losing an entry while a request is in flight.
let queueLock: Promise<unknown> = Promise.resolve();
function locked<T>(operation: () => Promise<T>): Promise<T> {
  const result = queueLock.then(operation, operation);
  queueLock = result.catch(() => {});
  return result;
}
export function enqueue(owner: string, payload: any) {
  return locked(async () => {
    const pending = (await queue(owner)).filter(
      (p) => p.payload.client_id !== payload.client_id,
    );
    pending.push({ payload });
    await cache(owner, "queue", pending);
  });
}
export function removePending(owner: string, id: string) {
  return locked(async () => {
    await cache(
      owner,
      "queue",
      (await queue(owner)).filter((p) => p.payload.client_id !== id),
    );
  });
}
export function syncQueue(owner: string) {
  return locked(async () => {
    const pending = await queue(owner);
    let synced = 0;
    for (const entry of [...pending]) {
      try {
        await api("/transactions", "POST", entry.payload);
        pending.splice(pending.indexOf(entry), 1);
        synced++;
      } catch (error) {
        if (
          error instanceof ApiError &&
          error.status !== 401 &&
          error.status < 500
        )
          entry.error = error.message;
        else break;
      }
    }
    await cache(owner, "queue", pending);
    return { synced, pending };
  });
}

export async function downloadExport(format: string) {
  if (!token) await refresh();
  let response = await fetch(API + "/export?format=" + format, {
    headers: { Authorization: "Bearer " + token },
  });
  if (response.status === 401 && (await refresh()))
    response = await fetch(API + "/export?format=" + format, {
      headers: { Authorization: "Bearer " + token },
    });
  if (!response.ok) throw new Error("Could not export your data.");
  download(await response.blob(), "chindi-export." + format);
}
export function download(blob: Blob, name: string) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
export async function importFile(file: File) {
  if (!token) await refresh();
  const response = await fetch(API + "/import", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": file.name.endsWith(".csv")
        ? "text/csv"
        : "application/json",
    },
    body: await file.text(),
  });
  if (!response.ok)
    throw new Error((await response.json()).error?.message || "Import failed.");
  return response.json();
}
