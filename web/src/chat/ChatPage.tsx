import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { splitSseEvents } from "../sse";
import { splitThink } from "../think";
import type { ChatMessage } from "../types";
import Brand from "../ui/Brand";
import {
  ArrowCounterClockwise,
  CaretDown,
  ChatCircleDots,
  Cpu,
  GearSix,
  PaperPlaneTilt,
  Robot,
  Sparkle,
  SpinnerGap,
  User,
  WarningCircle,
} from "../ui/icons";
import StatusBadge from "../ui/StatusBadge";
import ThemeToggle from "../ui/ThemeToggle";

const DEFAULT_TEMPERATURE = 0.7;
const TEMPERATURE_MIN = 0;
const TEMPERATURE_MAX = 2;
// 한국어 실측 하한(약 2.03자/토큰)에 맞춘 보수적 근사치다.
const ESTIMATED_CHARS_PER_TOKEN = 2;
const ESTIMATED_TOKENS_PER_MESSAGE = 4;
const CONTEXT_WARNING_RATIO = 0.8;
const MODEL_LOOKUP_DEBOUNCE_MS = 300;
const SUGGESTIONS = [
  "이 모델의 주요 특징을 알려줘",
  "간단한 Python 예제를 작성해줘",
  "회의 내용을 세 줄로 요약해줘",
];

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
  if (
    !Number.isFinite(parsed) ||
    parsed < TEMPERATURE_MIN ||
    parsed > TEMPERATURE_MAX
  ) {
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
          <summary>
            <Cpu aria-hidden="true" />
            {thinking ? "추론 중..." : "추론 과정"}
            <CaretDown aria-hidden="true" className="details-caret" />
          </summary>
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
  const [token, setToken] = useState(
    localStorage.getItem("crefleai_token") ?? "",
  );
  const latestTokenRef = useRef(token);
  const contextRequestIdRef = useRef(0);
  // 최초 마운트 시에만 토큰 유무로 초기화 — 이후에는 사용자가 직접 접고 펼친다
  const [settingsOpen, setSettingsOpen] = useState(!token);
  const [system, setSystem] = useState(
    () => localStorage.getItem("crefleai_system") ?? "",
  );
  const [temperature, setTemperature] = useState(loadTemperature);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contextLength, setContextLength] = useState<number | null>(null);
  const [usage, setUsage] = useState<ContextUsage | null>(null);

  const loadContextLength = useCallback(
    async (authToken: string, isCancelled: () => boolean = () => false) => {
      if (authToken !== latestTokenRef.current) return;
      const requestId = ++contextRequestIdRef.current;
      const shouldIgnore = (): boolean =>
        isCancelled() ||
        authToken !== latestTokenRef.current ||
        requestId !== contextRequestIdRef.current;
      try {
        const res = await fetch("/v1/models", {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        if (!res.ok) {
          if (!shouldIgnore()) setContextLength(null);
          return;
        }
        const body = await res.json();
        const length = body?.data?.[0]?.context_length;
        if (!shouldIgnore()) {
          setContextLength(
            typeof length === "number" && length > 0 ? length : null,
          );
        }
      } catch {
        // 조회 실패 시 온라인 상태를 해제하되 채팅 동작은 막지 않는다.
        if (!shouldIgnore()) setContextLength(null);
      }
    },
    [],
  );

  useEffect(() => {
    if (!token) {
      setContextLength(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void loadContextLength(token, () => cancelled);
    }, MODEL_LOOKUP_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [loadContextLength, token]);

  function saveToken(value: string) {
    latestTokenRef.current = value;
    contextRequestIdRef.current += 1;
    setContextLength(null);
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

  function clearConversation(): void {
    setMessages([]);
    setUsage(null);
    setError(null);
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!token || !input.trim() || busy) return;
    setError(null);
    const history: ChatMessage[] = [
      ...messages,
      { role: "user", content: input },
    ];
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
              tokens:
                parsed.usage.prompt_tokens +
                (parsed.usage.completion_tokens ?? 0),
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
        assistant
          ? [...history, { role: "assistant", content: assistant }]
          : history,
      );
    } finally {
      setBusy(false);
      if (token) await loadContextLength(token);
    }
  }

  function submitOnEnter(
    event: ReactKeyboardEvent<HTMLTextAreaElement>,
  ): void {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    ) {
      return;
    }
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
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
    <main id="main-content" className="chat-page" tabIndex={-1}>
      <header className="chat-topbar">
        <Brand compact />
        <div className="chat-topbar-actions">
          <span role="status" aria-live="polite" aria-atomic="true">
            <StatusBadge
              tone={contextLength ? "success" : "neutral"}
              pulse={Boolean(contextLength)}
            >
              {contextLength ? "Model online" : "연결 대기"}
            </StatusBadge>
          </span>
          <a className="button button-ghost button-small" href="/admin">
            관리자
          </a>
          <ThemeToggle compact />
        </div>
      </header>

      <div className="chat-layout">
        <aside className="chat-sidebar">
          <div className="chat-sidebar-heading">
            <span className="panel-icon" aria-hidden="true">
              <GearSix weight="duotone" />
            </span>
            <div>
              <p className="eyebrow">Playground</p>
              <h1>Chat 테스트</h1>
            </div>
          </div>
          <p className="sidebar-description">
            현재 서비스 모델의 응답과 스트리밍 동작을 확인합니다.
          </p>

          <details
            className="chat-settings"
            open={settingsOpen}
            onToggle={(event) => setSettingsOpen(event.currentTarget.open)}
          >
            <summary>
              <span>
                <GearSix aria-hidden="true" /> 연결 설정
              </span>
              <CaretDown aria-hidden="true" className="details-caret" />
            </summary>
            <div className="settings-fields">
              <label htmlFor="api-token">API 토큰</label>
              <input
                id="api-token"
                type="password"
                value={token}
                onChange={(event) => saveToken(event.target.value)}
                placeholder="관리자에게 발급받은 토큰"
                autoComplete="off"
              />
              <span className="field-hint">
                브라우저에만 저장되며 요청 헤더에 사용됩니다.
              </span>

              <label htmlFor="system-prompt">System 프롬프트</label>
              <textarea
                id="system-prompt"
                value={system}
                onChange={(event) => saveSystem(event.target.value)}
                placeholder="모델의 역할과 답변 방식을 지정하세요."
                rows={5}
              />

              <div className="range-label">
                <label htmlFor="temperature">Temperature</label>
                <output aria-live="polite">{temperature}</output>
              </div>
              <input
                id="temperature"
                type="range"
                min={TEMPERATURE_MIN}
                max={TEMPERATURE_MAX}
                step="0.1"
                value={temperature}
                onChange={(event) =>
                  saveTemperature(Number(event.target.value))
                }
              />
              <div className="range-scale" aria-hidden="true">
                <span>정확하게</span>
                <span>창의적으로</span>
              </div>
            </div>
          </details>

          {contextLength !== null && contextLength > 0 && (
            <div className="context-panel">
              <div className="progress-label">
                <span>컨텍스트</span>
                <span>{Math.round(usageRatio * 100)}%</span>
              </div>
              <progress
                className={isWarning ? "progress-warning" : "progress-blue"}
                value={Math.min(usageRatio * 100, 100)}
                max={100}
                aria-label="컨텍스트 사용률"
              />
              <p
                className={
                  isWarning ? "context-usage warning" : "context-usage"
                }
              >
                컨텍스트 사용량 약 {usedTokens.toLocaleString()} /{" "}
                {contextLength.toLocaleString()} ({Math.round(usageRatio * 100)}
                %)
              </p>
            </div>
          )}

          {messages.length > 0 && (
            <button
              type="button"
              className="button button-ghost button-block"
              onClick={clearConversation}
            >
              <ArrowCounterClockwise aria-hidden="true" /> 새 대화
            </button>
          )}
        </aside>

        <section className="conversation-panel" aria-label="대화">
          <header className="conversation-header">
            <div>
              <p className="eyebrow">Live Conversation</p>
              <h2>모델과 대화하기</h2>
            </div>
            {busy && (
              <span className="generating-state" role="status">
                <SpinnerGap className="spin" aria-hidden="true" /> 응답 생성 중
              </span>
            )}
          </header>

          <div className="conversation-body" aria-busy={busy}>
            {messages.length === 0 ? (
              <div className="chat-empty-state">
                <span className="chat-hero-icon" aria-hidden="true">
                  <Sparkle weight="duotone" />
                </span>
                <h2>무엇을 테스트해 볼까요?</h2>
                <p>프롬프트를 직접 입력하거나 아래 예시로 대화를 시작하세요.</p>
                <div className="suggestion-grid">
                  {SUGGESTIONS.map((suggestion) => (
                    <button
                      type="button"
                      key={suggestion}
                      onClick={() => setInput(suggestion)}
                    >
                      <ChatCircleDots aria-hidden="true" />
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <ol className="messages" aria-live="polite">
                {messages.map((message, index) => (
                  <li key={index} className={message.role}>
                    <span className="message-avatar" aria-hidden="true">
                      {message.role === "user" ? (
                        <User weight="bold" />
                      ) : (
                        <Robot weight="duotone" />
                      )}
                    </span>
                    <div className="message-content">
                      <strong>
                        {message.role === "user" ? "나" : "CrefleAI"}
                      </strong>
                      {message.role === "assistant" ? (
                        <AssistantContent
                          content={message.content}
                          streaming={busy && index === messages.length - 1}
                        />
                      ) : (
                        <p>{message.content || "..."}</p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="composer-area">
            {error && (
              <div className="notice notice-danger" role="alert">
                <WarningCircle aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}
            <form onSubmit={send} className="composer">
              <label className="sr-only" htmlFor="chat-message">
                메시지
              </label>
              <textarea
                id="chat-message"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={submitOnEnter}
                placeholder={
                  token ? "메시지를 입력하세요" : "먼저 API 토큰을 입력하세요"
                }
                rows={2}
                disabled={busy}
              />
              <button
                type="submit"
                className="send-button"
                disabled={busy || !token || !input.trim()}
                aria-label="보내기"
              >
                {busy ? (
                  <SpinnerGap className="spin" aria-hidden="true" />
                ) : (
                  <PaperPlaneTilt aria-hidden="true" weight="fill" />
                )}
                <span>보내기</span>
              </button>
            </form>
            <p className="composer-hint">
              Enter 전송 · Shift+Enter 줄바꿈 · AI 응답에는 부정확한 정보가
              포함될 수 있습니다.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
