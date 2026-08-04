import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import AdminLayout from "./AdminLayout";

afterEach(() => vi.unstubAllGlobals());

it("로그아웃 API가 실패해도 로그인 화면으로 이동한다", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "서버 오류" } }), { status: 500 }),
    ),
  );

  render(
    <MemoryRouter initialEntries={["/admin"]}>
      <Routes>
        <Route path="/admin" element={<AdminLayout />} />
        <Route path="/login" element={<p>로그인 화면</p>} />
      </Routes>
    </MemoryRouter>,
  );
  await userEvent.click(screen.getByRole("button", { name: "로그아웃" }));

  expect(await screen.findByText("로그인 화면")).toBeInTheDocument();
});
