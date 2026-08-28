import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import Brand from "../ui/Brand";
import {
  ArrowRight,
  CheckCircle,
  Eye,
  EyeSlash,
  LockKey,
  ShieldCheck,
  SpinnerGap,
} from "../ui/icons";
import ThemeToggle from "../ui/ThemeToggle";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const navigate = useNavigate();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      await api("/api/admin/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      navigate("/admin/models");
    } catch (err) {
      setError(err instanceof Error ? err.message : "로그인 실패");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main id="main-content" className="login-page" tabIndex={-1}>
      <div className="login-topbar">
        <Brand />
        <ThemeToggle compact />
      </div>

      <section
        className="login-showcase"
        aria-labelledby="login-showcase-title"
      >
        <div className="showcase-copy">
          <p className="eyebrow">Private AI Infrastructure</p>
          <h1 id="login-showcase-title">
            우리 팀의 AI를
            <br />
            가장 가까운 곳에서.
          </h1>
          <p>
            사내 GPU에서 모델을 운영하고, 액세스를 제어하고, 시스템 상태를
            한눈에 확인하세요.
          </p>
        </div>

        <div className="trust-list" aria-label="서비스 특징">
          <span>
            <ShieldCheck aria-hidden="true" weight="duotone" /> 사내망 중심의
            안전한 운영
          </span>
          <span>
            <CheckCircle aria-hidden="true" weight="duotone" /> OpenAI 호환 API
          </span>
          <span>
            <CheckCircle aria-hidden="true" weight="duotone" /> GPU와 모델 상태
            실시간 확인
          </span>
        </div>
      </section>

      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-card">
          <span className="login-icon" aria-hidden="true">
            <LockKey weight="duotone" />
          </span>
          <p className="eyebrow">Admin Console</p>
          <h2 id="login-title">관리자 로그인</h2>
          <p className="login-intro">발급받은 관리자 계정으로 계속하세요.</p>

          <form onSubmit={onSubmit} aria-busy={isLoading}>
            <label htmlFor="username">아이디</label>
            <input
              id="username"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin"
              required
            />

            <label htmlFor="password">비밀번호</label>
            <div className="password-field">
              <input
                id="password"
                autoComplete="current-password"
                type={isPasswordVisible ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button
                type="button"
                className="input-icon-button"
                onClick={() => setIsPasswordVisible((visible) => !visible)}
                aria-label={
                  isPasswordVisible ? "비밀번호 숨기기" : "비밀번호 보기"
                }
                aria-pressed={isPasswordVisible}
              >
                {isPasswordVisible ? (
                  <EyeSlash aria-hidden="true" />
                ) : (
                  <Eye aria-hidden="true" />
                )}
              </button>
            </div>

            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}

            <button
              type="submit"
              className="button button-primary button-block"
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <SpinnerGap className="spin" aria-hidden="true" /> 로그인
                  중...
                </>
              ) : (
                <>
                  로그인 <ArrowRight aria-hidden="true" />
                </>
              )}
            </button>
          </form>
          <p className="login-help">
            계정이 없거나 접근할 수 없다면 시스템 관리자에게 문의하세요.
          </p>
        </div>
      </section>
    </main>
  );
}
