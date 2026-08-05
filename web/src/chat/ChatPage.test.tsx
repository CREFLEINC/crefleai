import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import ChatPage from "./ChatPage";

it("토큰 입력 중에도 연결 설정이 접히지 않는다", async () => {
  render(<ChatPage />);
  const details = screen.getByText("연결 설정").closest("details")!;
  expect(details.open).toBe(true);

  await userEvent.type(screen.getByLabelText("API 토큰"), "a");

  expect(details.open).toBe(true);
});

it("저장된 토큰이 있으면 연결 설정이 접힌 상태로 시작한다", () => {
  localStorage.setItem("crefleai_token", "saved-token");
  render(<ChatPage />);
  const details = screen.getByText("연결 설정").closest("details")!;
  expect(details.open).toBe(false);
});
