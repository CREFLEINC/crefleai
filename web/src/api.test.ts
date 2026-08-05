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

it("호출자가 headers를 넘겨도 기본 Content-Type과 병합된다", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);

  await api("/api/x", { method: "POST", headers: { Authorization: "Bearer t" } });

  const init = fetchMock.mock.calls[0][1] as RequestInit;
  expect(init.headers).toEqual({
    "Content-Type": "application/json",
    Authorization: "Bearer t",
  });
  expect(init.method).toBe("POST");
  expect(init.credentials).toBe("include");
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
