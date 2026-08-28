import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { AdminMetrics } from "../types";
import {
  CheckCircle,
  CircleNotch,
  Clock,
  Cpu,
  HardDrives,
  Pulse,
  WarningCircle,
} from "../ui/icons";
import PageHeader from "../ui/PageHeader";
import StatusBadge from "../ui/StatusBadge";

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
      setError(
        err instanceof Error ? err.message : "지표를 불러오지 못했습니다",
      );
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [load]);

  if (!data) {
    return (
      <section aria-label="서버 지표 불러오는 중" aria-busy="true">
        <PageHeader
          eyebrow="System Health"
          title="서버 모니터링"
          description="GPU, 스토리지, API 처리량을 실시간으로 확인합니다."
        />
        <div className="metric-grid">
          {[0, 1, 2].map((item) => (
            <div
              className="metric-card skeleton-card"
              key={item}
              aria-hidden="true"
            >
              <span className="skeleton skeleton-title" />
              <span className="skeleton skeleton-value" />
              <span className="skeleton skeleton-line" />
            </div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section>
      <PageHeader
        eyebrow="System Health"
        title="서버 모니터링"
        description="GPU, 스토리지, API 처리량을 5초 간격으로 자동 갱신합니다."
        actions={
          <div className="sample-status">
            <StatusBadge
              tone={data.stale ? "warning" : "success"}
              pulse={!data.stale}
            >
              {data.stale ? "업데이트 지연" : "Live"}
            </StatusBadge>
            <span>
              <Clock aria-hidden="true" /> {formatSampledAt(data.sampled_at)}
            </span>
          </div>
        }
      />

      {data.stale && (
        <div className="notice notice-warning" role="alert">
          <WarningCircle aria-hidden="true" />
          <span>지표가 갱신되지 않고 있습니다</span>
        </div>
      )}
      {error && (
        <div className="notice notice-danger" role="alert">
          <WarningCircle aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      <div className="metric-grid">
        <article className="metric-card metric-card-wide">
          <header className="metric-card-header">
            <span className="metric-icon metric-icon-green" aria-hidden="true">
              <Cpu weight="duotone" />
            </span>
            <div>
              <p className="metric-kicker">Compute</p>
              <h2>GPU</h2>
            </div>
          </header>
          {data.gpus.length === 0 ? (
            <div className="empty-state compact">
              <WarningCircle aria-hidden="true" />
              <p>GPU 수집 불가</p>
              <span>NVML 및 컨테이너 GPU 연결을 확인하세요.</span>
            </div>
          ) : (
            data.gpus.map((gpu) => (
              <div key={gpu.index} className="metric-row">
                <div className="metric-row-title">
                  <div>
                    <strong>{gpu.name}</strong>
                    <span>GPU {gpu.index}</span>
                  </div>
                  <strong className="metric-value">
                    {formatPercent(gpu.utilization_percent)}
                  </strong>
                </div>
                <div className="progress-group">
                  <div className="progress-label">
                    <span>GPU 사용률</span>
                  </div>
                  <progress
                    value={gpu.utilization_percent}
                    max={100}
                    aria-label={`GPU 사용률 ${formatPercent(gpu.utilization_percent)}`}
                  />
                </div>
                <div className="progress-group">
                  <div className="progress-label">
                    <span>
                      VRAM ·{" "}
                      <span>
                        {formatBytes(gpu.memory_used_bytes)} /{" "}
                        {formatBytes(gpu.memory_total_bytes)}
                      </span>
                    </span>
                    <span>{formatPercent(gpu.memory_used_percent)}</span>
                  </div>
                  <progress
                    className="progress-blue"
                    value={gpu.memory_used_percent}
                    max={100}
                    aria-label={`VRAM 사용률 ${formatPercent(gpu.memory_used_percent)}`}
                  />
                </div>
              </div>
            ))
          )}
        </article>

        <article className="metric-card">
          <header className="metric-card-header">
            <span className="metric-icon metric-icon-blue" aria-hidden="true">
              <HardDrives weight="duotone" />
            </span>
            <div>
              <p className="metric-kicker">Storage</p>
              <h2>디스크</h2>
            </div>
          </header>
          <strong className="metric-hero-value">
            {formatPercent(data.disk.used_percent)}
          </strong>
          <p className="metric-caption">전체 저장 공간 사용률</p>
          <progress
            className="progress-blue"
            value={data.disk.used_percent ?? 0}
            max={100}
            aria-label={`디스크 사용률 ${formatPercent(data.disk.used_percent)}`}
          />
          <dl className="metric-details">
            <div>
              <dt>사용</dt>
              <dd>
                {formatBytes(data.disk.used_bytes)} /{" "}
                {formatBytes(data.disk.total_bytes)}
              </dd>
            </div>
            <div>
              <dt>여유</dt>
              <dd>{formatBytes(data.disk.free_bytes)}</dd>
            </div>
          </dl>
          <code className="path-label">{data.disk.path}</code>
          {data.disk.status !== "ok" && (
            <p className="metric-error" role="alert">
              {data.disk.error ?? "수집 불가"}
            </p>
          )}
        </article>

        <article className="metric-card">
          <header className="metric-card-header">
            <span className="metric-icon metric-icon-violet" aria-hidden="true">
              <Pulse weight="duotone" />
            </span>
            <div>
              <p className="metric-kicker">Traffic</p>
              <h2>요청 처리량</h2>
            </div>
          </header>
          <strong className="metric-hero-value">{data.requests.rpm} RPM</strong>
          <p className="metric-caption">
            최근 {data.requests.window_seconds}초 기준
          </p>
          <div className="request-breakdown">
            <span>
              <CheckCircle aria-hidden="true" /> 성공 {data.requests.success}
            </span>
            <span>
              <WarningCircle aria-hidden="true" /> 실패 {data.requests.failure}
            </span>
            <span>
              <CircleNotch aria-hidden="true" /> 처리 중{" "}
              {data.requests.in_flight}
            </span>
          </div>
          <p className="sr-summary">
            성공 {data.requests.success} · 실패 {data.requests.failure} · 처리
            중 {data.requests.in_flight}
          </p>
        </article>
      </div>
    </section>
  );
}
