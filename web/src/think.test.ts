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
