import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { AdminModels } from "../types";
import {
  ArrowDown,
  Cube,
  DownloadSimple,
  Play,
  SpinnerGap,
  WarningCircle,
} from "../ui/icons";
import PageHeader from "../ui/PageHeader";
import StatusBadge from "../ui/StatusBadge";

const STATUS_LABEL: Record<string, string> = {
  not_downloaded: "미다운로드",
  downloading: "다운로드 중",
  ready: "준비됨",
  serving: "서비스 중",
  failed: "실패",
};

const STATUS_TONE = {
  downloading: "info",
  failed: "danger",
  not_downloaded: "neutral",
  ready: "warning",
  serving: "success",
} as const;

const WORKER_LABEL: Record<string, string> = {
  failed: "워커 오류",
  running: "정상 서비스 중",
  starting: "모델 시작 중",
  stopped: "대기 중",
  stopping: "종료 중",
};

function formatGb(bytes: number): string {
  return `${(bytes / 1e9).toFixed(1)} GB`;
}

export default function ModelsPage() {
  const [data, setData] = useState<AdminModels | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [activeAction, setActiveAction] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<AdminModels>("/api/admin/models"));
    } catch {
      // 폴링 중 일시 오류는 다음 주기에 회복된다
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [load]);

  async function act(path: string, modelId: string) {
    setActionError(null);
    setActiveAction(modelId);
    try {
      await api(path, { method: "POST" });
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "요청 실패");
    } finally {
      setActiveAction(null);
    }
  }

  if (!data) {
    return (
      <section aria-label="모델 목록 불러오는 중" aria-busy="true">
        <PageHeader
          eyebrow="Model Registry"
          title="모델 관리"
          description="서빙할 GGUF 모델을 준비하고 전환합니다."
        />
        <div className="model-grid">
          {[0, 1, 2].map((item) => (
            <div
              className="model-card skeleton-card"
              key={item}
              aria-hidden="true"
            >
              <span className="skeleton skeleton-title" />
              <span className="skeleton skeleton-line" />
              <span className="skeleton skeleton-line short" />
            </div>
          ))}
        </div>
      </section>
    );
  }

  const isWorkerRunning = data.worker.status === "running";

  return (
    <section>
      <PageHeader
        eyebrow="Model Registry"
        title="모델 관리"
        description="검증된 GGUF 모델을 다운로드하고 현재 서비스 모델을 안전하게 전환합니다."
        actions={
          <div className="worker-summary">
            <StatusBadge
              tone={
                isWorkerRunning
                  ? "success"
                  : data.worker.status === "failed"
                    ? "danger"
                    : "neutral"
              }
              pulse={isWorkerRunning}
            >
              {WORKER_LABEL[data.worker.status] ?? data.worker.status}
            </StatusBadge>
            {data.worker.model_id && <code>{data.worker.model_id}</code>}
          </div>
        }
      />

      {data.worker.error && (
        <div className="notice notice-danger" role="alert">
          <WarningCircle aria-hidden="true" />
          <span>{data.worker.error}</span>
        </div>
      )}
      {actionError && (
        <div className="notice notice-danger" role="alert">
          <WarningCircle aria-hidden="true" />
          <span>{actionError}</span>
        </div>
      )}

      <div className="section-toolbar">
        <p>
          전체 <strong>{data.models.length}</strong>개 모델
        </p>
        <p className="toolbar-hint">
          <ArrowDown aria-hidden="true" /> 모델 파일은 로컬 데이터 볼륨에
          저장됩니다.
        </p>
      </div>

      <div className="model-grid">
        {data.models.map((model) => {
          const isActing = activeAction === model.id;
          const statusTone =
            STATUS_TONE[model.status as keyof typeof STATUS_TONE] ?? "neutral";
          return (
            <article
              className={`model-card${model.status === "serving" ? " is-serving" : ""}`}
              key={model.id}
              aria-busy={isActing}
            >
              <div className="model-card-header">
                <span className="model-icon" aria-hidden="true">
                  <Cube weight="duotone" />
                </span>
                <StatusBadge
                  tone={statusTone}
                  pulse={model.status === "serving"}
                >
                  {STATUS_LABEL[model.status] ?? model.status}
                </StatusBadge>
              </div>

              <div className="model-copy">
                <h2>{model.display_name}</h2>
                <p>{model.description}</p>
              </div>

              <dl className="model-metadata">
                <div>
                  <dt>양자화</dt>
                  <dd>{model.quantization}</dd>
                </div>
                <div>
                  <dt>크기</dt>
                  <dd>{formatGb(model.size_bytes)}</dd>
                </div>
                <div>
                  <dt>컨텍스트</dt>
                  <dd>{model.context_length.toLocaleString()}</dd>
                </div>
              </dl>

              <p className="license-label" title={model.license}>
                {model.license}
              </p>

              {model.status === "downloading" && (
                <div className="progress-group">
                  <div className="progress-label">
                    <span>다운로드 중</span>
                    <span>{(model.progress * 100).toFixed(0)}%</span>
                  </div>
                  <progress value={model.progress} max={1}>
                    {(model.progress * 100).toFixed(0)}%
                  </progress>
                </div>
              )}
              {model.error && (
                <p className="model-error" role="alert">
                  {model.error}
                </p>
              )}

              <div className="model-card-action">
                {(model.status === "not_downloaded" ||
                  model.status === "failed") && (
                  <button
                    className="button button-secondary button-block"
                    onClick={() =>
                      act(`/api/admin/models/${model.id}/download`, model.id)
                    }
                    disabled={isActing}
                  >
                    {isActing ? (
                      <SpinnerGap className="spin" aria-hidden="true" />
                    ) : (
                      <DownloadSimple aria-hidden="true" />
                    )}
                    다운로드
                  </button>
                )}
                {model.status === "ready" && (
                  <button
                    className="button button-primary button-block"
                    onClick={() =>
                      act(`/api/admin/models/${model.id}/serve`, model.id)
                    }
                    disabled={isActing}
                  >
                    {isActing ? (
                      <SpinnerGap className="spin" aria-hidden="true" />
                    ) : (
                      <Play aria-hidden="true" weight="fill" />
                    )}
                    서비스 시작
                  </button>
                )}
                {model.status === "serving" && (
                  <p className="serving-message">
                    <span className="live-dot" aria-hidden="true" /> 현재 요청을
                    처리하고 있습니다
                  </p>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
