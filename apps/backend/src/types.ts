export interface Env {
  ENVIRONMENT: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  MAXMIND_LICENSE_KEY?: string;
}

export interface Variables {
  userId: string;
}
