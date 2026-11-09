"""Máy chủ web cho VietDub (FastAPI).

Nhận video qua HTTP, xếp hàng và chạy lần lượt (mỗi lần một việc vì chép lời tốn CPU), báo tiến độ,
cho sửa bản dịch trước khi đọc giọng, rồi cho tải kết quả.

Chạy (từ thư mục gốc của dự án):
    python -m uvicorn server.app:app --host 127.0.0.1 --port 8000

Cấu hình bằng biến môi trường (đều có giá trị mặc định):
    GEMINI_API_KEY            khoá Gemini (hoặc điền trong config.json)
    VIETDUB_ACCESS_TOKEN      nếu đặt, mọi lời gọi API phải kèm mã này (header X-Access-Token hoặc ?token=)
    VIETDUB_MAX_UPLOAD_MB     dung lượng video tối đa, mặc định 300
    VIETDUB_MAX_DURATION_S    thời lượng video tối đa (giây), mặc định 600
    VIETDUB_JOB_TTL_HOURS     tự xoá việc cũ sau bấy nhiêu giờ, mặc định 24
    VIETDUB_JOBS_DIR          nơi lưu video và kết quả, mặc định server/jobs
    VIETDUB_CORS_ORIGINS      các địa chỉ web được gọi API, cách nhau dấu phẩy
"""
from __future__ import annotations

import hmac
import importlib.util
import json
import os
import queue
import re
import secrets
import shutil
import sys
import threading
import time
import traceback
from pathlib import Path

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import vietdub as vd  # noqa: E402


# ---------------------------------------------------------------- cấu hình

def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, "") or default)
    except ValueError:
        return default


MAX_UPLOAD_MB = _env_int("VIETDUB_MAX_UPLOAD_MB", 300)
MAX_DURATION_S = _env_int("VIETDUB_MAX_DURATION_S", 600)
JOB_TTL_HOURS = _env_int("VIETDUB_JOB_TTL_HOURS", 24)
JOBS_DIR = Path(os.environ.get("VIETDUB_JOBS_DIR") or ROOT / "server" / "jobs")
ACCESS_TOKEN = os.environ.get("VIETDUB_ACCESS_TOKEN", "")
CORS_ORIGINS = [o.strip() for o in os.environ.get(
    "VIETDUB_CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",") if o.strip()]

VOICES = {"vi-VN-HoaiMyNeural": "Hoài My (nữ)", "vi-VN-NamMinhNeural": "Nam Minh (nam)"}
EXT_ORDER = (".mp4", ".mov", ".mkv", ".webm", ".m4v", ".avi")  # thứ tự hiển thị trên giao diện
ALLOWED_EXT = set(EXT_ORDER)
ID_RE = re.compile(r"^[A-Za-z0-9_-]{6,40}$")

# Mỗi bước chiếm một khoảng của thanh tiến độ tổng (0..1)
STEP_SPAN = {"tach_am": (0.00, 0.04), "chep_loi": (0.04, 0.20), "dich": (0.20, 0.30),
             "doc_giong": (0.30, 0.85), "ghep_am": (0.85, 0.90), "xuat_video": (0.90, 1.00)}
ACTIVE = {"queued", "analyzing", "rendering"}
MEDIA = {"video": "video/mp4", "srt": "application/x-subrip", "txt": "text/plain; charset=utf-8"}

BASE_CFG = vd.load_config(None)


def problems() -> list[str]:
    """Những thứ máy chủ còn thiếu để chạy được (rỗng = sẵn sàng)."""
    out: list[str] = []
    if not (shutil.which("ffmpeg") and shutil.which("ffprobe")):
        out.append("Máy chủ chưa cài ffmpeg.")
    cfg = BASE_CFG
    if cfg["dich_bang"] == "gemini" and not cfg["gemini_api_key"]:
        out.append("Máy chủ chưa có khoá Gemini (biến môi trường GEMINI_API_KEY).")
    dung_openai = [k for k in ("dich_bang", "stt", "tts") if cfg[k] == "openai"]
    if dung_openai and not cfg["openai_api_key"]:
        out.append("Máy chủ chưa có khoá OpenAI (biến môi trường OPENAI_API_KEY).")
    if cfg["stt"] == "local" and importlib.util.find_spec("faster_whisper") is None:
        out.append("Máy chủ chưa cài faster-whisper.")
    return out


def clean_error(text: str) -> str:
    """Bỏ đường dẫn nội bộ của máy chủ khỏi thông báo lỗi trước khi gửi cho người dùng."""
    for p in (str(JOBS_DIR), str(ROOT)):
        text = text.replace(p, "…")
    return text.strip()[:600]


# ---------------------------------------------------------------- lưu trữ việc

class Store:
    """Danh sách việc, lưu mỗi việc thành job.json để không mất khi khởi động lại."""

    def __init__(self, root: Path):
        self.root = root
        self.lock = threading.RLock()
        self.jobs: dict[str, dict] = {}
        root.mkdir(parents=True, exist_ok=True)

    def dir(self, job_id: str) -> Path:
        return self.root / job_id

    def _save(self, job: dict) -> None:
        f = self.dir(job["id"]) / "job.json"
        tmp = f.with_suffix(".tmp")
        tmp.write_text(json.dumps(job, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, f)

    def load(self) -> None:
        for d in self.root.iterdir():
            f = d / "job.json"
            if not (d.is_dir() and f.exists()):
                continue
            try:
                job = json.loads(f.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            if job.get("status") in ACTIVE:
                job.update(status="failed", message="Bị gián đoạn",
                           error="Máy chủ đã khởi động lại giữa chừng. Hãy thử lại.")
            self.jobs[job["id"]] = job
            self._save(job)

    def add(self, job: dict) -> None:
        with self.lock:
            self.jobs[job["id"]] = job
            self._save(job)

    def get(self, job_id: str) -> dict | None:
        with self.lock:
            job = self.jobs.get(job_id)
            return dict(job) if job else None

    def update(self, job_id: str, **fields) -> None:
        with self.lock:
            job = self.jobs.get(job_id)
            if job is None:
                return
            job.update(fields)
            job["updated_at"] = time.time()
            if self.dir(job_id).exists():
                self._save(job)

    def snapshot(self) -> list[dict]:
        with self.lock:
            return [dict(j) for j in self.jobs.values()]

    def remove(self, job_id: str) -> None:
        with self.lock:
            self.jobs.pop(job_id, None)
        shutil.rmtree(self.dir(job_id), ignore_errors=True)


store = Store(JOBS_DIR)


# ---------------------------------------------------------------- hàng đợi và xử lý

def job_cfg(job: dict) -> dict:
    cfg = dict(BASE_CFG)
    cfg["giong_edge"] = job["options"]["voice"]
    cfg["gan_phu_de"] = bool(job["options"]["hardsub"])
    return cfg


def make_progress(job_id: str):
    def cb(step: str, frac: float, msg: str) -> None:
        lo, hi = STEP_SPAN.get(step, (0.0, 1.0))
        store.update(job_id, step=step, message=msg,
                     progress=round(lo + (hi - lo) * max(0.0, min(1.0, frac)), 4))
    return cb


class Manager:
    """Chạy lần lượt từng việc trên một luồng nền."""

    def __init__(self) -> None:
        self.q: queue.Queue[tuple[str, str]] = queue.Queue()
        self.lock = threading.Lock()
        self.pending: list[str] = []
        self.active: str | None = None
        self.cancel: dict[str, threading.Event] = {}
        threading.Thread(target=self._loop, daemon=True, name="vietdub-worker").start()

    def enqueue(self, job_id: str, phase: str) -> None:
        with self.lock:
            self.cancel[job_id] = threading.Event()
            self.pending.append(job_id)
        store.update(job_id, status="queued", phase=phase, step=None, error=None,
                     message="Đang chờ đến lượt")
        self.q.put((job_id, phase))

    def request_cancel(self, job_id: str) -> None:
        with self.lock:
            ev = self.cancel.get(job_id)
            if ev:
                ev.set()
            queued = job_id in self.pending
            if queued:
                self.pending.remove(job_id)
        job = store.get(job_id)
        if job and job["status"] == "queued":
            store.update(job_id, status="cancelled", message="Đã huỷ")
        elif job and job["status"] in ("analyzing", "rendering"):
            store.update(job_id, message="Đang huỷ…")

    def queue_position(self, job_id: str) -> int:
        """Số việc đang ở trước (kể cả việc đang chạy). 0 = sắp tới lượt."""
        with self.lock:
            ahead = self.pending.index(job_id) if job_id in self.pending else 0
            return ahead + (1 if self.active and self.active != job_id else 0)

    def _loop(self) -> None:
        while True:
            job_id, phase = self.q.get()
            with self.lock:
                if job_id in self.pending:
                    self.pending.remove(job_id)
                self.active = job_id
            try:
                self._run(job_id, phase)
            except Exception:  # không để luồng nền chết vì một việc lỗi
                traceback.print_exc()
            finally:
                with self.lock:
                    self.active = None

    def _run(self, job_id: str, phase: str) -> None:
        job = store.get(job_id)
        if not job or job["status"] == "cancelled":
            return
        cancel = self.cancel.get(job_id) or threading.Event()
        if cancel.is_set():
            store.update(job_id, status="cancelled", message="Đã huỷ")
            return
        jdir = store.dir(job_id)
        video = jdir / job["input_name"]
        work = jdir / "work"
        shutil.rmtree(work, ignore_errors=True)
        work.mkdir(parents=True, exist_ok=True)
        cfg = job_cfg(job)
        progress = make_progress(job_id)
        try:
            if phase == "analyze":
                store.update(job_id, status="analyzing", step="tach_am", progress=0.0,
                             message="Đang tách âm thanh...")
                segs, dur = vd.analyze(video, cfg, work, progress, cancel.is_set)
                (jdir / "segs.json").write_text(json.dumps(segs, ensure_ascii=False), encoding="utf-8")
                store.update(job_id, segment_count=len(segs), duration=dur)
                if job["options"]["review"]:
                    store.update(job_id, status="awaiting_review", step=None, progress=0.30,
                                 message="Chờ bạn duyệt bản dịch")
                    return
            segs = json.loads((jdir / "segs.json").read_text(encoding="utf-8"))
            dur = store.get(job_id)["duration"]
            store.update(job_id, status="rendering", step="doc_giong", progress=0.30,
                         message="Đang đọc giọng...", outputs={}, tts_failed=[])
            res = vd.render(video, segs, dur, cfg, jdir / "out", job["stem"], work, progress,
                            cancel.is_set, tts_cache=jdir / "tts_cache")
            failed = [i for i, s in enumerate(segs) if s.get("tts_loi")]
            store.update(job_id, status="done", step=None, progress=1.0, message="Hoàn tất",
                         outputs={k: p.name for k, p in res.items()}, tts_failed=failed)
        except vd.Cancelled:
            store.update(job_id, status="cancelled", step=None, message="Đã huỷ")
        except SystemExit as e:
            msg = str(e.code or "").strip()
            store.update(job_id, status="failed", message="Có lỗi",  # giữ nguyên `step` để giao diện đánh dấu bước bị lỗi
                         error=clean_error(msg.removeprefix("LỖI:").strip()) or "Lỗi không rõ.")
        except Exception as e:
            traceback.print_exc()
            store.update(job_id, status="failed", message="Có lỗi", error=clean_error(str(e)) or "Lỗi không rõ.")
        finally:
            shutil.rmtree(work, ignore_errors=True)


manager = Manager()


def _janitor() -> None:
    while True:
        time.sleep(600)
        cutoff = time.time() - JOB_TTL_HOURS * 3600
        for job in store.snapshot():
            if job["status"] not in ACTIVE and job["updated_at"] < cutoff:
                store.remove(job["id"])


store.load()
threading.Thread(target=_janitor, daemon=True, name="vietdub-janitor").start()


# ---------------------------------------------------------------- ứng dụng web

app = FastAPI(title="VietDub", docs_url="/api/docs", openapi_url="/api/openapi.json")


@app.middleware("http")
async def guard_upload(request: Request, call_next):
    """Chặn sớm lời gọi tải video không hợp lệ, trước khi máy chủ nhận cả file:
    sai mã truy cập, không khai báo dung lượng, hoặc dung lượng vượt giới hạn."""
    if request.method == "POST" and request.url.path == "/api/jobs":
        if not _valid_token(request.headers.get("x-access-token") or request.query_params.get("token")):
            return JSONResponse({"detail": "Sai hoặc thiếu mã truy cập."}, status_code=401)
        try:
            size = int(request.headers.get("content-length") or -1)
        except ValueError:
            size = -1
        if size < 0:
            return JSONResponse({"detail": "Thiếu thông tin dung lượng (Content-Length)."}, status_code=411)
        if size > (MAX_UPLOAD_MB + 5) * 1024 * 1024:
            return JSONResponse({"detail": f"Video quá lớn. Tối đa {MAX_UPLOAD_MB} MB."}, status_code=413)
    return await call_next(request)


app.add_middleware(  # thêm sau cùng để bọc ngoài cùng: phản hồi lỗi cũng có header CORS
    CORSMiddleware, allow_origins=CORS_ORIGINS, allow_credentials=False,
    allow_methods=["*"], allow_headers=["*"], expose_headers=["Content-Disposition"])


def _valid_token(given: str | None) -> bool:
    return not ACCESS_TOKEN or hmac.compare_digest((given or "").encode(), ACCESS_TOKEN.encode())


def auth(request: Request, token: str | None = Query(default=None)) -> None:
    if not _valid_token(request.headers.get("x-access-token") or token):
        raise HTTPException(401, "Sai hoặc thiếu mã truy cập.")


def get_job(job_id: str) -> dict:
    job = store.get(job_id) if ID_RE.match(job_id) else None
    if job is None:
        raise HTTPException(404, "Không tìm thấy việc này (có thể đã hết hạn và bị xoá).")
    return job


PUBLIC_FIELDS = ("id", "filename", "size", "duration", "options", "status", "phase", "step", "progress",
                 "message", "error", "outputs", "tts_failed", "segment_count", "created_at", "updated_at")


def public(job: dict) -> dict:
    d = {k: job.get(k) for k in PUBLIC_FIELDS}
    d["queue_position"] = manager.queue_position(job["id"]) if job["status"] == "queued" else None
    d["expires_at"] = job["updated_at"] + JOB_TTL_HOURS * 3600
    d["can_continue"] = (job["status"] in ("awaiting_review", "done", "failed", "cancelled")
                         and (store.dir(job["id"]) / "segs.json").exists())
    return d


@app.get("/api/health")
def health(request: Request):
    p = problems()
    return {
        "ok": not p, "problems": p,
        "auth_required": bool(ACCESS_TOKEN),
        "auth_ok": _valid_token(request.headers.get("x-access-token") or request.query_params.get("token")),
        "max_upload_mb": MAX_UPLOAD_MB, "max_duration_s": MAX_DURATION_S, "ttl_hours": JOB_TTL_HOURS,
        "voices": [{"id": k, "label": v} for k, v in VOICES.items()],
        "default_voice": BASE_CFG["giong_edge"] if BASE_CFG["giong_edge"] in VOICES else next(iter(VOICES)),
        "extensions": list(EXT_ORDER),
    }


def _safe_stem(name: str) -> str:
    stem = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "_", Path(name).stem).strip(" .")
    return stem[:80] or "video"


def _save_upload(src, dst: Path, limit: int) -> int:
    size = 0
    with open(dst, "wb") as f:
        while chunk := src.read(1024 * 1024):
            size += len(chunk)
            if size > limit:
                raise ValueError("too big")
            f.write(chunk)
    return size


@app.post("/api/jobs", status_code=201)
async def create_job(file: UploadFile = File(...), voice: str = Form(default=""),
                     hardsub: bool = Form(default=False), review: bool = Form(default=False),
                     _: None = Depends(auth)):
    p = problems()
    if p:
        raise HTTPException(503, " ".join(p))
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(415, f"Định dạng {ext or 'này'} chưa được hỗ trợ. Dùng: {', '.join(EXT_ORDER)}.")
    voice = voice or BASE_CFG["giong_edge"]
    if voice not in VOICES:
        raise HTTPException(422, "Giọng đọc không hợp lệ.")

    job_id = secrets.token_urlsafe(9)
    jdir = store.dir(job_id)
    jdir.mkdir(parents=True)
    input_name = f"input{ext}"
    try:
        size = await run_in_threadpool(_save_upload, file.file, jdir / input_name, MAX_UPLOAD_MB * 1024 * 1024)
    except ValueError:
        shutil.rmtree(jdir, ignore_errors=True)
        raise HTTPException(413, f"Video quá lớn. Tối đa {MAX_UPLOAD_MB} MB.")
    finally:
        await file.close()

    try:
        dur, has_audio = await run_in_threadpool(vd.probe, jdir / input_name)
    except Exception:
        shutil.rmtree(jdir, ignore_errors=True)
        raise HTTPException(422, "Không đọc được file này. Hãy chắc chắn đó là một video hợp lệ.")
    if not has_audio:
        shutil.rmtree(jdir, ignore_errors=True)
        raise HTTPException(422, "Video không có âm thanh nên không có gì để dịch.")
    if dur > MAX_DURATION_S:
        shutil.rmtree(jdir, ignore_errors=True)
        raise HTTPException(422, f"Video dài {dur / 60:.1f} phút, vượt giới hạn {MAX_DURATION_S / 60:.0f} phút.")

    now = time.time()
    store.add({
        "id": job_id, "created_at": now, "updated_at": now,
        "filename": Path(file.filename or "video").name, "stem": _safe_stem(file.filename or "video"),
        "input_name": input_name, "size": size, "duration": dur,
        "options": {"voice": voice, "hardsub": hardsub, "review": review},
        "status": "queued", "phase": "analyze", "step": None, "progress": 0.0,
        "message": "Đang chờ đến lượt", "error": None, "outputs": {}, "tts_failed": [], "segment_count": 0,
    })
    manager.enqueue(job_id, "analyze")
    return {"id": job_id}


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str, _: None = Depends(auth)):
    return public(get_job(job_id))


@app.get("/api/jobs/{job_id}/segments")
def job_segments(job_id: str, _: None = Depends(auth)):
    get_job(job_id)
    f = store.dir(job_id) / "segs.json"
    if not f.exists():
        raise HTTPException(409, "Chưa có bản dịch cho việc này.")
    segs = json.loads(f.read_text(encoding="utf-8"))
    return {"segments": [
        {"index": i, "start": s["start"], "end": s["end"], "zh": s["zh"], "vi": s.get("vi", ""),
         "max_chars": max(8, int((s["end"] - s["start"]) * vd.CHARS_PER_SEC))}
        for i, s in enumerate(segs)]}


class SegEdit(BaseModel):
    index: int = Field(ge=0)
    vi: str = Field(max_length=600)


class ContinueBody(BaseModel):
    segments: list[SegEdit] = []


@app.post("/api/jobs/{job_id}/continue")
def job_continue(job_id: str, body: ContinueBody, _: None = Depends(auth)):
    """Áp dụng các câu đã sửa rồi đọc giọng và xuất video (cũng dùng để chạy lại sau khi sửa)."""
    job = get_job(job_id)
    f = store.dir(job_id) / "segs.json"
    if job["status"] in ACTIVE:
        raise HTTPException(409, "Việc này đang chạy.")
    if not f.exists():
        raise HTTPException(409, "Chưa có bản dịch để tiếp tục.")
    p = problems()
    if p:
        raise HTTPException(503, " ".join(p))
    segs = json.loads(f.read_text(encoding="utf-8"))
    for e in body.segments:
        if e.index >= len(segs):
            raise HTTPException(422, f"Câu số {e.index} không tồn tại.")
        segs[e.index]["vi"] = e.vi.strip()
    f.write_text(json.dumps(segs, ensure_ascii=False), encoding="utf-8")
    manager.enqueue(job_id, "render")
    return public(get_job(job_id))


@app.post("/api/jobs/{job_id}/cancel")
def job_cancel(job_id: str, _: None = Depends(auth)):
    job = get_job(job_id)
    if job["status"] not in ACTIVE:
        raise HTTPException(409, "Việc này không còn chạy.")
    manager.request_cancel(job_id)
    return public(get_job(job_id))


@app.delete("/api/jobs/{job_id}", status_code=204)
def job_delete(job_id: str, _: None = Depends(auth)):
    job = get_job(job_id)
    if job["status"] in ACTIVE:
        raise HTTPException(409, "Hãy huỷ việc này trước khi xoá.")
    store.remove(job_id)


@app.get("/api/jobs/{job_id}/download/{kind}")
def job_download(job_id: str, kind: str, inline: bool = False, _: None = Depends(auth)):
    job = get_job(job_id)
    name = (job.get("outputs") or {}).get(kind)
    path = store.dir(job_id) / "out" / name if name else None
    if kind not in MEDIA or path is None or not path.exists():
        raise HTTPException(404, "File này chưa có.")
    return FileResponse(path, media_type=MEDIA[kind], filename=name,
                        content_disposition_type="inline" if inline else "attachment")


@app.get("/api/jobs/{job_id}/source")
def job_source(job_id: str, _: None = Depends(auth)):
    """Video gốc đã tải lên, để xem lại khi duyệt bản dịch."""
    job = get_job(job_id)
    path = store.dir(job_id) / job["input_name"]
    if not path.exists():
        raise HTTPException(404, "Không còn video gốc.")
    return FileResponse(path, content_disposition_type="inline")
