import { render, screen } from "@testing-library/react";
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
