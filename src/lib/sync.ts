/**
 * sync.ts — Offline-first cloud sync utility for Moka Journal
 *
 * Strategy:
 *  1. All data is saved to localStorage FIRST (instant, works offline).
 *  2. When the device is online, data is synced to the Render backend
 *     in the background — the user never waits.
 *  3. On app startup, cloud data is fetched and merged with local data
 *     so entries created on other devices appear automatically.
 *
 * The API URL is read from the VITE_RENDER_API_URL env variable.
 * If not set, cloud sync is silently disabled and the app works
 * purely from localStorage (zero changes to existing behaviour).
 */

// ─── Types (mirrored from routes/index.tsx) ───────────────────────────────────
type Mood = 1 | 2 | 3 | 4 | 5;
type Entry = { id: string; mood: Mood; note: string; createdAt: string; tags?: string[] };
type Tag = { id: string; name: string };
type TodoTask = {
  id: string;
  text: string;
  completed: boolean;
  priority: "low" | "medium" | "high";
  category?: string;
  createdAt: string;
};

export type SyncPayload = {
  entries: Entry[];
  todos: TodoTask[];
  privacy: boolean;
  tags: Tag[];
};

export type SyncStatus = "idle" | "syncing" | "synced" | "offline" | "error";

// ─── Persistent Anonymous User ID ────────────────────────────────────────────
const USER_ID_KEY = "moka_device_user_id";

export function getOrCreateUserId(): string {
  let id = localStorage.getItem(USER_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(USER_ID_KEY, id);
  }
  return id;
}

// ─── API URL ──────────────────────────────────────────────────────────────────
function getApiUrl(): string | null {
  const url = import.meta.env.VITE_RENDER_API_URL as string | undefined;
  return url?.replace(/\/+$/, "") || null;
}

// ─── Sync to Cloud (Background Push) ─────────────────────────────────────────
// Debounced: only fires after 2 seconds of inactivity to avoid hammering the
// API on rapid consecutive state changes (e.g. user typing notes quickly).
let syncTimer: ReturnType<typeof setTimeout> | null = null;
let lastSyncController: AbortController | null = null;

export function syncToCloud(
  data: SyncPayload,
  onStatus: (status: SyncStatus) => void
): void {
  const apiUrl = getApiUrl();
  if (!apiUrl) return; // Cloud sync not configured — silent no-op

  if (!navigator.onLine) {
    onStatus("offline");
    return;
  }

  // Cancel previous in-flight request if a newer sync is triggered
  if (lastSyncController) lastSyncController.abort();
  if (syncTimer) clearTimeout(syncTimer);

  syncTimer = setTimeout(async () => {
    const controller = new AbortController();
    lastSyncController = controller;

    onStatus("syncing");
    try {
      // Abort if the request takes longer than 10 seconds (Render free-tier cold start)
      const timeout = setTimeout(() => controller.abort(), 10_000);
      const res = await fetch(`${apiUrl}/api/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: getOrCreateUserId(),
          entries: data.entries,
          todos: data.todos,
          privacy: data.privacy,
          tags: data.tags,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (res.ok) {
        onStatus("synced");
      } else {
        console.warn("Cloud sync returned non-OK status:", res.status);
        onStatus("error");
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") return; // superseded
      console.warn("Background cloud sync failed (will retry on next change):", err);
      onStatus("error");
    }
  }, 2000);
}

// ─── Fetch from Cloud (Startup Pull) ─────────────────────────────────────────
export async function fetchFromCloud(): Promise<SyncPayload | null> {
  const apiUrl = getApiUrl();
  if (!apiUrl || !navigator.onLine) return null;

  try {
    // Abort if the request takes longer than 5 seconds so the app
    // doesn't appear frozen while Render cold-starts
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    const res = await fetch(`${apiUrl}/api/data/${getOrCreateUserId()}`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();
    return {
      entries: Array.isArray(data.entries) ? data.entries : [],
      todos: Array.isArray(data.todos) ? data.todos : [],
      privacy: typeof data.privacy === "boolean" ? data.privacy : false,
      tags: Array.isArray(data.tags) ? data.tags : [],
    };
  } catch (err) {
    console.warn("Cloud fetch on startup failed:", err);
    return null;
  }
}

// ─── Merge Helpers ────────────────────────────────────────────────────────────
// Merges cloud data INTO local data. Local data always wins for items that
// exist in both (since local is the latest source of truth for this device).

export function mergeEntries(local: Entry[], cloud: Entry[]): Entry[] {
  const map = new Map<string, Entry>();
  // Cloud entries go in first
  for (const e of cloud) map.set(e.id, e);
  // Local entries overwrite — local is latest truth for this device
  for (const e of local) map.set(e.id, e);
  // Sort newest first
  return Array.from(map.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export function mergeTodos(local: TodoTask[], cloud: TodoTask[]): TodoTask[] {
  const map = new Map<string, TodoTask>();
  for (const t of cloud) map.set(t.id, t);
  for (const t of local) map.set(t.id, t);
  return Array.from(map.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export function mergeTags(local: Tag[], cloud: Tag[]): Tag[] {
  const map = new Map<string, Tag>();
  for (const t of cloud) map.set(t.name, t);
  for (const t of local) map.set(t.name, t);
  return Array.from(map.values());
}

// ─── Online/Offline Listener ──────────────────────────────────────────────────
// Registers a one-time "back online" handler that re-syncs data automatically.

export function registerOnlineSync(
  getData: () => SyncPayload,
  onStatus: (status: SyncStatus) => void
): () => void {
  function handleOnline() {
    syncToCloud(getData(), onStatus);
  }
  function handleOffline() {
    onStatus("offline");
  }
  window.addEventListener("online", handleOnline);
  window.addEventListener("offline", handleOffline);

  // Return cleanup function
  return () => {
    window.removeEventListener("online", handleOnline);
    window.removeEventListener("offline", handleOffline);
  };
}
