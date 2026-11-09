"use client";

import { useState } from "react";
import { api, setToken } from "@/lib/api";
import { Button, Card } from "./ui";

/** Hiện khi máy chủ yêu cầu mã truy cập: người dùng nhập, ta kiểm tra bằng /api/health rồi mới nhớ. */
export function AccessGate({ onUnlocked }: { onUnlocked: () => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const code = value.trim();
    if (!code) return;
    setBusy(true);
    setError(null);
    setToken(code);
    try {
      const h = await api.health();
      if (h.auth_ok) {
        onUnlocked();
        return;
      }
      setToken("");
      setError("Mã truy cập không đúng.");
    } catch {
      setToken("");
      setError("Không kết nối được máy chủ. Hãy thử lại.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mx-auto mt-10 max-w-md p-6 sm:p-8">
      <h2 className="text-lg font-semibold">Nhập mã truy cập</h2>
      <p className="mt-1 text-sm text-muted">Máy chủ này chỉ dành cho người được cấp mã. Hãy nhập mã bạn được gửi.</p>
      <form onSubmit={submit} className="mt-5 space-y-3">
        <label className="block text-sm font-medium" htmlFor="access-code">
          Mã truy cập
        </label>
        <input
          id="access-code"
          type="password"
          autoComplete="off"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "access-error" : undefined}
          className="h-11 w-full rounded-lg border border-line bg-bg px-3 text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
        />
        {error ? (
          <p id="access-error" role="alert" className="text-sm text-bad">
            {error}
          </p>
        ) : null}
        <Button type="submit" size="lg" className="w-full" disabled={busy || !value.trim()}>
          {busy ? "Đang kiểm tra…" : "Vào"}
        </Button>
      </form>
    </Card>
  );
}
