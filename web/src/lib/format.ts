export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

/** 75 giây -> "1:15" */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Thời điểm (mili giây) -> "vừa xong", "5 phút trước", "2 giờ trước", "3 ngày trước" */
export function timeAgo(ms: number): string {
  const diff = Math.max(0, Date.now() - ms) / 1000;
  if (diff < 45) return "vừa xong";
  if (diff < 3600) return `${Math.round(diff / 60)} phút trước`;
  if (diff < 86400) return `${Math.round(diff / 3600)} giờ trước`;
  return `${Math.round(diff / 86400)} ngày trước`;
}

/** Thời điểm hết hạn (giây) -> "còn khoảng 23 giờ" */
export function remaining(expiresAtSeconds: number): string {
  const left = expiresAtSeconds - Date.now() / 1000;
  if (left <= 0) return "sắp bị xoá";
  if (left < 3600) return `còn ${Math.max(1, Math.round(left / 60))} phút`;
  return `còn khoảng ${Math.round(left / 3600)} giờ`;
}

export function voiceName(id: string): string {
  if (id.includes("HoaiMy")) return "Hoài My (nữ)";
  if (id.includes("NamMinh")) return "Nam Minh (nam)";
  return id;
}
