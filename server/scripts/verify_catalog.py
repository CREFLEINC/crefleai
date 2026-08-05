"""카탈로그의 hf_repo/filename(및 분할 파트)이 실제 HF에 존재하는지, 파일 크기를 확인한다.

사용: cd server && uv run python scripts/verify_catalog.py
출력된 실제 content-length 합계로 catalog.json의 size_bytes를 보정한다.
"""
import httpx

from crefleai.models.catalog import load_catalog


def main() -> None:
    for m in load_catalog().values():
        total = 0
        all_ok = True
        for name in (m.filename, *m.shards):
            url = f"https://huggingface.co/{m.hf_repo}/resolve/main/{name}"
            r = httpx.head(url, follow_redirects=True, timeout=30)
            size = int(r.headers.get("content-length") or 0)
            total += size
            if r.status_code != 200:
                all_ok = False
                print(f"FAIL {m.id}: {name} status={r.status_code}")
        ok = "OK " if all_ok and total == m.size_bytes else "FAIL"
        print(f"{ok} {m.id}: total={total} (catalog={m.size_bytes}, files={1 + len(m.shards)})")


if __name__ == "__main__":
    main()
