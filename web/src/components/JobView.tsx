"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useJob } from "@/hooks/useJob";
import { api, type Job } from "@/lib/api";
import { formatBytes, formatClock, voiceName } from "@/lib/format";
import { addHistory, loadHistory, removeHistory } from "@/lib/history";
import { AlertIcon, ArrowLeftIcon, Spinner } from "./Icons";
import { StatusBadge } from "./HistoryList";
import { ProgressPanel, Stepper } from "./ProgressPanel";
import { ResultPanel } from "./ResultPanel";
import { ReviewEditor } from "./ReviewEditor";
import { Button, ButtonLink, Card, Notice } from "./ui";

export function JobView({ id }: { id: string }) {
  const router = useRouter();
  const { job, fatal, offline, setJob } = useJob(id);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Mở bằng đường dẫn từ nơi khác: nhớ vào lịch sử của trình duyệt này.
  useEffect(() => {
    if (!job) return;
    if (!loadHistory().some((x) => x.id === job.id)) {
      addHistory({ id: job.id, filename: job.filename, createdAt: job.created_at * 1000 });
    }
  }, [job]);

  useEffect(() => {
    if (fatal?.status === 404) removeHistory(id);
  }, [fatal, id]);

  async function run(action: () => Promise<Job>) {
    setBusy(true);
    setActionError(null);
    try {
      setJob(await action());
      setEditing(false);
      window.scrollTo({ top: 0 });
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Không thực hiện được. Hãy thử lại.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm("Xoá video và kết quả khỏi máy chủ? Không thể khôi phục.")) return;
    setBusy(true);
    try {
      await api.deleteJob(id);
      removeHistory(id);
      router.push("/");
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Không xoá được. Hãy thử lại.");
      setBusy(false);
    }
  }

  if (fatal) {
    const expired = fatal.status === 404;
    return (
      <Card className="mx-auto mt-6 max-w-xl p-6 text-center sm:p-8">
        <AlertIcon className="mx-auto text-warn" size={28} />
        <h1 className="mt-3 text-lg font-semibold">
          {expired ? "Không tìm thấy việc này" : "Không mở được việc này"}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {expired ? "Có thể nó đã hết hạn và bị xoá khỏi máy chủ." : fatal.message}
        </p>
        <ButtonLink href="/" className="mt-5">
          Về trang chủ
        </ButtonLink>
      </Card>
    );
  }

  if (!job) {
    return (
      <div className="flex justify-center py-20 text-muted" role="status" aria-label="Đang tải">
        <Spinner size={28} />
      </div>
    );
  }

  const showEditor = job.status === "awaiting_review" || (editing && job.can_continue);

  return (
    <div className={`mx-auto ${showEditor ? "max-w-5xl" : "max-w-2xl"}`}>
      <ButtonLink href="/" variant="ghost" size="sm" className="-ml-3">
        <ArrowLeftIcon size={16} />
        Video khác
      </ButtonLink>

      <div className="mb-6 mt-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold sm:text-2xl" title={job.filename}>
            {job.filename}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {formatBytes(job.size)} · {formatClock(job.duration)} · Giọng {voiceName(job.options.voice)}
            {job.options.hardsub ? " · Phụ đề trên hình" : ""}
          </p>
        </div>
        <StatusBadge status={job.status} />
      </div>

      {offline ? (
        <div className="mb-4">
          <Notice tone="warn" icon={<Spinner size={16} />}>
            Mất kết nối với máy chủ, đang thử lại…
          </Notice>
        </div>
      ) : null}
      {actionError ? (
        <div className="mb-4">
          <Notice tone="bad" icon={<AlertIcon size={18} />}>
            {actionError}
          </Notice>
        </div>
      ) : null}

      {showEditor ? (
        <ReviewEditor
          job={job}
          onSubmitted={(next) => {
            setJob(next);
            setEditing(false);
            window.scrollTo({ top: 0 });
          }}
          onClose={job.status === "awaiting_review" ? undefined : () => setEditing(false)}
        />
      ) : job.status === "done" ? (
        <ResultPanel
          job={job}
          busy={busy}
          onEdit={() => setEditing(true)}
          onRetryFailed={() => void run(() => api.continueJob(id, []))}
          onDelete={() => void remove()}
        />
      ) : job.status === "failed" || job.status === "cancelled" ? (
        <Card className="p-5 sm:p-7">
          <Notice
            tone={job.status === "failed" ? "bad" : "warn"}
            icon={<AlertIcon size={18} />}
            title={job.status === "failed" ? "Không hoàn thành được" : "Đã huỷ"}
          >
            {job.status === "failed" ? job.error : "Bạn đã dừng việc này."}
          </Notice>
          <div className="mt-6">
            <Stepper job={job} />
          </div>
          <div className="mt-6 flex flex-wrap gap-2 border-t border-line pt-5">
            {job.can_continue ? (
              <Button onClick={() => void run(() => api.continueJob(id, []))} disabled={busy}>
                Thử lại từ bước đọc giọng
              </Button>
            ) : null}
            <ButtonLink href="/" variant={job.can_continue ? "secondary" : "primary"}>
              Tải video khác
            </ButtonLink>
            <Button variant="danger" onClick={() => void remove()} disabled={busy}>
              Xoá
            </Button>
          </div>
        </Card>
      ) : (
        <ProgressPanel
          job={job}
          cancelling={busy || job.message === "Đang huỷ…"}
          onCancel={() => void run(() => api.cancelJob(id))}
        />
      )}
    </div>
  );
}
