import { useCallback, useEffect, useRef, useState } from "react";
import { fetchSong, deleteSong, fetchGenreTags, updateSongGenres } from "../api.ts";
import type { Song } from "../types.ts";
import VectorViz from "./VectorViz.tsx";
import { cleanTitle } from "../utils.ts";

// ── Audio player ──────────────────────────────────────────────────────────────
function fmt(secs: number) {
  if (!isFinite(secs)) return "0:00";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function AudioPlayer({ songId }: { songId: number }) {
  const audioRef  = useRef<HTMLAudioElement>(null);
  const [playing,  setPlaying]  = useState(false);
  const [current,  setCurrent]  = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume,   setVolume]   = useState(1);

  const src = `/api/songs/${songId}/audio`;

  const toggle = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) { a.play(); } else { a.pause(); }
  }, []);

  const seek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = Number(e.target.value);
    setCurrent(Number(e.target.value));
  };

  const changeVolume = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    setVolume(v);
    if (audioRef.current) audioRef.current.volume = v;
  };

  // Stop playback when the card unmounts
  useEffect(() => () => { audioRef.current?.pause(); }, []);

  const progress = duration > 0 ? (current / duration) * 100 : 0;

  return (
    <div className="bg-gray-800/60 border border-gray-700 rounded-xl px-4 py-3 space-y-2">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={()       => setPlaying(true)}
        onPause={()      => setPlaying(false)}
        onEnded={()      => setPlaying(false)}
        onTimeUpdate={e  => setCurrent((e.target as HTMLAudioElement).currentTime)}
        onLoadedMetadata={e => setDuration((e.target as HTMLAudioElement).duration)}
      />

      {/* Play / pause + progress */}
      <div className="flex items-center gap-3">
        {/* Play / pause button */}
        <button
          onClick={toggle}
          className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-full bg-indigo-600 hover:bg-indigo-500 transition-colors"
        >
          {playing ? (
            /* Pause icon */
            <svg className="w-3.5 h-3.5 text-white" viewBox="0 0 12 12" fill="currentColor">
              <rect x="1" y="1" width="4" height="10" rx="1" />
              <rect x="7" y="1" width="4" height="10" rx="1" />
            </svg>
          ) : (
            /* Play icon */
            <svg className="w-3.5 h-3.5 text-white" viewBox="0 0 12 12" fill="currentColor">
              <path d="M2 1.5l9 4.5-9 4.5V1.5z" />
            </svg>
          )}
        </button>

        {/* Scrub bar */}
        <div className="flex-1 flex items-center gap-2">
          <span className="text-xs text-gray-500 tabular-nums w-8 text-right">{fmt(current)}</span>
          <div className="relative flex-1 h-1.5 rounded-full bg-gray-700">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-indigo-500 pointer-events-none"
              style={{ width: `${progress}%` }}
            />
            <input
              type="range"
              min={0}
              max={duration || 0}
              step={0.1}
              value={current}
              onChange={seek}
              className="absolute inset-0 w-full opacity-0 cursor-pointer"
            />
          </div>
          <span className="text-xs text-gray-500 tabular-nums w-8">{fmt(duration)}</span>
        </div>
      </div>

      {/* Volume */}
      <div className="flex items-center gap-2 pl-11">
        <svg className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" viewBox="0 0 16 16" fill="currentColor">
          <path d="M9 3.5v9a.5.5 0 01-.8.4L4.5 10H2a1 1 0 01-1-1V7a1 1 0 011-1h2.5l3.7-2.9A.5.5 0 019 3.5z"/>
          {volume > 0.5 && <path d="M11.5 5.5a3 3 0 010 5"/>}
          {volume > 0    && <path d="M13 3.5a6 6 0 010 9"/>}
        </svg>
        <div className="relative flex-1 h-1.5 rounded-full bg-gray-700 max-w-28">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-gray-500 pointer-events-none"
            style={{ width: `${volume * 100}%` }}
          />
          <input
            type="range"
            min={0}
            max={1}
            step={0.02}
            value={volume}
            onChange={changeVolume}
            className="absolute inset-0 w-full opacity-0 cursor-pointer"
          />
        </div>
        <span className="text-xs text-gray-600 tabular-nums w-7">{Math.round(volume * 100)}%</span>
      </div>
    </div>
  );
}

interface Props {
  songId: number;
  onClose: () => void;
  onDelete?: () => void;
}

// Build a display-name lookup from the genre_tags table (Title Case) keyed by lowercase
function buildDisplayMap(tags: string[]): Map<string, string> {
  return new Map(tags.map((t) => [t.toLowerCase(), t]));
}

function displayGenre(genre: string, displayMap: Map<string, string>): string {
  return displayMap.get(genre.toLowerCase()) ?? genre;
}

export default function SongDetail({ songId, onClose, onDelete }: Props) {
  const [song, setSong] = useState<Song | null>(null);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Genre editing
  const [genres, setGenres] = useState<string[]>([]);
  const [allGenreTags, setAllGenreTags] = useState<string[]>([]);
  const [displayMap, setDisplayMap] = useState<Map<string, string>>(new Map());
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [genreSearch, setGenreSearch] = useState("");
  const [savingGenres, setSavingGenres] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchSong(songId)
      .then((s) => { setSong(s); setGenres(s.genres ?? []); })
      .catch((e) => setError(String(e)));

    fetchGenreTags()
      .then((tags) => { setAllGenreTags(tags); setDisplayMap(buildDisplayMap(tags)); })
      .catch(() => {});
  }, [songId]);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!showAddMenu) return;
    const handler = (e: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setShowAddMenu(false);
        setGenreSearch("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showAddMenu]);

  // Focus search input when menu opens
  useEffect(() => {
    if (showAddMenu) searchInputRef.current?.focus();
  }, [showAddMenu]);

  const saveGenres = async (next: string[]) => {
    setSavingGenres(true);
    try {
      await updateSongGenres(songId, next);
    } catch {
      // Non-fatal — genres are already updated in UI
    } finally {
      setSavingGenres(false);
    }
  };

  const removeGenre = (genre: string) => {
    const next = genres.filter((g) => g !== genre);
    setGenres(next);
    saveGenres(next);
  };

  const addGenre = (tag: string) => {
    const stored = tag.toLowerCase();
    if (genres.includes(stored)) return;
    const next = [...genres, stored];
    setGenres(next);
    setShowAddMenu(false);
    setGenreSearch("");
    saveGenres(next);
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteSong(songId);
      onDelete?.();
      onClose();
    } catch (e) {
      setError(String(e));
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const availableGenres = allGenreTags.filter(
    (t) =>
      !genres.includes(t.toLowerCase()) &&
      t.toLowerCase().includes(genreSearch.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="bg-gray-900 rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="sticky top-0 bg-gray-900 border-b border-gray-700 flex items-center justify-between px-6 py-4 rounded-t-2xl gap-4">
          <h2 className="text-lg font-semibold text-white truncate">
            {song ? cleanTitle(song.title) : "Loading…"}
          </h2>
          <div className="flex items-center gap-3 flex-shrink-0">
            {song && !confirmDelete && (
              <button
                onClick={() => setConfirmDelete(true)}
                className="text-xs text-red-400 hover:text-red-300 border border-red-800 hover:border-red-600 px-3 py-1.5 rounded-lg transition-colors"
              >
                Delete
              </button>
            )}
            {confirmDelete && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-red-400">Remove from database?</span>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="text-xs bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg transition-colors"
                >
                  {deleting ? "Removing…" : "Confirm"}
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="text-xs text-gray-400 hover:text-white px-2 py-1.5 transition-colors"
                >
                  Cancel
                </button>
              </div>
            )}
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white transition-colors text-xl leading-none"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="px-6 py-4 space-y-6">
          {error && (
            <div className="bg-red-900/40 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm">
              {error}
            </div>
          )}

          {song && (
            <>
              <div className="grid grid-cols-2 gap-4 text-sm">
                {song.artist && (
                  <div>
                    <div className="text-gray-400 text-xs uppercase tracking-wide mb-1">Artist</div>
                    <div className="text-gray-100 font-medium">{song.artist}</div>
                  </div>
                )}
                {song.bpm && (
                  <div>
                    <div className="text-gray-400 text-xs uppercase tracking-wide mb-1">BPM</div>
                    <div className="text-amber-400 font-semibold text-lg">
                      {Math.round(song.bpm)}
                      <span className="text-gray-500 text-xs font-normal ml-1">
                        ({song.bpm.toFixed(1)})
                      </span>
                    </div>
                  </div>
                )}

                {/* Editable genres */}
                <div className={song.bpm || song.artist ? "" : "col-span-2"}>
                  <div className="text-gray-400 text-xs uppercase tracking-wide mb-2 flex items-center gap-2">
                    Genres
                    {savingGenres && (
                      <span className="text-indigo-500 text-xs normal-case tracking-normal">saving…</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1 items-center">
                    {genres.length === 0 && !showAddMenu && (
                      <span className="text-gray-500 text-xs">None — click + to add</span>
                    )}

                    {genres.map((g) => (
                      <span
                        key={g}
                        className="group relative inline-flex items-center bg-indigo-900/60 text-indigo-300 text-xs px-2 py-0.5 rounded-full border border-indigo-700 group-hover:border-red-700 cursor-default transition-colors"
                      >
                        {/* Text hides on hover but still defines the badge width */}
                        <span className="group-hover:invisible">
                          {displayGenre(g, displayMap)}
                        </span>
                        {/* × overlays the same space — no layout shift */}
                        <button
                          onClick={() => removeGenre(g)}
                          className="absolute inset-0 flex items-center justify-center invisible group-hover:visible rounded-full bg-red-900/50 border border-red-700 text-red-300 hover:text-red-100 hover:bg-red-800/60 transition-colors text-sm font-medium"
                          title="Remove genre"
                        >
                          ×
                        </button>
                      </span>
                    ))}

                    {/* Add genre button + dropdown */}
                    <div className="relative" ref={addMenuRef}>
                      <button
                        onClick={() => setShowAddMenu((v) => !v)}
                        className="inline-flex items-center justify-center w-5 h-5 text-gray-500 hover:text-white border border-gray-600 hover:border-indigo-500 rounded-full text-xs transition-colors leading-none"
                        title="Add genre"
                      >
                        +
                      </button>

                      {showAddMenu && (
                        <div className="absolute left-0 top-7 z-50 bg-gray-900 border border-gray-600 rounded-xl shadow-2xl w-52 overflow-hidden">
                          <div className="p-2 border-b border-gray-700">
                            <input
                              ref={searchInputRef}
                              value={genreSearch}
                              onChange={(e) => setGenreSearch(e.target.value)}
                              placeholder="Search genres…"
                              className="w-full bg-gray-800 text-white text-xs px-2 py-1.5 rounded-lg outline-none placeholder-gray-600"
                            />
                          </div>
                          <div className="max-h-48 overflow-y-auto">
                            {availableGenres.length === 0 ? (
                              <div className="text-xs text-gray-600 px-3 py-3 text-center">
                                {genreSearch ? "No matches" : "All genres already added"}
                              </div>
                            ) : (
                              availableGenres.map((tag) => (
                                <button
                                  key={tag}
                                  onClick={() => addGenre(tag)}
                                  className="w-full text-left text-xs px-3 py-2 text-gray-300 hover:bg-gray-800 hover:text-white transition-colors"
                                >
                                  {tag}
                                </button>
                              ))
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div>
                  <div className="text-gray-400 text-xs uppercase tracking-wide mb-1">Added</div>
                  <div className="text-gray-200">
                    {new Date(song.added_at).toLocaleDateString()}
                  </div>
                </div>
                <div className="col-span-2">
                  <div className="text-gray-400 text-xs uppercase tracking-wide mb-1">File</div>
                  <div className="text-gray-400 text-xs font-mono truncate">{
                    (() => {
                      const marker = "AudioAnalyzer/";
                      const idx = song.file_path.indexOf(marker);
                      return idx !== -1 ? song.file_path.slice(idx) : song.file_path;
                    })()
                  }</div>
                </div>
                {song.source_url && (
                  <div className="col-span-2">
                    <div className="text-gray-400 text-xs uppercase tracking-wide mb-1">Source</div>
                    <a
                      href={song.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-indigo-400 hover:text-indigo-300 text-xs truncate block transition-colors"
                    >
                      {song.source_url}
                    </a>
                  </div>
                )}

                <div className="col-span-2">
                  <div className="text-gray-400 text-xs uppercase tracking-wide mb-2">Preview</div>
                  <AudioPlayer songId={song.id} />
                </div>
              </div>

              {song.vector && song.vector.length > 0 ? (
                <div>
                  <h3 className="text-sm font-semibold text-gray-200 mb-3">
                    Feature Vector ({song.vector.length} dimensions)
                  </h3>
                  <VectorViz vector={song.vector} />
                </div>
              ) : (
                <div className="text-gray-500 text-sm">Vector not available.</div>
              )}
            </>
          )}

          {!song && !error && (
            <div className="flex justify-center py-12">
              <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
