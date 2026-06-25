import json
import sqlite3
import numpy as np
from pathlib import Path
from typing import List, Tuple

_SEED_SQL = Path(__file__).parent / "sql" / "seed_genres.sql"


class SongDatabase:
    def __init__(self, db_path: str):
        self.db_path = db_path
        self._init_schema()

    def _conn(self) -> sqlite3.Connection:
        return sqlite3.connect(self.db_path)

    def _init_schema(self):
        with self._conn() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS songs (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    file_path   TEXT UNIQUE NOT NULL,
                    title       TEXT NOT NULL,
                    vector      BLOB NOT NULL,
                    genres      TEXT NOT NULL DEFAULT '[]',
                    bpm         REAL,
                    added_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            cols = [r[1] for r in conn.execute("PRAGMA table_info(songs)").fetchall()]
            if "genres" not in cols:
                conn.execute("ALTER TABLE songs ADD COLUMN genres TEXT NOT NULL DEFAULT '[]'")
            if "bpm" not in cols:
                conn.execute("ALTER TABLE songs ADD COLUMN bpm REAL")

            # Genre tag vocabulary — always sourced from the seed SQL file
            if _SEED_SQL.exists():
                conn.executescript(_SEED_SQL.read_text())

    def add(self, file_path: str, title: str, vector: np.ndarray,
            genres: list[str] | None = None, bpm: float | None = None) -> bool:
        """Insert a song. Returns False if the path already exists."""
        genres_json = json.dumps(genres or [])
        try:
            with self._conn() as conn:
                conn.execute(
                    "INSERT INTO songs (file_path, title, vector, genres, bpm) VALUES (?, ?, ?, ?, ?)",
                    (file_path, title, vector.astype(np.float32).tobytes(), genres_json, bpm),
                )
            return True
        except sqlite3.IntegrityError:
            return False

    def get_genre_tags(self) -> List[str]:
        """Return all canonical genre tag names in alphabetical order."""
        with self._conn() as conn:
            rows = conn.execute("SELECT name FROM genre_tags ORDER BY name").fetchall()
        return [r[0] for r in rows]

    def update_genres(self, file_path: str, genres: list[str]) -> bool:
        with self._conn() as conn:
            c = conn.execute(
                "UPDATE songs SET genres = ? WHERE file_path = ?",
                (json.dumps(genres), file_path),
            )
            return c.rowcount > 0

    def update_genres_by_id(self, song_id: int, genres: list[str]) -> bool:
        with self._conn() as conn:
            c = conn.execute(
                "UPDATE songs SET genres = ? WHERE id = ?",
                (json.dumps(genres), song_id),
            )
            return c.rowcount > 0

    def update_bpm(self, file_path: str, bpm: float | None) -> bool:
        with self._conn() as conn:
            c = conn.execute(
                "UPDATE songs SET bpm = ? WHERE file_path = ?",
                (bpm, file_path),
            )
            return c.rowcount > 0

    def get_all(self) -> List[Tuple[int, str, str, np.ndarray, list, float | None]]:
        """Return all rows as (id, file_path, title, vector, genres, bpm)."""
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT id, file_path, title, vector, genres, bpm FROM songs ORDER BY added_at"
            ).fetchall()
        return [
            (r[0], r[1], r[2], np.frombuffer(r[3], dtype=np.float32), json.loads(r[4]), r[5])
            for r in rows
        ]

    def get_all_paths(self) -> List[Tuple[str, float | None]]:
        """Return (file_path, bpm) for every song — used for backfill."""
        with self._conn() as conn:
            return conn.execute("SELECT file_path, bpm FROM songs").fetchall()

    def count(self) -> int:
        with self._conn() as conn:
            return conn.execute("SELECT COUNT(*) FROM songs").fetchone()[0]

    def remove(self, file_path: str) -> bool:
        with self._conn() as conn:
            c = conn.execute("DELETE FROM songs WHERE file_path = ?", (file_path,))
            return c.rowcount > 0

    def exists(self, file_path: str) -> bool:
        with self._conn() as conn:
            return (
                conn.execute(
                    "SELECT 1 FROM songs WHERE file_path = ?", (file_path,)
                ).fetchone()
                is not None
            )
