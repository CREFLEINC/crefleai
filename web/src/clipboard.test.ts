import { afterEach, expect, it, vi } from "vitest";
import { copyToClipboard } from "./clipboard";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("클립보드 API가 있으면 writeText로 복사한다", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });

  expect(await copyToClipboard("secret")).toBe(true);
  expect(writeText).toHaveBeenCalledWith("secret");
});

it("클립보드 API가 없으면(HTTP) execCommand 폴백으로 복사한다", async () => {
  vi.stubGlobal("navigator", {});
  const execCommand = vi.fn().mockReturnValue(true);
  Object.defineProperty(document, "execCommand", { value: execCommand, configurable: true });

  expect(await copyToClipboard("secret")).toBe(true);
  expect(execCommand).toHaveBeenCalledWith("copy");
  expect(document.querySelector("textarea")).toBeNull(); // 임시 textarea 정리됨
});

it("폴백 복사도 실패하면 false를 반환한다", async () => {
  vi.stubGlobal("navigator", {});
  Object.defineProperty(document, "execCommand", {
    value: vi.fn().mockReturnValue(false),
    configurable: true,
  });

  expect(await copyToClipboard("secret")).toBe(false);
});
