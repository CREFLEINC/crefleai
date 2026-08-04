export interface SseSplit {
  events: string[];
  rest: string;
}

/** SSE 버퍼에서 완성된 이벤트의 data 페이로드를 추출한다. 미완성 꼬리는 rest로 반환. */
export function splitSseEvents(buffer: string): SseSplit {
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  const events = parts
    .map((part) =>
      part
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => line.slice(6))
        .join(""),
    )
    .filter((data) => data.length > 0);
  return { events, rest };
}
