import { useEffect, useState, type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { api } from "../api";
import Brand from "../ui/Brand";
import { SpinnerGap } from "../ui/icons";

export default function RequireAdmin({ children }: { children: ReactNode }) {
  const [state, setState] = useState<"loading" | "ok" | "unauthorized">(
    "loading",
  );

  useEffect(() => {
    api("/api/admin/me")
      .then(() => setState("ok"))
      .catch(() => setState("unauthorized"));
  }, []);

  if (state === "loading") {
    return (
      <main className="session-loading" aria-busy="true">
        <Brand />
        <SpinnerGap className="spin" aria-hidden="true" />
        <p>관리자 세션을 확인하고 있습니다</p>
      </main>
    );
  }
  if (state === "unauthorized") return <Navigate to="/login" replace />;
  return <>{children}</>;
}
