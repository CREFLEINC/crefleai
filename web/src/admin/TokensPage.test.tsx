import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import TokensPage from "./TokensPage";

afterEach(() => vi.unstubAllGlobals());

it("토큰 생성 시 1회 표시 모달을 보여준다", async () => {
  const fetchMock = vi.fn().mockImplementation((_path: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            token: "aaa.bbb.ccc",
            jti: "j1",
            user_name: "홍길동",
            purpose: "테스트",
            created_at: "2026-08-04T00:00:00+00:00",
          }),
          { status: 200 },
        ),
      );
    }
    return Promise.resolve(new Response(JSON.stringify({ tokens: [] }), { status: 200 }));
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<TokensPage />);
  await userEvent.type(screen.getByLabelText("사용자 이름"), "홍길동");
  await userEvent.type(screen.getByLabelText("사용 목적"), "테스트");
  await userEvent.click(screen.getByRole("button", { name: "토큰 생성" }));

  expect(await screen.findByRole("dialog", { name: "발급된 토큰" })).toHaveTextContent(
    "aaa.bbb.ccc",
  );
});

it("클립보드 API가 없는 환경(HTTP)에서도 복사 버튼이 동작한다", async () => {
  const fetchMock = vi.fn().mockImplementation((_path: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            token: "aaa.bbb.ccc",
            jti: "j1",
            user_name: "홍길동",
            purpose: "테스트",
            created_at: "2026-08-04T00:00:00+00:00",
          }),
          { status: 200 },
        ),
      );
    }
    return Promise.resolve(new Response(JSON.stringify({ tokens: [] }), { status: 200 }));
  });
  vi.stubGlobal("fetch", fetchMock);
  const execCommand = vi.fn().mockReturnValue(true);
  Object.defineProperty(document, "execCommand", { value: execCommand, configurable: true });

  render(<TokensPage />);
  await userEvent.type(screen.getByLabelText("사용자 이름"), "홍길동");
  await userEvent.type(screen.getByLabelText("사용 목적"), "테스트");
  await userEvent.click(screen.getByRole("button", { name: "토큰 생성" }));
  await screen.findByRole("dialog", { name: "발급된 토큰" });

  // jsdom 기본 상태는 navigator.clipboard가 없어 사내 HTTP 환경과 같다 —
  // userEvent.click은 자체 클립보드 스텁을 설치하므로 fireEvent로 클릭한다
  fireEvent.click(screen.getByRole("button", { name: "복사" }));

  expect(await screen.findByText("복사됨")).toBeInTheDocument();
  expect(execCommand).toHaveBeenCalledWith("copy");
});

it("폐기 버튼이 /api/admin 경로로 DELETE를 보낸다", async () => {
  vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
  const fetchMock = vi.fn().mockImplementation((_path: string, init?: RequestInit) => {
    if (init?.method === "DELETE") {
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    }
    return Promise.resolve(
      new Response(
        JSON.stringify({
          tokens: [
            {
              jti: "j1",
              user_name: "홍길동",
              purpose: "t",
              created_at: "2026-08-04T00:00:00+00:00",
              revoked_at: null,
            },
          ],
        }),
        { status: 200 },
      ),
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<TokensPage />);
  await userEvent.click(await screen.findByRole("button", { name: "폐기" }));
  const deleteCall = fetchMock.mock.calls.find(
    (c) => (c[1] as RequestInit | undefined)?.method === "DELETE",
  );
  expect(deleteCall?.[0]).toBe("/api/admin/tokens/j1");
});
