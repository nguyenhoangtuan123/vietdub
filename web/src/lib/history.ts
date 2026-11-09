/** Lịch sử các video đã gửi, chỉ nhớ trong trình duyệt này (máy chủ không có danh sách chung để giữ riêng tư). */
export interface HistoryItem {
  id: string;
  filename: string;
  createdAt: number;
}

const KEY = "vietdub.history";
const MAX_ITEMS = 12;

export function loadHistory(): HistoryItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(list)) return [];
    return list.filter(
      (x): x is HistoryItem =>
        typeof x?.id === "string" && typeof x?.filename === "string" && typeof x?.createdAt === "number",
    );
  } catch {
    return [];
  }
}

function save(list: HistoryItem[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_ITEMS)));
  } catch {
    /* bỏ qua: chỉ mất lịch sử */
  }
}

export function addHistory(item: HistoryItem): void {
  const rest = loadHistory().filter((x) => x.id !== item.id);
  save([item, ...rest]);
}

export function removeHistory(id: string): void {
  save(loadHistory().filter((x) => x.id !== id));
}
