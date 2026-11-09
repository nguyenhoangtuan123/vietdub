"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ApiError, uploadJob, type Health } from "@/lib/api";
import { formatBytes, formatClock } from "@/lib/format";
import { addHistory } from "@/lib/history";
import { AlertIcon, FilmIcon, Spinner, UploadIcon, XIcon } from "./Icons";
import { Button, Card, Notice, ProgressBar, Switch } from "./ui";

type Phase = "idle" | "uploading" | "checking";

export function UploadCard({ health }: { health: Health }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<(() => void) | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [voice, setVoice] = useState(health.default_voice);
  const [hardsub, setHardsub] = useState(false);
  const [review, setReview] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [serverError, setServerError] = useState<string | null>(null);

  const busy = phase !== "idle";
  const maxBytes = health.max_upload_mb * 1024 * 1024;
  const extList = health.extensions.map((e) => e.replace(".", "").toUpperCase()).join(", ");

  // Đọc thời lượng video ngay trên trình duyệt để báo sớm nếu quá dài (không đọc được thì bỏ qua, máy chủ sẽ kiểm tra lại).
  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const probe = document.createElement("video");
    probe.preload = "metadata";
    probe.onloadedmetadata = () => setDuration(Number.isFinite(probe.duration) ? probe.duration : null);
    probe.src = url;
    return () => {
      probe.removeAttribute("src");
      URL.revokeObjectURL(url);
    };
  }, [file]);

  function pick(f: File | undefined) {
    if (!f || busy) return;
    setFile(f);
    setDuration(null);
    setServerError(null);
  }

  function clear() {
    setFile(null);
    setDuration(null);
    setServerError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  let fileError: string | null = null;
  if (file) {
    const ext = "." + (file.name.split(".").pop() ?? "").toLowerCase();
    if (!health.extensions.includes(ext)) {
      fileError = `Định dạng ${ext} chưa được hỗ trợ. Hãy dùng ${extList}.`;
    } else if (file.size > maxBytes) {
      fileError = `Video nặng ${formatBytes(file.size)}, vượt giới hạn ${health.max_upload_mb} MB.`;
    } else if (duration !== null && duration > health.max_duration_s) {
      fileError = `Video dài ${formatClock(duration)}, vượt giới hạn ${Math.round(health.max_duration_s / 60)} phút.`;
    }
  }

  async function start() {
    if (!file || fileError || busy) return;
    setServerError(null);
    setPhase("uploading");
    setProgress(0);
    const upload = uploadJob(file, { voice, hardsub, review }, (f) => {
      setProgress(f);
      if (f >= 1) setPhase("checking");
    });
    abortRef.current = upload.abort;
    try {
      const id = await upload.promise;
      addHistory({ id, filename: file.name, createdAt: Date.now() });
      router.push(`/jobs/${id}`);
    } catch (e) {
      if (!(e instanceof ApiError && e.status === -1)) {
        setServerError(e instanceof Error ? e.message : "Không tải lên được video.");
      }
      setPhase("idle");
    } finally {
      abortRef.current = null;
    }
  }

  return (
    <Card className="mx-auto max-w-2xl p-5 sm:p-7">
      <input
        ref={inputRef}
        type="file"
        accept={health.extensions.join(",") + ",video/*"}
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => pick(e.target.files?.[0])}
      />

      {!file ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            pick(e.dataTransfer.files?.[0]);
          }}
          className={`rounded-xl border-2 border-dashed transition-colors ${
            dragging ? "border-accent bg-accent-soft" : "border-line bg-sunken/50 hover:border-muted/60"
          }`}
        >
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex w-full cursor-pointer flex-col items-center gap-3 rounded-xl px-6 py-12 text-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <span className="flex size-14 items-center justify-center rounded-full bg-accent-soft text-accent">
              <UploadIcon size={26} />
            </span>
            <span className="text-lg font-semibold">
              {dragging ? (
                "Thả video để bắt đầu"
              ) : (
                <>
                  <span className="sm:hidden">Chọn video để lồng tiếng</span>
                  <span className="hidden sm:inline">Kéo thả video vào đây</span>
                </>
              )}
            </span>
            <span className="hidden text-sm text-muted sm:block">
              hoặc <span className="font-medium text-accent underline underline-offset-2">chọn từ máy tính</span>
            </span>
            <span className="mt-1 text-xs text-muted">
              {extList} · tối đa {health.max_upload_mb} MB · tối đa {Math.round(health.max_duration_s / 60)} phút
            </span>
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-xl border border-line bg-sunken/50 p-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <FilmIcon />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium" title={file.name}>
              {file.name}
            </p>
            <p className="text-sm text-muted">
              {formatBytes(file.size)}
              {duration !== null ? ` · ${formatClock(duration)}` : ""}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={clear} disabled={busy} aria-label="Bỏ video này">
            <XIcon size={16} />
          </Button>
        </div>
      )}

      {fileError ? (
        <div className="mt-3">
          <Notice tone="bad" icon={<AlertIcon size={18} />}>
            {fileError}
          </Notice>
        </div>
      ) : null}

      <fieldset className="mt-6" disabled={busy}>
        <legend className="mb-2 text-sm font-medium">Giọng đọc</legend>
        <div className="grid grid-cols-2 gap-3">
          {health.voices.map((v) => (
            <label
              key={v.id}
              className={`cursor-pointer rounded-xl border px-4 py-3 text-sm transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent ${
                voice === v.id ? "border-accent bg-accent-soft" : "border-line hover:bg-sunken"
              }`}
            >
              <input
                type="radio"
                name="voice"
                value={v.id}
                checked={voice === v.id}
                onChange={() => setVoice(v.id)}
                className="sr-only"
              />
              <span className="font-medium">{v.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-5 space-y-3 border-t border-line pt-5">
        <Switch
          checked={review}
          onChange={setReview}
          disabled={busy}
          label="Cho tôi duyệt bản dịch trước"
          description="Dừng sau khi dịch để bạn xem và sửa lời, rồi mới đọc giọng."
        />
        <Switch
          checked={hardsub}
          onChange={setHardsub}
          disabled={busy}
          label="Gắn phụ đề tiếng Việt lên hình"
          description="Phụ đề in thẳng vào video. Xuất lâu hơn một chút."
        />
      </div>

      {serverError ? (
        <div className="mt-5">
          <Notice tone="bad" icon={<AlertIcon size={18} />}>
            {serverError}
          </Notice>
        </div>
      ) : null}

      {busy ? (
        <div className="mt-6 space-y-2" aria-live="polite">
          <ProgressBar value={phase === "checking" ? 1 : progress} label="Tiến độ tải video lên" />
          <div className="flex items-center justify-between text-sm text-muted">
            <span className="flex items-center gap-2">
              <Spinner size={16} />
              {phase === "checking" ? "Đang kiểm tra video…" : `Đang tải lên… ${Math.round(progress * 100)}%`}
            </span>
            {phase === "uploading" ? (
              <button
                type="button"
                onClick={() => abortRef.current?.()}
                className="cursor-pointer rounded text-sm underline underline-offset-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
              >
                Huỷ
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <Button className="mt-6 w-full" size="lg" disabled={!file || !!fileError || !health.ok} onClick={() => void start()}>
          Bắt đầu lồng tiếng
        </Button>
      )}
    </Card>
  );
}
