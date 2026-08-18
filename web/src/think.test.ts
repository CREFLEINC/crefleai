import { expect, it } from "vitest";
import { splitThink } from "./think";

it("think가 없으면 전체를 본문으로 반환한다", () => {
  expect(splitThink("그냥 답변")).toEqual({ think: null, answer: "그냥 답변", thinking: false });
});

it("완성된 think 블록을 본문과 분리한다", () => {
  expect(splitThink("<think>추론</think>\n답변")).toEqual({
    think: "추론",
    answer: "답변",
    thinking: false,
  });
});

it("닫는 태그가 아직 없으면 thinking 상태다", () => {
  expect(splitThink("<think>생각 중")).toEqual({ think: "생각 중", answer: "", thinking: true });
});

it("여는 태그가 청크 경계에 걸린 부분 문자열이면 thinking으로 처리한다", () => {
  expect(splitThink("<thi")).toEqual({ think: "", answer: "", thinking: true });
});

it("닫는 태그의 부분 문자열은 think 표시에서 제거한다", () => {
  expect(splitThink("<think>생각</thi")).toEqual({ think: "생각", answer: "", thinking: true });
});

it("빈 문자열은 본문 없음으로 처리한다", () => {
  expect(splitThink("")).toEqual({ think: null, answer: "", thinking: false });
});

it("완성된 Harmony 형식을 추론과 본문으로 분리한다", () => {
  expect(
    splitThink(
      "<|channel|>analysis<|message|>분석 내용<|end|><|start|>assistant<|channel|>final<|message|>최종 답변",
    ),
  ).toEqual({ think: "분석 내용", answer: "최종 답변", thinking: false });
});

it.each(["<|end|>", "<|return|>"])(
  "Harmony final 뒤의 종료 토큰 %s를 본문에서 제거한다",
  (marker) => {
    expect(
      splitThink(
        `<|channel|>analysis<|message|>분석<|channel|>final<|message|>답변${marker}`,
      ),
    ).toEqual({ think: "분석", answer: "답변", thinking: false });
  },
);

it("Harmony 종료 토큰 앞의 일반 본문 접미사를 보존한다", () => {
  expect(
    splitThink(
      "<|channel|>analysis<|message|>분석<|channel|>final<|message|>답변 <<|end|>",
    ),
  ).toEqual({ think: "분석", answer: "답변 <", thinking: false });
});

it("스트리밍이 끝난 Harmony 본문의 마커 접두사를 보존한다", () => {
  expect(
    splitThink("<|channel|>analysis<|message|>분석<|channel|>final<|message|>답변 <"),
  ).toEqual({ think: "분석", answer: "답변 <", thinking: false });
});

it.each(["<|en", "<|ret"])(
  "스트리밍 중 Harmony 종료 토큰 조각 %s를 본문에서 숨긴다",
  (marker) => {
    expect(
      splitThink(
        `<|channel|>analysis<|message|>분석<|channel|>final<|message|>답변 <${marker}`,
        true,
      ),
    ).toEqual({ think: "분석", answer: "답변 <", thinking: false });
  },
);

it("구분 토큰 없이 바로 채널이 전환되는 Harmony도 분리한다", () => {
  expect(
    splitThink("<|channel|>analysis<|message|>분석<|channel|>final<|message|>답변"),
  ).toEqual({ think: "분석", answer: "답변", thinking: false });
});

it("analysis 없이 final로 시작하는 Harmony는 본문으로 처리한다", () => {
  expect(splitThink("<|channel|>final<|message|>안녕하세요")).toEqual({
    think: null,
    answer: "안녕하세요",
    thinking: false,
  });
});

it("선행 assistant 시작 토큰이 있어도 Harmony를 분리한다", () => {
  expect(
    splitThink(
      "<|start|>assistant<|channel|>analysis<|message|>분석<|channel|>final<|message|>답변",
    ),
  ).toEqual({ think: "분석", answer: "답변", thinking: false });
});

it("선행 공백이 있어도 Harmony를 분리한다", () => {
  expect(
    splitThink(" <|channel|>analysis<|message|>분석<|channel|>final<|message|>답변"),
  ).toEqual({ think: "분석", answer: "답변", thinking: false });
});

it("commentary 채널로 시작하는 Harmony도 추론으로 처리한다", () => {
  expect(
    splitThink("<|channel|>commentary<|message|>도구 호출<|channel|>final<|message|>답변"),
  ).toEqual({ think: "도구 호출", answer: "답변", thinking: false });
});

it("final-only Harmony 뒤의 종료 토큰을 본문에서 제거한다", () => {
  expect(splitThink("<|channel|>final<|message|>답변<|end|>")).toEqual({
    think: null,
    answer: "답변",
    thinking: false,
  });
});

it("Harmony final 헤더가 아직 없으면 thinking 상태다", () => {
  expect(splitThink("<|channel|>analysis<|message|>생각 중", true)).toEqual({
    think: "생각 중",
    answer: "",
    thinking: true,
  });
});

it("Harmony 여는 태그가 청크 경계에 걸리면 thinking으로 처리한다", () => {
  expect(splitThink("<|chan", true)).toEqual({ think: "", answer: "", thinking: true });
});

it("스트리밍 중 Harmony 구분 토큰 조각은 추론 표시에서 제거한다", () => {
  expect(
    splitThink("<|channel|>analysis<|message|>생각<|end|><|start|>assi", true),
  ).toEqual({ think: "생각", answer: "", thinking: true });
});

it("Harmony final 헤더 조각도 추론 표시에서 제거한다", () => {
  expect(
    splitThink(
      "<|channel|>analysis<|message|>생각<|end|><|start|>assistant<|channel|>fin",
      true,
    ),
  ).toEqual({ think: "생각", answer: "", thinking: true });
});

it("스트리밍이 끝난 Harmony 추론의 마커 접두사를 보존한다", () => {
  expect(splitThink("<|channel|>analysis<|message|>생각 <")).toEqual({
    think: "생각 <",
    answer: "",
    thinking: true,
  });
});
