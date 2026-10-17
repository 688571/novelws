export interface User {
  id: number;
  username: string;
  nickname?: string;
  role: 'admin' | 'user';
  bound_device_id?: string | null;
  device_info?: string | null;
  device_bound_at?: string | null;
  device_reset_requested?: boolean | number;
  status?: 'active' | 'disabled';
  created_at?: string;
  novel_count?: number;
}

export interface NovelMeta {
  filename: string;
  name: string;
  start_url: string | null;
  mtime: string;
  size: string;
  chapter_estimate: number;
  is_favorite?: boolean;
  associated?: boolean;
  added_at?: string;
}

export interface TaskStatus {
  status: 'running' | 'finished' | 'error';
  log: string[];
  start_url: string;
  novel_name: string | null;
  safe_name: string | null;
  html_path: string | null;
}

export interface Chapter {
  title: string;
  content: string; // HTML
}
