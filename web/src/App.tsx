import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import AdminLayout from "./admin/AdminLayout";
import LoginPage from "./admin/LoginPage";
import ModelsPage from "./admin/ModelsPage";
import RequireAdmin from "./admin/RequireAdmin";
import TokensPage from "./admin/TokensPage";
import ChatPage from "./chat/ChatPage";

export default function App() {
  return (
    <BrowserRouter>
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
          <Route path="models" element={<ModelsPage />} />
          <Route path="tokens" element={<TokensPage />} />
        </Route>
        <Route path="/chat" element={<ChatPage />} />
        <Route path="*" element={<Navigate to="/chat" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
