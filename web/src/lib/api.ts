export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000").replace(/\/+$/, "");

export type JobStatus =
  | "queued"
  | "analyzing"
  | "awaiting_review"
  | "rendering"
  | "done"
  | "failed"
  | "cancelled";
export type StepId = "tach_am" | "chep_loi" | "dich" | "doc_giong" | "ghep_am" | "xuat_video";
export type OutputKind = "video" | "srt" | "txt";

export const ACTIVE_STATUSES: ReadonlySet<JobStatus> = new Set<JobStatus>(["queued", "analyzing", "rendering"]);

export interface Voice {
  id: string;
  label: string;
}

export interface Health {
  ok: boolean;
  problems: string[];
  auth_required: boolean;
  auth_ok: boolean;
  max_upload_mb: number;
  max_duration_s: number;
  ttl_hours: number;
  voices: Voice[];
  default_voice: string;
  extensions: string[];
}

export interface JobOptions {
  voice: string;
  hardsub: boolean;
  review: boolean;
}

export interface Job {
  id: string;
  filename: string;
  size: number;
  duration: number;
  options: JobOptions;
  status: JobStatus;
  phase: "analyze" | "render";
  step: StepId | null;
  progress: number;
  message: string;
  error: string | null;
  outputs: Partial<Record<OutputKind, string>>;
  tts_failed: number[];
  segment_count: number;
  created_at: number;
  updated_at: number;
  queue_position: number | null;
  expires_at: number;
  can_continue: boolean;
}

export interface Segment {
  index: number;
  start: number;
  end: number;
  zh: string;
  vi: string;
  max_chars: number;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Mã truy cập (nếu máy chủ yêu cầu) được nhớ trong trình duyệt. */
const TOKEN_KEY = "vietdub.token";

export function getToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setToken(token: string): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* trình duyệt chặn lưu trữ: chỉ mất việc nhớ mã */
  }
}

function detailOf(body: unknown, fallback: string): string {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && detail.length > 0) {
    const msg = (detail[0] as { msg?: unknown }).msg;
    if (typeof msg === "string") return msg;
  }
  return fallback;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set("X-Access-Token", token);
  let res: Response;
  try {
    res = await fetch(API_URL + path, { ...init, headers, cache: "no-store" });
  } catch {
    throw new ApiError(0, "Không kết nối được tới máy chủ lồng tiếng.");
  }
  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      /* phản hồi không phải JSON */
    }
    throw new ApiError(res.status, detailOf(body, `Máy chủ báo lỗi ${res.status}.`));
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export const api = {
  health: () => request<Health>("/api/health"),
  getJob: (id: string) => request<Job>(`/api/jobs/${encodeURIComponent(id)}`),
  getSegments: async (id: string) =>
    (await request<{ segments: Segment[] }>(`/api/jobs/${encodeURIComponent(id)}/segments`)).segments,
  continueJob: (id: string, segments: { index: number; vi: string }[]) =>
    request<Job>(`/api/jobs/${encodeURIComponent(id)}/continue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ segments }),
    }),
  cancelJob: (id: string) => request<Job>(`/api/jobs/${encodeURIComponent(id)}/cancel`, { method: "POST" }),
  deleteJob: (id: string) => request<void>(`/api/jobs/${encodeURIComponent(id)}`, { method: "DELETE" }),
};

function withToken(url: string): string {
  const token = getToken();
  if (!token) return url;
  return url + (url.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(token);
}

/** Địa chỉ file kết quả (dùng cho thẻ video và nút tải). Mã truy cập đi kèm trên URL vì thẻ video không gắn được header. */
export function fileUrl(id: string, kind: OutputKind, inline = false): string {
  const base = `${API_URL}/api/jobs/${encodeURIComponent(id)}/download/${kind}`;
  return withToken(inline ? base + "?inline=1" : base);
}

export function sourceUrl(id: string): string {
  return withToken(`${API_URL}/api/jobs/${encodeURIComponent(id)}/source`);
}

export interface UploadHandle {
  promise: Promise<string>;
  abort: () => void;
}

/** Tải video lên bằng XMLHttpRequest để có tiến độ tải (fetch chưa làm được). */
export function uploadJob(
  file: File,
  opts: JobOptions,
  onProgress: (fraction: number) => void,
): UploadHandle {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<string>((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);
    form.append("voice", opts.voice);
    form.append("hardsub", String(opts.hardsub));
    form.append("review", String(opts.review));

    xhr.open("POST", `${API_URL}/api/jobs`);
    const token = getToken();
    if (token) xhr.setRequestHeader("X-Access-Token", token);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* không phải JSON */
      }
      if (xhr.status === 201 && typeof (body as { id?: unknown } | null)?.id === "string") {
        resolve((body as { id: string }).id);
      } else {
        reject(new ApiError(xhr.status, detailOf(body, `Máy chủ báo lỗi ${xhr.status}.`)));
      }
    };
    xhr.onerror = () => reject(new ApiError(0, "Mất kết nối khi tải video lên. Hãy kiểm tra máy chủ và thử lại."));
    xhr.onabort = () => reject(new ApiError(-1, "Đã huỷ tải lên."));
    xhr.send(form);
  });
  return { promise, abort: () => xhr.abort() };
}
