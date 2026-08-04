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
