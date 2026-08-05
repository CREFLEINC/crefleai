export interface ThinkSplit {
  /** 추론 과정 텍스트. think 블록이 없으면 null. */
  think: string | null;
  answer: string;
  /** 아직 닫는 태그가 오지 않아 추론이 진행 중인가. */
  thinking: boolean;
}

const OPEN = "<think>";
const CLOSE = "</think>";

/** 스트리밍 중 누적된 응답에서 <think> 블록을 본문과 분리한다. 청크 경계의 부분 태그도 처리. */
export function splitThink(content: string): ThinkSplit {
  if (content === "") return { think: null, answer: "", thinking: false };
  // 여는 태그가 아직 다 도착하지 않은 경우 ("<thi" 등)
  if (content.length < OPEN.length && OPEN.startsWith(content)) {
    return { think: "", answer: "", thinking: true };
  }
  if (!content.startsWith(OPEN)) return { think: null, answer: content, thinking: false };

  const end = content.indexOf(CLOSE);
  if (end === -1) {
    let inner = content.slice(OPEN.length);
    // 닫는 태그가 청크 경계에 걸린 부분 문자열이면 표시에서 제거
    for (let i = Math.min(CLOSE.length - 1, inner.length); i > 0; i--) {
      if (CLOSE.startsWith(inner.slice(-i))) {
        inner = inner.slice(0, -i);
        break;
      }
    }
    return { think: inner, answer: "", thinking: true };
  }
  return {
    think: content.slice(OPEN.length, end),
    answer: content.slice(end + CLOSE.length).replace(/^\s+/, ""),
    thinking: false,
  };
}
