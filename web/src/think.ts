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
const HARMONY_START = "<|start|>assistant";
const HARMONY_CHANNEL = /^<\|channel\|>(\w+)<\|message\|>/;
// analysis 종료와 final 헤더 사이 또는 응답 끝에 올 수 있는 구분 토큰
const HARMONY_SEPARATORS = ["<|end|>", "<|return|>", HARMONY_START];

/** tag가 청크 경계에 걸려 앞부분만 도착한 상태인가 ("<thi", "<|chan" 등). */
function isPartialPrefix(content: string, tag: string): boolean {
  return content.length < tag.length && tag.startsWith(content);
}

/** text 끝의 완결된 marker를 반복 제거한다. */
function stripAllTrailing(text: string, markers: string[]): string {
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

/** text 끝에 걸친 마커 조각 중 가장 긴 하나를 제거한다. */
function stripLongestPartialSuffix(text: string, markers: string[]): string {
  let fragmentLength = 0;
  for (const marker of markers) {
    for (let i = Math.min(marker.length - 1, text.length); i > fragmentLength; i--) {
      if (marker.startsWith(text.slice(-i))) {
        fragmentLength = i;
        break;
      }
    }
  }
  return fragmentLength > 0 ? text.slice(0, -fragmentLength) : text;
}

/** 완결 마커와, 스트리밍 중이면 현재 경계의 부분 마커를 제거한다. */
function stripHarmonySuffix(text: string, markers: string[], streaming: boolean): string {
  const withoutPartial = streaming ? stripLongestPartialSuffix(text, markers) : text;
  // 완결 마커 제거 후 다른 마커 조각이 새 끝이 될 수 있어 처음부터 반복한다.
  return stripAllTrailing(withoutPartial, markers);
}

function stripHarmonyPrefix(content: string): string {
  let result = content.trimStart();
  if (result.startsWith(HARMONY_START)) {
    result = result.slice(HARMONY_START.length).trimStart();
  }
  return result;
}

function splitHarmony(content: string, streaming: boolean): ThinkSplit {
  const normalized = stripHarmonyPrefix(content);
  const channel = HARMONY_CHANNEL.exec(normalized);
  if (!channel) return { think: null, answer: content, thinking: false };

  const channelName = channel[1];
  const bodyStart = channel[0].length;
  if (channelName === "final") {
    const answer = normalized.slice(bodyStart).replace(/^\s+/, "");
    return {
      think: null,
      answer: stripHarmonySuffix(answer, HARMONY_SEPARATORS, streaming),
      thinking: false,
    };
  }

  const finalAt = normalized.indexOf(HARMONY_FINAL, bodyStart);
  if (finalAt === -1) {
    // 스트리밍 중 — 끝에 걸친 구분 토큰(완결·조각)이 추론 표시에 보이지 않게 제거
    const inner = stripHarmonySuffix(
      normalized.slice(bodyStart),
      [...HARMONY_SEPARATORS, HARMONY_FINAL],
      streaming,
    );
    return { think: inner, answer: "", thinking: true };
  }
  const think = stripAllTrailing(
    normalized.slice(bodyStart, finalAt),
    HARMONY_SEPARATORS,
  );
  const answer = normalized.slice(finalAt + HARMONY_FINAL.length).replace(/^\s+/, "");
  return {
    think,
    answer: stripHarmonySuffix(answer, HARMONY_SEPARATORS, streaming),
    thinking: false,
  };
}

/**
 * 스트리밍 중 누적된 응답에서 추론 블록을 본문과 분리한다. 청크 경계의 부분 태그도 처리.
 * <think>...</think> 형식과 gpt-oss Harmony 형식(analysis/final 채널)을 지원한다.
 */
export function splitThink(content: string, streaming = false): ThinkSplit {
  if (content === "") return { think: null, answer: "", thinking: false };
  // 여는 태그가 아직 다 도착하지 않은 경우 ("<thi", "<|chan" 등)
  const harmonyCandidate = stripHarmonyPrefix(content);
  if (
    isPartialPrefix(content, OPEN) ||
    isPartialPrefix(harmonyCandidate, "<|channel|>") ||
    isPartialPrefix(harmonyCandidate, HARMONY_ANALYSIS)
  ) {
    return { think: "", answer: "", thinking: true };
  }
  if (HARMONY_CHANNEL.test(harmonyCandidate)) return splitHarmony(content, streaming);
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
