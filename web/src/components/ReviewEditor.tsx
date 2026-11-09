"use client";

import { useEffect, useRef, useState } from "react";
import { api, sourceUrl, type Job, type Segment } from "@/lib/api";
import { formatClock } from "@/lib/format";
import { AlertIcon, PlayIcon, Spinner } from "./Icons";
import { Button, Card, Notice } from "./ui";

const MAX_CHARS = 600;

export function ReviewEditor({
  job,
  onSubmitted,
  onClose,
}: {
  job: Job;
  onSubmitted: (job: Job) => void;
  /** Có khi người dùng chủ động mở lại để sửa (không bắt buộc phải duyệt). */
  onClose?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const range = useRef<{ start: number; end: number } | null>(null);

  const [segs, setSegs] = useState<Segment[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [active, setActive] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getSegments(job.id)
      .then((list) => {
        if (!cancelled) setSegs(list);
      })
      .catch((e: Error) => {
        if (!cancelled) setLoadError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [job.id]);

  const valueOf = (s: Segment) => edits[s.index] ?? s.vi;
  const changed = segs ? segs.filter((s) => edits[s.index] !== undefined && edits[s.index] !== s.vi) : [];
  const emptyCount = segs ? segs.filter((s) => valueOf(s).trim() === "").length : 0;

  function playSegment(s: Segment) {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = s.start;
    range.current = { start: s.start, end: s.end };
    void v.play();
  }

  function onTimeUpdate() {
    const v = videoRef.current;
    if (!v || !segs) return;
    const t = v.currentTime;
    const r = range.current;
    if (r) {
      if (t >= r.end) {
        v.pause();
        range.current = null;
      } else if (t < r.start - 0.5) {
        range.current = null; // người dùng tua đi chỗ khác
      }
    }
    const now = segs.find((s) => t >= s.start && t < s.end)?.index ?? null;
    setActive((prev) => (prev === now ? prev : now));
  }

  async function submit() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const next = await api.continueJob(
        job.id,
        changed.map((s) => ({ index: s.index, vi: edits[s.index].trim() })),
      );
      onSubmitted(next);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Không gửi được. Hãy thử lại.");
      setSubmitting(false);
    }
  }

  if (loadError) {
    return (
      <Notice tone="bad" title="Không mở được bản dịch" icon={<AlertIcon size={18} />}>
        {loadError}
      </Notice>
    );
  }
  if (!segs) {
    return (
      <div className="flex justify-center py-16 text-muted" role="status" aria-label="Đang tải bản dịch">
        <Spinner size={28} />
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
      <div className="lg:sticky lg:top-20 lg:self-start">
        <Card className="overflow-hidden p-3">
          <video
            ref={videoRef}
            controls
            playsInline
            preload="metadata"
            src={`${sourceUrl(job.id)}#t=0.1`}
            onTimeUpdate={onTimeUpdate}
            className="mx-auto max-h-[60vh] w-full rounded-lg bg-black"
          />
          <p className="mt-3 px-1 text-xs text-muted">
            Video gốc. Bấm <PlayIcon size={11} className="inline align-baseline" /> cạnh mỗi câu để nghe lại đúng đoạn đó.
          </p>
        </Card>
      </div>

      <div className="min-w-0">
        <div className="mb-4">
          <h2 className="text-xl font-semibold">
            {onClose ? "Sửa lời dịch" : "Duyệt bản dịch"}
          </h2>
          <p className="mt-1 text-sm text-muted">
            Sửa các câu chưa ổn rồi bấm đọc giọng. Câu để trống sẽ được bỏ qua (không đọc).
          </p>
        </div>

        <ol className="space-y-3">
          {segs.map((s) => {
            const value = valueOf(s);
            const len = value.trim().length;
            const over = len > s.max_chars;
            const dirty = edits[s.index] !== undefined && edits[s.index] !== s.vi;
            return (
              <li
                key={s.index}
                className={`rounded-xl border bg-surface p-3.5 transition-colors ${
                  active === s.index ? "border-accent ring-2 ring-accent/20" : "border-line"
                }`}
              >
                <div className="flex items-start gap-3">
                  <button
                    type="button"
                    onClick={() => playSegment(s)}
                    aria-label={`Nghe lại câu ${s.index + 1}`}
                    className="mt-0.5 flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md bg-sunken px-2 py-1 text-xs font-medium tabular-nums text-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    <PlayIcon size={11} />
                    {formatClock(s.start)}–{formatClock(s.end)}
                  </button>
                  <p lang="zh" className="min-w-0 flex-1 text-sm leading-relaxed text-muted">
                    {s.zh}
                  </p>
                </div>
                <label className="mt-2.5 block">
                  <span className="sr-only">Lời dịch câu {s.index + 1}</span>
                  <textarea
                    value={value}
                    maxLength={MAX_CHARS}
                    rows={2}
                    onChange={(e) => setEdits((cur) => ({ ...cur, [s.index]: e.target.value }))}
                    className={`field-sizing-content min-h-[3.25rem] w-full resize-none rounded-lg border bg-bg px-3 py-2 text-base leading-relaxed outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 ${
                      dirty ? "border-accent/60" : "border-line"
                    }`}
                  />
                </label>
                <div className="mt-1 flex items-center justify-between gap-3 text-xs">
                  <span className={over ? "text-warn" : "text-muted"}>
                    {len === 0
                      ? "Câu này sẽ bị bỏ qua"
                      : over
                        ? "Hơi dài so với thời lượng — giọng sẽ bị đọc nhanh hơn"
                        : dirty
                          ? "Đã sửa"
                          : ""}
                  </span>
                  <span className={`tabular-nums ${over ? "text-warn" : "text-muted"}`}>
                    {len}/{s.max_chars}
                  </span>
                </div>
              </li>
            );
          })}
        </ol>

        <div className="sticky bottom-4 z-10 mt-6">
          <Card className="flex flex-wrap items-center justify-between gap-3 p-3 pl-4 shadow-lg">
            <p className="text-sm text-muted">
              {changed.length > 0 ? `Đã sửa ${changed.length} câu` : "Chưa sửa câu nào"}
              {emptyCount > 0 ? ` · ${emptyCount} câu để trống` : ""}
            </p>
            <div className="flex items-center gap-2">
              {onClose ? (
                <Button variant="ghost" onClick={onClose} disabled={submitting}>
                  Quay lại
                </Button>
              ) : null}
              <Button onClick={() => void submit()} disabled={submitting || emptyCount === segs.length}>
                {submitting ? <Spinner size={16} /> : null}
                Đọc giọng & xuất video
              </Button>
            </div>
          </Card>
          {submitError ? (
            <div className="mt-2">
              <Notice tone="bad">{submitError}</Notice>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
