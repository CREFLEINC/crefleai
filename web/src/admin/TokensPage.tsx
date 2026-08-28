import { useEffect, useState, type FormEvent } from "react";
import { api } from "../api";
import type { CreatedToken, TokenInfo } from "../types";
import { Key, Plus, SpinnerGap, Trash, WarningCircle } from "../ui/icons";
import PageHeader from "../ui/PageHeader";
import StatusBadge from "../ui/StatusBadge";
import TokenModal from "./TokenModal";

export default function TokensPage() {
  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [userName, setUserName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [created, setCreated] = useState<CreatedToken | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  async function load() {
    setTokens((await api<{ tokens: TokenInfo[] }>("/api/admin/tokens")).tokens);
  }

  useEffect(() => {
    load().catch(() => setError("토큰 목록을 불러오지 못했습니다"));
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsCreating(true);
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
    } finally {
      setIsCreating(false);
    }
  }

  async function onRevoke(jti: string) {
    if (!window.confirm("이 토큰을 폐기할까요? 즉시 사용할 수 없게 됩니다."))
      return;
    try {
      await api(`/api/admin/tokens/${jti}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "폐기 실패");
    }
  }

  return (
    <section>
      <PageHeader
        eyebrow="Access Control"
        title="토큰 관리"
        description="사용 목적이 분명한 API 토큰을 발급하고 필요할 때 즉시 폐기합니다."
        actions={
          <StatusBadge tone="info">
            활성 {tokens.filter((token) => token.revoked_at === null).length}개
          </StatusBadge>
        }
      />

      {error && (
        <div className="notice notice-danger" role="alert">
          <WarningCircle aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      <div className="token-layout">
        <aside className="token-create-card">
          <span className="panel-icon" aria-hidden="true">
            <Plus weight="bold" />
          </span>
          <h2>새 토큰 발급</h2>
          <p>누가 어떤 목적으로 사용하는지 기록하면 이후 관리가 쉬워집니다.</p>
          <form onSubmit={onCreate} aria-busy={isCreating}>
            <label htmlFor="token-user-name">사용자 이름</label>
            <input
              id="token-user-name"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              placeholder="예: 홍길동"
              autoComplete="off"
              required
            />
            <span className="field-hint">
              토큰을 전달받을 구성원의 이름을 입력하세요.
            </span>

            <label htmlFor="token-purpose">사용 목적</label>
            <input
              id="token-purpose"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="예: 사내 챗봇 테스트"
              autoComplete="off"
              required
            />
            <span className="field-hint">
              프로젝트나 서비스 이름처럼 구분 가능한 설명이 좋습니다.
            </span>

            <button
              type="submit"
              className="button button-primary button-block"
              disabled={isCreating}
            >
              {isCreating ? (
                <SpinnerGap className="spin" aria-hidden="true" />
              ) : (
                <Key aria-hidden="true" />
              )}
              토큰 생성
            </button>
          </form>
        </aside>

        <div className="token-list-card">
          <div className="card-heading">
            <div>
              <p className="eyebrow">Issued Tokens</p>
              <h2>발급 내역</h2>
            </div>
            <span>{tokens.length}개</span>
          </div>

          {tokens.length === 0 ? (
            <div className="empty-state">
              <Key aria-hidden="true" weight="duotone" />
              <p>아직 발급된 토큰이 없습니다</p>
              <span>왼쪽 양식을 작성해 첫 API 토큰을 발급하세요.</span>
            </div>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>사용자</th>
                    <th>사용 목적</th>
                    <th>생성일</th>
                    <th>상태</th>
                    <th>
                      <span className="sr-only">작업</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {tokens.map((token) => (
                    <tr key={token.jti}>
                      <td data-label="사용자">
                        <span className="table-user-mark" aria-hidden="true">
                          {token.user_name.slice(0, 1).toUpperCase()}
                        </span>
                        <strong>{token.user_name}</strong>
                      </td>
                      <td data-label="사용 목적">{token.purpose}</td>
                      <td data-label="생성일" className="tabular-numbers">
                        {token.created_at.slice(0, 10)}
                      </td>
                      <td data-label="상태">
                        <StatusBadge
                          tone={token.revoked_at ? "neutral" : "success"}
                        >
                          {token.revoked_at ? "폐기됨" : "활성"}
                        </StatusBadge>
                      </td>
                      <td>
                        {!token.revoked_at && (
                          <button
                            type="button"
                            className="button button-danger-ghost button-small"
                            onClick={() => onRevoke(token.jti)}
                          >
                            <Trash aria-hidden="true" /> 폐기
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {created && (
        <TokenModal created={created} onClose={() => setCreated(null)} />
      )}
    </section>
  );
}
