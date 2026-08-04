import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

it("다운로드 버튼이 /api/admin 경로를 호출한다", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify(BODY), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  render(<ModelsPage />);
  await userEvent.click(await screen.findByRole("button", { name: "다운로드" }));
  const paths = fetchMock.mock.calls.map((c) => c[0]);
  expect(paths).toContain("/api/admin/models/qwen3-8b-q4km/download");
});
