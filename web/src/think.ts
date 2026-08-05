export interface ThinkSplit {
  /** 추론 과정 텍스트. think 블록이 없으면 null. */
  think: string | null;
  answer: string;
  /** 아직 닫는 태그가 오지 않아 추론이 진행 중인가. */
  thinking: boolean;
}

const OPEN = "<think>";
const CLOSE = "</think>";

// gpt-oss 계열의 Harmony 형식 — analysis 채널이 추론, final 채널이 본 응답
const HARMONY_ANALYSIS = "<|channel|>analysis<|message|>";
const HARMONY_FINAL = "<|channel|>final<|message|>";
// analysis 종료와 final 헤더 사이에 올 수 있는 구분 토큰
const HARMONY_SEPARATORS = ["<|end|>", "<|start|>assistant"];

/** tag가 청크 경계에 걸려 앞부분만 도착한 상태인가 ("<thi", "<|chan" 등). */
function isPartialPrefix(content: string, tag: string): boolean {
  return content.length < tag.length && tag.startsWith(content);
}

/** text 끝의 완결된 marker를 반복 제거한다. */
function stripTrailingMarkers(text: string, markers: string[]): string {
  let result = text;
  for (let stripped = true; stripped; ) {
    stripped = false;
    for (const marker of markers) {
      if (result.endsWith(marker)) {
        result = result.slice(0, -marker.length);
        stripped = true;
      }
    }
  }
  return result;
}

/** text 끝이 marker의 앞부분(부분 도착)이면 그 조각을 제거한다. */
function stripPartialSuffix(text: string, marker: string): string {
  for (let i = Math.min(marker.length - 1, text.length); i > 0; i--) {
    if (marker.startsWith(text.slice(-i))) return text.slice(0, -i);
  }
  return text;
}

function splitHarmony(content: string): ThinkSplit {
  const finalAt = content.indexOf(HARMONY_FINAL);
  if (finalAt === -1) {
    // 스트리밍 중 — 끝에 걸친 구분 토큰(완결·조각)이 추론 표시에 보이지 않게 제거
    let inner = content.slice(HARMONY_ANALYSIS.length);
    for (let before = ""; before !== inner; ) {
      before = inner;
      inner = stripTrailingMarkers(inner, HARMONY_SEPARATORS);
      for (const marker of [...HARMONY_SEPARATORS, HARMONY_FINAL]) {
        inner = stripPartialSuffix(inner, marker);
      }
    }
    return { think: inner, answer: "", thinking: true };
  }
  const think = stripTrailingMarkers(content.slice(HARMONY_ANALYSIS.length, finalAt), HARMONY_SEPARATORS);
  return {
    think,
    answer: content.slice(finalAt + HARMONY_FINAL.length).replace(/^\s+/, ""),
    thinking: false,
  };
}

/**
 * 스트리밍 중 누적된 응답에서 추론 블록을 본문과 분리한다. 청크 경계의 부분 태그도 처리.
 * <think>...</think> 형식과 gpt-oss Harmony 형식(analysis/final 채널)을 지원한다.
 */
export function splitThink(content: string): ThinkSplit {
  if (content === "") return { think: null, answer: "", thinking: false };
  // 여는 태그가 아직 다 도착하지 않은 경우 ("<thi", "<|chan" 등)
  if (isPartialPrefix(content, OPEN) || isPartialPrefix(content, HARMONY_ANALYSIS)) {
    return { think: "", answer: "", thinking: true };
  }
  if (content.startsWith(HARMONY_ANALYSIS)) return splitHarmony(content);
  if (!content.startsWith(OPEN)) return { think: null, answer: content, thinking: false };

  const end = content.indexOf(CLOSE);
  if (end === -1) {
    // 닫는 태그가 청크 경계에 걸린 부분 문자열이면 표시에서 제거
    const inner = stripPartialSuffix(content.slice(OPEN.length), CLOSE);
    return { think: inner, answer: "", thinking: true };
  }
  return {
    think: content.slice(OPEN.length, end),
    answer: content.slice(end + CLOSE.length).replace(/^\s+/, ""),
    thinking: false,
  };
}
