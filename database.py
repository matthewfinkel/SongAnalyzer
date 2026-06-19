import sqlite3
import numpy as np
from pathlib import Path
from typing import List, Tuple


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
                    added_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

    def add(self, file_path: str, title: str, vector: np.ndarray) -> bool:
        """Insert a song. Returns False if the path already exists."""
        try:
            with self._conn() as conn:
                conn.execute(
                    "INSERT INTO songs (file_path, title, vector) VALUES (?, ?, ?)",
                    (file_path, title, vector.astype(np.float32).tobytes()),
                )
            return True
        except sqlite3.IntegrityError:
            return False

    def get_all(self) -> List[Tuple[int, str, str, np.ndarray]]:
        """Return all rows as (id, file_path, title, vector)."""
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT id, file_path, title, vector FROM songs ORDER BY added_at"
            ).fetchall()
        return [
            (r[0], r[1], r[2], np.frombuffer(r[3], dtype=np.float32))
            for r in rows
        ]

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
