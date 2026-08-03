# CrefleAI 로컬 LLM 서비스 서버 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사내 NVIDIA GPU 서버에서 오픈 소스 LLM(GGUF)을 OpenAI 호환 API로 서비스하고, 관리자가 모델·토큰을 웹 화면에서 관리하는 서버를 만든다.

**Architecture:** FastAPI 게이트웨이(:8000)가 JWT 인증·관리자 API·React SPA 서빙을 담당하고, llama-cpp-python 추론 워커(:8001, localhost 전용)를 서브프로세스로 스폰·감시한다. 모델 교체는 워커 프로세스 재시작으로 수행해 VRAM을 확실히 회수한다.

**Tech Stack:** Python 3.11+/uv/FastAPI/PyJWT/bcrypt/httpx/llama-cpp-python(GPU 서버 전용 extra), SQLite, Vite/React/TypeScript, pytest/vitest

**Spec:** `docs/superpowers/specs/2026-08-03-crefleai-llm-server-design.md`

## Global Constraints

- Python ≥ 3.11, 패키지 관리는 `uv` (server/ 디렉터리에서 `uv sync`, `uv run pytest`)
- Node 20+, npm (web/ 디렉터리)
- TDD: 각 태스크는 실패하는 테스트 먼저 (superpowers:test-driven-development)
- 커밋: Conventional Commits, 한국어 제목 허용 (예: `feat(server): 사용자 토큰 발급 추가`)
- 포매터/린터: Python은 ruff, TS는 ESLint + Prettier (설정을 신뢰하고 손대지 않는다)
- API 에러 응답은 항상 OpenAI 형식: `{"error": {"message", "type", "code"}}`
- 포트: 게이트웨이 `8000`, 워커 `8001` (워커는 `127.0.0.1` 바인딩)
- 환경변수 prefix `CREFLEAI_`: `JWT_SECRET`(필수), `ADMIN_ID`, `ADMIN_PASSWORD`, `DATA_DIR`(기본 `data`), `HOST`, `PORT`, `WORKER_PORT`, `WORKER_CTX`
- JWT는 HS256. 사용자 토큰은 `exp` 없음 + DB allowlist(`jti`). 관리자 세션 토큰은 `scope: "admin"` + 12시간 만료, HTTP-only 쿠키(이름 `crefleai_admin`)
- `llama-cpp-python`은 optional extra `worker`로만 설치 — 개발/테스트 머신에는 설치하지 않고, 워커 코드는 lazy import로 이를 보장한다
- 테스트 마커 `inference`(실모델 로드)는 기본 실행에서 제외 (`addopts = "-m 'not inference'"`)

## 파일 구조 (전체 지도)

```
crefleai/
├── server/
│   ├── pyproject.toml            # Task 1
│   ├── .gitignore                # Task 1
│   ├── src/crefleai/
│   │   ├── __init__.py           # Task 1
│   │   ├── config.py             # Task 1 (Task 19에서 web_dist 추가)
│   │   ├── db.py                 # Task 2
│   │   ├── auth/
│   │   │   ├── __init__.py       # Task 3
│   │   │   ├── errors.py         # Task 3  InvalidTokenError
│   │   │   ├── tokens.py         # Task 3  사용자 JWT 발급/검증
│   │   │   └── admin.py          # Task 4  관리자 인증
│   │   ├── api/
│   │   │   ├── __init__.py       # Task 5
│   │   │   ├── errors.py         # Task 5  APIError
│   │   │   ├── deps.py           # Task 5  의존성 (Task 12에서 사용자 토큰 의존성 추가)
│   │   │   ├── admin.py          # Task 5 로그인 → Task 6 토큰 → Task 11 모델
│   │   │   └── v1.py             # Task 12 OpenAI 호환 API
│   │   ├── models/
│   │   │   ├── __init__.py       # Task 7
│   │   │   ├── catalog.json      # Task 7
│   │   │   ├── catalog.py        # Task 7
│   │   │   ├── downloads.py      # Task 8
│   │   │   └── worker_manager.py # Task 10
│   │   ├── worker/
│   │   │   ├── __init__.py       # Task 9
│   │   │   ├── app.py            # Task 9  추론 워커 FastAPI 앱
│   │   │   └── __main__.py       # Task 9  python -m crefleai.worker
│   │   └── main.py               # Task 5 최소형 → Task 11/12/13 확장
│   ├── scripts/verify_catalog.py # Task 7
│   └── tests/                    # 각 태스크의 테스트
├── web/                          # Task 14~18 (Vite + React + TS)
│   ├── vite.config.ts
│   └── src/
│       ├── api.ts  types.ts  sse.ts
│       ├── App.tsx
│       ├── admin/ (LoginPage, RequireAdmin, AdminLayout, ModelsPage, TokensPage)
│       └── chat/ (ChatPage)
├── README.md                     # Task 19
└── docs/
```

---

## Phase 1 — 백엔드

### Task 1: server 스캐폴딩 + 설정 모듈

**Files:**
- Create: `server/pyproject.toml`
- Create: `server/.gitignore`
- Create: `server/src/crefleai/__init__.py`
- Create: `server/src/crefleai/config.py`
- Create: `server/tests/conftest.py`
- Test: `server/tests/test_config.py`

**Interfaces:**
- Produces: `Settings` (pydantic-settings, env prefix `CREFLEAI_`) — 필드 `jwt_secret: str`(필수), `admin_id: str | None`, `admin_password: str | None`, `data_dir: Path`(기본 `Path("data")`), `host: str`(기본 `"0.0.0.0"`), `port: int`(8000), `worker_port: int`(8001), `worker_ctx: int`(8192); 프로퍼티 `db_path -> Path`(`data_dir/"crefleai.db"`), `models_dir -> Path`(`data_dir/"models"`)
- Produces: `get_settings() -> Settings` (lru_cache)
- Produces: pytest 픽스처 `settings(tmp_path)` — 이후 모든 태스크가 사용

- [ ] **Step 1: 프로젝트 파일 생성**

`server/pyproject.toml`:

```toml
[project]
name = "crefleai"
version = "0.1.0"
description = "CREFLE 사내 로컬 LLM 서비스 서버"
requires-python = ">=3.11"
dependencies = [
    "fastapi>=0.115",
    "uvicorn[standard]>=0.30",
    "pydantic-settings>=2.4",
    "PyJWT>=2.9",
    "bcrypt>=4.2",
    "httpx>=0.27",
]

[project.optional-dependencies]
worker = ["llama-cpp-python>=0.3"]

[project.scripts]
crefleai = "crefleai.main:run"

[dependency-groups]
dev = ["pytest>=8", "pytest-asyncio>=0.24", "ruff>=0.6"]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/crefleai"]

[tool.pytest.ini_options]
markers = ["inference: 실제 GGUF 모델 로드가 필요한 테스트 (기본 제외)"]
addopts = "-m 'not inference'"
asyncio_mode = "auto"

[tool.ruff]
line-length = 100
target-version = "py311"
```

`server/.gitignore`:

```
__pycache__/
.venv/
data/
*.egg-info/
.pytest_cache/
.ruff_cache/
```

`server/src/crefleai/__init__.py`: 빈 파일.

`server/tests/conftest.py`:

```python
import pytest

from crefleai.config import Settings


@pytest.fixture
def settings(tmp_path):
    return Settings(
        jwt_secret="test-secret",
        admin_id="admin",
        admin_password="admin-pw",
        data_dir=tmp_path,
    )
```

Run: `cd server && uv sync`

- [ ] **Step 2: 실패하는 테스트 작성**

`server/tests/test_config.py`:

```python
import pytest
from pydantic import ValidationError

from crefleai.config import Settings


def test_jwt_secret_없으면_기동_실패(monkeypatch):
    monkeypatch.delenv("CREFLEAI_JWT_SECRET", raising=False)
    with pytest.raises(ValidationError):
        Settings()


def test_파생_경로(tmp_path):
    s = Settings(jwt_secret="x", data_dir=tmp_path)
    assert s.db_path == tmp_path / "crefleai.db"
    assert s.models_dir == tmp_path / "models"
    assert s.port == 8000
    assert s.worker_port == 8001
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `cd server && uv run pytest tests/test_config.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'crefleai.config'`

- [ ] **Step 4: config.py 구현**

`server/src/crefleai/config.py`:

```python
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="CREFLEAI_")

    jwt_secret: str  # 필수 — 미설정 시 기동 실패
    admin_id: str | None = None
    admin_password: str | None = None
    data_dir: Path = Path("data")
    host: str = "0.0.0.0"
    port: int = 8000
    worker_port: int = 8001
    worker_ctx: int = 8192

    @property
    def db_path(self) -> Path:
        return self.data_dir / "crefleai.db"

    @property
    def models_dir(self) -> Path:
        return self.data_dir / "models"


@lru_cache
def get_settings() -> Settings:
    return Settings()
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `cd server && uv run pytest tests/test_config.py -v`
Expected: PASS (2 passed)

- [ ] **Step 6: 커밋**

```bash
git add server/
git commit -m "feat(server): 프로젝트 스캐폴딩과 설정 모듈 추가"
```

---

### Task 2: SQLite 데이터베이스 모듈

**Files:**
- Create: `server/src/crefleai/db.py`
- Modify: `server/tests/conftest.py` (db 픽스처 추가)
- Test: `server/tests/test_db.py`

**Interfaces:**
- Consumes: `Settings.db_path`
- Produces: `Database(path: Path)` 클래스 — 메서드:
  - `insert_token(jti: str, user_name: str, purpose: str, created_at: str) -> None`
  - `get_token(jti: str) -> sqlite3.Row | None`
  - `revoke_token(jti: str, revoked_at: str) -> bool` (없으면 False)
  - `list_tokens() -> list[sqlite3.Row]` (created_at DESC)
  - `create_admin(username: str, password_hash: str, created_at: str) -> None`
  - `get_admin(username: str) -> sqlite3.Row | None`
  - `count_admins() -> int`
  - `get_setting(key: str) -> str | None` / `set_setting(key: str, value: str) -> None` (upsert)
  - `close() -> None`
- Produces: pytest 픽스처 `db(settings)`

- [ ] **Step 1: 실패하는 테스트 작성**

`server/tests/conftest.py`에 추가:

```python
from crefleai.db import Database


@pytest.fixture
def db(settings):
    database = Database(settings.db_path)
    yield database
    database.close()
```

`server/tests/test_db.py`:

```python
def test_토큰_저장_조회_폐기(db):
    db.insert_token("jti-1", "홍길동", "테스트", "2026-08-03T00:00:00+00:00")
    row = db.get_token("jti-1")
    assert row["user_name"] == "홍길동"
    assert row["purpose"] == "테스트"
    assert row["revoked_at"] is None

    assert db.revoke_token("jti-1", "2026-08-04T00:00:00+00:00") is True
    assert db.get_token("jti-1")["revoked_at"] is not None
    assert db.revoke_token("없는-jti", "2026-08-04T00:00:00+00:00") is False

    assert [r["jti"] for r in db.list_tokens()] == ["jti-1"]
    assert db.get_token("없는-jti") is None


def test_관리자_계정(db):
    assert db.count_admins() == 0
    db.create_admin("admin", "해시값", "2026-08-03T00:00:00+00:00")
    assert db.count_admins() == 1
    assert db.get_admin("admin")["password_hash"] == "해시값"
    assert db.get_admin("없는계정") is None


def test_설정_upsert(db):
    assert db.get_setting("serving_model") is None
    db.set_setting("serving_model", "model-a")
    db.set_setting("serving_model", "model-b")
    assert db.get_setting("serving_model") == "model-b"
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd server && uv run pytest tests/test_db.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'crefleai.db'`

- [ ] **Step 3: db.py 구현**

`server/src/crefleai/db.py`:

```python
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
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd server && uv run pytest tests/test_db.py -v`
Expected: PASS (3 passed)

- [ ] **Step 5: 커밋**

```bash
git add server/
git commit -m "feat(server): SQLite 데이터베이스 모듈 추가"
```

---

### Task 3: 사용자 토큰 발급·검증 (JWT + allowlist)

**Files:**
- Create: `server/src/crefleai/auth/__init__.py` (빈 파일)
- Create: `server/src/crefleai/auth/errors.py`
- Create: `server/src/crefleai/auth/tokens.py`
- Test: `server/tests/test_auth_tokens.py`

**Interfaces:**
- Consumes: `Database.insert_token / get_token`
- Produces: `InvalidTokenError(Exception)` (auth/errors.py)
- Produces: `create_user_token(db: Database, secret: str, user_name: str, purpose: str) -> tuple[str, dict]` — (JWT 문자열, 페이로드)
- Produces: `verify_user_token(db: Database, secret: str, token: str) -> dict` — 실패 시 `InvalidTokenError`

- [ ] **Step 1: 실패하는 테스트 작성**

`server/tests/test_auth_tokens.py`:

```python
import jwt as pyjwt
import pytest

from crefleai.auth.errors import InvalidTokenError
from crefleai.auth.tokens import create_user_token, verify_user_token

SECRET = "test-secret"


def test_발급_후_검증_성공(db):
    token, payload = create_user_token(db, SECRET, "홍길동", "프로토타입 테스트")
    assert payload["sub"] == "홍길동"
    assert payload["purpose"] == "프로토타입 테스트"
    assert "exp" not in payload  # 무만료

    verified = verify_user_token(db, SECRET, token)
    assert verified["jti"] == payload["jti"]
    assert db.get_token(payload["jti"]) is not None  # allowlist 기록됨


def test_폐기된_토큰_거부(db):
    token, payload = create_user_token(db, SECRET, "홍길동", "테스트")
    db.revoke_token(payload["jti"], "2026-08-03T00:00:00+00:00")
    with pytest.raises(InvalidTokenError):
        verify_user_token(db, SECRET, token)


def test_서명_불일치_거부(db):
    token, _ = create_user_token(db, SECRET, "홍길동", "테스트")
    with pytest.raises(InvalidTokenError):
        verify_user_token(db, "다른-시크릿", token)


def test_jti_없는_토큰_거부(db):
    # 관리자 세션 토큰처럼 jti가 없는 JWT는 /v1 경로에서 거부되어야 한다
    token = pyjwt.encode({"sub": "admin", "scope": "admin"}, SECRET, algorithm="HS256")
    with pytest.raises(InvalidTokenError):
        verify_user_token(db, SECRET, token)
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd server && uv run pytest tests/test_auth_tokens.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'crefleai.auth'`

- [ ] **Step 3: 구현**

`server/src/crefleai/auth/errors.py`:

```python
class InvalidTokenError(Exception):
    """서명 불일치, allowlist 미등록, 폐기 등 모든 토큰 검증 실패."""
```

`server/src/crefleai/auth/tokens.py`:

```python
import datetime as dt
import uuid

import jwt

from crefleai.auth.errors import InvalidTokenError
from crefleai.db import Database

ALGORITHM = "HS256"


def create_user_token(db: Database, secret: str, user_name: str, purpose: str) -> tuple[str, dict]:
    now = dt.datetime.now(dt.timezone.utc)
    payload = {
        "sub": user_name,
        "purpose": purpose,
        "iat": int(now.timestamp()),
        "jti": uuid.uuid4().hex,
    }
    token = jwt.encode(payload, secret, algorithm=ALGORITHM)
    db.insert_token(payload["jti"], user_name, purpose, now.isoformat())
    return token, payload


def verify_user_token(db: Database, secret: str, token: str) -> dict:
    try:
        payload = jwt.decode(
            token, secret, algorithms=[ALGORITHM], options={"require": ["jti", "sub"]}
        )
    except jwt.InvalidTokenError as e:
        raise InvalidTokenError(str(e)) from e
    row = db.get_token(payload["jti"])
    if row is None or row["revoked_at"] is not None:
        raise InvalidTokenError("token is not in allowlist or has been revoked")
    return payload
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd server && uv run pytest tests/test_auth_tokens.py -v`
Expected: PASS (4 passed)

- [ ] **Step 5: 커밋**

```bash
git add server/
git commit -m "feat(server): 사용자 JWT 발급·검증(allowlist) 추가"
```

---

### Task 4: 관리자 인증 (bcrypt + 세션 JWT)

**Files:**
- Create: `server/src/crefleai/auth/admin.py`
- Test: `server/tests/test_auth_admin.py`

**Interfaces:**
- Consumes: `Database.create_admin / get_admin / count_admins`, `Settings.admin_id / admin_password`
- Produces:
  - `hash_password(password: str) -> str` / `check_password(password: str, password_hash: str) -> bool`
  - `bootstrap_admin(db: Database, settings: Settings) -> None` — admins가 비어 있고 env 계정이 설정된 경우에만 생성
  - `login_admin(db: Database, secret: str, username: str, password: str) -> str | None` — 성공 시 `scope: "admin"`, `exp` 12시간 세션 JWT
  - `verify_admin_token(secret: str, token: str) -> dict` — scope 불일치·만료 시 `InvalidTokenError`
  - 상수 `ADMIN_SESSION_HOURS = 12`

- [ ] **Step 1: 실패하는 테스트 작성**

`server/tests/test_auth_admin.py`:

```python
import pytest

from crefleai.auth.admin import (
    bootstrap_admin,
    check_password,
    hash_password,
    login_admin,
    verify_admin_token,
)
from crefleai.auth.errors import InvalidTokenError
from crefleai.auth.tokens import create_user_token

SECRET = "test-secret"


def test_비밀번호_해시(settings):
    h = hash_password("my-pw")
    assert h != "my-pw"
    assert check_password("my-pw", h) is True
    assert check_password("wrong", h) is False


def test_부트스트랩은_한_번만(db, settings):
    bootstrap_admin(db, settings)
    assert db.count_admins() == 1
    bootstrap_admin(db, settings)  # 이미 있으면 아무것도 안 함
    assert db.count_admins() == 1


def test_로그인_성공과_실패(db, settings):
    bootstrap_admin(db, settings)
    assert login_admin(db, SECRET, "admin", "wrong-pw") is None
    assert login_admin(db, SECRET, "없는계정", "admin-pw") is None

    token = login_admin(db, SECRET, "admin", "admin-pw")
    payload = verify_admin_token(SECRET, token)
    assert payload["sub"] == "admin"
    assert payload["scope"] == "admin"
    assert "exp" in payload


def test_사용자_토큰은_관리자_검증에서_거부(db):
    user_token, _ = create_user_token(db, SECRET, "홍길동", "테스트")
    with pytest.raises(InvalidTokenError):
        verify_admin_token(SECRET, user_token)
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd server && uv run pytest tests/test_auth_admin.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'crefleai.auth.admin'`

- [ ] **Step 3: 구현**

`server/src/crefleai/auth/admin.py`:

```python
import datetime as dt

import bcrypt
import jwt

from crefleai.auth.errors import InvalidTokenError
from crefleai.auth.tokens import ALGORITHM
from crefleai.config import Settings
from crefleai.db import Database

ADMIN_SESSION_HOURS = 12


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def check_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode(), password_hash.encode())


def bootstrap_admin(db: Database, settings: Settings) -> None:
    if db.count_admins() > 0:
        return
    if not settings.admin_id or not settings.admin_password:
        return
    now = dt.datetime.now(dt.timezone.utc)
    db.create_admin(settings.admin_id, hash_password(settings.admin_password), now.isoformat())


def login_admin(db: Database, secret: str, username: str, password: str) -> str | None:
    row = db.get_admin(username)
    if row is None or not check_password(password, row["password_hash"]):
        return None
    now = dt.datetime.now(dt.timezone.utc)
    payload = {
        "sub": username,
        "scope": "admin",
        "iat": int(now.timestamp()),
        "exp": now + dt.timedelta(hours=ADMIN_SESSION_HOURS),
    }
    return jwt.encode(payload, secret, algorithm=ALGORITHM)


def verify_admin_token(secret: str, token: str) -> dict:
    try:
        payload = jwt.decode(token, secret, algorithms=[ALGORITHM], options={"require": ["exp"]})
    except jwt.InvalidTokenError as e:
        raise InvalidTokenError(str(e)) from e
    if payload.get("scope") != "admin":
        raise InvalidTokenError("not an admin token")
    return payload
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd server && uv run pytest tests/test_auth_admin.py -v`
Expected: PASS (4 passed)

- [ ] **Step 5: 커밋**

```bash
git add server/
git commit -m "feat(server): 관리자 인증(bcrypt, 세션 JWT) 추가"
```

---

### Task 5: 앱 골격 + 관리자 로그인 API

**Files:**
- Create: `server/src/crefleai/api/__init__.py` (빈 파일)
- Create: `server/src/crefleai/api/errors.py`
- Create: `server/src/crefleai/api/deps.py`
- Create: `server/src/crefleai/api/admin.py`
- Create: `server/src/crefleai/main.py`
- Modify: `server/tests/conftest.py` (client, admin_client 픽스처 추가)
- Test: `server/tests/test_admin_auth_api.py`

**Interfaces:**
- Consumes: `login_admin`, `verify_admin_token`, `bootstrap_admin`, `Database`
- Produces:
  - `APIError(status_code: int, message: str, type_: str, code: str | None = None)` — 전역 핸들러가 OpenAI 에러 형식으로 변환
  - `ADMIN_COOKIE = "crefleai_admin"` (deps.py)
  - 의존성 `require_admin(request) -> dict` (쿠키 검증, 실패 시 401 APIError)
  - `get_db(request) -> Database` 등 `app.state` 접근 의존성
  - `create_app(settings: Settings | None = None) -> FastAPI` — lifespan에서 db 초기화 + bootstrap_admin
  - 엔드포인트: `POST /admin/login`, `POST /admin/logout`, `GET /admin/me`
  - pytest 픽스처 `client(settings)`, `admin_client(client)` (로그인 완료 상태)

- [ ] **Step 1: 실패하는 테스트 작성**

`server/tests/conftest.py`에 추가:

```python
from fastapi.testclient import TestClient

from crefleai.main import create_app


@pytest.fixture
def client(settings):
    app = create_app(settings)
    with TestClient(app) as c:
        yield c


@pytest.fixture
def admin_client(client):
    res = client.post("/admin/login", json={"username": "admin", "password": "admin-pw"})
    assert res.status_code == 200
    return client
```

`server/tests/test_admin_auth_api.py`:

```python
def test_로그인_성공시_쿠키로_me_접근(client):
    res = client.post("/admin/login", json={"username": "admin", "password": "admin-pw"})
    assert res.status_code == 200
    assert "crefleai_admin" in res.cookies

    me = client.get("/admin/me")
    assert me.status_code == 200
    assert me.json() == {"username": "admin"}


def test_잘못된_비밀번호는_401_OpenAI_에러형식(client):
    res = client.post("/admin/login", json={"username": "admin", "password": "wrong"})
    assert res.status_code == 401
    body = res.json()
    assert "message" in body["error"]
    assert body["error"]["type"] == "invalid_request_error"


def test_쿠키_없으면_401(client):
    assert client.get("/admin/me").status_code == 401


def test_로그아웃하면_me가_401(admin_client):
    admin_client.post("/admin/logout")
    assert admin_client.get("/admin/me").status_code == 401
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd server && uv run pytest tests/test_admin_auth_api.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'crefleai.main'`

- [ ] **Step 3: 구현**

`server/src/crefleai/api/errors.py`:

```python
class APIError(Exception):
    """OpenAI 에러 형식으로 변환되는 API 예외."""

    def __init__(self, status_code: int, message: str, type_: str, code: str | None = None):
        super().__init__(message)
        self.status_code = status_code
        self.message = message
        self.type = type_
        self.code = code
```

`server/src/crefleai/api/deps.py`:

```python
from fastapi import Request

from crefleai.api.errors import APIError
from crefleai.auth.admin import verify_admin_token
from crefleai.auth.errors import InvalidTokenError
from crefleai.config import Settings
from crefleai.db import Database

ADMIN_COOKIE = "crefleai_admin"


def get_db(request: Request) -> Database:
    return request.app.state.db


def get_app_settings(request: Request) -> Settings:
    return request.app.state.settings


def require_admin(request: Request) -> dict:
    token = request.cookies.get(ADMIN_COOKIE)
    if not token:
        raise APIError(401, "관리자 로그인이 필요합니다", "invalid_request_error")
    try:
        return verify_admin_token(request.app.state.settings.jwt_secret, token)
    except InvalidTokenError as e:
        raise APIError(401, "관리자 세션이 유효하지 않습니다", "invalid_request_error") from e
```

`server/src/crefleai/api/admin.py`:

```python
from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel

from crefleai.api.deps import ADMIN_COOKIE, get_app_settings, get_db, require_admin
from crefleai.api.errors import APIError
from crefleai.auth.admin import ADMIN_SESSION_HOURS, login_admin
from crefleai.config import Settings
from crefleai.db import Database

router = APIRouter(prefix="/admin", tags=["admin"])


class LoginBody(BaseModel):
    username: str
    password: str


@router.post("/login")
def login(
    body: LoginBody,
    response: Response,
    db: Database = Depends(get_db),
    settings: Settings = Depends(get_app_settings),
):
    token = login_admin(db, settings.jwt_secret, body.username, body.password)
    if token is None:
        raise APIError(401, "아이디 또는 비밀번호가 올바르지 않습니다", "invalid_request_error")
    response.set_cookie(
        ADMIN_COOKIE,
        token,
        httponly=True,
        samesite="lax",
        max_age=ADMIN_SESSION_HOURS * 3600,
    )
    return {"ok": True}


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(ADMIN_COOKIE)
    return {"ok": True}


@router.get("/me")
def me(admin: dict = Depends(require_admin)):
    return {"username": admin["sub"]}
```

`server/src/crefleai/main.py`:

```python
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from crefleai.api import admin as admin_api
from crefleai.api.errors import APIError
from crefleai.auth.admin import bootstrap_admin
from crefleai.config import Settings, get_settings
from crefleai.db import Database


@asynccontextmanager
async def _lifespan(app: FastAPI):
    settings: Settings = app.state.settings
    app.state.db = Database(settings.db_path)
    bootstrap_admin(app.state.db, settings)
    yield
    app.state.db.close()


def create_app(settings: Settings | None = None) -> FastAPI:
    app = FastAPI(title="CrefleAI", lifespan=_lifespan)
    app.state.settings = settings or get_settings()

    @app.exception_handler(APIError)
    async def _api_error(request: Request, exc: APIError):
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": {"message": exc.message, "type": exc.type, "code": exc.code}},
        )

    app.include_router(admin_api.router)
    return app


def run() -> None:
    import uvicorn

    settings = get_settings()
    uvicorn.run(create_app(settings), host=settings.host, port=settings.port)
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd server && uv run pytest tests/test_admin_auth_api.py -v`
Expected: PASS (4 passed)

- [ ] **Step 5: 커밋**

```bash
git add server/
git commit -m "feat(server): FastAPI 앱 골격과 관리자 로그인 API 추가"
```

---

### Task 6: 관리자 토큰 관리 API

**Files:**
- Modify: `server/src/crefleai/api/admin.py`
- Test: `server/tests/test_admin_tokens_api.py`

**Interfaces:**
- Consumes: `create_user_token`, `verify_user_token`, `Database.list_tokens / revoke_token`, `require_admin`
- Produces:
  - `GET /admin/tokens` → `{"tokens": [{jti, user_name, purpose, created_at, revoked_at}]}`
  - `POST /admin/tokens` body `{"user_name", "purpose"}` → `{"token", "jti", "user_name", "purpose", "created_at"}` (JWT 원문은 이 응답 1회만)
  - `DELETE /admin/tokens/{jti}` → `{"ok": true}` / 404

- [ ] **Step 1: 실패하는 테스트 작성**

`server/tests/test_admin_tokens_api.py`:

```python
from crefleai.auth.errors import InvalidTokenError
from crefleai.auth.tokens import verify_user_token


def test_토큰_생성과_목록(admin_client):
    res = admin_client.post(
        "/admin/tokens", json={"user_name": "홍길동", "purpose": "프로토타입"}
    )
    assert res.status_code == 200
    created = res.json()
    assert created["user_name"] == "홍길동"
    assert created["token"].count(".") == 2  # JWT 형태

    listed = admin_client.get("/admin/tokens").json()["tokens"]
    assert len(listed) == 1
    assert listed[0]["jti"] == created["jti"]
    assert "token" not in listed[0]  # 원문은 목록에 없음


def test_생성된_토큰은_실제로_유효(admin_client):
    created = admin_client.post(
        "/admin/tokens", json={"user_name": "홍길동", "purpose": "테스트"}
    ).json()
    app = admin_client.app
    payload = verify_user_token(app.state.db, app.state.settings.jwt_secret, created["token"])
    assert payload["jti"] == created["jti"]


def test_폐기하면_검증_실패(admin_client):
    import pytest

    created = admin_client.post(
        "/admin/tokens", json={"user_name": "홍길동", "purpose": "테스트"}
    ).json()
    res = admin_client.delete(f"/admin/tokens/{created['jti']}")
    assert res.status_code == 200

    app = admin_client.app
    with pytest.raises(InvalidTokenError):
        verify_user_token(app.state.db, app.state.settings.jwt_secret, created["token"])


def test_없는_토큰_폐기는_404(admin_client):
    assert admin_client.delete("/admin/tokens/없는-jti").status_code == 404


def test_로그인_없이_토큰_API_접근은_401(client):
    assert client.get("/admin/tokens").status_code == 401
    assert client.post("/admin/tokens", json={"user_name": "a", "purpose": "b"}).status_code == 401
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd server && uv run pytest tests/test_admin_tokens_api.py -v`
Expected: FAIL — 404 Not Found (라우트 없음)

- [ ] **Step 3: api/admin.py에 엔드포인트 추가**

`server/src/crefleai/api/admin.py`에 추가 (import에 `datetime as dt`, `create_user_token` 추가):

```python
import datetime as dt

from crefleai.auth.tokens import create_user_token


class CreateTokenBody(BaseModel):
    user_name: str
    purpose: str


@router.get("/tokens")
def list_tokens(db: Database = Depends(get_db), _admin: dict = Depends(require_admin)):
    return {"tokens": [dict(row) for row in db.list_tokens()]}


@router.post("/tokens")
def create_token(
    body: CreateTokenBody,
    db: Database = Depends(get_db),
    settings: Settings = Depends(get_app_settings),
    _admin: dict = Depends(require_admin),
):
    token, payload = create_user_token(db, settings.jwt_secret, body.user_name, body.purpose)
    return {
        "token": token,
        "jti": payload["jti"],
        "user_name": body.user_name,
        "purpose": body.purpose,
        "created_at": db.get_token(payload["jti"])["created_at"],
    }


@router.delete("/tokens/{jti}")
def revoke_token(
    jti: str,
    db: Database = Depends(get_db),
    _admin: dict = Depends(require_admin),
):
    revoked = db.revoke_token(jti, dt.datetime.now(dt.timezone.utc).isoformat())
    if not revoked:
        raise APIError(404, "해당 토큰이 없거나 이미 폐기되었습니다", "invalid_request_error")
    return {"ok": True}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd server && uv run pytest tests/test_admin_tokens_api.py -v`
Expected: PASS (5 passed)

- [ ] **Step 5: 전체 테스트 확인 및 커밋**

Run: `cd server && uv run pytest -q`
Expected: 전부 PASS

```bash
git add server/
git commit -m "feat(server): 관리자 토큰 생성·목록·폐기 API 추가"
```

### Task 7: 모델 카탈로그

**Files:**
- Create: `server/src/crefleai/models/__init__.py` (빈 파일)
- Create: `server/src/crefleai/models/catalog.json`
- Create: `server/src/crefleai/models/catalog.py`
- Create: `server/scripts/verify_catalog.py`
- Test: `server/tests/test_catalog.py`

**Interfaces:**
- Produces: `CatalogModel` (frozen dataclass) — 필드 `id, display_name, hf_repo, filename, quantization, size_bytes, context_length, license, description`
- Produces: `load_catalog() -> dict[str, CatalogModel]` (id 키)
- Produces: `model_file(models_dir: Path, model: CatalogModel) -> Path` (`models_dir / model.filename`)

- [ ] **Step 1: 실패하는 테스트 작성**

`server/tests/test_catalog.py`:

```python
from pathlib import Path

from crefleai.models.catalog import CatalogModel, load_catalog, model_file


def test_카탈로그_로드():
    catalog = load_catalog()
    assert len(catalog) >= 3
    for model_id, m in catalog.items():
        assert m.id == model_id
        assert isinstance(m, CatalogModel)
        assert m.filename.endswith(".gguf")
        assert m.size_bytes > 0
        assert m.context_length > 0


def test_모델_파일_경로():
    m = next(iter(load_catalog().values()))
    assert model_file(Path("/data/models"), m) == Path("/data/models") / m.filename
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd server && uv run pytest tests/test_catalog.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'crefleai.models'`

- [ ] **Step 3: 구현**

`server/src/crefleai/models/catalog.json` (초기값 — Step 6에서 실제 HF 값으로 검증·보정):

```json
[
  {
    "id": "qwen3-8b-q4km",
    "display_name": "Qwen3 8B (Q4_K_M)",
    "hf_repo": "Qwen/Qwen3-8B-GGUF",
    "filename": "Qwen3-8B-Q4_K_M.gguf",
    "quantization": "Q4_K_M",
    "size_bytes": 5030000000,
    "context_length": 32768,
    "license": "Apache-2.0",
    "description": "다국어·한국어 성능이 좋은 범용 모델. 기본 추천."
  },
  {
    "id": "qwen2.5-7b-instruct-q4km",
    "display_name": "Qwen2.5 7B Instruct (Q4_K_M)",
    "hf_repo": "Qwen/Qwen2.5-7B-Instruct-GGUF",
    "filename": "qwen2.5-7b-instruct-q4_k_m.gguf",
    "quantization": "Q4_K_M",
    "size_bytes": 4680000000,
    "context_length": 32768,
    "license": "Apache-2.0",
    "description": "검증이 많이 된 안정적인 범용 모델."
  },
  {
    "id": "exaone-3.5-7.8b-q4km",
    "display_name": "EXAONE 3.5 7.8B Instruct (Q4_K_M)",
    "hf_repo": "LGAI-EXAONE/EXAONE-3.5-7.8B-Instruct-GGUF",
    "filename": "EXAONE-3.5-7.8B-Instruct-Q4_K_M.gguf",
    "quantization": "Q4_K_M",
    "size_bytes": 4770000000,
    "context_length": 32768,
    "license": "EXAONE AI Model License (연구용 — 상업 이용 제한 주의)",
    "description": "LG AI연구원의 한국어 특화 모델. 라이선스 조건 확인 필요."
  }
]
```

`server/src/crefleai/models/catalog.py`:

```python
import json
from dataclasses import dataclass
from importlib.resources import files
from pathlib import Path


@dataclass(frozen=True)
class CatalogModel:
    id: str
    display_name: str
    hf_repo: str
    filename: str
    quantization: str
    size_bytes: int
    context_length: int
    license: str
    description: str


def load_catalog() -> dict[str, CatalogModel]:
    raw = json.loads(
        files("crefleai.models").joinpath("catalog.json").read_text(encoding="utf-8")
    )
    models = [CatalogModel(**entry) for entry in raw]
    return {m.id: m for m in models}


def model_file(models_dir: Path, model: CatalogModel) -> Path:
    return models_dir / model.filename
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd server && uv run pytest tests/test_catalog.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: 카탈로그 검증 스크립트 작성**

`server/scripts/verify_catalog.py`:

```python
"""카탈로그의 hf_repo/filename이 실제 HF에 존재하는지, 파일 크기를 확인한다.

사용: cd server && uv run python scripts/verify_catalog.py
출력된 실제 content-length로 catalog.json의 size_bytes를 보정한다.
단일 파일 GGUF가 아니면(404) 해당 항목을 단일 파일 quant로 교체해야 한다.
"""
import httpx

from crefleai.models.catalog import load_catalog


def main() -> None:
    for m in load_catalog().values():
        url = f"https://huggingface.co/{m.hf_repo}/resolve/main/{m.filename}"
        r = httpx.head(url, follow_redirects=True, timeout=30)
        size = r.headers.get("content-length", "?")
        ok = "OK " if r.status_code == 200 else "FAIL"
        print(f"{ok} {m.id}: status={r.status_code} size={size} (catalog={m.size_bytes})")


if __name__ == "__main__":
    main()
```

- [ ] **Step 6: 검증 실행 및 카탈로그 보정**

Run: `cd server && uv run python scripts/verify_catalog.py`
Expected: 3개 항목 모두 `OK`. FAIL이 있으면 해당 repo의 실제 단일 파일 GGUF 이름으로 `filename`을 고치고(HF 웹에서 Files 탭 확인), `size_bytes`를 출력된 실제 값으로 갱신한 뒤 재실행한다. (사내망에서 HF 접근이 안 되면 이 단계는 보류하고 커밋 메시지에 명시)

- [ ] **Step 7: 커밋**

```bash
git add server/
git commit -m "feat(server): 내장 모델 카탈로그 추가"
```

---

### Task 8: 모델 다운로더

**Files:**
- Create: `server/src/crefleai/models/downloads.py`
- Test: `server/tests/test_downloads.py`

**Interfaces:**
- Consumes: `CatalogModel`, `Settings.models_dir`
- Produces:
  - `DownloadState` dataclass — `status: str`(`"idle" | "downloading" | "ready" | "failed"`), `progress: float`(0.0~1.0), `error: str | None`
  - `DownloadManager(models_dir: Path, catalog: dict[str, CatalogModel], client: httpx.AsyncClient | None = None)`
    - `state_for(model_id: str) -> DownloadState` — 파일 존재 시 ready
    - `start(model_id: str) -> bool` — downloading/ready면 False
    - `wait(model_id: str)` (async) — 테스트용: 진행 중 다운로드 완료 대기
  - 상수 `HF_BASE = "https://huggingface.co"`
- 다운로드는 `<filename>.part`에 쓰고 완료 시 rename, 실패 시 .part 삭제

- [ ] **Step 1: 실패하는 테스트 작성**

`server/tests/test_downloads.py`:

```python
import httpx
import pytest

from crefleai.models.catalog import CatalogModel
from crefleai.models.downloads import DownloadManager

MODEL = CatalogModel(
    id="tiny",
    display_name="Tiny",
    hf_repo="org/tiny-gguf",
    filename="tiny.gguf",
    quantization="Q4_K_M",
    size_bytes=100,
    context_length=2048,
    license="MIT",
    description="테스트",
)
CATALOG = {"tiny": MODEL}
CONTENT = b"x" * 100


def make_manager(tmp_path, handler):
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler), follow_redirects=True)
    return DownloadManager(tmp_path / "models", CATALOG, client=client)


async def test_다운로드_성공(tmp_path):
    def handler(request):
        return httpx.Response(200, content=CONTENT, headers={"content-length": "100"})

    dm = make_manager(tmp_path, handler)
    assert dm.state_for("tiny").status == "idle"
    assert dm.start("tiny") is True
    await dm.wait("tiny")

    state = dm.state_for("tiny")
    assert state.status == "ready"
    assert state.progress == 1.0
    assert (tmp_path / "models" / "tiny.gguf").read_bytes() == CONTENT
    assert not (tmp_path / "models" / "tiny.gguf.part").exists()


async def test_이미_받은_모델은_start_거부(tmp_path):
    (tmp_path / "models").mkdir(parents=True)
    (tmp_path / "models" / "tiny.gguf").write_bytes(CONTENT)
    dm = make_manager(tmp_path, lambda request: httpx.Response(500))
    assert dm.state_for("tiny").status == "ready"
    assert dm.start("tiny") is False


async def test_실패시_part_정리_후_재시도_가능(tmp_path):
    def handler(request):
        return httpx.Response(404)

    dm = make_manager(tmp_path, handler)
    assert dm.start("tiny") is True
    await dm.wait("tiny")

    state = dm.state_for("tiny")
    assert state.status == "failed"
    assert state.error is not None
    assert not (tmp_path / "models" / "tiny.gguf.part").exists()
    assert dm.start("tiny") is True  # 재시도 허용
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd server && uv run pytest tests/test_downloads.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'crefleai.models.downloads'`

- [ ] **Step 3: 구현**

`server/src/crefleai/models/downloads.py`:

```python
import asyncio
from dataclasses import dataclass
from pathlib import Path

import httpx

from crefleai.models.catalog import CatalogModel

HF_BASE = "https://huggingface.co"
_CHUNK = 1024 * 1024


@dataclass
class DownloadState:
    status: str = "idle"  # idle | downloading | ready | failed
    progress: float = 0.0
    error: str | None = None


class DownloadManager:
    def __init__(
        self,
        models_dir: Path,
        catalog: dict[str, CatalogModel],
        client: httpx.AsyncClient | None = None,
    ):
        self._models_dir = models_dir
        self._catalog = catalog
        self._client = client  # None이면 다운로드마다 생성 (운영 기본)
        self._states: dict[str, DownloadState] = {}
        self._tasks: dict[str, asyncio.Task] = {}

    def state_for(self, model_id: str) -> DownloadState:
        state = self._states.get(model_id)
        if state is not None:
            return state
        model = self._catalog[model_id]
        if (self._models_dir / model.filename).exists():
            return DownloadState("ready", 1.0, None)
        return DownloadState("idle", 0.0, None)

    def start(self, model_id: str) -> bool:
        if self.state_for(model_id).status in ("downloading", "ready"):
            return False
        self._states[model_id] = DownloadState("downloading", 0.0, None)
        self._tasks[model_id] = asyncio.create_task(self._download(model_id))
        return True

    async def wait(self, model_id: str) -> None:
        task = self._tasks.get(model_id)
        if task is not None:
            await task

    async def _download(self, model_id: str) -> None:
        model = self._catalog[model_id]
        url = f"{HF_BASE}/{model.hf_repo}/resolve/main/{model.filename}"
        part = self._models_dir / f"{model.filename}.part"
        state = self._states[model_id]
        client = self._client or httpx.AsyncClient(
            follow_redirects=True, timeout=httpx.Timeout(30, read=120)
        )
        owns_client = self._client is None
        try:
            self._models_dir.mkdir(parents=True, exist_ok=True)
            async with client.stream("GET", url) as response:
                response.raise_for_status()
                total = int(response.headers.get("content-length") or model.size_bytes)
                written = 0
                with part.open("wb") as f:
                    async for chunk in response.aiter_bytes(_CHUNK):
                        f.write(chunk)
                        written += len(chunk)
                        if total:
                            state.progress = min(written / total, 1.0)
            part.replace(self._models_dir / model.filename)
            state.status, state.progress = "ready", 1.0
        except Exception as e:  # noqa: BLE001 — 상태로 노출하고 삼키지 않는다
            part.unlink(missing_ok=True)
            state.status, state.error = "failed", str(e)
        finally:
            if owns_client:
                await client.aclose()
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd server && uv run pytest tests/test_downloads.py -v`
Expected: PASS (3 passed)

- [ ] **Step 5: 커밋**

```bash
git add server/
git commit -m "feat(server): HF GGUF 스트리밍 다운로더 추가"
```

---

### Task 9: 추론 워커

**Files:**
- Create: `server/src/crefleai/worker/__init__.py` (빈 파일)
- Create: `server/src/crefleai/worker/app.py`
- Create: `server/src/crefleai/worker/__main__.py`
- Test: `server/tests/test_worker_app.py`

**Interfaces:**
- Produces: `create_app(model_path: str, model_id: str, n_ctx: int, llama_factory=None) -> FastAPI`
  - `llama_factory(model_path: str, n_ctx: int)`는 `create_chat_completion(stream=False, **kwargs)`를 가진 객체를 반환. 기본값은 llama_cpp.Llama lazy import (n_gpu_layers=-1)
  - `GET /health` → `{"status": "loading" | "ready", "model": model_id}`
  - `POST /completion` — OpenAI chat.completion 형식 JSON. `stream: true`면 SSE(`data: {...}\n\n` … `data: [DONE]\n\n`)
  - 허용 파라미터: `messages, temperature, top_p, max_tokens, stop` (그 외 무시)
  - 요청은 asyncio.Lock으로 한 번에 하나씩 처리
- CLI: `python -m crefleai.worker --model-path P --model-id ID --port 8001 --ctx 8192` (127.0.0.1 바인딩)

- [ ] **Step 1: 실패하는 테스트 작성**

`server/tests/test_worker_app.py`:

```python
import json

from fastapi.testclient import TestClient

from crefleai.worker.app import create_app


class FakeLlama:
    def __init__(self):
        self.calls: list[dict] = []

    def create_chat_completion(self, stream=False, **kwargs):
        self.calls.append(kwargs)
        if stream:
            def gen():
                yield {"choices": [{"delta": {"content": "안"}}]}
                yield {"choices": [{"delta": {"content": "녕"}}]}
            return gen()
        return {
            "id": "chatcmpl-x",
            "object": "chat.completion",
            "model": "local",
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": "안녕"},
                    "finish_reason": "stop",
                }
            ],
            "usage": {"prompt_tokens": 1, "completion_tokens": 2, "total_tokens": 3},
        }


def make_client():
    fake = FakeLlama()
    app = create_app("/fake/path.gguf", "test-model", 2048, llama_factory=lambda p, c: fake)
    return TestClient(app), fake


def test_health_ready():
    client, _ = make_client()
    with client:
        res = client.get("/health")
        assert res.json() == {"status": "ready", "model": "test-model"}


def test_비스트리밍_completion():
    client, fake = make_client()
    with client:
        res = client.post(
            "/completion",
            json={
                "messages": [{"role": "user", "content": "hi"}],
                "temperature": 0.2,
                "stream": False,
                "ignored_param": 123,
            },
        )
    body = res.json()
    assert body["model"] == "test-model"  # 워커가 model 필드를 자기 id로 교체
    assert body["choices"][0]["message"]["content"] == "안녕"
    assert body["usage"]["total_tokens"] == 3
    assert fake.calls[0] == {
        "messages": [{"role": "user", "content": "hi"}],
        "temperature": 0.2,
    }  # 허용 목록 외 파라미터는 전달되지 않음


def test_스트리밍_completion():
    client, _ = make_client()
    with client:
        with client.stream(
            "POST",
            "/completion",
            json={"messages": [{"role": "user", "content": "hi"}], "stream": True},
        ) as res:
            assert res.headers["content-type"].startswith("text/event-stream")
            lines = [l for l in res.iter_lines() if l.startswith("data: ")]

    assert lines[-1] == "data: [DONE]"
    chunks = [json.loads(l[6:]) for l in lines[:-1]]
    contents = [c["choices"][0]["delta"].get("content", "") for c in chunks]
    assert "".join(contents) == "안녕"
    assert all(c["model"] == "test-model" for c in chunks)
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd server && uv run pytest tests/test_worker_app.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'crefleai.worker'`

- [ ] **Step 3: 구현**

`server/src/crefleai/worker/app.py`:

```python
import asyncio
import json
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse

_ALLOWED_PARAMS = ("messages", "temperature", "top_p", "max_tokens", "stop")


def _default_llama_factory(model_path: str, n_ctx: int):
    from llama_cpp import Llama  # GPU 서버에서만 설치되는 extra — lazy import

    return Llama(model_path=model_path, n_ctx=n_ctx, n_gpu_layers=-1, verbose=False)


def _to_llama_kwargs(body: dict) -> dict:
    return {k: body[k] for k in _ALLOWED_PARAMS if body.get(k) is not None}


def create_app(model_path: str, model_id: str, n_ctx: int, llama_factory=None) -> FastAPI:
    state: dict = {"llama": None, "ready": False}
    lock = asyncio.Lock()
    factory = llama_factory or _default_llama_factory

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        state["llama"] = await asyncio.to_thread(factory, model_path, n_ctx)
        state["ready"] = True
        yield

    app = FastAPI(lifespan=lifespan)

    @app.get("/health")
    async def health():
        return {"status": "ready" if state["ready"] else "loading", "model": model_id}

    @app.post("/completion")
    async def completion(request: Request):
        body = await request.json()
        kwargs = _to_llama_kwargs(body)
        if body.get("stream"):
            return StreamingResponse(_stream(kwargs), media_type="text/event-stream")
        async with lock:
            result = await asyncio.to_thread(
                lambda: state["llama"].create_chat_completion(**kwargs)
            )
        result["model"] = model_id
        return JSONResponse(result)

    async def _stream(kwargs: dict):
        async with lock:
            queue: asyncio.Queue = asyncio.Queue(maxsize=32)
            loop = asyncio.get_running_loop()

            def produce():
                try:
                    for chunk in state["llama"].create_chat_completion(stream=True, **kwargs):
                        asyncio.run_coroutine_threadsafe(queue.put(("chunk", chunk)), loop).result()
                    asyncio.run_coroutine_threadsafe(queue.put(("done", None)), loop).result()
                except Exception as e:  # noqa: BLE001 — 클라이언트에 에러 이벤트로 전달
                    asyncio.run_coroutine_threadsafe(queue.put(("error", str(e))), loop).result()

            threading.Thread(target=produce, daemon=True).start()
            while True:
                kind, item = await queue.get()
                if kind == "chunk":
                    item["model"] = model_id
                    yield f"data: {json.dumps(item, ensure_ascii=False)}\n\n"
                elif kind == "error":
                    payload = {"error": {"message": item, "type": "server_error", "code": None}}
                    yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
                    break
                else:
                    yield "data: [DONE]\n\n"
                    break

    return app
```

`server/src/crefleai/worker/__main__.py`:

```python
import argparse

import uvicorn

from crefleai.worker.app import create_app


def main() -> None:
    parser = argparse.ArgumentParser(description="CrefleAI 추론 워커")
    parser.add_argument("--model-path", required=True)
    parser.add_argument("--model-id", required=True)
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--ctx", type=int, default=8192)
    args = parser.parse_args()

    app = create_app(args.model_path, args.model_id, args.ctx)
    uvicorn.run(app, host="127.0.0.1", port=args.port)


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd server && uv run pytest tests/test_worker_app.py -v`
Expected: PASS (3 passed)

- [ ] **Step 5: 커밋**

```bash
git add server/
git commit -m "feat(server): llama.cpp 추론 워커 추가"
```

---

### Task 10: 워커 매니저

**Files:**
- Create: `server/src/crefleai/models/worker_manager.py`
- Create: `server/tests/fake_worker.py` (테스트용 가짜 워커 스크립트)
- Test: `server/tests/test_worker_manager.py`

**Interfaces:**
- Consumes: `CatalogModel`
- Produces:
  - `WorkerError(Exception)`
  - `WorkerManager(port: int, ctx: int, command_builder=None, startup_timeout: float = 600.0, max_restarts: int = 3)`
    - `command_builder(model: CatalogModel, model_path: Path) -> list[str]` — 기본은 `[sys.executable, "-m", "crefleai.worker", ...]`
    - 속성 `status: str`(`"stopped" | "starting" | "running" | "stopping" | "failed"`), `error: str | None`, `model_id: str | None`, `base_url: str`(`http://127.0.0.1:{port}`)
    - `async serve(model: CatalogModel, model_path: Path)` — 기존 워커 중지 → 스폰 → /health ready 대기. 실패 시 `WorkerError`
    - `async stop()`
  - 비정상 종료 시 watchdog이 같은 모델로 자동 재시작 (max_restarts 초과 시 status="failed")

- [ ] **Step 1: 가짜 워커 스크립트 작성**

`server/tests/fake_worker.py`:

```python
"""WorkerManager 테스트용 가짜 워커. /health에 ready로 응답한다."""
import argparse
import json
from http.server import BaseHTTPRequestHandler, HTTPServer


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            body = json.dumps({"status": "ready", "model": "fake"}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, required=True)
    args = parser.parse_args()
    HTTPServer(("127.0.0.1", args.port), Handler).serve_forever()
```

- [ ] **Step 2: 실패하는 테스트 작성**

`server/tests/test_worker_manager.py`:

```python
import asyncio
import sys
from pathlib import Path

import pytest

from crefleai.models.catalog import CatalogModel
from crefleai.models.worker_manager import WorkerError, WorkerManager

FAKE_WORKER = Path(__file__).parent / "fake_worker.py"
MODEL = CatalogModel(
    id="tiny", display_name="Tiny", hf_repo="org/tiny", filename="tiny.gguf",
    quantization="Q4_K_M", size_bytes=1, context_length=2048, license="MIT", description="",
)
PORT = 18801


def fake_command(model, model_path):
    return [sys.executable, str(FAKE_WORKER), "--port", str(PORT)]


async def test_서빙_시작과_중지():
    wm = WorkerManager(PORT, 2048, command_builder=fake_command, startup_timeout=15)
    await wm.serve(MODEL, Path("/fake/tiny.gguf"))
    assert wm.status == "running"
    assert wm.model_id == "tiny"

    await wm.stop()
    assert wm.status == "stopped"


async def test_기동_실패시_WorkerError():
    def broken_command(model, model_path):
        return [sys.executable, "-c", "import time; time.sleep(60)"]  # health 응답 없음

    wm = WorkerManager(PORT, 2048, command_builder=broken_command, startup_timeout=2)
    with pytest.raises(WorkerError):
        await wm.serve(MODEL, Path("/fake/tiny.gguf"))
    assert wm.status == "failed"
    await wm.stop()


async def test_비정상_종료시_자동_재시작():
    wm = WorkerManager(PORT, 2048, command_builder=fake_command, startup_timeout=15)
    await wm.serve(MODEL, Path("/fake/tiny.gguf"))
    first_pid = wm._proc.pid

    wm._proc.terminate()  # 비정상 종료 시뮬레이션
    for _ in range(100):
        await asyncio.sleep(0.2)
        if wm.status == "running" and wm._proc.pid != first_pid:
            break
    assert wm.status == "running"
    assert wm._proc.pid != first_pid
    await wm.stop()
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `cd server && uv run pytest tests/test_worker_manager.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'crefleai.models.worker_manager'`

- [ ] **Step 4: 구현**

`server/src/crefleai/models/worker_manager.py`:

```python
import asyncio
import sys
from pathlib import Path

import httpx

from crefleai.models.catalog import CatalogModel


class WorkerError(Exception):
    """워커 기동 실패."""


class WorkerManager:
    """추론 워커 서브프로세스를 스폰·감시한다. 워커는 항상 0개 또는 1개."""

    def __init__(
        self,
        port: int,
        ctx: int,
        command_builder=None,
        startup_timeout: float = 600.0,
        max_restarts: int = 3,
    ):
        self._port = port
        self._ctx = ctx
        self._command_builder = command_builder or self._default_command
        self._startup_timeout = startup_timeout
        self._max_restarts = max_restarts
        self._proc: asyncio.subprocess.Process | None = None
        self._watchdog: asyncio.Task | None = None
        self._model: CatalogModel | None = None
        self._model_path: Path | None = None
        self._restarts = 0
        self.status = "stopped"
        self.error: str | None = None

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self._port}"

    @property
    def model_id(self) -> str | None:
        return self._model.id if self._model else None

    def _default_command(self, model: CatalogModel, model_path: Path) -> list[str]:
        return [
            sys.executable, "-m", "crefleai.worker",
            "--model-path", str(model_path),
            "--model-id", model.id,
            "--port", str(self._port),
            "--ctx", str(self._ctx),
        ]

    async def serve(self, model: CatalogModel, model_path: Path) -> None:
        await self.stop()
        self._model, self._model_path = model, model_path
        self._restarts = 0
        await self._spawn()

    async def _spawn(self) -> None:
        self.status, self.error = "starting", None
        self._proc = await asyncio.create_subprocess_exec(
            *self._command_builder(self._model, self._model_path)
        )
        try:
            await self._wait_ready()
        except WorkerError as e:
            self.status, self.error = "failed", str(e)
            await self._terminate()
            raise
        self.status = "running"
        self._watchdog = asyncio.create_task(self._watch())

    async def _wait_ready(self) -> None:
        loop = asyncio.get_running_loop()
        deadline = loop.time() + self._startup_timeout
        async with httpx.AsyncClient(timeout=5.0) as client:
            while loop.time() < deadline:
                if self._proc.returncode is not None:
                    raise WorkerError(f"워커가 기동 중 종료됨 (exit code {self._proc.returncode})")
                try:
                    r = await client.get(f"{self.base_url}/health")
                    if r.status_code == 200 and r.json().get("status") == "ready":
                        return
                except httpx.TransportError:
                    pass
                await asyncio.sleep(0.5)
        raise WorkerError("워커 기동 시간 초과")

    async def _watch(self) -> None:
        proc = self._proc
        await proc.wait()
        if self.status == "stopping" or proc is not self._proc:
            return
        self._restarts += 1
        if self._restarts > self._max_restarts:
            self.status = "failed"
            self.error = "워커가 반복적으로 종료되어 재시작을 중단했습니다"
            return
        try:
            await self._spawn()
        except WorkerError:
            pass  # 상태는 _spawn이 failed로 기록

    async def _terminate(self) -> None:
        if self._proc and self._proc.returncode is None:
            self._proc.terminate()
            try:
                await asyncio.wait_for(self._proc.wait(), timeout=10)
            except asyncio.TimeoutError:
                self._proc.kill()
                await self._proc.wait()

    async def stop(self) -> None:
        self.status = "stopping"
        if self._watchdog:
            self._watchdog.cancel()
            self._watchdog = None
        await self._terminate()
        self._proc = None
        self.status = "stopped"
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `cd server && uv run pytest tests/test_worker_manager.py -v`
Expected: PASS (3 passed) — 서브프로세스 기동 때문에 수 초 걸릴 수 있다

- [ ] **Step 6: 커밋**

```bash
git add server/
git commit -m "feat(server): 워커 프로세스 매니저(스폰·감시·자동재시작) 추가"
```

---

### Task 11: 관리자 모델 API

**Files:**
- Modify: `server/src/crefleai/main.py` (lifespan에 catalog/download_manager/worker_manager 추가)
- Modify: `server/src/crefleai/api/deps.py` (get_catalog, get_download_manager, get_worker_manager 추가)
- Modify: `server/src/crefleai/api/admin.py` (모델 엔드포인트 추가)
- Test: `server/tests/test_admin_models_api.py`

**Interfaces:**
- Consumes: `load_catalog`, `DownloadManager`, `WorkerManager`, `model_file`, `require_admin`
- Produces:
  - `GET /admin/models` → `{"models": [{id, display_name, quantization, size_bytes, context_length, license, description, status, progress, error}], "worker": {status, model_id, error}}` — 모델 status는 `not_downloaded | downloading | ready | serving | failed`
  - `POST /admin/models/{model_id}/download` → 202 `{"ok": true}` / 404 / 409(이미 진행·완료)
  - `POST /admin/models/{model_id}/serve` → 202 `{"ok": true}` / 404 / 409(미다운로드). 백그라운드로 `wm.serve` 후 성공 시 `db.set_setting("serving_model", model_id)`
  - `app.state`: `catalog`, `download_manager`, `worker_manager`

- [ ] **Step 1: 실패하는 테스트 작성**

`server/tests/test_admin_models_api.py`:

```python
import time

from crefleai.models.catalog import load_catalog, model_file


class FakeWorkerManager:
    def __init__(self):
        self.status = "stopped"
        self.error = None
        self.model_id = None
        self.base_url = "http://worker"
        self.served = []

    async def serve(self, model, model_path):
        self.served.append((model.id, model_path))
        self.model_id = model.id
        self.status = "running"

    async def stop(self):
        self.status = "stopped"


def test_모델_목록은_카탈로그와_상태를_반환(admin_client):
    body = admin_client.get("/admin/models").json()
    catalog = load_catalog()
    assert {m["id"] for m in body["models"]} == set(catalog)
    assert all(m["status"] == "not_downloaded" for m in body["models"])
    assert body["worker"]["status"] == "stopped"


def test_없는_모델_다운로드는_404(admin_client):
    assert admin_client.post("/admin/models/없는모델/download").status_code == 404


def test_미다운로드_모델_서빙은_409(admin_client):
    model_id = next(iter(load_catalog()))
    assert admin_client.post(f"/admin/models/{model_id}/serve").status_code == 409


def test_서빙_성공_흐름(admin_client):
    app = admin_client.app
    fake_wm = FakeWorkerManager()
    app.state.worker_manager = fake_wm

    model_id = next(iter(load_catalog()))
    model = load_catalog()[model_id]
    path = model_file(app.state.settings.models_dir, model)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"fake gguf")  # 다운로드 완료 상태로 만든다

    res = admin_client.post(f"/admin/models/{model_id}/serve")
    assert res.status_code == 202

    for _ in range(50):  # 백그라운드 서빙 완료 대기
        time.sleep(0.1)
        if app.state.db.get_setting("serving_model") == model_id:
            break
    assert fake_wm.served == [(model_id, path)]
    assert app.state.db.get_setting("serving_model") == model_id

    body = admin_client.get("/admin/models").json()
    serving = next(m for m in body["models"] if m["id"] == model_id)
    assert serving["status"] == "serving"


def test_모델_API도_로그인_필요(client):
    assert client.get("/admin/models").status_code == 401
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd server && uv run pytest tests/test_admin_models_api.py -v`
Expected: FAIL — 404 (라우트 없음)

- [ ] **Step 3: 구현**

`server/src/crefleai/main.py`의 `_lifespan`을 확장:

```python
from crefleai.models.catalog import load_catalog
from crefleai.models.downloads import DownloadManager
from crefleai.models.worker_manager import WorkerManager


@asynccontextmanager
async def _lifespan(app: FastAPI):
    settings: Settings = app.state.settings
    app.state.db = Database(settings.db_path)
    bootstrap_admin(app.state.db, settings)
    app.state.catalog = load_catalog()
    app.state.download_manager = DownloadManager(settings.models_dir, app.state.catalog)
    app.state.worker_manager = WorkerManager(settings.worker_port, settings.worker_ctx)
    yield
    await app.state.worker_manager.stop()
    app.state.db.close()
```

`server/src/crefleai/api/deps.py`에 추가:

```python
def get_catalog(request: Request) -> dict:
    return request.app.state.catalog


def get_download_manager(request: Request):
    return request.app.state.download_manager


def get_worker_manager(request: Request):
    return request.app.state.worker_manager
```

`server/src/crefleai/api/admin.py`에 추가 (import에 `asyncio`, `dataclasses.asdict`, `Request`, `get_catalog`, `get_download_manager`, `get_worker_manager`, `model_file` 추가):

```python
import asyncio
from dataclasses import asdict

from fastapi import Request

from crefleai.api.deps import get_catalog, get_download_manager, get_worker_manager
from crefleai.models.catalog import model_file


@router.get("/models")
def list_models(
    request: Request,
    catalog: dict = Depends(get_catalog),
    _admin: dict = Depends(require_admin),
):
    dm = request.app.state.download_manager
    wm = request.app.state.worker_manager
    models = []
    for m in catalog.values():
        state = dm.state_for(m.id)
        if wm.model_id == m.id and wm.status == "running":
            status = "serving"
        elif state.status == "idle":
            status = "not_downloaded"
        else:
            status = state.status
        models.append(
            {**asdict(m), "status": status, "progress": state.progress, "error": state.error}
        )
    return {
        "models": models,
        "worker": {"status": wm.status, "model_id": wm.model_id, "error": wm.error},
    }


@router.post("/models/{model_id}/download", status_code=202)
async def download_model(
    model_id: str,
    catalog: dict = Depends(get_catalog),
    dm=Depends(get_download_manager),
    _admin: dict = Depends(require_admin),
):
    if model_id not in catalog:
        raise APIError(404, f"카탈로그에 없는 모델입니다: {model_id}", "invalid_request_error")
    if not dm.start(model_id):
        raise APIError(409, "이미 다운로드되었거나 진행 중입니다", "invalid_request_error")
    return {"ok": True}


@router.post("/models/{model_id}/serve", status_code=202)
async def serve_model(
    model_id: str,
    request: Request,
    catalog: dict = Depends(get_catalog),
    dm=Depends(get_download_manager),
    _admin: dict = Depends(require_admin),
):
    model = catalog.get(model_id)
    if model is None:
        raise APIError(404, f"카탈로그에 없는 모델입니다: {model_id}", "invalid_request_error")
    if dm.state_for(model_id).status != "ready":
        raise APIError(409, "모델이 아직 다운로드되지 않았습니다", "invalid_request_error")

    wm = request.app.state.worker_manager
    db = request.app.state.db
    path = model_file(request.app.state.settings.models_dir, model)

    async def _serve_and_persist():
        try:
            await wm.serve(model, path)
            db.set_setting("serving_model", model_id)
        except Exception:  # noqa: BLE001 — 실패 상태는 wm.status/error로 노출된다
            pass

    request.app.state.serve_task = asyncio.create_task(_serve_and_persist())
    return {"ok": True}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd server && uv run pytest tests/test_admin_models_api.py -v`
Expected: PASS (5 passed)

- [ ] **Step 5: 커밋**

```bash
git add server/
git commit -m "feat(server): 관리자 모델 목록·다운로드·서빙 API 추가"
```

---

### Task 12: OpenAI 호환 v1 API

**Files:**
- Modify: `server/src/crefleai/api/deps.py` (require_user_token, get_http_client 추가)
- Modify: `server/src/crefleai/main.py` (http_client 생성, v1 라우터 등록)
- Create: `server/src/crefleai/api/v1.py`
- Test: `server/tests/test_v1_api.py`

**Interfaces:**
- Consumes: `verify_user_token`, `WorkerManager.status / model_id / base_url`, `app.state.http_client`
- Produces:
  - 의존성 `require_user_token(request) -> dict` — `Authorization: Bearer` 검증, 실패 시 401 (code `invalid_api_key`)
  - `GET /v1/models` → `{"object": "list", "data": [{id, object: "model", created, owned_by}]}` (0개 또는 1개)
  - `POST /v1/chat/completions` — 워커로 프록시. 에러 매핑:
    - 워커 미가동: 503 / 지정한 `model`이 서비스 모델과 다름: 404 / 워커 연결 실패: 502
    - `stream: true`면 워커 SSE를 그대로 통과
  - `app.state.http_client: httpx.AsyncClient`

- [ ] **Step 1: 실패하는 테스트 작성**

`server/tests/test_v1_api.py`:

```python
import httpx
import pytest
from fastapi import FastAPI
from fastapi.responses import StreamingResponse


def make_fake_worker_app() -> FastAPI:
    app = FastAPI()

    @app.post("/completion")
    async def completion(body: dict):
        if body.get("stream"):
            async def gen():
                yield b'data: {"choices":[{"delta":{"content":"an"}}],"model":"m"}\n\n'
                yield b'data: {"choices":[{"delta":{"content":"nyeong"}}],"model":"m"}\n\n'
                yield b"data: [DONE]\n\n"
            return StreamingResponse(gen(), media_type="text/event-stream")
        return {
            "id": "chatcmpl-1",
            "object": "chat.completion",
            "model": "m",
            "choices": [
                {"index": 0, "message": {"role": "assistant", "content": "안녕"}, "finish_reason": "stop"}
            ],
            "usage": {"prompt_tokens": 3, "completion_tokens": 2, "total_tokens": 5},
        }

    return app


class FakeWorkerManager:
    def __init__(self, status="running", model_id="tiny"):
        self.status = status
        self.model_id = model_id
        self.error = None
        self.base_url = "http://worker"


@pytest.fixture
def user_token(admin_client):
    return admin_client.post(
        "/admin/tokens", json={"user_name": "홍길동", "purpose": "테스트"}
    ).json()["token"]


@pytest.fixture
def v1_client(admin_client):
    app = admin_client.app
    app.state.worker_manager = FakeWorkerManager()
    app.state.http_client = httpx.AsyncClient(
        transport=httpx.ASGITransport(app=make_fake_worker_app()), base_url="http://worker"
    )
    return admin_client


def test_토큰_없으면_401(v1_client):
    res = v1_client.post("/v1/chat/completions", json={"messages": []})
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "invalid_api_key"


def test_models_목록(v1_client, user_token):
    res = v1_client.get("/v1/models", headers={"Authorization": f"Bearer {user_token}"})
    assert res.status_code == 200
    assert [m["id"] for m in res.json()["data"]] == ["tiny"]


def test_비스트리밍_프록시(v1_client, user_token):
    res = v1_client.post(
        "/v1/chat/completions",
        headers={"Authorization": f"Bearer {user_token}"},
        json={"messages": [{"role": "user", "content": "hi"}]},
    )
    assert res.status_code == 200
    assert res.json()["choices"][0]["message"]["content"] == "안녕"
    assert res.json()["usage"]["total_tokens"] == 5


def test_스트리밍_프록시(v1_client, user_token):
    with v1_client.stream(
        "POST",
        "/v1/chat/completions",
        headers={"Authorization": f"Bearer {user_token}"},
        json={"messages": [{"role": "user", "content": "hi"}], "stream": True},
    ) as res:
        assert res.headers["content-type"].startswith("text/event-stream")
        lines = [l for l in res.iter_lines() if l.startswith("data: ")]
    assert lines[-1] == "data: [DONE]"


def test_워커_미가동시_503(v1_client, user_token):
    v1_client.app.state.worker_manager = FakeWorkerManager(status="stopped", model_id=None)
    res = v1_client.post(
        "/v1/chat/completions",
        headers={"Authorization": f"Bearer {user_token}"},
        json={"messages": []},
    )
    assert res.status_code == 503


def test_다른_모델_지정시_404(v1_client, user_token):
    res = v1_client.post(
        "/v1/chat/completions",
        headers={"Authorization": f"Bearer {user_token}"},
        json={"messages": [], "model": "없는-모델"},
    )
    assert res.status_code == 404
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd server && uv run pytest tests/test_v1_api.py -v`
Expected: FAIL — 404 (라우트 없음)

- [ ] **Step 3: 구현**

`server/src/crefleai/api/deps.py`에 추가:

```python
import httpx

from crefleai.auth.tokens import verify_user_token


def get_http_client(request: Request) -> httpx.AsyncClient:
    return request.app.state.http_client


def require_user_token(request: Request) -> dict:
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        raise APIError(
            401, "Authorization 헤더에 Bearer 토큰이 필요합니다",
            "invalid_request_error", "invalid_api_key",
        )
    try:
        return verify_user_token(
            request.app.state.db, request.app.state.settings.jwt_secret, header[7:]
        )
    except InvalidTokenError as e:
        raise APIError(
            401, "유효하지 않거나 폐기된 토큰입니다", "invalid_request_error", "invalid_api_key"
        ) from e
```

`server/src/crefleai/api/v1.py`:

```python
import json

import httpx
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, StreamingResponse

from crefleai.api.deps import get_http_client, get_worker_manager, require_user_token
from crefleai.api.errors import APIError

router = APIRouter(prefix="/v1", tags=["v1"])


@router.get("/models")
async def list_models(
    wm=Depends(get_worker_manager),
    _token: dict = Depends(require_user_token),
):
    data = []
    if wm.status == "running" and wm.model_id:
        data.append({"id": wm.model_id, "object": "model", "created": 0, "owned_by": "crefleai"})
    return {"object": "list", "data": data}


@router.post("/chat/completions")
async def chat_completions(
    request: Request,
    wm=Depends(get_worker_manager),
    client: httpx.AsyncClient = Depends(get_http_client),
    _token: dict = Depends(require_user_token),
):
    body = await request.json()
    if wm.status != "running":
        raise APIError(503, "현재 서비스 중인 모델이 없습니다", "service_unavailable")
    requested = body.get("model")
    if requested not in (None, wm.model_id):
        raise APIError(404, f"모델을 찾을 수 없습니다: {requested}", "invalid_request_error")

    url = f"{wm.base_url}/completion"
    if body.get("stream"):
        async def relay():
            try:
                async with client.stream("POST", url, json=body, timeout=None) as response:
                    async for chunk in response.aiter_raw():
                        yield chunk
            except httpx.TransportError:
                payload = {"error": {"message": "추론 워커에 연결할 수 없습니다", "type": "server_error"}}
                yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n".encode()

        return StreamingResponse(relay(), media_type="text/event-stream")

    try:
        response = await client.post(url, json=body, timeout=None)
    except httpx.TransportError as e:
        raise APIError(502, "추론 워커에 연결할 수 없습니다", "server_error") from e
    return JSONResponse(response.json(), status_code=response.status_code)
```

`server/src/crefleai/main.py` 수정 — `_lifespan`에 http_client 추가, v1 라우터 등록:

```python
import httpx

from crefleai.api import v1 as v1_api

# _lifespan 안 (worker_manager 생성 다음 줄):
    app.state.http_client = httpx.AsyncClient(timeout=httpx.Timeout(10, read=None))
# yield 후 정리(순서 유지):
    await app.state.worker_manager.stop()
    await app.state.http_client.aclose()
    app.state.db.close()

# create_app 안:
    app.include_router(v1_api.router)
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd server && uv run pytest tests/test_v1_api.py -v`
Expected: PASS (6 passed)

- [ ] **Step 5: 커밋**

```bash
git add server/
git commit -m "feat(server): OpenAI 호환 v1 API(프록시·스트리밍) 추가"
```

---

### Task 13: 기동 시 서비스 모델 복원

**Files:**
- Modify: `server/src/crefleai/main.py`
- Test: `server/tests/test_startup_restore.py`

**Interfaces:**
- Consumes: `db.get_setting("serving_model")`, `load_catalog`, `model_file`, `WorkerManager.serve`
- Produces: lifespan에서 조건 만족 시(`serving_model` 설정 존재 + 카탈로그에 있음 + 파일 존재) `app.state.restore_task = asyncio.create_task(wm.serve(...))`. 조건 미달이면 워커는 stopped 유지, 기동은 정상 진행.

- [ ] **Step 1: 실패하는 테스트 작성**

`server/tests/test_startup_restore.py`:

```python
import time

from fastapi.testclient import TestClient

from crefleai.db import Database
from crefleai.main import create_app
from crefleai.models.catalog import load_catalog, model_file


def _preset_serving_model(settings, model_id: str):
    db = Database(settings.db_path)
    db.set_setting("serving_model", model_id)
    db.close()


def test_파일_없으면_복원하지_않고_정상_기동(settings):
    _preset_serving_model(settings, next(iter(load_catalog())))
    with TestClient(create_app(settings)) as client:
        assert client.app.state.worker_manager.status == "stopped"
        assert client.app.state.restore_task is None


def test_조건_충족시_복원_시도(settings, monkeypatch):
    served = []

    async def fake_serve(self, model, model_path):
        served.append(model.id)
        self.status = "running"

    from crefleai.models.worker_manager import WorkerManager

    monkeypatch.setattr(WorkerManager, "serve", fake_serve)

    model_id = next(iter(load_catalog()))
    model = load_catalog()[model_id]
    path = model_file(settings.models_dir, model)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"fake gguf")
    _preset_serving_model(settings, model_id)

    with TestClient(create_app(settings)) as client:
        for _ in range(50):
            time.sleep(0.1)
            if served:
                break
        assert served == [model_id]
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd server && uv run pytest tests/test_startup_restore.py -v`
Expected: FAIL — `AttributeError: restore_task` (state에 없음)

- [ ] **Step 3: main.py에 복원 로직 추가**

`server/src/crefleai/main.py`에 추가:

```python
import asyncio

from crefleai.models.catalog import model_file


def _maybe_restore(app: FastAPI) -> asyncio.Task | None:
    db = app.state.db
    catalog = app.state.catalog
    settings = app.state.settings
    model_id = db.get_setting("serving_model")
    model = catalog.get(model_id) if model_id else None
    if model is None:
        return None
    path = model_file(settings.models_dir, model)
    if not path.exists():
        return None
    return asyncio.create_task(app.state.worker_manager.serve(model, path))


# _lifespan 안, http_client 생성 다음 줄:
    app.state.restore_task = _maybe_restore(app)
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd server && uv run pytest tests/test_startup_restore.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: 백엔드 전체 테스트 및 커밋**

Run: `cd server && uv run pytest -q && uv run ruff check .`
Expected: 전부 PASS, ruff 위반 0건

```bash
git add server/
git commit -m "feat(server): 기동 시 서비스 모델 자동 복원 추가"
```

## Phase 2 — 프론트엔드

### Task 14: web 스캐폴딩 + API 클라이언트

**Files:**
- Create: `web/` (Vite react-ts 템플릿)
- Modify: `web/package.json` (test 스크립트), `web/vite.config.ts` (프록시 + vitest)
- Create: `web/src/api.ts`, `web/src/types.ts`, `web/src/test-setup.ts`
- Test: `web/src/api.test.ts`

**Interfaces:**
- Produces: `api<T>(path: string, init?: RequestInit): Promise<T>` — `credentials: "include"` + JSON 헤더 기본, 실패 시 `ApiError(status, message)` (message는 OpenAI 에러 형식에서 추출)
- Produces: `ApiError extends Error` — `status: number`
- Produces: 타입 `TokenInfo, CreatedToken, ModelInfo, WorkerInfo, AdminModels, ChatMessage`
- 개발 서버는 `/admin`, `/v1`을 `http://localhost:8000`으로 프록시 (CORS 불필요)

- [ ] **Step 1: 스캐폴딩**

```bash
cd /Users/rangkim/projects/crefle/apps/crefleai
npm create vite@latest web -- --template react-ts
cd web
npm install
npm install react-router-dom
npm install -D vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event prettier
```

`web/package.json`의 scripts에 추가: `"test": "vitest run"`

`web/vite.config.ts` 전체 교체:

```ts
/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/admin": "http://localhost:8000",
      "/v1": "http://localhost:8000",
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test-setup.ts",
    globals: true,
  },
});
```

`web/src/test-setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 2: 실패하는 테스트 작성**

`web/src/api.test.ts`:

```ts
import { afterEach, expect, it, vi } from "vitest";
import { api } from "./api";

afterEach(() => vi.unstubAllGlobals());

it("JSON 응답을 반환한다", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 })),
  );
  await expect(api("/admin/me")).resolves.toEqual({ ok: true });
});

it("에러 응답이면 OpenAI 형식 메시지로 ApiError를 던진다", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "로그인이 필요합니다" } }), {
        status: 401,
      }),
    ),
  );
  await expect(api("/admin/me")).rejects.toMatchObject({
    status: 401,
    message: "로그인이 필요합니다",
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `cd web && npm test`
Expected: FAIL — `Cannot find module './api'`

- [ ] **Step 4: 구현**

`web/src/api.ts`:

```ts
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    let message = `요청 실패 (${res.status})`;
    try {
      const body = await res.json();
      message = body?.error?.message ?? message;
    } catch {
      // JSON이 아닌 에러 응답은 기본 메시지 유지
    }
    throw new ApiError(res.status, message);
  }
  return res.json() as Promise<T>;
}
```

`web/src/types.ts`:

```ts
export interface TokenInfo {
  jti: string;
  user_name: string;
  purpose: string;
  created_at: string;
  revoked_at: string | null;
}

export interface CreatedToken {
  token: string;
  jti: string;
  user_name: string;
  purpose: string;
  created_at: string;
}

export interface ModelInfo {
  id: string;
  display_name: string;
  hf_repo: string;
  filename: string;
  quantization: string;
  size_bytes: number;
  context_length: number;
  license: string;
  description: string;
  status: string;
  progress: number;
  error: string | null;
}

export interface WorkerInfo {
  status: string;
  model_id: string | null;
  error: string | null;
}

export interface AdminModels {
  models: ModelInfo[];
  worker: WorkerInfo;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `cd web && npm test`
Expected: PASS (2 passed)

- [ ] **Step 6: 커밋**

```bash
git add web/
git commit -m "feat(web): Vite React 스캐폴딩과 API 클라이언트 추가"
```

---

### Task 15: 라우팅 + 관리자 로그인 화면

**Files:**
- Modify: `web/src/App.tsx` (전체 교체), `web/src/index.css` (전체 교체)
- Delete: `web/src/App.css`, `web/src/assets/react.svg` (템플릿 잔재)
- Create: `web/src/admin/LoginPage.tsx`, `web/src/admin/RequireAdmin.tsx`, `web/src/admin/AdminLayout.tsx`
- Create: `web/src/admin/ModelsPage.tsx`, `web/src/admin/TokensPage.tsx`, `web/src/chat/ChatPage.tsx` (스텁 — Task 16~18에서 교체)
- Test: `web/src/admin/LoginPage.test.tsx`

**Interfaces:**
- Consumes: `api`, `ApiError`
- Produces: 라우트 `/login`, `/admin/models`, `/admin/tokens`, `/chat` (기본 리다이렉트 `*` → `/chat`, `/admin` → `/admin/models`)
- Produces: `RequireAdmin` — `GET /admin/me` 성공 시 children, 401이면 `/login`으로 이동
- Produces: `AdminLayout` — 탭 내비게이션(모델 관리/토큰 관리/Chat 테스트) + 로그아웃 + `<Outlet />`

- [ ] **Step 1: 실패하는 테스트 작성**

`web/src/admin/LoginPage.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import LoginPage from "./LoginPage";

afterEach(() => vi.unstubAllGlobals());

it("아이디/비밀번호로 로그인 요청을 보낸다", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);

  render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  );
  await userEvent.type(screen.getByLabelText("아이디"), "admin");
  await userEvent.type(screen.getByLabelText("비밀번호"), "pw");
  await userEvent.click(screen.getByRole("button", { name: "로그인" }));

  expect(fetchMock).toHaveBeenCalledWith(
    "/admin/login",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ username: "admin", password: "pw" }),
    }),
  );
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd web && npm test`
Expected: FAIL — `Cannot find module './LoginPage'`

- [ ] **Step 3: 구현**

`web/src/admin/LoginPage.tsx`:

```tsx
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api("/admin/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      navigate("/admin/models");
    } catch (err) {
      setError(err instanceof Error ? err.message : "로그인 실패");
    }
  }

  return (
    <main className="login">
      <h1>CrefleAI 관리자</h1>
      <form onSubmit={onSubmit}>
        <label>
          아이디
          <input value={username} onChange={(e) => setUsername(e.target.value)} />
        </label>
        <label>
          비밀번호
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button type="submit">로그인</button>
      </form>
      {error && <p role="alert">{error}</p>}
    </main>
  );
}
```

`web/src/admin/RequireAdmin.tsx`:

```tsx
import { useEffect, useState, type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { api } from "../api";

export default function RequireAdmin({ children }: { children: ReactNode }) {
  const [state, setState] = useState<"loading" | "ok" | "unauthorized">("loading");

  useEffect(() => {
    api("/admin/me")
      .then(() => setState("ok"))
      .catch(() => setState("unauthorized"));
  }, []);

  if (state === "loading") return <p>확인 중...</p>;
  if (state === "unauthorized") return <Navigate to="/login" replace />;
  return <>{children}</>;
}
```

`web/src/admin/AdminLayout.tsx`:

```tsx
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { api } from "../api";

export default function AdminLayout() {
  const navigate = useNavigate();

  async function logout() {
    await api("/admin/logout", { method: "POST" });
    navigate("/login");
  }

  return (
    <div className="admin-layout">
      <header>
        <strong>CrefleAI 관리자</strong>
        <nav>
          <NavLink to="/admin/models">모델 관리</NavLink>
          <NavLink to="/admin/tokens">토큰 관리</NavLink>
          <NavLink to="/chat">Chat 테스트</NavLink>
        </nav>
        <button onClick={logout}>로그아웃</button>
      </header>
      <Outlet />
    </div>
  );
}
```

스텁 3개 (Task 16~18에서 실제 구현으로 교체):

`web/src/admin/ModelsPage.tsx`:

```tsx
export default function ModelsPage() {
  return <p>모델 관리 — 준비 중</p>;
}
```

`web/src/admin/TokensPage.tsx`:

```tsx
export default function TokensPage() {
  return <p>토큰 관리 — 준비 중</p>;
}
```

`web/src/chat/ChatPage.tsx`:

```tsx
export default function ChatPage() {
  return <p>Chat 테스트 — 준비 중</p>;
}
```

`web/src/App.tsx` 전체 교체:

```tsx
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import AdminLayout from "./admin/AdminLayout";
import LoginPage from "./admin/LoginPage";
import ModelsPage from "./admin/ModelsPage";
import RequireAdmin from "./admin/RequireAdmin";
import TokensPage from "./admin/TokensPage";
import ChatPage from "./chat/ChatPage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/admin"
          element={
            <RequireAdmin>
              <AdminLayout />
            </RequireAdmin>
          }
        >
          <Route index element={<Navigate to="models" replace />} />
          <Route path="models" element={<ModelsPage />} />
          <Route path="tokens" element={<TokensPage />} />
        </Route>
        <Route path="/chat" element={<ChatPage />} />
        <Route path="*" element={<Navigate to="/chat" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
```

`web/src/index.css` 전체 교체 (`web/src/App.css`와 `web/src/assets/react.svg` 삭제, `main.tsx`의 App.css import 제거):

```css
:root {
  font-family: system-ui, sans-serif;
  color-scheme: light dark;
}
body {
  margin: 0;
}
.admin-layout header {
  display: flex;
  gap: 1rem;
  align-items: center;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid #8884;
}
.admin-layout section,
.chat,
.login {
  max-width: 60rem;
  margin: 0 auto;
  padding: 1rem;
}
table {
  border-collapse: collapse;
  width: 100%;
}
th,
td {
  border-bottom: 1px solid #8884;
  padding: 0.5rem;
  text-align: left;
}
label {
  display: block;
  margin: 0.5rem 0;
}
input,
textarea {
  display: block;
  width: 100%;
  max-width: 24rem;
  padding: 0.4rem;
}
.token-modal {
  border: 1px solid #8886;
  padding: 1rem;
  margin: 1rem 0;
  word-break: break-all;
}
.messages {
  list-style: none;
  padding: 0;
}
.messages li {
  margin: 0.75rem 0;
}
.messages li p {
  padding: 0.5rem;
  border-radius: 6px;
  white-space: pre-wrap;
}
.messages li.user p {
  background: #4a90d922;
}
.messages li.assistant p {
  background: #8883;
}
[role="alert"] {
  color: #c0392b;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd web && npm test && npm run build`
Expected: 테스트 PASS + 빌드 성공

- [ ] **Step 5: 커밋**

```bash
git add web/
git commit -m "feat(web): 라우팅과 관리자 로그인 화면 추가"
```

---

### Task 16: 모델 관리 화면

**Files:**
- Modify: `web/src/admin/ModelsPage.tsx` (스텁 교체)
- Test: `web/src/admin/ModelsPage.test.tsx`

**Interfaces:**
- Consumes: `api`, `AdminModels`, `ModelInfo`, `GET /admin/models`(3초 폴링), `POST /admin/models/{id}/download`, `POST /admin/models/{id}/serve`
- Produces: 카탈로그 테이블(이름·양자화·크기·라이선스·상태 배지·진행률), 상태별 버튼(미다운로드/실패→다운로드, 준비됨→서비스 시작), 워커 상태 표시

- [ ] **Step 1: 실패하는 테스트 작성**

`web/src/admin/ModelsPage.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { AdminModels } from "../types";
import ModelsPage from "./ModelsPage";

afterEach(() => vi.unstubAllGlobals());

const BODY: AdminModels = {
  models: [
    {
      id: "qwen3-8b-q4km",
      display_name: "Qwen3 8B (Q4_K_M)",
      hf_repo: "Qwen/Qwen3-8B-GGUF",
      filename: "Qwen3-8B-Q4_K_M.gguf",
      quantization: "Q4_K_M",
      size_bytes: 5030000000,
      context_length: 32768,
      license: "Apache-2.0",
      description: "테스트",
      status: "not_downloaded",
      progress: 0,
      error: null,
    },
  ],
  worker: { status: "stopped", model_id: null, error: null },
};

it("모델 목록과 다운로드 버튼을 보여준다", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(JSON.stringify(BODY), { status: 200 })),
  );
  render(<ModelsPage />);

  expect(await screen.findByText("Qwen3 8B (Q4_K_M)")).toBeInTheDocument();
  expect(screen.getByText("미다운로드")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "다운로드" })).toBeInTheDocument();
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd web && npm test`
Expected: FAIL — "미다운로드" 텍스트 없음 (스텁이 렌더링됨)

- [ ] **Step 3: 구현**

`web/src/admin/ModelsPage.tsx` 전체 교체:

```tsx
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { AdminModels } from "../types";

const STATUS_LABEL: Record<string, string> = {
  not_downloaded: "미다운로드",
  downloading: "다운로드 중",
  ready: "준비됨",
  serving: "서비스 중",
  failed: "실패",
};

function formatGb(bytes: number): string {
  return `${(bytes / 1e9).toFixed(1)} GB`;
}

export default function ModelsPage() {
  const [data, setData] = useState<AdminModels | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<AdminModels>("/admin/models"));
    } catch {
      // 폴링 중 일시 오류는 다음 주기에 회복된다
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [load]);

  async function act(path: string) {
    setActionError(null);
    try {
      await api(path, { method: "POST" });
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "요청 실패");
    }
  }

  if (!data) return <section>불러오는 중...</section>;

  return (
    <section>
      <h2>모델 관리</h2>
      <p>
        워커 상태: {data.worker.status}
        {data.worker.error && <span role="alert"> — {data.worker.error}</span>}
      </p>
      {actionError && <p role="alert">{actionError}</p>}
      <table>
        <thead>
          <tr>
            <th>모델</th>
            <th>양자화</th>
            <th>크기</th>
            <th>라이선스</th>
            <th>상태</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {data.models.map((m) => (
            <tr key={m.id}>
              <td>
                {m.display_name}
                <br />
                <small>{m.description}</small>
              </td>
              <td>{m.quantization}</td>
              <td>{formatGb(m.size_bytes)}</td>
              <td>{m.license}</td>
              <td>
                {STATUS_LABEL[m.status] ?? m.status}
                {m.status === "downloading" && ` ${(m.progress * 100).toFixed(0)}%`}
                {m.error && <small role="alert"> {m.error}</small>}
              </td>
              <td>
                {(m.status === "not_downloaded" || m.status === "failed") && (
                  <button onClick={() => act(`/admin/models/${m.id}/download`)}>
                    다운로드
                  </button>
                )}
                {m.status === "ready" && (
                  <button onClick={() => act(`/admin/models/${m.id}/serve`)}>
                    서비스 시작
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd web && npm test`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add web/
git commit -m "feat(web): 모델 관리 화면 추가"
```

---

### Task 17: 토큰 관리 화면

**Files:**
- Modify: `web/src/admin/TokensPage.tsx` (스텁 교체)
- Test: `web/src/admin/TokensPage.test.tsx`

**Interfaces:**
- Consumes: `api`, `TokenInfo`, `CreatedToken`, `GET/POST /admin/tokens`, `DELETE /admin/tokens/{jti}`
- Produces: 토큰 목록 테이블(사용자·목적·생성일·상태·폐기 버튼), 생성 폼(사용자 이름·사용 목적), 생성 직후 JWT 1회 표시 모달(복사 버튼)

- [ ] **Step 1: 실패하는 테스트 작성**

`web/src/admin/TokensPage.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import TokensPage from "./TokensPage";

afterEach(() => vi.unstubAllGlobals());

it("토큰 생성 시 1회 표시 모달을 보여준다", async () => {
  const fetchMock = vi.fn().mockImplementation((path: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            token: "aaa.bbb.ccc",
            jti: "j1",
            user_name: "홍길동",
            purpose: "테스트",
            created_at: "2026-08-04T00:00:00+00:00",
          }),
          { status: 200 },
        ),
      );
    }
    return Promise.resolve(new Response(JSON.stringify({ tokens: [] }), { status: 200 }));
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<TokensPage />);
  await userEvent.type(screen.getByLabelText("사용자 이름"), "홍길동");
  await userEvent.type(screen.getByLabelText("사용 목적"), "테스트");
  await userEvent.click(screen.getByRole("button", { name: "토큰 생성" }));

  expect(await screen.findByRole("dialog", { name: "발급된 토큰" })).toHaveTextContent(
    "aaa.bbb.ccc",
  );
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd web && npm test`
Expected: FAIL — 폼 요소 없음 (스텁이 렌더링됨)

- [ ] **Step 3: 구현**

`web/src/admin/TokensPage.tsx` 전체 교체:

```tsx
import { useEffect, useState, type FormEvent } from "react";
import { api } from "../api";
import type { CreatedToken, TokenInfo } from "../types";

export default function TokensPage() {
  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [userName, setUserName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [created, setCreated] = useState<CreatedToken | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setTokens((await api<{ tokens: TokenInfo[] }>("/admin/tokens")).tokens);
  }

  useEffect(() => {
    load().catch(() => setError("토큰 목록을 불러오지 못했습니다"));
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const token = await api<CreatedToken>("/admin/tokens", {
        method: "POST",
        body: JSON.stringify({ user_name: userName, purpose }),
      });
      setCreated(token);
      setUserName("");
      setPurpose("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "생성 실패");
    }
  }

  async function onRevoke(jti: string) {
    if (!window.confirm("이 토큰을 폐기할까요? 즉시 사용할 수 없게 됩니다.")) return;
    try {
      await api(`/admin/tokens/${jti}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "폐기 실패");
    }
  }

  return (
    <section>
      <h2>토큰 관리</h2>
      <form onSubmit={onCreate}>
        <label>
          사용자 이름
          <input value={userName} onChange={(e) => setUserName(e.target.value)} required />
        </label>
        <label>
          사용 목적
          <input value={purpose} onChange={(e) => setPurpose(e.target.value)} required />
        </label>
        <button type="submit">토큰 생성</button>
      </form>
      {error && <p role="alert">{error}</p>}

      {created && (
        <div role="dialog" aria-label="발급된 토큰" className="token-modal">
          <p>아래 토큰은 지금만 확인할 수 있습니다. 복사해서 사용자에게 전달하세요.</p>
          <code>{created.token}</code>
          <p>
            <button onClick={() => navigator.clipboard.writeText(created.token)}>
              복사
            </button>{" "}
            <button onClick={() => setCreated(null)}>닫기</button>
          </p>
        </div>
      )}

      <table>
        <thead>
          <tr>
            <th>사용자</th>
            <th>목적</th>
            <th>생성일</th>
            <th>상태</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {tokens.map((t) => (
            <tr key={t.jti}>
              <td>{t.user_name}</td>
              <td>{t.purpose}</td>
              <td>{t.created_at.slice(0, 10)}</td>
              <td>{t.revoked_at ? "폐기됨" : "활성"}</td>
              <td>{!t.revoked_at && <button onClick={() => onRevoke(t.jti)}>폐기</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd web && npm test`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add web/
git commit -m "feat(web): 토큰 관리 화면 추가"
```

---

### Task 18: Chat 테스트 화면 (SSE 스트리밍)

**Files:**
- Create: `web/src/sse.ts`
- Modify: `web/src/chat/ChatPage.tsx` (스텁 교체)
- Test: `web/src/sse.test.ts`

**Interfaces:**
- Consumes: `ChatMessage`, `POST /v1/chat/completions` (`stream: true`, `Authorization: Bearer`)
- Produces: `splitSseEvents(buffer: string): { events: string[]; rest: string }` — 완성된 SSE 이벤트의 data 페이로드 배열과 미완성 꼬리 분리
- Produces: Chat 화면 — 토큰 입력(localStorage `crefleai_token`), system 프롬프트·temperature 조절, 스트리밍 응답 실시간 표시

- [ ] **Step 1: 실패하는 테스트 작성**

`web/src/sse.test.ts`:

```ts
import { expect, it } from "vitest";
import { splitSseEvents } from "./sse";

it("완성된 이벤트만 추출하고 꼬리는 rest로 남긴다", () => {
  const first = splitSseEvents('data: {"a":1}\n\ndata: {"b"');
  expect(first.events).toEqual(['{"a":1}']);
  expect(first.rest).toBe('data: {"b"');

  const second = splitSseEvents(first.rest + ':2}\n\ndata: [DONE]\n\n');
  expect(second.events).toEqual(['{"b":2}', "[DONE]"]);
  expect(second.rest).toBe("");
});

it("data 라인이 아닌 내용은 무시한다", () => {
  const result = splitSseEvents(': keep-alive\n\ndata: {"x":1}\n\n');
  expect(result.events).toEqual(['{"x":1}']);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd web && npm test`
Expected: FAIL — `Cannot find module './sse'`

- [ ] **Step 3: 구현**

`web/src/sse.ts`:

```ts
export interface SseSplit {
  events: string[];
  rest: string;
}

/** SSE 버퍼에서 완성된 이벤트의 data 페이로드를 추출한다. 미완성 꼬리는 rest로 반환. */
export function splitSseEvents(buffer: string): SseSplit {
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  const events = parts
    .map((part) =>
      part
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => line.slice(6))
        .join(""),
    )
    .filter((data) => data.length > 0);
  return { events, rest };
}
```

`web/src/chat/ChatPage.tsx` 전체 교체:

```tsx
import { useState, type FormEvent } from "react";
import { splitSseEvents } from "../sse";
import type { ChatMessage } from "../types";

export default function ChatPage() {
  const [token, setToken] = useState(localStorage.getItem("crefleai_token") ?? "");
  const [system, setSystem] = useState("");
  const [temperature, setTemperature] = useState(0.7);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function saveToken(value: string) {
    setToken(value);
    localStorage.setItem("crefleai_token", value);
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!input.trim() || busy) return;
    setError(null);
    const history: ChatMessage[] = [...messages, { role: "user", content: input }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);
    try {
      const payload: ChatMessage[] = system
        ? [{ role: "system", content: system }, ...history]
        : history;
      const res = await fetch("/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ messages: payload, temperature, stream: true }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? `요청 실패 (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let assistant = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { events, rest } = splitSseEvents(buffer);
        buffer = rest;
        for (const event of events) {
          if (event === "[DONE]") continue;
          const parsed = JSON.parse(event);
          if (parsed.error) throw new Error(parsed.error.message);
          assistant += parsed.choices?.[0]?.delta?.content ?? "";
          setMessages([...history, { role: "assistant", content: assistant }]);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "요청 실패");
      setMessages(history); // 빈 어시스턴트 말풍선 제거
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="chat">
      <h1>CrefleAI Chat 테스트</h1>
      <details open={!token}>
        <summary>연결 설정</summary>
        <label>
          API 토큰
          <input
            value={token}
            onChange={(e) => saveToken(e.target.value)}
            placeholder="관리자에게 발급받은 토큰"
          />
        </label>
        <label>
          System 프롬프트
          <textarea value={system} onChange={(e) => setSystem(e.target.value)} />
        </label>
        <label>
          Temperature: {temperature}
          <input
            type="range"
            min="0"
            max="2"
            step="0.1"
            value={temperature}
            onChange={(e) => setTemperature(Number(e.target.value))}
          />
        </label>
      </details>

      <ol className="messages">
        {messages.map((m, i) => (
          <li key={i} className={m.role}>
            <strong>{m.role === "user" ? "나" : "모델"}</strong>
            <p>{m.content || "..."}</p>
          </li>
        ))}
      </ol>
      {error && <p role="alert">{error}</p>}

      <form onSubmit={send}>
        <label>
          메시지
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="메시지를 입력하세요"
          />
        </label>
        <button type="submit" disabled={busy || !token}>
          보내기
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd web && npm test && npm run build`
Expected: 테스트 PASS + 빌드 성공

- [ ] **Step 5: 커밋**

```bash
git add web/
git commit -m "feat(web): SSE 스트리밍 Chat 테스트 화면 추가"
```

---

### Task 19: SPA 정적 서빙 + README + 실모델 통합 테스트

**Files:**
- Modify: `server/src/crefleai/config.py` (`web_dist` 필드 추가)
- Modify: `server/src/crefleai/main.py` (SPA 정적 서빙)
- Create: `server/tests/test_spa_serving.py`
- Create: `server/tests/test_inference_integration.py`
- Create: `README.md`

**Interfaces:**
- Consumes: `web/dist` 빌드 결과물, `create_app`, 워커 `create_app`
- Produces: `Settings.web_dist: Path | None`(기본 None → 저장소 기본 위치 `web/dist` 자동 탐색), `SPAStaticFiles`(404 시 index.html 폴백), API 라우트가 정적 서빙보다 우선
- Produces: `inference` 마커 통합 테스트 — `CREFLEAI_TEST_GGUF` 환경변수의 GGUF로 워커 실추론 (기본 실행 제외)

- [ ] **Step 1: 실패하는 테스트 작성**

`server/tests/test_spa_serving.py`:

```python
from fastapi.testclient import TestClient

from crefleai.main import create_app


def test_spa_서빙과_폴백(settings, tmp_path):
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<html>CrefleAI</html>")

    spa_settings = settings.model_copy(update={"web_dist": dist})
    with TestClient(create_app(spa_settings)) as client:
        assert "CrefleAI" in client.get("/").text
        # SPA 딥링크는 index.html로 폴백
        assert "CrefleAI" in client.get("/admin/models-page").text
        # API 라우트는 정적 서빙보다 우선
        assert client.get("/admin/models").status_code == 401


def test_dist_없으면_정적_서빙_생략(settings):
    with TestClient(create_app(settings)) as client:
        assert client.get("/admin/models").status_code == 401
```

`server/tests/test_inference_integration.py`:

```python
import os

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.inference


def test_실모델_추론():
    gguf = os.environ.get("CREFLEAI_TEST_GGUF")
    if not gguf:
        pytest.skip("CREFLEAI_TEST_GGUF 환경변수가 없습니다")
    pytest.importorskip("llama_cpp")
    from crefleai.worker.app import create_app

    with TestClient(create_app(gguf, "test-model", 2048)) as client:
        res = client.post(
            "/completion",
            json={"messages": [{"role": "user", "content": "1+1은?"}], "max_tokens": 16},
        )
        assert res.status_code == 200
        assert res.json()["choices"][0]["message"]["content"]
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd server && uv run pytest tests/test_spa_serving.py -v`
Expected: FAIL — `web_dist` 필드 없음 (ValidationError)

- [ ] **Step 3: 구현**

`server/src/crefleai/config.py`의 `Settings`에 필드 추가:

```python
    web_dist: Path | None = None  # None이면 저장소 기본 위치(web/dist) 자동 탐색
```

`server/src/crefleai/main.py`에 추가:

```python
from pathlib import Path

from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException


class SPAStaticFiles(StaticFiles):
    """SPA 클라이언트 라우트 딥링크를 index.html로 폴백한다."""

    async def get_response(self, path: str, scope):
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as e:
            if e.status_code == 404:
                return await super().get_response("index.html", scope)
            raise


def _web_dist(settings: Settings) -> Path | None:
    if settings.web_dist is not None:
        return settings.web_dist
    default = Path(__file__).resolve().parents[3] / "web" / "dist"
    return default if default.exists() else None


# create_app 안, 라우터 등록 다음 줄:
    dist = _web_dist(app.state.settings)
    if dist is not None and dist.exists():
        app.mount("/", SPAStaticFiles(directory=dist, html=True), name="web")
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd server && uv run pytest tests/test_spa_serving.py -v && uv run pytest -q`
Expected: SPA 테스트 PASS, 전체 PASS (inference 마커는 자동 제외)

- [ ] **Step 5: README 작성**

`README.md`:

````markdown
# CrefleAI

사내 로컬 서버에서 오픈 소스 LLM(GGUF)을 OpenAI 호환 API로 서비스하는 서버.

- 설계 문서: `docs/superpowers/specs/2026-08-03-crefleai-llm-server-design.md`

## 요구 사항

- 운영: NVIDIA GPU 리눅스 서버 (CUDA 12+)
- Python 3.11+ / [uv](https://docs.astral.sh/uv/) / Node 20+

## 설치 (GPU 서버)

```bash
cd server
uv sync
# llama-cpp-python CUDA 빌드 (GPU 서버에서만 필요)
CMAKE_ARGS="-DGGML_CUDA=on" uv pip install -e ".[worker]"

cd ../web
npm ci && npm run build
```

## 실행

```bash
export CREFLEAI_JWT_SECRET="$(openssl rand -hex 32)"   # 필수
export CREFLEAI_ADMIN_ID=admin                          # 최초 1회 관리자 계정 생성용
export CREFLEAI_ADMIN_PASSWORD='초기-비밀번호'

cd server && uv run crefleai
```

- 관리자 화면: `http://<서버>:8000/admin` — 모델 다운로드 → 서비스 시작 → 토큰 발급
- Chat 테스트: `http://<서버>:8000/chat`
- API 사용: `openai` SDK에서 `base_url="http://<서버>:8000/v1"`, `api_key=<발급 토큰>`

## 개발

```bash
cd server && uv run pytest          # 백엔드 테스트
cd web && npm run dev               # 프론트 개발 서버 (8000 프록시)
cd web && npm test                  # 프론트 테스트

# 실모델 통합 테스트 (선택, 소형 GGUF 필요)
CREFLEAI_TEST_GGUF=/path/to/tiny.gguf uv run pytest -m inference -v
```
````

- [ ] **Step 6: 최종 확인 및 커밋**

Run:
```bash
cd web && npm run build
cd ../server && uv run pytest -q && uv run ruff check .
```
Expected: 빌드 성공, 전체 테스트 PASS, ruff 위반 0건

```bash
git add README.md server/ web/
git commit -m "feat: SPA 정적 서빙·README·실모델 통합 테스트 추가"
```

---

## 수동 검증 체크리스트 (GPU 서버 배포 후)

1. `uv run crefleai` 기동 → `/admin` 로그인 성공
2. 모델 다운로드 → 진행률 표시 → 준비됨
3. 서비스 시작 → 수 분 내 "서비스 중" 전환 (`nvidia-smi`로 VRAM 로드 확인)
4. 토큰 발급 → `/chat`에서 스트리밍 응답 확인
5. `openai` SDK로 `base_url` 지정 호출 성공 확인
6. 다른 모델로 교체 → 기존 워커 종료·VRAM 회수 확인 (`nvidia-smi`)
7. 토큰 폐기 → 해당 토큰 즉시 401 확인
8. 서버 재시작 → 서비스 모델 자동 복원 확인


