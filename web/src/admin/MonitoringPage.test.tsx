import { render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { AdminMetrics } from "../types";
import MonitoringPage from "./MonitoringPage";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const BODY: AdminMetrics = {
  sampled_at: "2026-08-18T00:00:00Z",
  stale: false,
  disk: {
    status: "ok",
    path: "/app/data",
    total_bytes: 1000,
    used_bytes: 250,
    free_bytes: 750,
    used_percent: 25,
    error: null,
  },
  gpus: [
    {
      index: 0,
      name: "NVIDIA RTX",
      utilization_percent: 42,
      memory_used_bytes: 400,
      memory_total_bytes: 1000,
      memory_used_percent: 40,
    },
  ],
  requests: {
    window_seconds: 60,
    rpm: 7,
    success: 6,
    failure: 1,
    in_flight: 2,
  },
};

it("서버 지표를 카드로 표시한다", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(JSON.stringify(BODY), { status: 200 })),
  );

  render(<MonitoringPage />);

  expect(await screen.findByText("서버 모니터링")).toBeInTheDocument();
  expect(screen.getByText("NVIDIA RTX")).toBeInTheDocument();
  expect(screen.getByText("42%")).toBeInTheDocument();
  expect(screen.getByText("400 B / 1000 B")).toBeInTheDocument();
  expect(screen.getByText("/app/data")).toBeInTheDocument();
  expect(screen.getByText("250 B / 1000 B")).toBeInTheDocument();
  expect(screen.getByText("7 RPM")).toBeInTheDocument();
  expect(screen.getByText("성공 6 · 실패 1 · 처리 중 2")).toBeInTheDocument();
});

it("stale 상태와 GPU 수집 불가를 표시한다", async () => {
  const body: AdminMetrics = {
    ...BODY,
    stale: true,
    gpus: [],
    disk: { ...BODY.disk, status: "unavailable", error: "disk unavailable" },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 })),
  );

  render(<MonitoringPage />);

  expect(await screen.findByText("지표가 갱신되지 않고 있습니다")).toBeInTheDocument();
  expect(screen.getByText("GPU 수집 불가")).toBeInTheDocument();
  expect(screen.getByText("disk unavailable")).toBeInTheDocument();
});

it("5초 간격으로 metrics API를 폴링한다", async () => {
  vi.useFakeTimers();
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify(BODY), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);

  render(<MonitoringPage />);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(5000);

  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls.every((call) => call[0] === "/api/admin/metrics")).toBe(true);
});
