import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api("/api/admin/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      navigate("/admin/models");
    } catch (err) {
      setError(err instanceof Error ? err.message : "로그인 실패");
    }
  }

  return (
    <main className="login">
      <h1>CrefleAI 관리자</h1>
      <form onSubmit={onSubmit}>
        <label>
          아이디
          <input value={username} onChange={(e) => setUsername(e.target.value)} />
        </label>
        <label>
          비밀번호
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button type="submit">로그인</button>
      </form>
      {error && <p role="alert">{error}</p>}
    </main>
  );
}
