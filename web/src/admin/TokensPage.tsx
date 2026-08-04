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
    setTokens((await api<{ tokens: TokenInfo[] }>("/api/admin/tokens")).tokens);
  }

  useEffect(() => {
    load().catch(() => setError("토큰 목록을 불러오지 못했습니다"));
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const token = await api<CreatedToken>("/api/admin/tokens", {
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
