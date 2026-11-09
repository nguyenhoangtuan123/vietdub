"use client";

import { useCallback, useEffect, useState } from "react";
import { API_URL, api, type Health } from "@/lib/api";
import { AccessGate } from "./AccessGate";
import { HistoryList } from "./HistoryList";
import { AlertIcon, Spinner } from "./Icons";
import { UploadCard } from "./UploadCard";
import { Button, Card, Notice } from "./ui";

type Load = { state: "loading" } | { state: "down" } | { state: "ready"; health: Health };

const HOW_IT_WORKS = [
  { n: "1", title: "Thả video", text: "MP4, MOV, MKV, WEBM… Chọn giọng đọc nam hoặc nữ." },
  { n: "2", title: "Duyệt bản dịch", text: "Tuỳ chọn: đọc lại và sửa lời dịch trước khi đọc giọng." },
  { n: "3", title: "Nhận video", text: "Tải video lồng tiếng, file phụ đề .srt và bản lời thoại." },
];

export function HomeClient() {
  const [load, setLoad] = useState<Load>({ state: "loading" });

  const check = useCallback(async () => {
    try {
      setLoad({ state: "ready", health: await api.health() });
    } catch {
      setLoad({ state: "down" });
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  if (load.state === "loading") {
    return (
      <div className="mt-10 flex justify-center text-muted" role="status" aria-label="Đang kết nối">
        <Spinner size={28} />
      </div>
    );
  }

  if (load.state === "down") {
    return (
      <Card className="mx-auto mt-10 max-w-2xl p-6 sm:p-8">
        <div className="flex items-start gap-3">
          <AlertIcon className="mt-1 shrink-0 text-warn" />
          <div>
            <h2 className="text-lg font-semibold">Chưa kết nối được máy chủ lồng tiếng</h2>
            <p className="mt-1 text-sm text-muted">
              Trang web cần máy chủ VietDub đang chạy để xử lý video. Hãy bật máy chủ (chạy <code>chay-web.bat</code>)
              rồi thử lại.
            </p>
            <p className="mt-3 break-all rounded-lg bg-sunken px-3 py-2 font-mono text-xs text-muted">{API_URL}</p>
            <Button className="mt-4" variant="secondary" onClick={() => void check()}>
              Thử lại
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  const { health } = load;

  if (health.auth_required && !health.auth_ok) {
    return <AccessGate onUnlocked={() => void check()} />;
  }

  return (
    <div className="mt-10 space-y-10">
      {!health.ok && (
        <Notice tone="bad" title="Máy chủ chưa sẵn sàng" icon={<AlertIcon size={18} />}>
          <ul className="list-disc pl-4">
            {health.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Notice>
      )}

      <UploadCard health={health} />

      <HistoryList />

      <section aria-labelledby="how-title">
        <h2 id="how-title" className="sr-only">
          Cách hoạt động
        </h2>
        <ol className="grid gap-4 sm:grid-cols-3">
          {HOW_IT_WORKS.map((s) => (
            <li key={s.n} className="rounded-2xl border border-line bg-surface p-5">
              <span className="flex size-8 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent">
                {s.n}
              </span>
              <p className="mt-3 font-semibold">{s.title}</p>
              <p className="mt-1 text-sm text-muted">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
