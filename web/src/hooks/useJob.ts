"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ACTIVE_STATUSES, ApiError, api, type Job } from "@/lib/api";

export interface JobState {
  job: Job | null;
  /** Lỗi dứt khoát (404 hết hạn, 401 sai mã...). Khi có lỗi này thì ngừng hỏi máy chủ. */
  fatal: { status: number; message: string } | null;
  /** Đang mất kết nối tạm thời, vẫn thử lại. */
  offline: boolean;
  setJob: (job: Job) => void;
}

const POLL_MS = 1200;
const POLL_OFFLINE_MS = 3000;

/** Theo dõi một việc: hỏi máy chủ định kỳ khi việc còn đang chạy, dừng khi đã xong hoặc đang chờ người dùng. */
export function useJob(id: string): JobState {
  const [job, setJobState] = useState<Job | null>(null);
  const [fatal, setFatal] = useState<JobState["fatal"]>(null);
  const [offline, setOffline] = useState(false);
  const offlineRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const next = await api.getJob(id);
      offlineRef.current = false;
      setOffline(false);
      setFatal(null);
      setJobState(next);
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
        setFatal({ status: e.status, message: e.message });
      } else {
        offlineRef.current = true;
        setOffline(true);
      }
    }
  }, [id]);

  const active = fatal === null && (job === null || ACTIVE_STATUSES.has(job.status));

  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const loop = async () => {
      await refresh();
      if (!stopped) timer = setTimeout(loop, offlineRef.current ? POLL_OFFLINE_MS : POLL_MS);
    };
    void loop();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [active, refresh]);

  const setJob = useCallback((next: Job) => {
    setJobState(next);
    setFatal(null);
  }, []);

  return { job, fatal, offline, setJob };
}
