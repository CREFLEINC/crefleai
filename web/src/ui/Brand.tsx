import { Cpu } from "./icons";

interface BrandProps {
  compact?: boolean;
}

export default function Brand({ compact = false }: BrandProps) {
  return (
    <div className={`brand${compact ? " brand-compact" : ""}`}>
      <span className="brand-mark" aria-hidden="true">
        <Cpu weight="duotone" />
      </span>
      <span className="brand-copy">
        <strong>CrefleAI</strong>
        {!compact && <small>Local Intelligence</small>}
      </span>
    </div>
  );
}
