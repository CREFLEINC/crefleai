import sqlite3
import threading
from pathlib import Path

_SCHEMA = """
CREATE TABLE IF NOT EXISTS tokens (
    jti TEXT PRIMARY KEY,
    user_name TEXT NOT NULL,
    purpose TEXT NOT NULL,
    created_at TEXT NOT NULL,
    revoked_at TEXT
);
CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


class Database:
    """SQLite 접근 계층. 쓰기 빈도가 낮아 단일 커넥션 + 락으로 충분하다."""

    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._lock = threading.Lock()
        with self._lock, self._conn:
            self._conn.execute("PRAGMA journal_mode=WAL")
            self._conn.executescript(_SCHEMA)

    def insert_token(self, jti: str, user_name: str, purpose: str, created_at: str) -> None:
        with self._lock, self._conn:
            self._conn.execute(
                "INSERT INTO tokens (jti, user_name, purpose, created_at) VALUES (?, ?, ?, ?)",
                (jti, user_name, purpose, created_at),
            )

    def get_token(self, jti: str) -> sqlite3.Row | None:
        with self._lock:
            return self._conn.execute("SELECT * FROM tokens WHERE jti = ?", (jti,)).fetchone()

    def revoke_token(self, jti: str, revoked_at: str) -> bool:
        with self._lock, self._conn:
            cur = self._conn.execute(
                "UPDATE tokens SET revoked_at = ? WHERE jti = ? AND revoked_at IS NULL",
                (revoked_at, jti),
            )
            return cur.rowcount > 0

    def list_tokens(self) -> list[sqlite3.Row]:
        with self._lock:
            return self._conn.execute(
                "SELECT * FROM tokens ORDER BY created_at DESC"
            ).fetchall()

    def create_admin(self, username: str, password_hash: str, created_at: str) -> None:
        with self._lock, self._conn:
            self._conn.execute(
                "INSERT INTO admins (username, password_hash, created_at) VALUES (?, ?, ?)",
                (username, password_hash, created_at),
            )

    def get_admin(self, username: str) -> sqlite3.Row | None:
        with self._lock:
            return self._conn.execute(
                "SELECT * FROM admins WHERE username = ?", (username,)
            ).fetchone()

    def count_admins(self) -> int:
        with self._lock:
            return self._conn.execute("SELECT COUNT(*) FROM admins").fetchone()[0]

    def get_setting(self, key: str) -> str | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT value FROM settings WHERE key = ?", (key,)
            ).fetchone()
            return row["value"] if row else None

    def set_setting(self, key: str, value: str) -> None:
        with self._lock, self._conn:
            self._conn.execute(
                "INSERT INTO settings (key, value) VALUES (?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (key, value),
            )

    def close(self) -> None:
        self._conn.close()
