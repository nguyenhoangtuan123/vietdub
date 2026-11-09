"use client";

import { fileUrl, type Job } from "@/lib/api";
import { remaining } from "@/lib/format";
import { AlertIcon, CheckIcon, DownloadIcon, FileTextIcon, PencilIcon, SubtitlesIcon, TrashIcon } from "./Icons";
import { Button, ButtonLink, Card, Notice } from "./ui";

export function ResultPanel({
  job,
  busy,
  onEdit,
  onRetryFailed,
  onDelete,
}: {
  job: Job;
  busy: boolean;
  onEdit: () => void;
  onRetryFailed: () => void;
  onDelete: () => void;
}) {
  const failed = job.tts_failed.length;

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden">
        <div className="p-5 sm:p-7">
          <p className="flex items-center gap-2 font-semibold text-ok">
            <span className="flex size-6 items-center justify-center rounded-full bg-ok text-white">
              <CheckIcon size={14} strokeWidth={2.6} />
            </span>
            Video lồng tiếng đã sẵn sàng
          </p>
          <video
            key={job.updated_at}
            controls
            playsInline
            preload="metadata"
            src={`${fileUrl(job.id, "video", true)}#t=0.1`}
            className="mx-auto mt-4 max-h-[70vh] w-full rounded-xl bg-black"
          />

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <ButtonLink href={fileUrl(job.id, "video")} size="lg" className="sm:col-span-1">
              <DownloadIcon size={18} />
              Tải video
            </ButtonLink>
            <ButtonLink href={fileUrl(job.id, "srt")} variant="secondary" size="lg">
              <SubtitlesIcon size={18} />
              Phụ đề .srt
            </ButtonLink>
            <ButtonLink href={fileUrl(job.id, "txt")} variant="secondary" size="lg">
              <FileTextIcon size={18} />
              Lời thoại .txt
            </ButtonLink>
          </div>
        </div>
      </Card>

      {failed > 0 ? (
        <Notice
          tone="warn"
          icon={<AlertIcon size={18} />}
          title={`${failed} câu chưa có giọng đọc`}
        >
          <p>
            Dịch vụ đọc giọng thỉnh thoảng bị lỗi tạm thời. Những câu này đang im lặng trong video. Bấm đọc lại — các câu
            đã đọc được giữ nguyên nên rất nhanh.
          </p>
          <Button className="mt-3" variant="secondary" size="sm" onClick={onRetryFailed} disabled={busy}>
            Đọc lại các câu lỗi
          </Button>
        </Notice>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {job.can_continue ? (
            <Button variant="secondary" onClick={onEdit} disabled={busy}>
              <PencilIcon size={16} />
              Sửa lời & đọc lại
            </Button>
          ) : null}
          <ButtonLink href="/" variant="ghost">
            Làm video khác
          </ButtonLink>
        </div>
        <div className="flex items-center gap-3 text-sm text-muted">
          <span>Lưu trên máy chủ · {remaining(job.expires_at)}</span>
          <Button variant="danger" size="sm" onClick={onDelete} disabled={busy}>
            <TrashIcon size={15} />
            Xoá ngay
          </Button>
        </div>
      </div>
    </div>
  );
}
