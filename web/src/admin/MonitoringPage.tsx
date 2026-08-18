import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { AdminMetrics } from "../types";

function formatBytes(bytes: number | null): string {
  if (bytes == null) return "수집 불가";
  if (bytes <= 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(1)} KB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
}

function formatPercent(value: number | null): string {
  return value == null ? "수집 불가" : `${value}%`;
}

function formatSampledAt(value: string | null): string {
  if (!value) return "수집 전";
  return new Date(value).toLocaleString();
}

export default function MonitoringPage() {
  const [data, setData] = useState<AdminMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<AdminMetrics>("/api/admin/metrics"));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "지표를 불러오지 못했습니다");
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [load]);

  if (!data) {
    return (
      <section>
        <h2>서버 모니터링</h2>
        <p>불러오는 중...</p>
      </section>
    );
  }

  return (
    <section>
      <h2>서버 모니터링</h2>
      <p>
        마지막 수집: {formatSampledAt(data.sampled_at)}
        {data.stale && <span role="alert">지표가 갱신되지 않고 있습니다</span>}
      </p>
      {error && <p role="alert">{error}</p>}

      <div className="metric-grid">
        <article>
          <h3>GPU</h3>
          {data.gpus.length === 0 ? (
            <p>GPU 수집 불가</p>
          ) : (
            data.gpus.map((gpu) => (
              <div key={gpu.index} className="metric-row">
                <strong>{gpu.name}</strong>
                <span>{formatPercent(gpu.utilization_percent)}</span>
                <span>
                  {formatBytes(gpu.memory_used_bytes)} / {formatBytes(gpu.memory_total_bytes)}
                </span>
                <span>VRAM {formatPercent(gpu.memory_used_percent)}</span>
              </div>
            ))
          )}
        </article>

        <article>
          <h3>DISK</h3>
          <p>{data.disk.path}</p>
          <p>
            {formatBytes(data.disk.used_bytes)} / {formatBytes(data.disk.total_bytes)}
          </p>
          <p>여유 {formatBytes(data.disk.free_bytes)}</p>
          <p>사용률 {formatPercent(data.disk.used_percent)}</p>
          {data.disk.status !== "ok" && <p role="alert">{data.disk.error ?? "수집 불가"}</p>}
        </article>

        <article>
          <h3>요청 처리량</h3>
          <p>{data.requests.rpm} RPM</p>
          <p>
            성공 {data.requests.success} · 실패 {data.requests.failure} · 처리 중{" "}
            {data.requests.in_flight}
          </p>
          <p>최근 {data.requests.window_seconds}초 기준</p>
        </article>
      </div>
    </section>
  );
}
