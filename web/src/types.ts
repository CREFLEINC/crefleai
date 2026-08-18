export interface TokenInfo {
  jti: string;
  user_name: string;
  purpose: string;
  created_at: string;
  revoked_at: string | null;
}

export interface CreatedToken {
  token: string;
  jti: string;
  user_name: string;
  purpose: string;
  created_at: string;
}

export interface ModelInfo {
  id: string;
  display_name: string;
  hf_repo: string;
  filename: string;
  quantization: string;
  size_bytes: number;
  context_length: number;
  license: string;
  description: string;
  status: string;
  progress: number;
  error: string | null;
}

export interface WorkerInfo {
  status: string;
  model_id: string | null;
  error: string | null;
}

export interface AdminModels {
  models: ModelInfo[];
  worker: WorkerInfo;
}

export interface GpuMetric {
  index: number;
  name: string;
  utilization_percent: number;
  memory_used_bytes: number;
  memory_total_bytes: number;
  memory_used_percent: number;
}

export interface DiskMetric {
  status: string;
  path: string;
  total_bytes: number | null;
  used_bytes: number | null;
  free_bytes: number | null;
  used_percent: number | null;
  error: string | null;
}

export interface RequestMetrics {
  window_seconds: number;
  rpm: number;
  success: number;
  failure: number;
  in_flight: number;
}

export interface AdminMetrics {
  sampled_at: string | null;
  stale: boolean;
  disk: DiskMetric;
  gpus: GpuMetric[];
  requests: RequestMetrics;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
