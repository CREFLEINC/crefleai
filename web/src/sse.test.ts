import { expect, it } from "vitest";
import { splitSseEvents } from "./sse";

it("완성된 이벤트만 추출하고 꼬리는 rest로 남긴다", () => {
  const first = splitSseEvents('data: {"a":1}\n\ndata: {"b"');
  expect(first.events).toEqual(['{"a":1}']);
  expect(first.rest).toBe('data: {"b"');

  const second = splitSseEvents(first.rest + ':2}\n\ndata: [DONE]\n\n');
  expect(second.events).toEqual(['{"b":2}', "[DONE]"]);
  expect(second.rest).toBe("");
});

it("data 라인이 아닌 내용은 무시한다", () => {
  const result = splitSseEvents(': keep-alive\n\ndata: {"x":1}\n\n');
  expect(result.events).toEqual(['{"x":1}']);
});
