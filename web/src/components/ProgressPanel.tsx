"use client";

import type { Job, StepId } from "@/lib/api";
import { CheckIcon, ClockIcon, Spinner, XIcon } from "./Icons";
import { Button, Card, ProgressBar } from "./ui";

type StepKey = StepId | "review";

const STEPS: { id: StepKey; label: string; doing: string }[] = [
  { id: "tach_am", label: "Tách âm thanh", doing: "Đang tách âm thanh" },
  { id: "chep_loi", label: "Chép lời tiếng Trung", doing: "Đang chép lời tiếng Trung" },
  { id: "dich", label: "Dịch sang tiếng Việt", doing: "Đang dịch sang tiếng Việt" },
  { id: "review", label: "Bạn duyệt bản dịch", doing: "Chờ bạn duyệt bản dịch" },
  { id: "doc_giong", label: "Đọc giọng tiếng Việt", doing: "Đang đọc giọng tiếng Việt" },
  { id: "ghep_am", label: "Ghép âm thanh vào video", doing: "Đang ghép âm thanh" },
  { id: "xuat_video", label: "Xuất video", doing: "Đang xuất video" },
];

type StepState = "done" | "current" | "failed" | "todo";

function visibleSteps(job: Job) {
  return STEPS.filter((s) => s.id !== "review" || job.options.review || job.status === "awaiting_review");
}

/** Bước đang làm (chỉ số trong danh sách hiện); bằng độ dài danh sách nghĩa là xong hết. */
function currentIndex(job: Job, steps: ReturnType<typeof visibleSteps>): number {
  if (job.status === "done") return steps.length;
  if (job.status === "awaiting_review") return steps.findIndex((s) => s.id === "review");
  const byStep = job.step ? steps.findIndex((s) => s.id === job.step) : -1;
  if (byStep >= 0) return byStep;
  if (job.phase === "render") return steps.findIndex((s) => s.id === "doc_giong");
  return 0;
}

export function Stepper({ job }: { job: Job }) {
  const steps = visibleSteps(job);
  const idx = currentIndex(job, steps);
  const waiting = job.status === "queued" || job.status === "cancelled";

  return (
    <ol className="space-y-3">
      {steps.map((s, i) => {
        let state: StepState = "todo";
        if (i < idx) state = "done";
        else if (i === idx && !waiting) state = job.status === "failed" ? "failed" : "current";
        return (
          <li key={s.id} className="flex items-center gap-3" aria-current={state === "current" ? "step" : undefined}>
            <StepDot state={state} paused={s.id === "review"} />
            <span
              className={`text-sm ${
                state === "current" ? "font-semibold" : state === "failed" ? "font-semibold text-bad" : state === "done" ? "text-ink" : "text-muted"
              }`}
            >
              {s.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function StepDot({ state, paused }: { state: StepState; paused: boolean }) {
  const base = "flex size-6 shrink-0 items-center justify-center rounded-full";
  if (state === "done") {
    return (
      <span className={`${base} bg-ok text-white`}>
        <CheckIcon size={14} strokeWidth={2.6} />
      </span>
    );
  }
  if (state === "failed") {
    return (
      <span className={`${base} bg-bad text-white`}>
        <XIcon size={14} strokeWidth={2.6} />
      </span>
    );
  }
  if (state === "current") {
    return (
      <span className={`${base} bg-accent-soft text-accent`}>
        {paused ? <span className="size-2.5 rounded-full bg-warn" /> : <Spinner size={16} />}
      </span>
    );
  }
  return <span className={`${base} border-2 border-line`} />;
}

export function ProgressPanel({
  job,
  onCancel,
  cancelling,
}: {
  job: Job;
  onCancel: () => void;
  cancelling: boolean;
}) {
  const steps = visibleSteps(job);
  const queued = job.status === "queued";
  const current = steps[currentIndex(job, steps)];
  const pct = Math.round(job.progress * 100);

  const title = queued
    ? job.queue_position
      ? `Đang xếp hàng — còn ${job.queue_position} việc trước bạn`
      : "Sắp đến lượt của bạn"
    : (current?.doing ?? "Đang xử lý");

  return (
    <Card className="p-5 sm:p-7">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-xl font-semibold">
            {queued ? <ClockIcon className="text-muted" /> : null}
            {title}
          </h2>
          <p className="mt-1 min-h-6 text-sm text-muted" aria-live="polite">
            {job.message}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={cancelling}>
          {cancelling ? "Đang huỷ…" : "Huỷ"}
        </Button>
      </div>

      <div className="mt-5 flex items-center gap-3">
        <div className="flex-1">
          <ProgressBar value={job.progress} label="Tiến độ xử lý" />
        </div>
        <span className="w-10 text-right text-sm font-medium tabular-nums">{pct}%</span>
      </div>

      <div className="mt-7 border-t border-line pt-6">
        <Stepper job={job} />
      </div>

      <p className="mt-6 rounded-lg bg-sunken px-4 py-3 text-sm text-muted">
        Bạn có thể đóng trang này — việc vẫn chạy trên máy chủ. Quay lại bằng mục “Video gần đây” ở trang chủ.
      </p>
    </Card>
  );
}
