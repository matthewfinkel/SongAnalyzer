import { useState, useRef } from "react";
import { addSong, downloadSong } from "../api.ts";
import PlaylistImport from "./PlaylistImport.tsx";

type Mode = "upload" | "youtube" | "playlist";
type Status = "idle" | "loading" | "done" | "error";

export default function AddSong() {
  const [mode, setMode] = useState<Mode>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const handleUpload = async () => {
    if (!file) return;
    setStatus("loading");
    setMessage("");
    try {
      const res = await addSong(file);
      setMessage(res.message);
      setStatus("done");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
    } catch (e) {
      setMessage(String(e));
      setStatus("error");
    }
  };

  const handleDownload = async () => {
    if (!url.trim()) return;
    setStatus("loading");
    setMessage("");
    try {
      const res = await downloadSong(url.trim());
      setMessage(res.message);
      setStatus("done");
      setUrl("");
    } catch (e) {
      setMessage(String(e));
      setStatus("error");
    }
  };

  const isLoading = status === "loading";

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <div className="flex rounded-lg overflow-hidden border border-gray-700">
        {(["upload", "youtube", "playlist"] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => { setMode(m); setStatus("idle"); setMessage(""); }}
            className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
              mode === m
                ? "bg-indigo-600 text-white"
                : "bg-gray-800 text-gray-400 hover:text-white"
            }`}
          >
            {m === "upload" ? "Upload File" : m === "youtube" ? "YouTube URL" : "YouTube Playlist"}
          </button>
        ))}
      </div>

      {mode === "playlist" ? (
        <PlaylistImport />
      ) : mode === "upload" ? (
        <div className="space-y-4">
          <label className="block">
            <div
              className="border-2 border-dashed border-gray-700 hover:border-indigo-500 rounded-xl p-10 text-center cursor-pointer transition-colors"
              onClick={() => fileRef.current?.click()}
            >
              {file ? (
                <div>
                  <div className="text-white font-medium">{file.name}</div>
                  <div className="text-gray-400 text-sm mt-1">
                    {(file.size / 1024 / 1024).toFixed(1)} MB
                  </div>
                </div>
              ) : (
                <div>
                  <div className="text-4xl mb-3">🎵</div>
                  <div className="text-gray-300 font-medium">
                    Click to select an audio file
                  </div>
                  <div className="text-gray-500 text-sm mt-1">
                    MP3, WAV, FLAC, M4A, OGG supported
                  </div>
                </div>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".mp3,.wav,.flac,.ogg,.m4a,.aac,.wma,.opus"
              className="hidden"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setStatus("idle");
                setMessage("");
              }}
            />
          </label>

          <button
            onClick={handleUpload}
            disabled={!file || isLoading}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium py-3 rounded-xl transition-colors"
          >
            {isLoading ? "Analyzing & Adding…" : "Analyze & Add to Database"}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-2">
              YouTube URL
            </label>
            <input
              type="url"
              value={url}
              onChange={(e) => { setUrl(e.target.value); setStatus("idle"); setMessage(""); }}
              placeholder="https://www.youtube.com/watch?v=..."
              className="w-full bg-gray-800 border border-gray-700 focus:border-indigo-500 text-white placeholder-gray-600 rounded-lg px-4 py-3 focus:outline-none transition-colors"
            />
          </div>
          <button
            onClick={handleDownload}
            disabled={!url.trim() || isLoading}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium py-3 rounded-xl transition-colors"
          >
            {isLoading ? "Downloading & Analyzing…" : "Download & Add to Database"}
          </button>
        </div>
      )}

      {isLoading && (
        <div className="flex items-center gap-3 text-gray-400 text-sm">
          <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
          <span>
            {mode === "upload"
              ? "Analyzing audio features… this can take 30–60 seconds."
              : "Downloading then analyzing… this can take a minute or two."}
          </span>
        </div>
      )}

      {message && status !== "idle" && (
        <div
          className={`rounded-xl px-4 py-3 text-sm whitespace-pre-wrap font-mono ${
            status === "done"
              ? "bg-green-900/40 border border-green-700 text-green-300"
              : "bg-red-900/40 border border-red-700 text-red-300"
          }`}
        >
          {message}
        </div>
      )}
    </div>
  );
}
