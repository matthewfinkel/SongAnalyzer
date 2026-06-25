import { useState, useRef, useEffect } from "react";

type Phase = "idle" | "fetching" | "running" | "done" | "cancelled" | "error";

interface VideoEntry {
  id: string;
  title: string;
  status: "pending" | "downloading" | "analyzing" | "added" | "skipped" | "error";
  error?: string;
}

interface Summary {
  added: number;
  skipped: number;
  failed: number;
}

// Maps a status to a fixed-width icon element
function StatusIcon({ status }: { status: VideoEntry["status"] }) {
  switch (status) {
    case "added":
      return <span className="text-emerald-400 font-bold">✓</span>;
    case "skipped":
      return <span className="text-gray-500">−</span>;
    case "error":
      return <span className="text-red-400 font-bold">✕</span>;
    case "downloading":
    case "analyzing":
      return (
        <span
          className={`inline-block w-3 h-3 border-2 rounded-full animate-spin border-t-transparent ${
            status === "downloading" ? "border-indigo-400" : "border-amber-400"
          }`}
        />
      );
    default:
      return <span className="text-gray-700">○</span>;
  }
}

function statusLabel(status: VideoEntry["status"]) {
  switch (status) {
    case "downloading": return "Downloading…";
    case "analyzing":   return "Analyzing…";
    case "added":       return "Added";
    case "skipped":     return "Already in library";
    case "error":       return "Failed";
    default:            return "";
  }
}

export default function PlaylistImport() {
  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [videos, setVideos] = useState<VideoEntry[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [removedCount, setRemovedCount] = useState(0);
  const jobIdRef = useRef("");
  const currentRowRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll the active video into view
  useEffect(() => {
    currentRowRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [currentIndex]);

  const handleStart = async () => {
    const trimmed = url.trim();
    if (!trimmed) return;

    setPhase("fetching");
    setVideos([]);
    setSummary(null);
    setErrorMsg("");
    setRemovedCount(0);
    setCurrentIndex(-1);
    jobIdRef.current = "";

    let res: Response;
    try {
      res = await fetch("/api/analyze/playlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed }),
      });
    } catch (e) {
      setPhase("error");
      setErrorMsg(String(e));
      return;
    }

    if (!res.ok || !res.body) {
      setPhase("error");
      setErrorMsg("Could not connect to server");
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const onEvent = (event: Record<string, unknown>) => {
      switch (event.type) {
        case "job":
          jobIdRef.current = event.jobId as string;
          break;
        case "fetching":
          setPhase("fetching");
          break;
        case "playlist": {
          const vids = event.videos as { id: string; title: string }[];
          setVideos(vids.map((v) => ({ ...v, status: "pending" })));
          setPhase("running");
          break;
        }
        case "progress": {
          const idx = event.index as number;
          const step = event.step as string;
          setCurrentIndex(idx);
          setVideos((prev) =>
            prev.map((v, i) =>
              i === idx
                ? { ...v, status: step === "downloading" ? "downloading" : "analyzing" }
                : v
            )
          );
          break;
        }
        case "result": {
          const idx = event.index as number;
          setVideos((prev) =>
            prev.map((v, i) =>
              i === idx
                ? {
                    ...v,
                    status: event.status as VideoEntry["status"],
                    error: event.error as string | undefined,
                  }
                : v
            )
          );
          break;
        }
        case "cancelled":
          setRemovedCount(event.removed as number);
          setPhase("cancelled");
          break;
        case "complete":
          setSummary({
            added: event.added as number,
            skipped: event.skipped as number,
            failed: event.failed as number,
          });
          setPhase("done");
          break;
        case "error":
          setErrorMsg(event.error as string);
          setPhase("error");
          break;
      }
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          for (const line of part.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            try { onEvent(JSON.parse(line.slice(6))); } catch {}
          }
        }
      }
    } catch {}

    // If stream ended without a terminal event (server crash etc.)
    setPhase((p) => (p === "running" || p === "fetching" ? "error" : p));
    setErrorMsg((m) => m || "Connection to server lost");
  };

  const handleCancel = async () => {
    if (!jobIdRef.current) return;
    try {
      await fetch("/api/analyze/playlist/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: jobIdRef.current }),
      });
    } catch {}
    // Server will emit the 'cancelled' event and close the stream
  };

  const handleReset = () => {
    setPhase("idle");
    setVideos([]);
    setSummary(null);
    setErrorMsg("");
    setRemovedCount(0);
    setCurrentIndex(-1);
    setUrl("");
  };

  const doneCount = videos.filter((v) => ["added", "skipped", "error"].includes(v.status)).length;
  const progressPct = videos.length > 0 ? (doneCount / videos.length) * 100 : 0;

  // -------------------------------------------------------------------------
  // Idle / error
  // -------------------------------------------------------------------------
  if (phase === "idle" || phase === "error") {
    return (
      <div className="space-y-4">
        <div>
          <label className="block text-sm text-gray-400 mb-2">YouTube Playlist URL</label>
          <input
            type="url"
            value={url}
            onChange={(e) => { setUrl(e.target.value); setErrorMsg(""); }}
            placeholder="https://www.youtube.com/playlist?list=..."
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

  // -------------------------------------------------------------------------
  // Fetching playlist info
  // -------------------------------------------------------------------------
  if (phase === "fetching") {
    return (
      <div className="flex flex-col items-center gap-4 py-12 text-center">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        <div className="text-gray-300 font-medium">Fetching playlist info…</div>
        <div className="text-gray-500 text-sm">Reading video list from YouTube</div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Done
  // -------------------------------------------------------------------------
  if (phase === "done" && summary) {
    return (
      <div className="space-y-4">
        <div className="bg-green-900/30 border border-green-700 rounded-2xl px-6 py-5">
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
        <VideoList videos={videos} currentIndex={-1} currentRowRef={currentRowRef} />
        <button
          onClick={handleReset}
          className="w-full border border-gray-700 hover:border-indigo-600 text-gray-300 hover:text-white font-medium py-2.5 rounded-xl transition-colors text-sm"
        >
          Import Another Playlist
        </button>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Cancelled
  // -------------------------------------------------------------------------
  if (phase === "cancelled") {
    return (
      <div className="space-y-4">
        <div className="bg-gray-800 border border-gray-600 rounded-2xl px-6 py-5">
          <div className="text-gray-200 font-semibold mb-1">Import cancelled</div>
          <div className="text-gray-400 text-sm">
            {removedCount > 0
              ? `${removedCount} song${removedCount !== 1 ? "s" : ""} that were added during this session have been removed from the database.`
              : "No songs were added before cancellation."}
          </div>
        </div>
        <VideoList videos={videos} currentIndex={-1} currentRowRef={currentRowRef} />
        <button
          onClick={handleReset}
          className="w-full border border-gray-700 hover:border-indigo-600 text-gray-300 hover:text-white font-medium py-2.5 rounded-xl transition-colors text-sm"
        >
          Start Over
        </button>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Running
  // -------------------------------------------------------------------------
  return (
    <div className="space-y-4">
      {/* Progress header */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-300">
          <span className="font-semibold text-white">{doneCount}</span>
          <span className="text-gray-500"> / {videos.length} songs</span>
        </div>
        <button
          onClick={handleCancel}
          className="text-xs text-red-400 hover:text-red-300 border border-red-800 hover:border-red-600 px-4 py-1.5 rounded-lg transition-colors"
        >
          Cancel Import
        </button>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
        <div
          className="h-full bg-indigo-500 rounded-full transition-all duration-300"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      <VideoList videos={videos} currentIndex={currentIndex} currentRowRef={currentRowRef} />
    </div>
  );
}

// -------------------------------------------------------------------------
// Shared video list
// -------------------------------------------------------------------------
function VideoList({
  videos,
  currentIndex,
  currentRowRef,
}: {
  videos: VideoEntry[];
  currentIndex: number;
  currentRowRef: React.MutableRefObject<HTMLDivElement | null>;
}) {
  if (videos.length === 0) return null;

  return (
    <div className="max-h-96 overflow-y-auto rounded-xl border border-gray-700 divide-y divide-gray-800">
      {videos.map((video, i) => {
        const isCurrent = i === currentIndex;
        return (
          <div
            key={video.id}
            ref={isCurrent ? (el) => { currentRowRef.current = el; } : undefined}
            className={`flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
              isCurrent ? "bg-gray-800" : "bg-gray-900"
            }`}
          >
            <div className="w-4 flex justify-center flex-shrink-0">
              <StatusIcon status={video.status} />
            </div>
            <div className="flex-1 min-w-0">
              <span
                className={`truncate block ${
                  video.status === "added"
                    ? "text-white"
                    : video.status === "error"
                    ? "text-red-300"
                    : video.status === "skipped"
                    ? "text-gray-500"
                    : isCurrent
                    ? "text-indigo-300"
                    : "text-gray-500"
                }`}
              >
                {video.title}
              </span>
              {video.error && (
                <span className="text-xs text-red-500 truncate block">{video.error}</span>
              )}
            </div>
            <div className="text-xs text-gray-600 flex-shrink-0 w-28 text-right">
              {statusLabel(video.status)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
