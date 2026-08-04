import { useState, type FormEvent } from "react";
import { splitSseEvents } from "../sse";
import type { ChatMessage } from "../types";

export default function ChatPage() {
  const [token, setToken] = useState(localStorage.getItem("crefleai_token") ?? "");
  const [system, setSystem] = useState("");
  const [temperature, setTemperature] = useState(0.7);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function saveToken(value: string) {
    setToken(value);
    localStorage.setItem("crefleai_token", value);
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!input.trim() || busy) return;
    setError(null);
    const history: ChatMessage[] = [...messages, { role: "user", content: input }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);
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
      let assistant = "";
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
          assistant += parsed.choices?.[0]?.delta?.content ?? "";
          setMessages([...history, { role: "assistant", content: assistant }]);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "요청 실패");
      setMessages(history); // 빈 어시스턴트 말풍선 제거
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="chat">
      <h1>CrefleAI Chat 테스트</h1>
      <details open={!token}>
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
          <textarea value={system} onChange={(e) => setSystem(e.target.value)} />
        </label>
        <label>
          Temperature: {temperature}
          <input
            type="range"
            min="0"
            max="2"
            step="0.1"
            value={temperature}
            onChange={(e) => setTemperature(Number(e.target.value))}
          />
        </label>
      </details>

      <ol className="messages">
        {messages.map((m, i) => (
          <li key={i} className={m.role}>
            <strong>{m.role === "user" ? "나" : "모델"}</strong>
            <p>{m.content || "..."}</p>
          </li>
        ))}
      </ol>
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
