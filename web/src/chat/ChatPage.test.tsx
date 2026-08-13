import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

function modelsResponse(contextLength: number | null) {
  const data =
    contextLength === null ? [] : [{ id: "m", object: "model", context_length: contextLength }];
  return new Response(JSON.stringify({ object: "list", data }), { status: 200 });
}

// /v1/models(마운트 조회)와 /v1/chat/completions(전송)를 URL로 구분해 스텁한다
function stubFetch(completion?: Response, contextLength: number | null = null) {
  const mock = vi.fn(async (url: RequestInfo | URL) => {
    if (String(url).includes("/v1/models")) return modelsResponse(contextLength);
    if (!completion) throw new Error("completion 응답이 스텁되지 않았습니다");
    return completion;
  });
  vi.stubGlobal("fetch", mock);
  return mock;
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

it("모델의 컨텍스트 윈도우 크기와 현재 사용량을 표시한다", async () => {
  localStorage.setItem("crefleai_token", "t");
  stubFetch(undefined, 100);
  render(<ChatPage />);
  const usage = await screen.findByText(/컨텍스트 사용량/);
  expect(usage).toHaveTextContent("컨텍스트 사용량 약 0 / 100 (0%)");
  expect(usage).not.toHaveClass("warning");
});

it("대화가 쌓이면 문자 수 근사치로 사용량이 늘어난다", async () => {
  localStorage.setItem("crefleai_token", "t");
  stubFetch(sseResponse(delta("답")), 100);

  await sendMessage("안녕하세요");

  // 본문 ceil(6자 / 2) + 메시지 템플릿 2개 * 4토큰 = 11토큰
  expect(
    await screen.findByText(/컨텍스트 사용량 약 11 \/ 100 \(11%\)/),
  ).toBeInTheDocument();
});

it("한국어 대화는 실측 토큰 수보다 적게 추정하지 않는다", async () => {
  localStorage.setItem("crefleai_token", "t");
  stubFetch(sseResponse(delta("")), 100);

  // o200k_base 실측: 59자, 29토큰
  await sendMessage(
    "안녕하세요. 오늘 회의에서 논의된 내용을 정리해서 알려주세요. 특히 예산 관련 항목은 자세히 부탁드립니다.",
  );

  await waitFor(() => {
    const text = screen.getByText(/컨텍스트 사용량/).textContent ?? "";
    const estimated = Number(
      text.match(/약 ([\d,]+)/)?.[1].replaceAll(",", ""),
    );
    expect(estimated).toBeGreaterThanOrEqual(29);
  });
});

it("사용량이 80% 이상이면 경고 스타일을 적용한다", async () => {
  localStorage.setItem("crefleai_token", "t");
  stubFetch(sseResponse(delta("답변")), 10);

  await sendMessage("a".repeat(22));

  const usage = await screen.findByText(/컨텍스트 사용량/);
  expect(usage).toHaveClass("warning");
});

it("스트림에 usage가 포함되면 실제 토큰 수를 우선 사용한다", async () => {
  localStorage.setItem("crefleai_token", "t");
  stubFetch(
    sseResponse(
      delta("답"),
      JSON.stringify({
        choices: [{ delta: {} }],
        usage: { prompt_tokens: 50, completion_tokens: 10 },
      }),
    ),
    100,
  );

  await sendMessage("안녕");

  expect(await screen.findByText(/컨텍스트 사용량 약 60 \/ 100 \(60%\)/)).toBeInTheDocument();
});

it("컨텍스트 크기를 조회할 수 없으면 사용량을 표시하지 않는다", async () => {
  localStorage.setItem("crefleai_token", "t");
  const mock = vi.fn(async () => new Response("{}", { status: 500 }));
  vi.stubGlobal("fetch", mock);

  render(<ChatPage />);

  await waitFor(() => expect(mock).toHaveBeenCalled());
  expect(screen.queryByText(/컨텍스트 사용량/)).toBeNull();
});

it("think 블록을 접힌 추론 과정 영역으로 분리하고 본문을 마크다운으로 렌더링한다", async () => {
  localStorage.setItem("crefleai_token", "t");
  stubFetch(sseResponse(delta("<think>먼저 생각한다</think>"), delta("**굵은** 답변")));

  await sendMessage("안녕");

  const summary = await screen.findByText("추론 과정");
  const details = summary.closest("details")!;
  expect(details.open).toBe(false);
  expect(details).toHaveTextContent("먼저 생각한다");
  const bold = await screen.findByText("굵은");
  expect(bold.tagName).toBe("STRONG");
  expect(screen.queryByText(/<think>/)).toBeNull();
});

it("Harmony 형식 응답의 추론 과정을 분리하고 종료 토큰을 숨긴다", async () => {
  localStorage.setItem("crefleai_token", "t");
  stubFetch(
    sseResponse(
      delta("<|channel|>analysis<|message|>먼저 분석"),
      delta(
        "<|end|><|start|>assistant<|channel|>final<|message|>최종 답변<|return|>",
      ),
    ),
  );

  await sendMessage("안녕");

  const summary = await screen.findByText("추론 과정");
  const details = summary.closest("details")!;
  expect(details.open).toBe(false);
  expect(details).toHaveTextContent("먼저 분석");
  expect(await screen.findByText("최종 답변")).toBeInTheDocument();
  expect(screen.queryByText(/<\|(channel|return)\|>/)).toBeNull();
});

it("think가 없는 응답은 본문만 표시한다", async () => {
  localStorage.setItem("crefleai_token", "t");
  stubFetch(sseResponse(delta("일반 답변")));

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
  stubFetch(new Response(stream, { status: 200 }));

  await sendMessage("안녕");

  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(screen.getByText("부분 응답")).toBeInTheDocument();
});
