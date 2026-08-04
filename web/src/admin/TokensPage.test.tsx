import { render, screen } from "@testing-library/react";
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
