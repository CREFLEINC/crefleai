import { afterEach, expect, it, vi } from "vitest";
import { api } from "./api";

afterEach(() => vi.unstubAllGlobals());

it("JSON 응답을 반환한다", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 })),
  );
  await expect(api("/api/admin/me")).resolves.toEqual({ ok: true });
});

it("에러 응답이면 OpenAI 형식 메시지로 ApiError를 던진다", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "로그인이 필요합니다" } }), {
        status: 401,
      }),
    ),
  );
  await expect(api("/api/admin/me")).rejects.toMatchObject({
    status: 401,
    message: "로그인이 필요합니다",
  });
});
