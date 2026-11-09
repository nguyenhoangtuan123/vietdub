"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError, api, type JobStatus } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { loadHistory, removeHistory, type HistoryItem } from "@/lib/history";
import { FilmIcon } from "./Icons";
import { Card } from "./ui";

export const STATUS_LABEL: Record<JobStatus, { text: string; cls: string }> = {
  queued: { text: "Đang chờ", cls: "bg-sunken text-muted" },
  analyzing: { text: "Đang xử lý", cls: "bg-accent-soft text-accent" },
  awaiting_review: { text: "Chờ bạn duyệt", cls: "bg-warn-soft text-warn" },
  rendering: { text: "Đang xuất", cls: "bg-accent-soft text-accent" },
  done: { text: "Hoàn tất", cls: "bg-ok-soft text-ok" },
  failed: { text: "Lỗi", cls: "bg-bad-soft text-bad" },
  cancelled: { text: "Đã huỷ", cls: "bg-sunken text-muted" },
};

export function StatusBadge({ status }: { status: JobStatus }) {
  const s = STATUS_LABEL[status];
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${s.cls}`}>{s.text}</span>;
}

/** Danh sách video đã gửi từ trình duyệt này; việc nào máy chủ đã xoá (hết hạn) thì tự bỏ khỏi danh sách. */
export function HistoryList() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [status, setStatus] = useState<Record<string, JobStatus>>({});

  useEffect(() => {
    let cancelled = false;
    const list = loadHistory();
    setItems(list);
    for (const item of list) {
      api
        .getJob(item.id)
        .then((job) => {
          if (!cancelled) setStatus((s) => ({ ...s, [item.id]: job.status }));
        })
        .catch((e) => {
          if (cancelled) return;
          if (e instanceof ApiError && e.status === 404) {
            removeHistory(item.id);
            setItems((cur) => cur.filter((x) => x.id !== item.id));
          }
        });
    }
    return () => {
      cancelled = true;
    };
  }, []);

  if (items.length === 0) return null;

  return (
    <section aria-labelledby="history-title" className="mx-auto max-w-2xl">
      <h2 id="history-title" className="mb-3 text-sm font-semibold text-muted">
        Video gần đây của bạn
      </h2>
      <Card className="divide-y divide-line overflow-hidden">
        {items.map((item) => (
          <Link
            key={item.id}
            href={`/jobs/${item.id}`}
            className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-sunken focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
          >
            <FilmIcon className="shrink-0 text-muted" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{item.filename}</span>
              <span className="block text-xs text-muted">{timeAgo(item.createdAt)}</span>
            </span>
            {status[item.id] ? <StatusBadge status={status[item.id]} /> : null}
          </Link>
        ))}
      </Card>
    </section>
  );
}
