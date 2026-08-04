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
