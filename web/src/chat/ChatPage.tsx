import { useCallback, useEffect, useState, type FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { splitSseEvents } from "../sse";
import { splitThink } from "../think";
import type { ChatMessage } from "../types";

const DEFAULT_TEMPERATURE = 0.7;
const TEMPERATURE_MIN = 0;
const TEMPERATURE_MAX = 2;
// 한국어 실측 하한(약 2.03자/토큰)에 맞춘 보수적 근사치다.
const ESTIMATED_CHARS_PER_TOKEN = 2;
const ESTIMATED_TOKENS_PER_MESSAGE = 4;
const CONTEXT_WARNING_RATIO = 0.8;
const MODEL_LOOKUP_DEBOUNCE_MS = 300;

// 마지막 응답의 usage 기준 실제 토큰 수. messageCount 시점의 대화까지만 유효하다.
interface ContextUsage {
  tokens: number;
  messageCount: number;
}

function estimateTokens(texts: string[]): number {
  const totalChars = texts.reduce((sum, text) => sum + text.length, 0);
  return (
    Math.ceil(totalChars / ESTIMATED_CHARS_PER_TOKEN) +
    texts.length * ESTIMATED_TOKENS_PER_MESSAGE
  );
}

function loadTemperature(): number {
  const saved = localStorage.getItem("crefleai_temperature");
  if (!saved) return DEFAULT_TEMPERATURE;
  const parsed = Number(saved);
  if (!Number.isFinite(parsed) || parsed < TEMPERATURE_MIN || parsed > TEMPERATURE_MAX) {
    return DEFAULT_TEMPERATURE;
  }
  return parsed;
}

function AssistantContent({
  content,
  streaming,
}: {
  content: string;
  streaming: boolean;
}) {
  const { think, answer, thinking } = splitThink(content, streaming);
  if (think === null && !answer) return <p>...</p>;
  return (
    <>
      {think !== null && (
        <details className="think">
          <summary>{thinking ? "추론 중..." : "추론 과정"}</summary>
          <p>{think}</p>
        </details>
      )}
      {answer && (
        <div className="markdown">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{answer}</ReactMarkdown>
        </div>
      )}
    </>
  );
}

export default function ChatPage() {
  const [token, setToken] = useState(localStorage.getItem("crefleai_token") ?? "");
  const [modelLookupToken, setModelLookupToken] = useState(token);
  // 최초 마운트 시에만 토큰 유무로 초기화 — 이후에는 사용자가 직접 접고 펼친다
  const [settingsOpen, setSettingsOpen] = useState(!token);
  const [system, setSystem] = useState(() => localStorage.getItem("crefleai_system") ?? "");
  const [temperature, setTemperature] = useState(loadTemperature);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contextLength, setContextLength] = useState<number | null>(null);
  const [usage, setUsage] = useState<ContextUsage | null>(null);

  const loadContextLength = useCallback(
    async (authToken: string, isCancelled: () => boolean = () => false) => {
      try {
        const res = await fetch("/v1/models", {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        if (!res.ok) return;
        const body = await res.json();
        const length = body?.data?.[0]?.context_length;
        if (!isCancelled() && typeof length === "number") setContextLength(length);
      } catch {
        // 조회 실패는 사용량 표시 생략으로 처리한다 — 채팅 동작은 막지 않는다
      }
    },
    [],
  );

  useEffect(() => {
    if (!token) {
      setModelLookupToken("");
      setContextLength(null);
      return;
    }
    const timer = setTimeout(() => setModelLookupToken(token), MODEL_LOOKUP_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [token]);

  useEffect(() => {
    if (!modelLookupToken) return;
    let cancelled = false;
    void loadContextLength(modelLookupToken, () => cancelled);
    return () => {
      cancelled = true;
    };
  }, [loadContextLength, modelLookupToken]);

  function saveToken(value: string) {
    setToken(value);
    localStorage.setItem("crefleai_token", value);
  }

  function saveSystem(value: string) {
    setSystem(value);
    setUsage(null);
    localStorage.setItem("crefleai_system", value);
  }

  function saveTemperature(value: number) {
    setTemperature(value);
    localStorage.setItem("crefleai_temperature", String(value));
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!input.trim() || busy) return;
    setError(null);
    const history: ChatMessage[] = [...messages, { role: "user", content: input }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);
    let assistant = "";
    try {
      const payload: ChatMessage[] = system
        ? [{ role: "system", content: system }, ...history]
        : history;
      const res = await fetch("/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ messages: payload, temperature, stream: true }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? `요청 실패 (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { events, rest } = splitSseEvents(buffer);
        buffer = rest;
        for (const event of events) {
          if (event === "[DONE]") continue;
          const parsed = JSON.parse(event);
          if (parsed.error) throw new Error(parsed.error.message);
          if (parsed.usage?.prompt_tokens != null) {
            setUsage({
              tokens: parsed.usage.prompt_tokens + (parsed.usage.completion_tokens ?? 0),
              messageCount: history.length + 1,
            });
          }
          assistant += parsed.choices?.[0]?.delta?.content ?? "";
          setMessages([...history, { role: "assistant", content: assistant }]);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "요청 실패");
      // 부분 수신 텍스트는 유지하고, 아무것도 못 받았으면 빈 말풍선만 제거
      setMessages(
        assistant ? [...history, { role: "assistant", content: assistant }] : history,
      );
    } finally {
      setBusy(false);
      if (token) await loadContextLength(token);
    }
  }

  // 마지막 응답의 usage가 현재 대화 상태를 커버하면 실제 값, 아니면 문자 수 근사치
  const usedTokens =
    usage && usage.messageCount === messages.length
      ? usage.tokens
      : estimateTokens([
          ...(system ? [system] : []),
          ...messages.map((message) => message.content),
        ]);
  const usageRatio = contextLength ? usedTokens / contextLength : 0;
  const isWarning = usageRatio >= CONTEXT_WARNING_RATIO;

  return (
    <main className="chat">
      <h1>CrefleAI Chat 테스트</h1>
      <details open={settingsOpen} onToggle={(e) => setSettingsOpen(e.currentTarget.open)}>
        <summary>연결 설정</summary>
        <label>
          API 토큰
          <input
            value={token}
            onChange={(e) => saveToken(e.target.value)}
            placeholder="관리자에게 발급받은 토큰"
          />
        </label>
        <label>
          System 프롬프트
          <textarea value={system} onChange={(e) => saveSystem(e.target.value)} />
        </label>
        <label>
          Temperature: {temperature}
          <input
            type="range"
            min={TEMPERATURE_MIN}
            max={TEMPERATURE_MAX}
            step="0.1"
            value={temperature}
            onChange={(e) => saveTemperature(Number(e.target.value))}
          />
        </label>
      </details>

      <ol className="messages">
        {messages.map((m, i) => (
          <li key={i} className={m.role}>
            <strong>{m.role === "user" ? "나" : "모델"}</strong>
            {m.role === "assistant" ? (
              <AssistantContent
                content={m.content}
                streaming={busy && i === messages.length - 1}
              />
            ) : (
              <p>{m.content || "..."}</p>
            )}
          </li>
        ))}
      </ol>
      {contextLength !== null && contextLength > 0 && (
        <p className={isWarning ? "context-usage warning" : "context-usage"}>
          컨텍스트 사용량 약 {usedTokens.toLocaleString()} /{" "}
          {contextLength.toLocaleString()} ({Math.round(usageRatio * 100)}%)
        </p>
      )}
      {error && <p role="alert">{error}</p>}

      <form onSubmit={send}>
        <label>
          메시지
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="메시지를 입력하세요"
          />
        </label>
        <button type="submit" disabled={busy || !token}>
          보내기
        </button>
      </form>
    </main>
  );
}
