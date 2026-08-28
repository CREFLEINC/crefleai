import type { ReactNode } from "react";
import { CheckCircle, Circle, SpinnerGap, WarningCircle } from "./icons";

type StatusTone = "danger" | "info" | "neutral" | "success" | "warning";

interface StatusBadgeProps {
  children: ReactNode;
  pulse?: boolean;
  tone?: StatusTone;
}

const ICONS: Record<StatusTone, typeof Circle> = {
  danger: WarningCircle,
  info: SpinnerGap,
  neutral: Circle,
  success: CheckCircle,
  warning: WarningCircle,
};

export default function StatusBadge({
  children,
  pulse = false,
  tone = "neutral",
}: StatusBadgeProps) {
  const Icon = ICONS[tone];
  return (
    <span
      className={`status-badge status-${tone}${pulse ? " is-pulsing" : ""}`}
    >
      <Icon aria-hidden="true" weight={tone === "neutral" ? "fill" : "bold"} />
      {children}
    </span>
  );
}
