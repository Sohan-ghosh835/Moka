import { createFileRoute } from "@tanstack/react-router";
import {
  Activity,
  CheckSquare,
  CircleUserRound,
  Cloud,
  CloudOff,
  Download,
  Eye,
  EyeOff,
  Heart,
  Loader2,
  Plus,
  Settings,
  Trash2,
  Upload,
  UserCheck,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BottomBar, NavTab } from "../components/BottomBar";
import Carousel, { CarouselItemData } from "../components/Carousel";
import SpringCheck from "../components/SpringCheck";
import { Slider } from "../components/ui/slider";
import {
  type SyncPayload,
  type SyncStatus,
  fetchFromCloud,
  mergeEntries,
  mergeTags,
  mergeTodos,
  registerOnlineSync,
  syncToCloud,
} from "../lib/sync";


type Mood = 1 | 2 | 3 | 4 | 5;
type Entry = { id: string; mood: Mood; note: string; createdAt: string; tags?: string[] | undefined };
type Tag = { id: string; name: string };
type TodoPriority = "low" | "medium" | "high";
type TodoTask = {
  id: string;
  text: string;
  completed: boolean;
  priority: TodoPriority;
  category?: string;
  createdAt: string;
};

const moods: { value: Mood; label: string; name: string; image: string; desc: string }[] = [
  { value: 1, label: "Rough", name: "Espresso", image: "/espresso.png", desc: "Bold, intense & raw energy" },
  { value: 2, label: "Low", name: "Iced Americano", image: "/iced-americano.png", desc: "Cool, quiet & reflective vibe" },
  { value: 3, label: "Okay", name: "Affogato", image: "/affogato.png", desc: "Balanced, smooth & steady flow" },
  { value: 4, label: "Good", name: "Mocha", image: "/mocha.png", desc: "Warm, rich & uplifting sweetness" },
  { value: 5, label: "Great", name: "Vanilla Mountain", image: "/vanilla-mountain.png", desc: "Decadent, joyous & top tier mood" },
];

function moodLabel(value: number) {
  const m = moods.find((mood) => mood.value === value);
  return m ? `${m.name} · ${m.label}` : "Affogato · Okay";
}

function moodColor(value: number) {
  return ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-chart-5"][value - 1] ?? "bg-chart-3";
}

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Moka" },
      { name: "description", content: "A quiet, private mood journal for noticing how your days unfold." },
      { property: "og:title", content: "Moka" },
      { property: "og:description", content: "A quiet, private mood journal for noticing how your days unfold." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Waypoint,
});

declare global {
  interface Window {
    waypointAPI?: {
      load: () => Promise<{ entries?: Entry[]; privacy?: boolean; tags?: Tag[]; todos?: TodoTask[] } | null>;
      save: (data: { entries: Entry[]; privacy: boolean; tags?: Tag[]; todos?: TodoTask[] }) => Promise<boolean>;
      exportFile: (filename: string, content: string) => Promise<{ ok: boolean }>;
      importFile?: () => Promise<{ ok: boolean; data?: { entries?: Entry[]; privacy?: boolean; tags?: Tag[]; todos?: TodoTask[] } }>;
    };
  }
}

function Waypoint() {
  const [activeTab, setActiveTab] = useState<NavTab>("Mood");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selectedMood, setSelectedMood] = useState<Mood>(3);
  const [weeksCount, setWeeksCount] = useState<number>(53);
  const [note, setNote] = useState("");
  const [availableTags, setAvailableTags] = useState<Tag[]>([
    { id: "t1", name: "work" },
    { id: "t2", name: "sleep" },
    { id: "t3", name: "exams" },
    { id: "t4", name: "health" },
  ]);
  const [selectedTagNames, setSelectedTagNames] = useState<string[]>([]);
  const [newTagInput, setNewTagInput] = useState("");
  const [query, setQuery] = useState("");
  const [privacy, setPrivacy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const trendRef = useRef<HTMLElement>(null);

  // To-Do Planner State
  const [todos, setTodos] = useState<TodoTask[]>([]);
  const [newTodoText, setNewTodoText] = useState("");
  const [newTodoPriority, setNewTodoPriority] = useState<TodoPriority>("medium");
  const [newTodoCategory, setNewTodoCategory] = useState("general");
  const [todoFilter, setTodoFilter] = useState<"all" | "active" | "completed">("all");
  const [todoQuery, setTodoQuery] = useState("");

  const coffeeCarouselItems: CarouselItemData[] = useMemo(
    () =>
      moods.map((m) => ({
        id: m.value,
        title: m.name,
        description: m.desc,
        moodValue: m.value,
        imageSrc: m.image,
        badgeText: m.label,
      })),
    []
  );

  // Helper to get current sync payload — used by the online-reconnect listener
  const getSyncPayload = useCallback((): SyncPayload => ({
    entries, todos, privacy, tags: availableTags,
  }), [entries, todos, privacy, availableTags]);

  // Load state from Electron IPC or localStorage, then merge cloud data
  useEffect(() => {
    async function init() {
      let localEntries: Entry[] = [];
      let localTodos: TodoTask[] = [];
      let localTags: Tag[] = [
        { id: "t1", name: "work" },
        { id: "t2", name: "sleep" },
        { id: "t3", name: "exams" },
        { id: "t4", name: "health" },
      ];
      let localPrivacy = false;

      // 1. Load from Electron IPC first (desktop)
      try {
        if (window.waypointAPI?.load) {
          const loaded = await window.waypointAPI.load();
          if (loaded) {
            if (Array.isArray(loaded.entries)) localEntries = loaded.entries;
            if (typeof loaded.privacy === "boolean") localPrivacy = loaded.privacy;
            if (Array.isArray(loaded.tags) && loaded.tags.length) localTags = loaded.tags;
            if (Array.isArray(loaded.todos)) {
              localTodos = loaded.todos.filter((t) => t.id !== "td1" && t.id !== "td2");
            }
          }
        }
      } catch (e) {
        console.error(e);
      }

      // 2. Fallback: load from localStorage (web / PWA)
      if (!localEntries.length) {
        const saved = window.localStorage.getItem("waypoint_mood_v1");
        if (saved) {
          try {
            const parsed = JSON.parse(saved) as { entries?: Entry[]; privacy?: boolean; tags?: Tag[]; todos?: TodoTask[] };
            if (Array.isArray(parsed.entries)) localEntries = parsed.entries;
            if (typeof parsed.privacy === "boolean") localPrivacy = parsed.privacy;
            if (Array.isArray(parsed.tags) && parsed.tags.length) localTags = parsed.tags;
            if (Array.isArray(parsed.todos)) {
              localTodos = parsed.todos.filter((t) => t.id !== "td1" && t.id !== "td2");
            }
          } catch (e) {
            console.error(e);
          }
        }
      }

      // Apply local state immediately (fast startup)
      setEntries(localEntries);
      setTodos(localTodos);
      setAvailableTags(localTags);
      setPrivacy(localPrivacy);
      setReady(true);

      // 3. Fetch cloud data in background and merge
      const cloud = await fetchFromCloud();
      if (cloud) {
        setEntries((prev) => mergeEntries(prev, cloud.entries));
        setTodos((prev) => mergeTodos(prev, cloud.todos));
        if (cloud.tags.length) {
          setAvailableTags((prev) => mergeTags(prev, cloud.tags));
        }
        setSyncStatus("synced");
      }
    }
    init();
  }, []);

  // Save state to Electron IPC or localStorage + background cloud sync
  useEffect(() => {
    if (!ready) return;

    // Local save (instant)
    if (window.waypointAPI?.save) {
      window.waypointAPI.save({ entries, privacy, tags: availableTags, todos }).catch(console.error);
    } else {
      window.localStorage.setItem("waypoint_mood_v1", JSON.stringify({ entries, privacy, tags: availableTags, todos }));
    }

    // Background cloud sync (debounced, non-blocking)
    syncToCloud({ entries, todos, privacy, tags: availableTags }, setSyncStatus);
  }, [entries, privacy, availableTags, todos, ready]);

  // Re-sync automatically when the device comes back online
  useEffect(() => {
    if (!ready) return;
    return registerOnlineSync(getSyncPayload, setSyncStatus);
  }, [ready, getSyncPayload]);

  const filteredEntries = useMemo(
    () => entries.filter((entry) => {
      const q = query.toLowerCase();
      const noteMatch = entry.note.toLowerCase().includes(q);
      const tagMatch = entry.tags?.some((t) => t.toLowerCase().includes(q));
      return noteMatch || tagMatch;
    }),
    [entries, query],
  );
  
  const average = entries.length
    ? entries.reduce((sum, entry) => sum + entry.mood, 0) / entries.length
    : 0;
    
  const streak = new Set(entries.map((entry) => entry.createdAt.slice(0, 10))).size;

  function toggleTagSelection(tagName: string) {
    setSelectedTagNames((prev) =>
      prev.includes(tagName) ? prev.filter((t) => t !== tagName) : [...prev, tagName]
    );
  }

  function addNewTag() {
    const clean = newTagInput.trim().toLowerCase();
    if (!clean) return;
    if (!availableTags.some((t) => t.name === clean)) {
      setAvailableTags((prev) => [...prev, { id: crypto.randomUUID(), name: clean }]);
    }
    if (!selectedTagNames.includes(clean)) {
      setSelectedTagNames((prev) => [...prev, clean]);
    }
    setNewTagInput("");
  }

  function clearForm() {
    setNote("");
    setSelectedTagNames([]);
  }

  // To-Do Handlers
  function addTodo() {
    const text = newTodoText.trim();
    if (!text) return;
    const newTask: TodoTask = {
      id: crypto.randomUUID(),
      text,
      completed: false,
      priority: newTodoPriority,
      category: newTodoCategory.trim().toLowerCase() || "general",
      createdAt: new Date().toISOString(),
    };
    setTodos((prev) => [newTask, ...prev]);
    setNewTodoText("");
  }

  function toggleTodo(id: string) {
    setTodos((prev) =>
      prev.map((t) => (t.id === id ? { ...t, completed: !t.completed } : t))
    );
  }

  function deleteTodo(id: string) {
    setTodos((prev) => prev.filter((t) => t.id !== id));
  }

  function clearCompletedTodos() {
    setTodos((prev) => prev.filter((t) => !t.completed));
  }

  const filteredTodos = useMemo(() => {
    return todos.filter((task) => {
      const matchesFilter =
        todoFilter === "all"
          ? true
          : todoFilter === "active"
          ? !task.completed
          : task.completed;
      const q = todoQuery.toLowerCase();
      const matchesQuery =
        task.text.toLowerCase().includes(q) ||
        (task.category && task.category.toLowerCase().includes(q));
      return matchesFilter && matchesQuery;
    });
  }, [todos, todoFilter, todoQuery]);

  const todoStats = useMemo(() => {
    const total = todos.length;
    const completed = todos.filter((t) => t.completed).length;
    const pending = total - completed;
    const rate = total > 0 ? Math.round((completed / total) * 100) : 0;
    return { total, completed, pending, rate };
  }, [todos]);

  // Dynamic trend computation for recent 7 days
  const trendValues = useMemo(() => {
    const daysMap: Record<string, number[]> = {};
    entries.forEach((e) => {
      const day = e.createdAt.slice(0, 10);
      (daysMap[day] = daysMap[day] || []).push(e.mood);
    });
    const result: { dayLabel: string; value: number | null }[] = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const dayLabel = d.toLocaleDateString(undefined, { weekday: "short" });
      const vals = daysMap[key];
      const avg = vals && vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
      result.push({ dayLabel, value: avg });
    }
    return result;
  }, [entries]);

  // Contributions heatmap generator
  const contribHeatmap = useMemo(() => {
    const entriesByDay: Record<string, number[]> = {};
    entries.forEach((e) => {
      const day = e.createdAt.slice(0, 10);
      (entriesByDay[day] = entriesByDay[day] || []).push(e.mood);
    });

    const today = new Date();
    const end = new Date(today);
    const startDow = end.getDay();
    end.setDate(end.getDate() + (6 - startDow)); // extend to Saturday

    const WEEKS = Math.max(12, Math.min(53, weeksCount));
    const start = new Date(end);
    start.setDate(start.getDate() - (WEEKS * 7 - 1));
    start.setDate(start.getDate() - start.getDay()); // align to Sunday

    const days: { dateStr: string; formattedDate: string; count: number; mood?: number | undefined; colorClass: string }[] = [];
    const monthLabels: { month: string; col: number }[] = [];

    let lastMonth = -1;
    const totalDays = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
    const cursor = new Date(start);

    for (let i = 0; i < totalDays; i++) {
      const dateStr = cursor.toISOString().slice(0, 10);
      const col = Math.floor(i / 7);
      const row = cursor.getDay();

      if (row === 0) {
        const m = cursor.getMonth();
        if (m !== lastMonth) {
          const monthName = cursor.toLocaleDateString(undefined, { month: "short" });
          if (monthLabels.length > 0) {
            const lastCol = monthLabels[monthLabels.length - 1]?.col ?? 0;
            if (col - lastCol < 3) {
              if (lastCol === 0) {
                monthLabels[0] = { month: monthName, col };
              }
            } else {
              monthLabels.push({ month: monthName, col });
            }
          } else {
            monthLabels.push({ month: monthName, col });
          }
          lastMonth = m;
        }
      }

      const formattedDate = cursor.toLocaleDateString(undefined, { month: "short", day: "numeric", weekday: "short" });
      const isFuture = cursor > today;
      const vals = isFuture ? undefined : entriesByDay[dateStr];
      const count = vals ? vals.length : 0;
      const avg = vals && vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : undefined;
      
      let colorClass = "bg-primary/15 hover:bg-primary/35";
      if (isFuture) {
        colorClass = "opacity-0 pointer-events-none";
      } else if (count === 1) {
        colorClass = "bg-chart-1 hover:brightness-125";
      } else if (count === 2) {
        colorClass = "bg-chart-2 hover:brightness-125";
      } else if (count === 3) {
        colorClass = "bg-chart-3 hover:brightness-125";
      } else if (count === 4) {
        colorClass = "bg-chart-4 hover:brightness-125";
      } else if (count > 4) {
        colorClass = "bg-chart-5 ring-1 ring-foreground/60 shadow-xs hover:brightness-135";
      }

      days.push({ dateStr, formattedDate, count, mood: avg, colorClass });
      cursor.setDate(cursor.getDate() + 1);
    }

    return { days, monthLabels, weeksCount: WEEKS };
  }, [entries, weeksCount]);

  function saveEntry() {
    const createdAt = new Date().toISOString();
    const trimmedNote = note.trim();
    const finalNote = trimmedNote || `Logged ${moodLabel(selectedMood).toLowerCase()} mood`;
    setEntries((current) => [
      {
        id: crypto.randomUUID(),
        mood: selectedMood,
        note: finalNote,
        createdAt,
        tags: selectedTagNames.length > 0 ? [...selectedTagNames] : undefined,
      },
      ...current,
    ]);
    setNote("");
    setSelectedTagNames([]);
  }

  async function exportEntries() {
    if (!entries.length && !todos.length) {
      alert("No data to export yet.");
      return;
    }
    const payload = JSON.stringify({ entries, privacy, tags: availableTags, todos }, null, 2);
    if (window.waypointAPI?.exportFile) {
      const res = await window.waypointAPI.exportFile("moka-journal.json", payload);
      if (res?.ok) return;
    }
    const blob = new Blob([payload], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = "moka-journal.json";
    link.click();
    URL.revokeObjectURL(href);
  }

  async function importEntries() {
    if (window.waypointAPI?.importFile) {
      const res = await window.waypointAPI.importFile();
      if (res?.ok && res.data) {
        processImportData(res.data);
        return;
      }
    }
    fileInputRef.current?.click();
  }

  function handleFileInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target?.result as string);
        processImportData(data);
      } catch (err) {
        alert("Could not parse JSON backup file.");
      }
    };
    reader.readAsText(file);
    event.target.value = "";
  }

  function processImportData(data: { entries?: Entry[]; privacy?: boolean; todos?: TodoTask[] }) {
    if (Array.isArray(data.entries)) {
      setEntries((current) => {
        const existingIds = new Set(current.map((e) => e.id));
        const merged = [...current];
        for (const item of data.entries!) {
          if (item.id && item.mood && !existingIds.has(item.id)) {
            merged.push(item);
          }
        }
        return merged;
      });
      if (Array.isArray(data.todos)) {
        setTodos((current) => {
          const existingIds = new Set(current.map((t) => t.id));
          const merged = [...current];
          for (const item of data.todos!) {
            if (item.id && item.text && !existingIds.has(item.id)) {
              merged.push(item);
            }
          }
          return merged;
        });
      }
      if (typeof data.privacy === "boolean") setPrivacy(data.privacy);
      alert("Backup imported successfully!");
    } else {
      alert("Invalid backup file format.");
    }
  }

  function clearExceptThisMonth() {
    if (!confirm("Delete all entries EXCEPT those from this month?")) return;
    const now = new Date();
    const currentMonthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    setEntries((current) => current.filter((e) => e.createdAt.startsWith(currentMonthPrefix)));
  }

  return (
    <main className="journal-bg min-h-screen w-full overflow-x-hidden font-body text-foreground antialiased pb-28">
      <div className="w-full max-w-[1400px] mx-auto px-4 py-5 sm:px-8 sm:py-7">
        {/* Top Branding & Tools Header */}
        <header className="rise grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-border pb-5">
          <div className="flex min-w-0 items-center gap-3">
            <img
              src="/logo.png"
              alt="Moka"
              className="size-9 shrink-0 object-contain rounded-lg p-1 bg-primary/15 ring-1 ring-primary/30 shadow-xs"
            />
            <div className="min-w-0">
              <div className="truncate font-display text-[15px] font-bold text-foreground">Moka</div>
            </div>
          </div>
          <nav className="flex shrink-0 items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
            {/* Cloud Sync Status Indicator */}
            <span
              className="icon-control pointer-events-none"
              title={
                syncStatus === "syncing" ? "Syncing to cloud…" :
                syncStatus === "synced" ? "Synced to cloud" :
                syncStatus === "offline" ? "Offline — will sync when connected" :
                syncStatus === "error" ? "Sync error — will retry" :
                "Cloud sync idle"
              }
            >
              {syncStatus === "syncing" ? (
                <Loader2 size={14} className="animate-spin text-primary" />
              ) : syncStatus === "synced" ? (
                <Cloud size={14} className="text-emerald-400" />
              ) : syncStatus === "offline" || syncStatus === "error" ? (
                <CloudOff size={14} className="text-amber-400" />
              ) : null}
            </span>
            <button
              className="icon-control"
              onClick={() => setPrivacy((value) => !value)}
              aria-label="Toggle note privacy"
              title="Toggle note privacy"
            >
              {privacy ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
            <button
              className="icon-control"
              onClick={() => setSettingsOpen(true)}
              aria-label="Open settings"
              title="Open settings"
            >
              <Settings size={15} />
            </button>
            <button
              className="icon-control"
              onClick={exportEntries}
              aria-label="Download backup"
              title="Download backup"
            >
              <Download size={15} />
            </button>
          </nav>
        </header>

        {/* PAGE 1: MOOD TAB */}
        {activeTab === "Mood" && (
          <div className="flex flex-col gap-6 pt-2">
            {/* Prominent Page Title Banner - Pulled Outside Box */}
            <div className="pt-3 pb-1 rise flex flex-col items-start gap-0.5">
              <h1 className="title-sans text-3xl sm:text-4xl lg:text-5xl font-semibold tracking-tight text-foreground">
                How are you feeling
              </h1>
              <span className="title-serif-italic text-2xl sm:text-3xl lg:text-4xl text-rose-300 font-normal">
                today?
              </span>
            </div>

            <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
              {/* Left: New Entry Card */}
              <aside className="w-full shrink-0 flex flex-col gap-4 lg:w-[340px]">
                <section className="entry-ledger rise relative min-w-0 overflow-hidden rounded-xl bg-primary/10 ring-1 ring-primary/25">
                  <div className="pointer-events-none absolute inset-0 overflow-hidden">
                    <div className="absolute top-0 h-px w-full bg-gradient-to-r from-transparent via-foreground/50 to-transparent" />
                    <div className="sweep absolute inset-y-0 top-0 w-1/3 bg-gradient-to-r from-transparent via-foreground/[0.06] to-transparent" />
                  </div>
                  <div className="relative -skew-x-3 p-5">
                    <div className="skew-x-3">
                      <div className="flex items-center justify-between mb-3">
                        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                          New entry
                        </p>
                        <span className="font-mono text-[11px] font-bold text-primary-foreground bg-primary/25 px-2.5 py-0.5 rounded-full ring-1 ring-primary/40">
                          {moodLabel(selectedMood)}
                        </span>
                      </div>
                      <div className="mb-4">
                        <div className="w-full flex justify-center my-2">
                          <Carousel
                            items={coffeeCarouselItems}
                            baseWidth={290}
                            loop={true}
                            initialIndex={selectedMood - 1}
                            onIndexChange={(index) => {
                              setSelectedMood((index + 1) as Mood);
                            }}
                          />
                        </div>
                      </div>
                    <label htmlFor="note" className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
                      Note
                    </label>
                    <textarea
                      id="note"
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder="A few honest words…"
                      className="h-24 w-full resize-none rounded-lg bg-background/40 p-3 text-sm text-foreground ring-1 ring-border placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/60"
                    />

                    {/* Tags Section */}
                    <div className="my-3">
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">Tags</label>
                        {selectedTagNames.length > 0 && (
                          <button
                            onClick={() => setSelectedTagNames([])}
                            type="button"
                            className="text-[10px] font-mono text-muted-foreground hover:text-foreground"
                          >
                            Clear tags
                          </button>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {availableTags.map((t) => {
                          const isSelected = selectedTagNames.includes(t.name);
                          return (
                            <button
                              key={t.id}
                              type="button"
                              onClick={() => toggleTagSelection(t.name)}
                              className={`rounded-md px-2 py-0.5 font-mono text-[10.5px] transition-colors ${
                                isSelected
                                  ? "bg-primary text-primary-foreground font-semibold ring-1 ring-primary/60"
                                  : "bg-background/40 text-muted-foreground ring-1 ring-border hover:text-foreground hover:bg-background/70"
                              }`}
                            >
                              #{t.name}
                            </button>
                          );
                        })}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={newTagInput}
                          onChange={(e) => setNewTagInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              addNewTag();
                            }
                          }}
                          placeholder="Add tag (e.g. exams, sleep)..."
                          className="flex-1 min-w-0 rounded-md bg-background/40 px-2.5 py-1 text-xs text-foreground ring-1 ring-border placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/60"
                        />
                        <button
                          type="button"
                          onClick={addNewTag}
                          className="rounded-md bg-primary/20 px-2.5 py-1 font-mono text-[11px] font-medium text-foreground ring-1 ring-primary/40 hover:bg-primary/30 transition-colors"
                        >
                          + Add
                        </button>
                      </div>
                    </div>

                    <div className="mt-4 flex items-center gap-2">
                      <button
                        onClick={saveEntry}
                        className="flex-1 rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/85 shadow-md shadow-primary/20"
                      >
                        Save entry
                      </button>
                      <button
                        onClick={() => {
                          setNote("");
                          setSelectedTagNames([]);
                        }}
                        className="rounded-lg px-3 py-2.5 font-mono text-[11px] text-muted-foreground ring-1 ring-border transition-colors hover:text-foreground"
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                </div>
              </section>
            </aside>

            {/* Right: Recent Log Feed */}
            <div className="flex-1 min-w-0 flex flex-col">
              <section className="panel rise min-w-0 p-4 sm:p-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-border/50 pb-3">
                  <div>
                    <h2 className="font-display text-base font-bold text-foreground">Recent log</h2>
                    <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
                      Latest journal entries ({filteredEntries.length})
                    </p>
                  </div>
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search journal…"
                    className="w-36 min-w-0 rounded-md bg-background/40 px-3 py-1.5 text-xs text-foreground ring-1 ring-border placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/60 sm:w-48"
                  />
                </div>

                <div className="divide-y divide-border/60">
                  {filteredEntries.length ? (
                    filteredEntries.slice(0, 15).map((entry) => (
                      <div key={entry.id} className="group flex flex-col gap-1.5 py-3.5 first:pt-1 last:pb-1">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
                            <span className={`size-2.5 shrink-0 rounded-full ${moodColor(entry.mood)}`} />
                            <span className="font-semibold text-foreground">{moodLabel(entry.mood)}</span>
                            <span className="opacity-40">•</span>
                            <span>
                              {new Date(entry.createdAt).toLocaleDateString(undefined, {
                                month: "short",
                                day: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                          </div>
                          <button
                            onClick={() => setEntries((current) => current.filter((item) => item.id !== entry.id))}
                            className="icon-control size-6 opacity-70 group-hover:opacity-100 transition-opacity"
                            aria-label="Delete entry"
                            title="Delete entry"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>

                        <p className={`text-sm text-foreground/90 leading-relaxed break-words pl-4 border-l-2 border-primary/20 ${privacy ? "blur-sm select-none" : ""}`}>
                          {entry.note}
                        </p>

                        {entry.tags && entry.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 pl-4 mt-0.5">
                            {entry.tags.map((t) => (
                              <button
                                key={t}
                                type="button"
                                onClick={() => setQuery(t)}
                                className="rounded px-1.5 py-0.5 font-mono text-[9.5px] bg-primary/20 text-muted-foreground ring-1 ring-border hover:text-foreground hover:bg-primary/30 transition-colors"
                              >
                                #{t}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="py-12 text-center font-mono text-xs text-muted-foreground italic">
                      {entries.length ? "No entries match your search query." : "Nothing logged yet — write your first entry on the left!"}
                    </div>
                  )}
                </div>
              </section>
            </div>
          </div>
        </div>
      )}

        {/* PAGE 2: TRACK TAB */}
        {activeTab === "Track" && (
          <div className="flex flex-col gap-5 pt-5">
            {/* Bento Quick Stats Grid */}
            <section aria-label="Journal statistics" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              {[
                ["Streak", String(streak), "days recorded"],
                ["Entries", String(entries.length), "in your journal"],
                ["Tone", average ? average.toFixed(1) : "—", "average mood"],
                ["Best", entries.length ? moodLabel(Math.max(...entries.map((entry) => entry.mood))) : "—", "recent high"],
              ].map(([label, value, detail], index) => (
                <article key={label} className="panel rise min-w-0 p-4" style={{ animationDelay: `${140 + index * 30}ms` }}>
                  <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">{label}</p>
                  <p className="mt-1 truncate font-display text-2xl font-bold text-foreground sm:text-3xl">{value}</p>
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{detail}</p>
                </article>
              ))}
            </section>

            {/* Mood Trend Panel */}
            <section ref={trendRef} className="panel rise min-w-0 p-4 sm:p-5">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h2 className="font-display text-sm font-bold">Mood trend</h2>
                  <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">Last 7 days</p>
                </div>
                <span className="font-mono text-[10px] text-muted-foreground">1–5</span>
              </div>
              {entries.length > 0 && trendValues.some((t) => t.value !== null) ? (
                <>
                  <div className="relative flex h-24 items-end gap-2 pt-2">
                    <div className="absolute inset-x-0 top-1/2 h-px bg-border" />
                    {trendValues.map((t, index) => (
                      <div key={`${t.dayLabel}-${index}`} className="relative flex h-full min-w-0 flex-1 items-end justify-center">
                        {t.value !== null ? (
                          <div
                            className={`grow w-full rounded-t transition-all duration-200 hover:brightness-125 ${moodColor(t.value)} ${
                              ["h-[20%]", "h-[40%]", "h-[60%]", "h-[80%]", "h-[100%]"][t.value - 1] ?? "h-1/2"
                            }`}
                            title={`${t.dayLabel}: ${moodLabel(t.value)}`}
                          />
                        ) : (
                          <div className="size-1.5 rounded-full bg-border/60 mb-1" title={`${t.dayLabel}: No entry`} />
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 flex gap-2 font-mono text-[9px] text-muted-foreground">
                    {trendValues.map((t, index) => (
                      <span className="flex-1 text-center" key={`${t.dayLabel}-${index}`}>{t.dayLabel}</span>
                    ))}
                  </div>
                </>
              ) : (
                <div className="flex h-24 flex-col items-center justify-center font-mono text-xs text-muted-foreground italic">
                  <span>No entries recorded in the last 7 days.</span>
                </div>
              )}
            </section>

            {/* Contributions Heatmap Panel */}
            <section className="panel rise min-w-0 p-4 sm:p-5">
              <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-display text-sm font-bold">Contributions</h2>
                  <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">Activity heatmap</p>
                </div>
                <div className="flex items-center gap-1 rounded-lg bg-background/40 p-1 ring-1 ring-border">
                  <span className="px-2 font-mono text-[10px] text-muted-foreground uppercase tracking-wider hidden sm:inline">Timeframe:</span>
                  {[
                    { label: "12w", value: 12 },
                    { label: "26w", value: 26 },
                    { label: "38w", value: 38 },
                    { label: "53w", value: 53 },
                  ].map((preset) => (
                    <button
                      key={preset.value}
                      type="button"
                      onClick={() => setWeeksCount(preset.value)}
                      className={`rounded px-2.5 py-1 font-mono text-[10.5px] transition-colors ${
                        weeksCount === preset.value
                          ? "bg-primary text-primary-foreground font-semibold ring-1 ring-primary/60 shadow-xs"
                          : "text-muted-foreground hover:text-foreground hover:bg-background/60"
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="overflow-x-auto scrollbar-none pb-2 pt-1 -mx-2 px-2 sm:mx-0 sm:px-0">
                <div className="inline-block" style={{ minWidth: `${contribHeatmap.weeksCount * 13 + 30}px` }}>
                  {/* Month Header Labels */}
                  <div className="relative mb-2 flex h-4 text-[10px] font-mono text-muted-foreground">
                    {contribHeatmap.monthLabels.map((m, idx) => (
                      <span
                        key={`${m.month}-${idx}`}
                        className="absolute truncate"
                        style={{ left: `calc(26px + ${m.col * 13}px)` }}
                      >
                        {m.month}
                      </span>
                    ))}
                  </div>

                  <div className="flex gap-1.5 items-start">
                    {/* Day of Week Labels */}
                    <div className="grid grid-rows-7 gap-[3px] text-[9px] font-mono text-muted-foreground shrink-0 w-5 py-[1px]">
                      <span className="h-[10px]"></span>
                      <span className="h-[10px] flex items-center">Mon</span>
                      <span className="h-[10px]"></span>
                      <span className="h-[10px] flex items-center">Wed</span>
                      <span className="h-[10px]"></span>
                      <span className="h-[10px] flex items-center">Fri</span>
                      <span className="h-[10px]"></span>
                    </div>

                    {/* Dynamic Weeks Grid */}
                    <div
                      className="grid grid-flow-col grid-rows-7 gap-[3px]"
                      style={{ gridTemplateColumns: `repeat(${contribHeatmap.weeksCount}, 10px)` }}
                    >
                      {contribHeatmap.days.map((day) => (
                        <div
                          key={day.dateStr}
                          title={
                            day.count > 0
                              ? `${day.formattedDate}: ${day.count} ${day.count === 1 ? "entry" : "entries"}${day.mood ? ` (Avg: ${moodLabel(day.mood)})` : ""}`
                              : `${day.formattedDate}: No entries`
                          }
                          className={`size-[10px] rounded-[2px] transition-all duration-150 ease-out hover:scale-135 hover:z-20 hover:ring-2 hover:ring-foreground/80 hover:shadow-md cursor-pointer ${day.colorClass}`}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Legend Row */}
                  <div className="mt-3.5 flex items-center justify-between text-[10px] font-mono text-muted-foreground">
                    <span>Activity log ({weeksCount} weeks view)</span>
                    <div className="flex items-center gap-1.5">
                      <span>Less</span>
                      <span className="size-[10px] rounded-[2px] bg-primary/15" title="0 entries" />
                      <span className="size-[10px] rounded-[2px] bg-chart-1" title="1 entry" />
                      <span className="size-[10px] rounded-[2px] bg-chart-2" title="2 entries" />
                      <span className="size-[10px] rounded-[2px] bg-chart-3" title="3 entries" />
                      <span className="size-[10px] rounded-[2px] bg-chart-4" title="4 entries" />
                      <span className="size-[10px] rounded-[2px] bg-chart-5 ring-1 ring-foreground/60" title="5+ entries (>4)" />
                      <span>More (5+)</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Theme Slider Control at Bottom */}
              <div className="mt-3 pt-3 border-t border-border/50 flex flex-col gap-2">
                <div className="flex items-center justify-between font-mono text-[10px] text-muted-foreground">
                  <span className="uppercase tracking-wider text-muted-foreground">Heatmap Range Slider</span>
                  <span className="text-foreground font-semibold font-mono">{weeksCount} weeks</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-[10px] text-muted-foreground shrink-0">12w</span>
                  <Slider
                    value={[weeksCount]}
                    min={12}
                    max={53}
                    step={1}
                    onValueChange={(val) => setWeeksCount(val[0])}
                    className="flex-1 cursor-pointer"
                    aria-label="Bottom contribution table range slider"
                  />
                  <span className="font-mono text-[10px] text-muted-foreground shrink-0">53w</span>
                </div>
              </div>
            </section>
          </div>
        )}

        {/* PAGE 3: PROFILE TAB */}
        {activeTab === "Profile" && (
          <div className="grid grid-cols-1 gap-5 pt-5 lg:grid-cols-[minmax(0,1fr)_340px]">
            {/* Card 1: Student ID Card Showcase */}
            <section className="panel rise min-w-0 p-5 flex flex-col gap-4">
              <div className="flex items-center justify-between border-b border-border/50 pb-3">
                <div>
                  <h2 className="font-display text-base font-bold text-foreground">Profile & Student ID</h2>
                  <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
                    Verified Moka member credentials
                  </p>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/20 px-3 py-1 font-mono text-[10px] font-semibold text-primary-foreground ring-1 ring-primary/40">
                  <UserCheck size={13} /> Active Member
                </span>
              </div>

              {/* Student Card Frame */}
              <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-background/50 p-2 shadow-2xl transition-transform duration-300 hover:scale-[1.01]">
                <img
                  src="./student-card.jpeg"
                  alt="Student ID Card - SOOBJJIGAE"
                  className="w-full h-auto rounded-xl object-contain shadow-md"
                />
              </div>

              {/* Profile Details Grid */}
              <div className="grid grid-cols-2 gap-3 pt-2 sm:grid-cols-4">
                <div className="rounded-lg bg-background/40 p-3 ring-1 ring-border">
                  <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Name</p>
                  <p className="mt-0.5 font-display text-sm font-bold text-foreground">SOOBJJIGAE</p>
                </div>
                <div className="rounded-lg bg-background/40 p-3 ring-1 ring-border">
                  <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Birthday</p>
                  <p className="mt-0.5 font-mono text-sm font-semibold text-foreground">22-12-2004</p>
                </div>
                <div className="rounded-lg bg-background/40 p-3 ring-1 ring-border">
                  <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Year Level</p>
                  <p className="mt-0.5 font-mono text-sm font-semibold text-foreground">2ND YEAR</p>
                </div>
                <div className="rounded-lg bg-background/40 p-3 ring-1 ring-border">
                  <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Program</p>
                  <p className="mt-0.5 font-mono text-sm font-semibold text-foreground">G.CON MSD MCH</p>
                </div>
              </div>
            </section>

            {/* Card 2: Journal Profile Stats & Quick Actions */}
            <section className="panel rise min-w-0 p-5 flex flex-col gap-4">
              <div className="border-b border-border/50 pb-3">
                <h2 className="font-display text-base font-bold text-foreground">Journal Summary</h2>
                <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
                  Personal workspace statistics
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-primary/15 p-3.5 ring-1 ring-primary/30">
                  <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Logged Entries</p>
                  <p className="mt-1 font-display text-2xl font-bold text-foreground">{entries.length}</p>
                </div>
                <div className="rounded-xl bg-primary/15 p-3.5 ring-1 ring-primary/30">
                  <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Active Streak</p>
                  <p className="mt-1 font-display text-2xl font-bold text-foreground">{streak} days</p>
                </div>
                <div className="rounded-xl bg-primary/15 p-3.5 ring-1 ring-primary/30">
                  <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Tasks Planned</p>
                  <p className="mt-1 font-display text-2xl font-bold text-foreground">{todos.length}</p>
                </div>
                <div className="rounded-xl bg-primary/15 p-3.5 ring-1 ring-primary/30">
                  <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Privacy Mode</p>
                  <p className="mt-1 font-mono text-sm font-bold text-foreground">{privacy ? "ON" : "OFF"}</p>
                </div>
              </div>

              <div className="mt-2 flex flex-col gap-2 pt-2 border-t border-border/50">
                <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                  Quick Data Actions
                </p>
                <button onClick={exportEntries} className="setting-control text-xs">
                  <span>Export Journal Backup</span>
                  <Download size={14} />
                </button>
                <button onClick={importEntries} className="setting-control text-xs">
                  <span>Import Journal Backup</span>
                  <Upload size={14} />
                </button>
                <button onClick={clearExceptThisMonth} className="setting-control text-xs text-destructive">
                  <span>Clear Previous Months</span>
                  <Trash2 size={14} />
                </button>
              </div>
            </section>
          </div>
        )}

        {/* PAGE 4: TODO TAB */}
        {activeTab === "Todo" && (
          <div className="flex flex-col gap-5 pt-5">
            {/* Top Row: Task Creator & Overview Stats */}
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
              {/* Task Creator Card */}
              <section className="panel rise min-w-0 p-5">
                <div className="mb-4 border-b border-border/50 pb-3">
                  <h2 className="font-display text-base font-bold text-foreground">Task Planner</h2>
                  <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
                    Organize your daily tasks & priorities
                  </p>
                </div>

                <div className="flex flex-col gap-3">
                  <input
                    type="text"
                    value={newTodoText}
                    onChange={(e) => setNewTodoText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addTodo();
                      }
                    }}
                    placeholder="What do you need to accomplish?"
                    className="w-full rounded-lg bg-background/50 p-3 text-sm text-foreground ring-1 ring-border placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/60"
                  />

                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[10px] uppercase text-muted-foreground">Priority:</span>
                      {(["low", "medium", "high"] as TodoPriority[]).map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setNewTodoPriority(p)}
                          className={`rounded px-2.5 py-1 font-mono text-[10.5px] uppercase transition-colors ${
                            newTodoPriority === p
                              ? p === "high"
                                ? "bg-rose-500/80 text-white font-bold ring-1 ring-rose-400"
                                : p === "medium"
                                ? "bg-primary text-primary-foreground font-bold ring-1 ring-primary/60"
                                : "bg-muted text-foreground font-bold ring-1 ring-border"
                              : "bg-background/40 text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {p}
                        </button>
                      ))}
                    </div>

                    <div className="flex items-center gap-1.5 flex-1 min-w-[160px]">
                      <span className="font-mono text-[10px] uppercase text-muted-foreground shrink-0">Category:</span>
                      <input
                        type="text"
                        value={newTodoCategory}
                        onChange={(e) => setNewTodoCategory(e.target.value)}
                        placeholder="study, health..."
                        className="w-full rounded-md bg-background/40 px-2.5 py-1 text-xs text-foreground ring-1 ring-border placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/60"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={addTodo}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/85 shadow-md shadow-primary/20"
                    >
                      <Plus size={15} /> Add Task
                    </button>
                  </div>
                </div>
              </section>

              {/* Task Progress & Statistics Card */}
              <section className="panel rise min-w-0 p-5 flex flex-col justify-between">
                <div>
                  <h2 className="font-display text-base font-bold text-foreground mb-1">Task Progress</h2>
                  <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground mb-4">
                    Overview of your productivity
                  </p>

                  <div className="grid grid-cols-3 gap-2 text-center mb-4">
                    <div className="rounded-lg bg-background/40 p-2.5 ring-1 ring-border">
                      <p className="font-mono text-[10px] uppercase text-muted-foreground">Total</p>
                      <p className="mt-0.5 font-display text-xl font-bold text-foreground">{todoStats.total}</p>
                    </div>
                    <div className="rounded-lg bg-background/40 p-2.5 ring-1 ring-border">
                      <p className="font-mono text-[10px] uppercase text-muted-foreground">Pending</p>
                      <p className="mt-0.5 font-display text-xl font-bold text-amber-300">{todoStats.pending}</p>
                    </div>
                    <div className="rounded-lg bg-background/40 p-2.5 ring-1 ring-border">
                      <p className="font-mono text-[10px] uppercase text-muted-foreground">Done</p>
                      <p className="mt-0.5 font-display text-xl font-bold text-emerald-300">{todoStats.completed}</p>
                    </div>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between items-center text-xs font-mono mb-1.5">
                    <span className="text-muted-foreground uppercase tracking-wider">Completion Rate</span>
                    <span className="font-bold text-foreground">{todoStats.rate}%</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-primary/20">
                    <div
                      className="h-full bg-primary transition-all duration-300 rounded-full"
                      style={{ width: `${todoStats.rate}%` }}
                    />
                  </div>
                </div>
              </section>
            </div>

            {/* Task Manager List & Filters Feed */}
            <section className="panel rise min-w-0 p-4 sm:p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-border/50 pb-3">
                <div className="flex items-center gap-2">
                  <CheckSquare size={18} className="text-primary" />
                  <div>
                    <h2 className="font-display text-base font-bold text-foreground">Task List</h2>
                    <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
                      Showing {filteredTodos.length} {filteredTodos.length === 1 ? "task" : "tasks"}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={todoQuery}
                    onChange={(e) => setTodoQuery(e.target.value)}
                    placeholder="Search tasks..."
                    className="w-36 min-w-0 rounded-md bg-background/40 px-3 py-1 text-xs text-foreground ring-1 ring-border placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/60 sm:w-44"
                  />

                  <div className="flex items-center gap-1 rounded-md bg-background/40 p-1 ring-1 ring-border">
                    {(["all", "active", "completed"] as const).map((f) => (
                      <button
                        key={f}
                        type="button"
                        onClick={() => setTodoFilter(f)}
                        className={`rounded px-2.5 py-0.5 font-mono text-[10px] uppercase transition-colors ${
                          todoFilter === f
                            ? "bg-primary text-primary-foreground font-semibold"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {f}
                      </button>
                    ))}
                  </div>

                  {todos.some((t) => t.completed) && (
                    <button
                      onClick={clearCompletedTodos}
                      className="rounded px-2.5 py-1 font-mono text-[10px] text-muted-foreground ring-1 ring-border hover:text-foreground hover:bg-background/60 transition-colors"
                    >
                      Clear Done
                    </button>
                  )}
                </div>
              </div>

              <div className="divide-y divide-border/60">
                {filteredTodos.length ? (
                  filteredTodos.map((task) => (
                    <div
                      key={task.id}
                      className="group flex items-start justify-between gap-3 py-3 border-b border-border/40 last:border-0"
                    >
                      <div className="min-w-0 flex-1 flex items-start gap-3">
                        <SpringCheck
                          checked={task.completed}
                          onChange={() => toggleTodo(task.id)}
                          label=""
                          strike="none"
                          color="oklch(0.83 0.075 351)"
                          fillColor="oklch(0.46 0.13 353)"
                          checkColor="#ffffff"
                          boxSize={22}
                          boxRadius={7}
                          bounce={0.25}
                          ariaLabel={`Toggle task: ${task.text}`}
                          className="shrink-0 mt-0.5"
                        />
                        <div
                          onClick={() => toggleTodo(task.id)}
                          className="min-w-0 flex-1 flex flex-col gap-1 cursor-pointer select-none"
                        >
                          <span
                            className={`text-sm font-medium break-words transition-all duration-300 ${
                              task.completed
                                ? "line-through decoration-primary/80 decoration-2 text-muted-foreground/60 opacity-60"
                                : "text-foreground hover:text-foreground/90"
                            }`}
                          >
                            {task.text}
                          </span>
                          <div className="flex items-center gap-2 font-mono text-[9.5px] text-muted-foreground">
                            {task.category && (
                              <span className="rounded bg-primary/15 px-1.5 py-0.5 ring-1 ring-border">
                                #{task.category}
                              </span>
                            )}
                            <span>
                              {new Date(task.createdAt).toLocaleDateString(undefined, {
                                month: "short",
                                day: "numeric",
                              })}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0 self-start mt-0.5">

                        <span
                          className={`rounded px-2 py-0.5 font-mono text-[9px] uppercase font-bold ring-1 ${
                            task.priority === "high"
                              ? "bg-rose-500/20 text-rose-300 ring-rose-500/40"
                              : task.priority === "medium"
                              ? "bg-primary/20 text-primary-foreground ring-primary/40"
                              : "bg-muted/40 text-muted-foreground ring-border"
                          }`}
                        >
                          {task.priority}
                        </span>

                        <button
                          onClick={() => deleteTodo(task.id)}
                          className="icon-control size-6 opacity-60 group-hover:opacity-100 transition-opacity"
                          aria-label="Delete task"
                          title="Delete task"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="py-12 text-center font-mono text-xs text-muted-foreground italic">
                    {todos.length ? "No tasks match your filter/search criteria." : "No tasks added yet — create your first task above!"}
                  </div>
                )}
              </div>
            </section>
          </div>
        )}
      </div>

      {/* Floating Glassmorphic 4-Tab Bottom Navigation Bar */}
      <BottomBar active={activeTab} setActive={setActiveTab} />

      {/* Settings Modal */}
      {settingsOpen && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-overlay p-4"
          role="presentation"
          onMouseDown={() => setSettingsOpen(false)}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
            onMouseDown={(event) => event.stopPropagation()}
            className="panel w-full max-w-md p-5 shadow-2xl"
          >
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
              <div>
                <h2 id="settings-title" className="font-display text-lg font-bold">
                  Settings
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">Your journal stays on this device.</p>
              </div>
              <button className="icon-control" onClick={() => setSettingsOpen(false)} aria-label="Close settings">
                <X size={16} />
              </button>
            </div>

            <div className="mt-5 grid gap-2 text-left">
              <button className="setting-control text-left" onClick={exportEntries}>
                <span className="text-left flex-1 min-w-0">Download backup</span>
                <Download size={15} className="shrink-0 ml-2" />
              </button>

              <button className="setting-control text-left" onClick={importEntries}>
                <span className="text-left flex-1 min-w-0">Import backup</span>
                <Upload size={15} className="shrink-0 ml-2" />
              </button>

              <button className="setting-control text-destructive text-left" onClick={clearExceptThisMonth}>
                <span className="text-left flex-1 min-w-0">Delete entries except this month</span>
                <Trash2 size={15} className="shrink-0 ml-2" />
              </button>

              <button
                className="setting-control text-destructive text-left"
                onClick={() => {
                  if (confirm("Delete ALL entries permanently?")) {
                    setEntries([]);
                    setSettingsOpen(false);
                  }
                }}
              >
                <span className="text-left flex-1 min-w-0">Delete every entry</span>
                <Trash2 size={15} className="shrink-0 ml-2" />
              </button>
            </div>
            <input type="file" ref={fileInputRef} accept=".json" className="hidden" onChange={handleFileInputChange} />
          </section>
        </div>
      )}
    </main>
  );
}