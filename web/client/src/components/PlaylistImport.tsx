import { useState, useRef } from "react";

type Phase = "idle" | "fetching" | "running" | "done" | "cancelled" | "error";
type SongStatus = "queued" | "downloading" | "analyzing" | "added" | "skipped" | "failed";

interface SongState {
  id: string;
  title: string;
  status: SongStatus;
}

interface Summary { added: number; skipped: number; failed: number }

// ── Status icon ───────────────────────────────────────────────────────────────
function StatusIcon({ status }: { status: SongStatus }) {
  if (status === "queued") {
    return <span className="w-4 h-4 rounded-full border border-gray-600 flex-shrink-0" />;
  }
  if (status === "downloading") {
    return (
      <span className="w-4 h-4 flex-shrink-0 flex items-center justify-center">
        <span className="w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
      </span>
    );
  }
  if (status === "analyzing") {
    return (
      <span className="w-4 h-4 flex-shrink-0 flex items-center justify-center">
        <span className="w-3 h-3 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />
      </span>
    );
  }
  if (status === "added") {
    return (
      <svg className="w-4 h-4 text-emerald-400 flex-shrink-0" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
        <path d="M5 8l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (status === "skipped") {
    return (
      <svg className="w-4 h-4 text-gray-500 flex-shrink-0" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
        <path d="M5.5 8h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  // failed
  return (
    <svg className="w-4 h-4 text-red-400 flex-shrink-0" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 6l4 4M10 6l-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

// ── Status label ──────────────────────────────────────────────────────────────
const STATUS_LABEL: Record<SongStatus, string> = {
  queued:      "queued",
  downloading: "downloading…",
  analyzing:   "analyzing…",
  added:       "added",
  skipped:     "already in library",
  failed:      "failed",
};

const STATUS_COLOR: Record<SongStatus, string> = {
  queued:      "text-gray-600",
  downloading: "text-indigo-400",
  analyzing:   "text-yellow-400",
  added:       "text-emerald-400",
  skipped:     "text-gray-500",
  failed:      "text-red-400",
};

// ── Main component ────────────────────────────────────────────────────────────
export default function PlaylistImport() {
  const [url, setUrl]           = useState("");
  const [phase, setPhase]       = useState<Phase>("idle");
  const [songs, setSongs]       = useState<SongState[]>([]);
  const [summary, setSummary]   = useState<Summary | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  const abortRef = useRef<AbortController | null>(null);
  const jobIdRef = useRef("");

  const handleStart = async () => {
    const trimmed = url.trim();
    if (!trimmed) return;

    setSummary(null);
    setErrorMsg("");
    setSongs([]);
    jobIdRef.current = "";
    setPhase("fetching");

    const abort = new AbortController();
    abortRef.current = abort;

    let res: Response;
    try {
      res = await fetch("/api/analyze/playlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed }),
        signal: abort.signal,
      });
    } catch (e: unknown) {
      if ((e as DOMException).name === "AbortError") return;
      setPhase("error");
      setErrorMsg(String(e));
      return;
    }

    if (!res.ok || !res.body) {
      setPhase("error");
      setErrorMsg("Could not connect to server.");
      return;
    }

    setPhase("running");

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let   buffer  = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          let evt: Record<string, unknown>;
          try { evt = JSON.parse(line.slice(6)); } catch { continue; }

          if (evt.type === "job") {
            jobIdRef.current = evt.jobId as string;

          } else if (evt.type === "playlist") {
            const videos = evt.videos as { id: string; title: string }[];
            setSongs(videos.map(v => ({ id: v.id, title: v.title, status: "queued" })));

          } else if (evt.type === "song_status") {
            const id     = evt.id     as string;
            const status = evt.status as SongStatus;
            setSongs(prev => prev.map(s => s.id === id ? { ...s, status } : s));

          } else if (evt.type === "complete") {
            setSummary({
              added:   evt.added   as number,
              skipped: evt.skipped as number,
              failed:  evt.failed  as number,
            });
            setPhase("done");

          } else if (evt.type === "error") {
            setErrorMsg(evt.error as string);
            setPhase("error");
          }
        }
      }
    } catch (e: unknown) {
      if ((e as DOMException).name === "AbortError") return;
      setPhase("error");
      setErrorMsg("Connection to server lost.");
    }
  };

  const handleCancel = () => {
    abortRef.current?.abort();
    setPhase("cancelled");
    const jid = jobIdRef.current;
    if (jid) {
      fetch("/api/analyze/playlist/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: jid }),
      }).catch(() => {});
    }
  };

  const handleReset = () => {
    abortRef.current = null;
    jobIdRef.current = "";
    setUrl("");
    setSongs([]);
    setSummary(null);
    setErrorMsg("");
    setPhase("idle");
  };

  // ── Idle / error ──────────────────────────────────────────────────
  if (phase === "idle" || phase === "error") {
    return (
      <div className="space-y-4">
        <div>
          <label className="block text-sm text-gray-400 mb-2">YouTube Playlist URL</label>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleStart(); }}
            placeholder="https://www.youtube.com/playlist?list=…"
            className="w-full bg-gray-800 border border-gray-700 focus:border-indigo-500 text-white placeholder-gray-600 rounded-lg px-4 py-3 focus:outline-none transition-colors"
          />
        </div>

        {errorMsg && (
          <div className="bg-red-900/40 border border-red-700 rounded-xl px-4 py-3 text-red-300 text-sm">
            {errorMsg}
          </div>
        )}

        <button
          onClick={handleStart}
          disabled={!url.trim()}
          className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium py-3 rounded-xl transition-colors"
        >
          Import Playlist
        </button>

        <p className="text-xs text-gray-600 text-center">
          Every song in the playlist will be downloaded, analyzed, and added to your database.
        </p>
      </div>
    );
  }

  // ── Fetching ──────────────────────────────────────────────────────
  if (phase === "fetching") {
    return (
      <div className="flex flex-col items-center gap-4 py-8 text-center">
        <div className="w-10 h-10 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        <div className="text-gray-300 font-medium">Fetching playlist…</div>
        <div className="text-gray-500 text-sm">Reading video list from YouTube</div>
      </div>
    );
  }

  // ── Running ───────────────────────────────────────────────────────
  if (phase === "running") {
    const active  = songs.filter(s => s.status === "downloading" || s.status === "analyzing");
    const done    = songs.filter(s => s.status === "added" || s.status === "skipped" || s.status === "failed");
    const queued  = songs.filter(s => s.status === "queued");

    return (
      <div className="space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-2 text-gray-300">
            <span className="w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
            <span>Importing {songs.length} song{songs.length !== 1 ? "s" : ""}…</span>
          </div>
          <span className="text-gray-500 tabular-nums">
            {done.length} / {songs.length}
          </span>
        </div>

        {/* Song list */}
        <div className="max-h-72 overflow-y-auto rounded-xl border border-gray-700/60 divide-y divide-gray-700/40">
          {/* Active first */}
          {active.map(song => (
            <div key={song.id} className="flex items-center gap-3 px-3 py-2 bg-gray-800/80">
              <StatusIcon status={song.status} />
              <span className="flex-1 text-sm text-white truncate">{song.title}</span>
              <span className={`text-xs ${STATUS_COLOR[song.status]} flex-shrink-0`}>
                {STATUS_LABEL[song.status]}
              </span>
            </div>
          ))}
          {/* Queued */}
          {queued.map(song => (
            <div key={song.id} className="flex items-center gap-3 px-3 py-2">
              <StatusIcon status="queued" />
              <span className="flex-1 text-sm text-gray-500 truncate">{song.title}</span>
              <span className="text-xs text-gray-700 flex-shrink-0">queued</span>
            </div>
          ))}
          {/* Done */}
          {done.map(song => (
            <div key={song.id} className="flex items-center gap-3 px-3 py-2">
              <StatusIcon status={song.status} />
              <span className="flex-1 text-sm text-gray-400 truncate">{song.title}</span>
              <span className={`text-xs ${STATUS_COLOR[song.status]} flex-shrink-0`}>
                {STATUS_LABEL[song.status]}
              </span>
            </div>
          ))}
        </div>

        <button
          onClick={handleCancel}
          className="w-full text-sm text-red-400 hover:text-red-300 border border-red-800 hover:border-red-600 py-2.5 rounded-xl transition-colors"
        >
          Cancel Import
        </button>
      </div>
    );
  }

  // ── Done ──────────────────────────────────────────────────────────
  if (phase === "done" && summary) {
    const failedSongs = songs.filter(s => s.status === "failed");

    return (
      <div className="space-y-4">
        <div className="bg-green-900/20 border border-green-700/60 rounded-2xl px-6 py-5">
          <div className="text-green-300 font-semibold text-lg mb-3">Import complete</div>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-3xl font-bold text-emerald-400">{summary.added}</div>
              <div className="text-xs text-gray-400 mt-1">Added</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-gray-400">{summary.skipped}</div>
              <div className="text-xs text-gray-400 mt-1">Already in library</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-red-400">{summary.failed}</div>
              <div className="text-xs text-gray-400 mt-1">Failed</div>
            </div>
          </div>
        </div>

        {failedSongs.length > 0 && (
          <div className="bg-red-900/20 border border-red-800/60 rounded-2xl px-4 py-3">
            <div className="text-red-400 text-xs font-semibold uppercase tracking-wide mb-2">
              Failed to import
            </div>
            <ul className="space-y-1">
              {failedSongs.map(s => (
                <li key={s.id} className="flex items-center gap-2 text-sm text-red-300">
                  <svg className="w-3.5 h-3.5 text-red-500 flex-shrink-0" viewBox="0 0 12 12" fill="none">
                    <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2" />
                    <path d="M4 4l4 4M8 4l-4 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                  <span className="truncate">{s.title}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <button
          onClick={handleReset}
          className="w-full border border-gray-700 hover:border-indigo-600 text-gray-300 hover:text-white font-medium py-2.5 rounded-xl transition-colors text-sm"
        >
          Import Another Playlist
        </button>
      </div>
    );
  }

  // ── Cancelled ─────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <div className="bg-gray-800/60 border border-gray-600 rounded-2xl px-6 py-5">
        <div className="text-gray-200 font-semibold mb-1">Import stopped</div>
        <div className="text-gray-400 text-sm">
          Songs added before cancellation have been kept in your library.
        </div>
      </div>
      <button
        onClick={handleReset}
        className="w-full border border-gray-700 hover:border-indigo-600 text-gray-300 hover:text-white font-medium py-2.5 rounded-xl transition-colors text-sm"
      >
        Start Over
      </button>
    </div>
  );
}
