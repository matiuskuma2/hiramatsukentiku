// ==============================================
// Cloudflare Bindings Type Definition
// ==============================================

export type Bindings = {
  DB: D1Database;
  DEV_USER_EMAIL?: string;
  OPENAI_API_KEY?: string;
  SNAPSHOT_QUEUE?: any; // Queue binding (optional)
};

export type AppEnv = {
  Bindings: Bindings;
  Variables: {
    currentUser?: {
      id: number;
      email: string;
      role: string;
    };
  };
};

// Standard API response wrapper
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  meta?: {
    total?: number;
    page?: number;
    per_page?: number;
  };
}
