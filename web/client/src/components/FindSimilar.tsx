import { useState, useRef } from "react";
import { findSimilar, findSimilarFromUrl, addFromPath } from "../api.ts";
import type { FindResponse, SimilarResult } from "../types.ts";
import { cleanTitle } from "../utils.ts";
import ComparisonModal from "./ComparisonModal.tsx";

type InputMode = "upload" | "youtube";
type AddStatus = "idle" | "loading" | "done" | "error";

interface FindResult extends FindResponse {
  source_path: string;
}

export default function FindSimilar() {
  const [mode, setMode] = useState<InputMode>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [n, setN] = useState(5);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<FindResult | null>(null);
  const [error, setError] = useState("");
  const [addStatus, setAddStatus] = useState<AddStatus>("idle");
  const [addMessage, setAddMessage] = useState("");
  const [selectedMatch, setSelectedMatch] = useState<SimilarResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setResult(null);
    setError("");
    setAddStatus("idle");
    setAddMessage("");
    setSelectedMatch(null);
  };

  const queryTitle =
    mode === "upload" && file
      ? file.name.replace(/\.[^.]+$/, "")
      : result?.source_path
      ? result.source_path.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "Query Song"
      : "Query Song";

  const handleFind = async () => {
    reset();
    setLoading(true);
    try {
      const data =
        mode === "upload" && file
          ? await findSimilar(file, n)
          : await findSimilarFromUrl(url.trim(), n);
      setResult(data as FindResult);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async () => {
    if (!result?.source_path) return;
    setAddStatus("loading");
    try {
      const res = await addFromPath(result.source_path);
      setAddMessage(res.message);
      setAddStatus("done");
    } catch (e) {
      setAddMessage(String(e));
      setAddStatus("error");
    }
  };

  const canFind =
    !loading && (mode === "upload" ? !!file : url.trim().length > 0);

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Mode toggle */}
      <div className="flex rounded-lg overflow-hidden border border-gray-700">
        {(["upload", "youtube"] as InputMode[]).map((m) => (
          <button
            key={m}
            onClick={() => { setMode(m); reset(); }}
            className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
              mode === m
                ? "bg-indigo-600 text-white"
                : "bg-gray-800 text-gray-400 hover:text-white"
            }`}
          >
            {m === "upload" ? "Upload File" : "YouTube URL"}
          </button>
        ))}
      </div>

      {/* Input area */}
      {mode === "upload" ? (
        <label
          className="block border-2 border-dashed border-gray-700 hover:border-indigo-500 rounded-xl p-8 text-center cursor-pointer transition-colors"
          onClick={() => fileRef.current?.click()}
        >
          {file ? (
            <div>
              <div className="text-white font-medium">{file.name}</div>
              <div className="text-gray-400 text-sm mt-1">
                {(file.size / 1024 / 1024).toFixed(1)} MB — click to change
              </div>
            </div>
          ) : (
            <div>
              <div className="text-4xl mb-3">🔍</div>
              <div className="text-gray-300 font-medium">
                Upload a song to find similar tracks
              </div>
              <div className="text-gray-500 text-sm mt-1">
                MP3, WAV, FLAC, M4A, OGG supported
              </div>
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".mp3,.wav,.flac,.ogg,.m4a,.aac,.wma,.opus"
            className="hidden"
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); reset(); }}
          />
        </label>
      ) : (
        <div>
          <label className="block text-sm text-gray-400 mb-2">YouTube URL</label>
          <input
            type="url"
            value={url}
            onChange={(e) => { setUrl(e.target.value); reset(); }}
            placeholder="https://www.youtube.com/watch?v=..."
            className="w-full bg-gray-800 border border-gray-700 focus:border-indigo-500 text-white placeholder-gray-600 rounded-lg px-4 py-3 focus:outline-none transition-colors"
          />
        </div>
      )}

      {/* Results count + find button */}
      <div className="flex items-center gap-4">
        <label className="text-sm text-gray-400 flex-shrink-0">Results:</label>
        <input
          type="range"
          min={1}
          max={20}
          value={n}
          onChange={(e) => setN(Number(e.target.value))}
          className="flex-1 accent-indigo-500"
        />
        <span className="text-white font-medium w-6 text-center">{n}</span>
      </div>

      <button
        onClick={handleFind}
        disabled={!canFind}
        className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium py-3 rounded-xl transition-colors"
      >
        {loading
          ? mode === "youtube"
            ? "Downloading & Analyzing…"
            : "Analyzing…"
          : "Find Similar Songs"}
      </button>

      {loading && (
        <div className="flex items-center gap-3 text-gray-400 text-sm">
          <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
          <span>
            {mode === "youtube"
              ? "Downloading then analyzing audio… this can take a minute or two."
              : "Analyzing audio features… this can take 30–60 seconds."}
          </span>
        </div>
      )}

      {error && (
        <div className="bg-red-900/40 border border-red-700 rounded-xl px-4 py-3 text-red-300 text-sm">
          {error}
        </div>
      )}

      {selectedMatch && result && (
        <ComparisonModal
          queryTitle={queryTitle}
          matchTitle={selectedMatch.title}
          queryVector={result.query_vector}
          matchVector={selectedMatch.vector}
          similarity={selectedMatch.similarity}
          onClose={() => setSelectedMatch(null)}
        />
      )}

      {result && (
        <div className="space-y-3">
          {/* Genre tags for query */}
          {result.query_genres.length > 0 && (
            <div className="flex items-center gap-2 text-sm text-gray-400 flex-wrap">
              <span>Detected genres:</span>
              {result.query_genres.map((g) => (
                <span key={g} className="text-xs text-indigo-400 bg-indigo-900/40 px-2 py-0.5 rounded-full border border-indigo-800">
                  {g}
                </span>
              ))}
            </div>
          )}

          {/* Add to database button */}
          {addStatus === "idle" && (
            <button
              onClick={handleAdd}
              className="w-full border border-green-700 hover:bg-green-900/30 text-green-400 font-medium py-2.5 rounded-xl transition-colors text-sm"
            >
              + Add this song to the database
            </button>
          )}
          {addStatus === "loading" && (
            <div className="flex items-center gap-3 text-gray-400 text-sm border border-gray-700 rounded-xl px-4 py-2.5">
              <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
              <span>Analyzing & adding…</span>
            </div>
          )}
          {(addStatus === "done" || addStatus === "error") && (
            <div className={`rounded-xl px-4 py-3 text-sm whitespace-pre-wrap font-mono ${
              addStatus === "done"
                ? "bg-green-900/40 border border-green-700 text-green-300"
                : "bg-red-900/40 border border-red-700 text-red-300"
            }`}>
              {addMessage}
            </div>
          )}

          {/* Results list */}
          {result.results.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              No matches found. Add more songs to the database first.
            </div>
          ) : (
            result.results.map((song, i) => (
              <div
                key={i}
                onClick={() => setSelectedMatch(song)}
                className="bg-gray-800 border border-gray-700 hover:border-indigo-600 rounded-xl px-5 py-4 space-y-2 cursor-pointer transition-colors group"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-gray-500 text-sm font-mono">#{i + 1}</span>
                      <span className="text-white font-medium truncate">
                        {cleanTitle(song.title)}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {song.bpm && (
                        <span className="text-xs text-amber-400 bg-amber-900/30 px-2 py-0.5 rounded-full border border-amber-800">
                          {Math.round(song.bpm)} BPM
                        </span>
                      )}
                      {song.genres.map((g) => (
                        <span key={g} className="text-xs text-indigo-400 bg-indigo-900/40 px-2 py-0.5 rounded-full border border-indigo-800">
                          {g}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-2xl font-bold text-white">
                      {(song.similarity * 100).toFixed(1)}%
                    </div>
                    <div className="text-xs text-gray-500">
                      acoustic {(song.acoustic_similarity * 100).toFixed(1)}%
                    </div>
                  </div>
                </div>
                <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${song.similarity * 100}%`,
                      background: `hsl(${song.similarity * 120}, 70%, 50%)`,
                    }}
                  />
                </div>
                <div className="text-xs text-gray-600 group-hover:text-indigo-400 transition-colors text-right">
                  Click to see why →
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
