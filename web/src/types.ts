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

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
