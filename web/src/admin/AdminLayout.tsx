import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { api } from "../api";

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
    <div className="admin-layout">
      <header>
        <strong>CrefleAI 관리자</strong>
        <nav>
          <NavLink to="/admin/monitoring">모니터링</NavLink>
          <NavLink to="/admin/models">모델 관리</NavLink>
          <NavLink to="/admin/tokens">토큰 관리</NavLink>
          <NavLink to="/chat">Chat 테스트</NavLink>
        </nav>
        <button onClick={logout}>로그아웃</button>
      </header>
      <Outlet />
    </div>
  );
}
