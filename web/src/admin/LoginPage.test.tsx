import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import LoginPage from "./LoginPage";

afterEach(() => vi.unstubAllGlobals());

it("아이디/비밀번호로 로그인 요청을 보낸다", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);

  render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  );
  await userEvent.type(screen.getByLabelText("아이디"), "admin");
  await userEvent.type(screen.getByLabelText("비밀번호"), "pw");
  await userEvent.click(screen.getByRole("button", { name: "로그인" }));

  expect(fetchMock).toHaveBeenCalledWith(
    "/api/admin/login",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ username: "admin", password: "pw" }),
    }),
  );
});
