import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import ChatPage from "./ChatPage";

function delta(content: string) {
  return JSON.stringify({ choices: [{ delta: { content } }] });
}

function sseResponse(...events: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const e of events) controller.enqueue(encoder.encode(`data: ${e}\n\n`));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

async function sendMessage(text: string) {
  render(<ChatPage />);
  await userEvent.type(screen.getByLabelText("메시지"), text);
  await userEvent.click(screen.getByRole("button", { name: "보내기" }));
}

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

it("저장된 System 프롬프트와 Temperature를 복원한다", () => {
  localStorage.setItem("crefleai_system", "너는 친절한 비서다");
  localStorage.setItem("crefleai_temperature", "1.3");
  render(<ChatPage />);
  expect(screen.getByLabelText("System 프롬프트")).toHaveValue("너는 친절한 비서다");
  expect(screen.getByLabelText(/Temperature/)).toHaveValue("1.3");
});

it("저장된 값이 없으면 기본값(빈 프롬프트, 0.7)으로 시작한다", () => {
  render(<ChatPage />);
  expect(screen.getByLabelText("System 프롬프트")).toHaveValue("");
  expect(screen.getByLabelText(/Temperature/)).toHaveValue("0.7");
});

it("System 프롬프트·Temperature 변경 시 localStorage에 저장한다", async () => {
  render(<ChatPage />);

  await userEvent.type(screen.getByLabelText("System 프롬프트"), "간결하게 답하라");
  fireEvent.change(screen.getByLabelText(/Temperature/), { target: { value: "0.3" } });

  expect(localStorage.getItem("crefleai_system")).toBe("간결하게 답하라");
  expect(localStorage.getItem("crefleai_temperature")).toBe("0.3");
});

it("저장된 Temperature가 숫자가 아니면 기본값 0.7로 동작한다", () => {
  localStorage.setItem("crefleai_temperature", "잘못된값");
  render(<ChatPage />);
  expect(screen.getByLabelText(/Temperature/)).toHaveValue("0.7");
});

it("think 블록을 접힌 추론 과정 영역으로 분리하고 본문을 마크다운으로 렌더링한다", async () => {
  localStorage.setItem("crefleai_token", "t");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(sseResponse(delta("<think>먼저 생각한다</think>"), delta("**굵은** 답변"))),
  );

  await sendMessage("안녕");

  const summary = await screen.findByText("추론 과정");
  const details = summary.closest("details")!;
  expect(details.open).toBe(false);
  expect(details).toHaveTextContent("먼저 생각한다");
  const bold = await screen.findByText("굵은");
  expect(bold.tagName).toBe("STRONG");
  expect(screen.queryByText(/<think>/)).toBeNull();
});

it("think가 없는 응답은 본문만 표시한다", async () => {
  localStorage.setItem("crefleai_token", "t");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse(delta("일반 답변"))));

  await sendMessage("안녕");

  expect(await screen.findByText("일반 답변")).toBeInTheDocument();
  expect(screen.queryByText("추론 과정")).toBeNull();
});

it("스트림 에러 시 부분 수신 텍스트를 유지하고 오류를 표시한다", async () => {
  localStorage.setItem("crefleai_token", "t");
  const encoder = new TextEncoder();
  // 첫 read에는 청크를 전달하고, 다음 read에서 네트워크 단절을 시뮬레이션
  let pulls = 0;
  const stream = new ReadableStream({
    pull(controller) {
      pulls += 1;
      if (pulls === 1) controller.enqueue(encoder.encode(`data: ${delta("부분 응답")}\n\n`));
      else controller.error(new Error("연결 끊김"));
    },
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream, { status: 200 })));

  await sendMessage("안녕");

  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(screen.getByText("부분 응답")).toBeInTheDocument();
});
