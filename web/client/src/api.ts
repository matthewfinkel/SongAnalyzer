import type { Song, FindResponse } from "./types.ts";

const BASE = "/api";

export async function fetchSongs(): Promise<Song[]> {
  const res = await fetch(`${BASE}/songs`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function searchSongs(q: string): Promise<Song[]> {
  const res = await fetch(`${BASE}/songs/search?q=${encodeURIComponent(q)}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchSong(id: number): Promise<Song> {
  const res = await fetch(`${BASE}/songs/${id}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function addSong(file: File): Promise<{ message: string }> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${BASE}/analyze/add`, { method: "POST", body: form });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function downloadSong(url: string): Promise<{ message: string }> {
  const res = await fetch(`${BASE}/analyze/download`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function findSimilar(file: File, n = 5): Promise<FindResponse & { source_path: string }> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${BASE}/analyze/find?n=${n}`, { method: "POST", body: form });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function findSimilarFromUrl(url: string, n = 5): Promise<FindResponse & { source_path: string }> {
  const res = await fetch(`${BASE}/analyze/find-from-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, n }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchGenreTags(): Promise<string[]> {
  const res = await fetch(`${BASE}/songs/genres`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function updateSongGenres(id: number, genres: string[]): Promise<{ genres: string[] }> {
  const res = await fetch(`${BASE}/songs/${id}/genres`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ genres }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteSong(id: number): Promise<{ message: string }> {
  const res = await fetch(`${BASE}/songs/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function addFromPath(filePath: string): Promise<{ message: string }> {
  const res = await fetch(`${BASE}/analyze/add-from-path`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filePath }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
