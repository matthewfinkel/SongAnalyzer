import initSqlJs from "sql.js";
import fs from "fs";
import os from "os";
import path from "path";

const DB_PATH =
  process.env.DB_PATH ?? path.join(os.homedir(), ".audio_analyzer.db");

export interface SongRow {
  id: number;
  file_path: string;
  title: string;
  genres: string[];
  bpm: number | null;
  added_at: string;
  vector?: number[];
}

async function openDb() {
  const SQL = await initSqlJs();
  const buf = fs.readFileSync(DB_PATH);
  return new SQL.Database(buf);
}

function rowsToSongs(
  result: { columns: string[]; values: (string | number | Uint8Array | null)[][] },
  includeVector = false
): SongRow[] {
  const cols = result.columns;
  return result.values.map((row) => {
    const obj: Record<string, unknown> = {};
    cols.forEach((c, i) => (obj[c] = row[i]));

    const genres: string[] = JSON.parse((obj.genres as string) ?? "[]");
    const out: SongRow = {
      id: obj.id as number,
      file_path: obj.file_path as string,
      title: obj.title as string,
      genres,
      bpm: (obj.bpm as number | null) ?? null,
      added_at: obj.added_at as string,
    };

    if (includeVector && obj.vector instanceof Uint8Array) {
      const buf = obj.vector.buffer.slice(
        obj.vector.byteOffset,
        obj.vector.byteOffset + obj.vector.byteLength
      );
      out.vector = Array.from(new Float32Array(buf));
    }

    return out;
  });
}

export async function getAllSongs(): Promise<SongRow[]> {
  const db = await openDb();
  try {
    const [result] = db.exec(
      "SELECT id, file_path, title, genres, bpm, added_at FROM songs ORDER BY added_at DESC"
    );
    return result ? rowsToSongs(result) : [];
  } finally {
    db.close();
  }
}

export async function getSongById(id: number): Promise<SongRow | null> {
  const db = await openDb();
  try {
    const stmt = db.prepare(
      "SELECT id, file_path, title, genres, bpm, added_at, vector FROM songs WHERE id = ?"
    );
    stmt.bind([id]);
    if (!stmt.step()) return null;
    const row = stmt.getAsObject() as Record<string, unknown>;
    stmt.free();

    const genres: string[] = JSON.parse((row.genres as string) ?? "[]");
    let vector: number[] | undefined;
    if (row.vector instanceof Uint8Array) {
      const buf = row.vector.buffer.slice(
        row.vector.byteOffset,
        row.vector.byteOffset + row.vector.byteLength
      );
      vector = Array.from(new Float32Array(buf));
    }

    return {
      id: row.id as number,
      file_path: row.file_path as string,
      title: row.title as string,
      genres,
      bpm: (row.bpm as number | null) ?? null,
      added_at: row.added_at as string,
      vector,
    };
  } finally {
    db.close();
  }
}

export async function getGenreTags(): Promise<string[]> {
  const db = await openDb();
  try {
    const [result] = db.exec("SELECT name FROM genre_tags ORDER BY name");
    return result ? (result.values.map((r) => r[0] as string)) : [];
  } finally {
    db.close();
  }
}

export async function updateSongGenres(id: number, genres: string[]): Promise<boolean> {
  const SQL = await initSqlJs();
  const buf = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(buf);
  try {
    db.run("UPDATE songs SET genres = ? WHERE id = ?", [JSON.stringify(genres), id]);
    const changed = db.getRowsModified() > 0;
    if (changed) fs.writeFileSync(DB_PATH, db.export());
    return changed;
  } finally {
    db.close();
  }
}

export async function getMaxSongId(): Promise<number> {
  const db = await openDb();
  try {
    const [result] = db.exec("SELECT COALESCE(MAX(id), 0) FROM songs");
    return (result?.values?.[0]?.[0] as number) ?? 0;
  } finally {
    db.close();
  }
}

export async function deleteSongsAfter(minId: number): Promise<number> {
  const SQL = await initSqlJs();
  const buf = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(buf);
  try {
    db.run("DELETE FROM songs WHERE id > ?", [minId]);
    const count = db.getRowsModified();
    fs.writeFileSync(DB_PATH, db.export());
    return count;
  } finally {
    db.close();
  }
}

export async function deleteSong(id: number): Promise<boolean> {
  const SQL = await initSqlJs();
  const buf = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(buf);
  try {
    const before = db.exec("SELECT COUNT(*) FROM songs WHERE id = ?", [id]);
    const count = before[0]?.values?.[0]?.[0] as number ?? 0;
    if (count === 0) return false;
    db.run("DELETE FROM songs WHERE id = ?", [id]);
    fs.writeFileSync(DB_PATH, db.export());
    return true;
  } finally {
    db.close();
  }
}

export async function searchSongs(query: string): Promise<SongRow[]> {
  const db = await openDb();
  try {
    const stmt = db.prepare(
      "SELECT id, file_path, title, genres, added_at FROM songs WHERE title LIKE ? ORDER BY added_at DESC"
    );
    stmt.bind([`%${query}%`]);
    const rows: SongRow[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as Record<string, unknown>;
      rows.push({
        id: row.id as number,
        file_path: row.file_path as string,
        title: row.title as string,
        genres: JSON.parse((row.genres as string) ?? "[]"),
        bpm: (row.bpm as number | null) ?? null,
        added_at: row.added_at as string,
      });
    }
    stmt.free();
    return rows;
  } finally {
    db.close();
  }
}
