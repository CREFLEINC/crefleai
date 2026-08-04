import { useEffect, useState, type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { api } from "../api";

export default function RequireAdmin({ children }: { children: ReactNode }) {
  const [state, setState] = useState<"loading" | "ok" | "unauthorized">("loading");

  useEffect(() => {
    api("/api/admin/me")
      .then(() => setState("ok"))
      .catch(() => setState("unauthorized"));
  }, []);

  if (state === "loading") return <p>확인 중...</p>;
  if (state === "unauthorized") return <Navigate to="/login" replace />;
  return <>{children}</>;
}
