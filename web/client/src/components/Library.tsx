import { useEffect, useState, useCallback } from "react";
import { fetchSongs, searchSongs } from "../api.ts";
import type { Song } from "../types.ts";
import SongDetail from "./SongDetail.tsx";
import { cleanTitle } from "../utils.ts";

export default function Library() {
  const [songs, setSongs] = useState<Song[]>([]);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (q: string) => {
    setLoading(true);
    setError("");
    try {
      const results = q.trim() ? await searchSongs(q) : await fetchSongs();
      setSongs(results);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load("");
  }, [load]);

  useEffect(() => {
    const t = setTimeout(() => load(query), 300);
    return () => clearTimeout(t);
  }, [query, load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search songs…"
            className="w-full bg-gray-800 border border-gray-700 text-white placeholder-gray-500 rounded-lg px-4 py-2 pr-10 focus:outline-none focus:border-indigo-500 transition-colors"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
            >
              ✕
            </button>
          )}
        </div>
        <button
          onClick={() => load(query)}
          className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg transition-colors text-sm"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-900/40 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : songs.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          {query ? `No songs matching "${query}"` : "No songs in the database yet."}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="text-xs text-gray-500 px-1">
            {songs.length} song{songs.length !== 1 ? "s" : ""}
          </div>
          {songs.map((song) => (
            <button
              key={song.id}
              onClick={() => setSelectedId(song.id)}
              className="w-full text-left bg-gray-800 hover:bg-gray-750 border border-gray-700 hover:border-indigo-600 rounded-xl px-5 py-4 transition-all group"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="text-white font-medium truncate group-hover:text-indigo-300 transition-colors">
                    {cleanTitle(song.title)}
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {song.bpm && (
                      <span className="text-xs text-amber-400 bg-amber-900/30 px-2 py-0.5 rounded-full border border-amber-800">
                        {Math.round(song.bpm)} BPM
                      </span>
                    )}
                    {song.genres.length > 0 ? (
                      song.genres.map((g) => (
                        <span
                          key={g}
                          className="text-xs text-indigo-400 bg-indigo-900/40 px-2 py-0.5 rounded-full border border-indigo-800"
                        >
                          {g}
                        </span>
                      ))
                    ) : (
                      <span className="text-xs text-gray-600">No genre data</span>
                    )}
                  </div>
                </div>
                <div className="text-xs text-gray-500 whitespace-nowrap mt-0.5">
                  {new Date(song.added_at).toLocaleDateString()}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {selectedId !== null && (
        <SongDetail
          songId={selectedId}
          onClose={() => setSelectedId(null)}
          onDelete={() => { setSelectedId(null); load(query); }}
        />
      )}
    </div>
  );
}
