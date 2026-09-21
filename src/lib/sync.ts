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
function safeUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function getOrCreateUserId(): string {
  let id = localStorage.getItem(USER_ID_KEY);
  if (!id) {
    id = safeUUID();
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

// ─── Sync to Cloud (Pure Local Storage Mode) ──────────────────────────────────
export function syncToCloud(
  _data: SyncPayload,
  _onStatus: (status: SyncStatus) => void
): void {
  // Operating 100% locally from localStorage / IPC — remote DB disabled
  return;
}

// ─── Fetch from Cloud (Pure Local Storage Mode) ───────────────────────────────
export async function fetchFromCloud(): Promise<SyncPayload | null> {
  // Operating 100% locally from localStorage / IPC — remote DB disabled
  return null;
}

// ─── Merge Helpers ────────────────────────────────────────────────────────────
// Merges cloud data INTO local data. Local data always wins for items that
// exist in both (since local is the latest source of truth for this device).

export function mergeEntries(local: Entry[], cloud: Entry[]): Entry[] {
  const map = new Map<string, Entry>();
  const processItem = (e: any) => {
    if (e && typeof e === "object" && e.id && typeof e.mood === "number") {
      const sanitized: Entry = {
        id: String(e.id),
        mood: Math.max(1, Math.min(5, Math.round(Number(e.mood) || 3))) as Mood,
        note: typeof e.note === "string" ? e.note : "",
        createdAt: typeof e.createdAt === "string" && e.createdAt ? e.createdAt : new Date().toISOString(),
        tags: Array.isArray(e.tags) ? e.tags.filter((t: any) => typeof t === "string") : [],
      };
      map.set(sanitized.id, sanitized);
    }
  };
  if (Array.isArray(cloud)) cloud.forEach(processItem);
  if (Array.isArray(local)) local.forEach(processItem);

  return Array.from(map.values()).sort((a, b) => {
    const tA = new Date(a.createdAt).getTime();
    const tB = new Date(b.createdAt).getTime();
    return (isNaN(tB) ? 0 : tB) - (isNaN(tA) ? 0 : tA);
  });
}

export function mergeTodos(local: TodoTask[], cloud: TodoTask[]): TodoTask[] {
  const map = new Map<string, TodoTask>();
  const processItem = (t: any) => {
    if (t && typeof t === "object" && t.id && (typeof t.text === "string" || typeof t.text === "number")) {
      const priority = t.priority === "high" || t.priority === "low" ? t.priority : "medium";
      const sanitized: TodoTask = {
        id: String(t.id),
        text: String(t.text),
        completed: Boolean(t.completed),
        priority,
        category: typeof t.category === "string" && t.category ? t.category : "general",
        createdAt: typeof t.createdAt === "string" && t.createdAt ? t.createdAt : new Date().toISOString(),
      };
      map.set(sanitized.id, sanitized);
    }
  };
  if (Array.isArray(cloud)) cloud.forEach(processItem);
  if (Array.isArray(local)) local.forEach(processItem);

  return Array.from(map.values()).sort((a, b) => {
    const tA = new Date(a.createdAt).getTime();
    const tB = new Date(b.createdAt).getTime();
    return (isNaN(tB) ? 0 : tB) - (isNaN(tA) ? 0 : tA);
  });
}

export function mergeTags(local: Tag[], cloud: Tag[]): Tag[] {
  const map = new Map<string, Tag>();
  const processItem = (t: any) => {
    if (t && typeof t === "object" && t.name) {
      const name = String(t.name).trim().toLowerCase();
      if (name) {
        map.set(name, {
          id: typeof t.id === "string" ? t.id : safeUUID(),
          name,
        });
      }
    }
  };
  if (Array.isArray(cloud)) cloud.forEach(processItem);
  if (Array.isArray(local)) local.forEach(processItem);
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
