import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import AdminLayout from "./admin/AdminLayout";
import RequireAdmin from "./admin/RequireAdmin";

const LoginPage = lazy(() => import("./admin/LoginPage"));
const MonitoringPage = lazy(() => import("./admin/MonitoringPage"));
const ModelsPage = lazy(() => import("./admin/ModelsPage"));
const TokensPage = lazy(() => import("./admin/TokensPage"));
const ChatPage = lazy(() => import("./chat/ChatPage"));

function RouteLoading() {
  return (
    <main className="route-loading" aria-busy="true" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>화면을 준비하고 있습니다.</span>
    </main>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <a className="skip-link" href="#main-content">
        본문으로 바로가기
      </a>
      <Suspense fallback={<RouteLoading />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/admin"
            element={
              <RequireAdmin>
                <AdminLayout />
              </RequireAdmin>
            }
          >
            <Route index element={<Navigate to="models" replace />} />
            <Route path="monitoring" element={<MonitoringPage />} />
            <Route path="models" element={<ModelsPage />} />
            <Route path="tokens" element={<TokensPage />} />
          </Route>
          <Route path="/chat" element={<ChatPage />} />
          <Route path="*" element={<Navigate to="/chat" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
