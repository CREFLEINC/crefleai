import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { api } from "../api";

export default function AdminLayout() {
  const navigate = useNavigate();

  async function logout() {
    try {
      await api("/api/admin/logout", { method: "POST" });
    } catch (err) {
      // Silently ignore logout errors - user navigates to login regardless
    } finally {
      navigate("/login");
    }
  }

  return (
    <div className="admin-layout">
      <header>
        <strong>CrefleAI 관리자</strong>
        <nav>
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
