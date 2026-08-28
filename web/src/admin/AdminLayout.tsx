import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { api } from "../api";
import Brand from "../ui/Brand";
import { ChatCircleDots, Cube, Gauge, Key, SignOut } from "../ui/icons";
import ThemeToggle from "../ui/ThemeToggle";

export default function AdminLayout() {
  const navigate = useNavigate();

  async function logout() {
    try {
      await api("/api/admin/logout", { method: "POST" });
    } catch {
      // 로그아웃 실패와 무관하게 로그인 화면으로 이동한다
    } finally {
      navigate("/login");
    }
  }

  return (
    <div className="admin-shell">
      <aside className="app-sidebar">
        <Brand />

        <div className="environment-chip">
          <span className="live-dot" aria-hidden="true" />
          Local GPU Gateway
        </div>

        <nav aria-label="관리자 메뉴">
          <p className="nav-label">Workspace</p>
          <NavLink to="/admin/monitoring">
            <Gauge aria-hidden="true" />
            <span>모니터링</span>
          </NavLink>
          <NavLink to="/admin/models">
            <Cube aria-hidden="true" />
            <span>모델 관리</span>
          </NavLink>
          <NavLink to="/admin/tokens">
            <Key aria-hidden="true" />
            <span>토큰 관리</span>
          </NavLink>
          <NavLink to="/chat">
            <ChatCircleDots aria-hidden="true" />
            <span>Chat 테스트</span>
          </NavLink>
        </nav>

        <div className="sidebar-footer">
          <ThemeToggle />
          <button type="button" className="sidebar-action" onClick={logout}>
            <SignOut aria-hidden="true" />
            <span>로그아웃</span>
          </button>
        </div>
      </aside>

      <div className="admin-workspace">
        <header className="mobile-app-header">
          <Brand compact />
          <ThemeToggle compact />
        </header>
        <main id="main-content" className="admin-content" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
