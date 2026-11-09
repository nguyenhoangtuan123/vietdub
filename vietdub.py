#!/usr/bin/env python3
"""
VietDub: biến video tiếng Trung (Douyin) thành video lồng tiếng Việt.

Quy trình:
  1. Tách âm thanh, chép lời tiếng Trung kèm mốc thời gian
  2. Dịch từng đoạn sang tiếng Việt, độ dài vừa với thời lượng đoạn
  3. Đọc bằng giọng AI tiếng Việt
  4. Khớp từng câu đọc vào đúng thời điểm, giảm nhỏ tiếng gốc khi có lời đọc
  5. Ghép lại thành video mới (+ file phụ đề .srt, tuỳ chọn gắn phụ đề lên hình)

Cách chạy:  python vietdub.py "video.mp4"
Xem tuỳ chọn: python vietdub.py --help
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Callable

import numpy as np
import requests

SR = 44100  # tần số lấy mẫu dùng khi trộn âm
HERE = Path(__file__).resolve().parent

DEFAULTS = {
    "openai_api_key": "",
    "openai_base_url": "https://api.openai.com/v1",
    # Chép lời: "openai" (whisper-1, OpenAI ngừng chạy 26/02/2027) hoặc "local" (faster-whisper, miễn phí, chạy trên máy)
    "stt": "local",
    "local_whisper_model": "small",
    # Thiết bị chép lời: "cpu" (ổn định), "cuda" (cần cài CUDA 12 + cuBLAS) hoặc "auto"
    "local_whisper_device": "cpu",
    # Dịch bằng: "gemini" (Google) hoặc "openai"
    "dich_bang": "gemini",
    "gemini_api_key": "",
    "gemini_base_url": "https://generativelanguage.googleapis.com/v1beta/openai",
    "model_dich_gemini": "gemini-3.6-flash",
    # Model dịch khi dich_bang = "openai"
    "model_dich": "gpt-5-mini",
    # Giọng đọc: "edge" (miễn phí, giọng Việt tự nhiên) hoặc "openai" (OpenAI ngừng chạy 06/01/2027)
    "tts": "edge",
    "giong_edge": "vi-VN-HoaiMyNeural",      # hoặc vi-VN-NamMinhNeural (giọng nam)
    "toc_do_edge": "+10%",
    "giong_openai": "coral",
    "model_tts_openai": "gpt-4o-mini-tts",
    # Âm lượng tiếng gốc khi đang có lời đọc (0 = tắt hẳn, 1 = giữ nguyên)
    "am_luong_goc_khi_doc": 0.12,
    # Âm lượng tiếng gốc ở đoạn không có lời
    "am_luong_goc_nen": 0.9,
    # Tăng tốc tối đa khi câu đọc dài hơn chỗ trống (1.0 = không tăng)
    "toc_do_toi_da": 1.5,
    # Gắn phụ đề tiếng Việt lên hình (mất thêm thời gian vì phải mã hoá lại video)
    "gan_phu_de": False,
}

CHARS_PER_SEC = 14  # tốc độ đọc tiếng Việt ước lượng

# Báo tiến độ cho giao diện web: (mã bước, tỉ lệ 0..1 trong bước, thông điệp).
# Các bước: tach_am, chep_loi, dich, doc_giong, ghep_am, xuat_video
ProgressFn = Callable[[str, float, str], None]
CancelFn = Callable[[], bool]


class Cancelled(Exception):
    """Người dùng đã huỷ việc đang chạy."""


def _no_progress(step: str, frac: float, msg: str) -> None:
    pass


def _never() -> bool:
    return False


# ---------------------------------------------------------------- tiện ích

def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def die(msg: str) -> None:
    # SystemExit mang theo thông điệp: dòng lệnh in ra stderr và thoát mã 1, máy chủ web đọc được từ e.code
    sys.exit(f"\nLỖI: {msg}")


def run(cmd: list[str], cwd: str | None = None) -> bytes:
    p = subprocess.run(cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if p.returncode != 0:
        tail = p.stderr.decode("utf-8", "replace")[-1500:]
        raise RuntimeError(f"Lệnh thất bại: {' '.join(cmd[:3])} ...\n{tail}")
    return p.stdout


RETRY_CODES = {429, 500, 502, 503, 504}


def post_retry(url: str, what: str, delays: tuple[int, ...] = (4, 12, 30), **kw) -> requests.Response:
    """requests.post có thử lại khi bị giới hạn tốc độ (429), server lỗi tạm thời hoặc mất mạng."""
    for i in range(len(delays) + 1):
        try:
            r = requests.post(url, **kw)
            if r.status_code not in RETRY_CODES:
                return r
            why = f"HTTP {r.status_code}"
        except requests.RequestException as e:
            r, why = None, str(e)[:120]
        if i == len(delays):
            if r is None:
                raise RuntimeError(f"{what} lỗi mạng: {why}")
            return r
        log(f"{what}: {why}, thử lại sau {delays[i]}s...")
        time.sleep(delays[i])
    raise AssertionError("không tới được đây")


def check_tools() -> None:
    for t in ("ffmpeg", "ffprobe"):
        if not shutil.which(t):
            die(f"Không tìm thấy {t}. Trên Windows mở PowerShell gõ: winget install Gyan.FFmpeg  rồi mở lại cửa sổ.")


def load_config(path: Path | None) -> dict:
    cfg = dict(DEFAULTS)
    p = path or HERE / "config.json"
    if p.exists():
        with open(p, encoding="utf-8") as f:
            cfg.update({k: v for k, v in json.load(f).items() if not k.startswith("_")})
    cfg["openai_api_key"] = os.environ.get("OPENAI_API_KEY") or cfg["openai_api_key"]
    cfg["gemini_api_key"] = os.environ.get("GEMINI_API_KEY") or cfg["gemini_api_key"]
    return cfg


def probe(path: Path) -> tuple[float, bool]:
    out = run(["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type",
               "-of", "json", str(path)])
    info = json.loads(out)
    dur = float(info["format"]["duration"])
    has_audio = any(s.get("codec_type") == "audio" for s in info.get("streams", []))
    return dur, has_audio


def decode(path: Path, channels: int, tempo: float = 1.0) -> np.ndarray:
    """Giải mã file âm thanh/video thành mảng float32 [mẫu, kênh] ở 44.1 kHz."""
    cmd = ["ffmpeg", "-v", "error", "-i", str(path), "-vn"]
    if tempo != 1.0:
        cmd += ["-filter:a", f"atempo={tempo:.4f}"]
    cmd += ["-ac", str(channels), "-ar", str(SR), "-f", "f32le", "-"]
    data = np.frombuffer(run(cmd), dtype=np.float32)
    return data.reshape(-1, channels).copy()


def srt_time(t: float) -> str:
    ms = int(round(max(t, 0) * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02}:{m:02}:{s:02},{ms:03}"


def write_srt(path: Path, segs: list[dict], key: str) -> None:
    lines = []
    for i, s in enumerate([s for s in segs if s.get(key)], 1):
        lines += [str(i), f"{srt_time(s['start'])} --> {srt_time(s['end'])}", s[key].strip(), ""]
    path.write_text("\n".join(lines), encoding="utf-8")


# ---------------------------------------------------------------- 1. chép lời

def transcribe_openai(audio: Path, cfg: dict) -> list[dict]:
    with open(audio, "rb") as f:
        r = requests.post(
            f"{cfg['openai_base_url']}/audio/transcriptions",
            headers={"Authorization": f"Bearer {cfg['openai_api_key']}"},
            files={"file": (audio.name, f, "audio/mpeg")},
            data={"model": "whisper-1", "language": "zh", "response_format": "verbose_json",
                  "timestamp_granularities[]": "segment"},
            timeout=600,
        )
    if r.status_code != 200:
        raise RuntimeError(f"OpenAI chép lời lỗi {r.status_code}: {r.text[:500]}")
    return [{"start": float(s["start"]), "end": float(s["end"]), "zh": s["text"].strip()}
            for s in r.json().get("segments", [])]


def transcribe_local(audio: Path, cfg: dict) -> list[dict]:
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        die("Chưa cài faster-whisper. Chạy: pip install faster-whisper")
    log(f"Đang nạp model {cfg['local_whisper_model']} (lần đầu sẽ tải về, mất vài phút)...")
    model = WhisperModel(cfg["local_whisper_model"], device=cfg["local_whisper_device"], compute_type="int8")
    segments, _ = model.transcribe(str(audio), language="zh", vad_filter=True, beam_size=5)
    return [{"start": float(s.start), "end": float(s.end), "zh": s.text.strip()} for s in segments]


def merge_short(segs: list[dict], min_dur: float = 1.2, max_gap: float = 0.3) -> list[dict]:
    """Gộp các đoạn quá ngắn liền nhau để câu dịch tự nhiên hơn."""
    out: list[dict] = []
    for s in segs:
        if not s["zh"]:
            continue
        if out and (out[-1]["end"] - out[-1]["start"] < min_dur) and s["start"] - out[-1]["end"] <= max_gap:
            out[-1]["end"] = s["end"]
            out[-1]["zh"] += "，" + s["zh"]
        else:
            out.append(dict(s))
    return out


# ---------------------------------------------------------------- 2. dịch

SYSTEM_DICH = (
    "Bạn là người lồng tiếng video ngắn Trung - Việt. Dịch từng đoạn lời thoại sang tiếng Việt nói tự nhiên, "
    "giọng thân mật kiểu video TikTok. Mỗi đoạn có max_chars: câu dịch KHÔNG được dài hơn số ký tự này, "
    "nếu cần thì rút gọn ý nhưng giữ nghĩa chính. Giữ đúng tên sản phẩm, con số, đơn vị. "
    "Đổi đơn vị tiền: giữ nguyên 'tệ' (không tự quy đổi). "
    'Trả về JSON dạng {"segments":[{"id":<số>,"vi":"<câu dịch>"}]}, đủ mọi id, không thêm gì khác.'
)


# Khuôn JSON bắt buộc khi dịch bằng Gemini (kiểu structured output của OpenAI-compat)
DICH_SCHEMA = {
    "type": "object",
    "properties": {"segments": {"type": "array", "items": {
        "type": "object",
        "properties": {"id": {"type": "integer"}, "vi": {"type": "string"}},
        "required": ["id", "vi"], "additionalProperties": False}}},
    "required": ["segments"], "additionalProperties": False,
}


def send_translation(payload: list[dict], cfg: dict) -> requests.Response:
    """Gửi các đoạn cần dịch tới Gemini hoặc OpenAI (cùng giao diện chat/completions)."""
    gemini = cfg["dich_bang"] == "gemini"
    if gemini:
        name, base, key, model = "Gemini", cfg["gemini_base_url"], cfg["gemini_api_key"], cfg["model_dich_gemini"]
        fmt = {"type": "json_schema", "json_schema": {"name": "ban_dich", "strict": True, "schema": DICH_SCHEMA}}
    else:
        name, base, key, model = "OpenAI", cfg["openai_base_url"], cfg["openai_api_key"], cfg["model_dich"]
        fmt = {"type": "json_object"}
    r = post_retry(
        f"{base.rstrip('/')}/chat/completions", f"{name} dịch",
        headers={"Authorization": f"Bearer {key}"},
        json={"model": model, "response_format": fmt,
              "messages": [{"role": "system", "content": SYSTEM_DICH},
                           {"role": "user", "content": json.dumps({"segments": payload}, ensure_ascii=False)}]},
        timeout=600,
    )
    if r.status_code != 200:
        raise RuntimeError(f"{name} dịch lỗi {r.status_code}: {r.text[:500]}")
    return r


def translate(segs: list[dict], cfg: dict) -> None:
    payload = [{"id": i, "duration_s": round(s["end"] - s["start"], 1),
                "max_chars": max(8, int((s["end"] - s["start"]) * CHARS_PER_SEC)), "zh": s["zh"]}
               for i, s in enumerate(segs)]
    for attempt in (1, 2):
        r = send_translation(payload, cfg)
        try:
            got = json.loads(r.json()["choices"][0]["message"]["content"])["segments"]
            by_id = {int(x["id"]): str(x["vi"]).strip() for x in got}
        except (KeyError, IndexError, ValueError, TypeError, json.JSONDecodeError):
            by_id = {}
        missing = [i for i in range(len(segs)) if not by_id.get(i)]
        if not missing:
            break
        if attempt == 1:
            log(f"Bản dịch thiếu {len(missing)} đoạn, đang thử lại...")
    else:
        if len(missing) == len(segs):
            raise RuntimeError("Bước dịch không trả về kết quả hợp lệ.")
        log(f"CẢNH BÁO: {len(missing)}/{len(segs)} đoạn không dịch được, các đoạn này sẽ không có lời đọc.")
    for i, s in enumerate(segs):
        s["vi"] = by_id.get(i, "")


# ---------------------------------------------------------------- 3. giọng đọc

def tts_edge(text: str, out: Path, cfg: dict) -> None:
    try:
        import edge_tts
    except ImportError:
        die("Chưa cài edge-tts. Chạy: pip install edge-tts")

    async def go():
        await edge_tts.Communicate(text, cfg["giong_edge"], rate=cfg["toc_do_edge"]).save(str(out))

    # Edge TTS là dịch vụ không chính thức: thỉnh thoảng trả "No audio was received" ngẫu nhiên cho cả
    # câu bình thường (khoảng một phần tư số câu khi đo thử), nên thử lại nhiều lần, chờ lâu dần.
    waits = (2, 4, 8, 12)
    for attempt in range(len(waits) + 1):
        try:
            asyncio.run(go())
            if out.exists() and out.stat().st_size > 0:
                return
            raise RuntimeError("file âm thanh rỗng")
        except Exception as e:
            if attempt == len(waits):
                raise RuntimeError(f"Edge TTS lỗi sau {attempt + 1} lần thử: {e}")
            time.sleep(waits[attempt])


def tts_openai(text: str, out: Path, cfg: dict) -> None:
    r = requests.post(
        f"{cfg['openai_base_url']}/audio/speech",
        headers={"Authorization": f"Bearer {cfg['openai_api_key']}"},
        json={"model": cfg["model_tts_openai"], "voice": cfg["giong_openai"], "input": text,
              "response_format": "wav",
              "instructions": "Đọc bằng tiếng Việt, giọng tự nhiên, hào hứng như người review đồ trên TikTok, nhịp hơi nhanh."},
        timeout=300,
    )
    if r.status_code != 200:
        raise RuntimeError(f"OpenAI đọc giọng lỗi {r.status_code}: {r.text[:300]}")
    out.write_bytes(r.content)


# ---------------------------------------------------------------- 4. ghép âm

def build_audio(segs: list[dict], clips: list[Path | None], video: Path, dur: float,
                has_audio: bool, cfg: dict) -> np.ndarray:
    n = int(dur * SR) + 1
    dub = np.zeros(n, dtype=np.float32)
    busy = np.zeros(n, dtype=bool)
    max_tempo = float(cfg["toc_do_toi_da"])

    for i, (s, clip) in enumerate(zip(segs, clips)):
        if clip is None:
            continue
        start = int(s["start"] * SR)
        nxt = segs[i + 1]["start"] if i + 1 < len(segs) else dur
        slot = max(nxt - s["start"], 0.3)
        audio = decode(clip, 1)[:, 0]
        length = len(audio) / SR
        tempo = 1.0
        if length > slot * 0.98:
            tempo = min(length / (slot * 0.98), max_tempo)
            if tempo > 1.01:
                audio = decode(clip, 1, tempo)[:, 0]
        s["dub_start"], s["dub_end"] = s["start"], s["start"] + len(audio) / SR
        s["tempo"] = round(tempo, 2)
        end = min(start + len(audio), n)
        dub[start:end] += audio[: end - start]
        busy[start:end] = True

    if has_audio:
        orig = decode(video, 2)
        if len(orig) < n:
            orig = np.pad(orig, ((0, n - len(orig)), (0, 0)))
        orig = orig[:n]
    else:
        orig = np.zeros((n, 2), dtype=np.float32)

    # đường cong âm lượng tiếng gốc: nhỏ khi có lời đọc, chuyển mượt 120 ms
    gain = np.where(busy, cfg["am_luong_goc_khi_doc"], cfg["am_luong_goc_nen"]).astype(np.float32)
    k = int(0.12 * SR)
    if k > 1 and n > k:
        gain = np.convolve(gain, np.ones(k, dtype=np.float32) / k, mode="same")
    mix = orig * gain[:, None] + dub[:, None]
    peak = float(np.max(np.abs(mix))) if mix.size else 0
    if peak > 0.98:
        mix *= 0.98 / peak
    return mix


def write_wav(path: Path, data: np.ndarray) -> None:
    raw = path.with_suffix(".f32")
    data.astype(np.float32).tofile(raw)
    run(["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", str(data.shape[1]),
         "-i", str(raw), str(path)])
    raw.unlink()


# ---------------------------------------------------------------- chương trình chính

def main() -> None:
    ap = argparse.ArgumentParser(description="Lồng tiếng Việt cho video tiếng Trung")
    ap.add_argument("videos", nargs="+", help="file video đầu vào (có thể nhiều file)")
    ap.add_argument("--config", type=Path, help="đường dẫn config.json (mặc định: cạnh script)")
    ap.add_argument("--out-dir", type=Path, help="thư mục lưu kết quả (mặc định: cạnh video gốc)")
    ap.add_argument("--dich", choices=["gemini", "openai"], help="dịch bằng Gemini hay OpenAI")
    ap.add_argument("--stt", choices=["openai", "local"])
    ap.add_argument("--tts", choices=["edge", "openai"])
    ap.add_argument("--giong", help="tên giọng đọc, VD vi-VN-NamMinhNeural")
    ap.add_argument("--gan-phu-de", action="store_true", help="gắn phụ đề tiếng Việt lên hình")
    ap.add_argument("--giu-tam", action="store_true", help="giữ thư mục tạm để kiểm tra")
    a = ap.parse_args()

    check_tools()
    cfg = load_config(a.config)
    if a.dich: cfg["dich_bang"] = a.dich
    if a.stt: cfg["stt"] = a.stt
    if a.tts: cfg["tts"] = a.tts
    if a.giong:
        cfg["giong_edge" if cfg["tts"] == "edge" else "giong_openai"] = a.giong
    if a.gan_phu_de: cfg["gan_phu_de"] = True
    if cfg["dich_bang"] not in ("gemini", "openai"):
        die('"dich_bang" trong config.json phải là "gemini" hoặc "openai".')
    if cfg["dich_bang"] == "gemini" and not cfg["gemini_api_key"]:
        die("Chưa có Gemini API key. Mở config.json điền vào dòng gemini_api_key "
            "(hoặc đặt biến môi trường GEMINI_API_KEY). Lấy key tại aistudio.google.com/apikey")
    dung_openai = [k for k in ("dich_bang", "stt", "tts") if cfg[k] == "openai"]
    if dung_openai and not cfg["openai_api_key"]:
        die(f"Chưa có OpenAI API key (đang chọn OpenAI cho: {', '.join(dung_openai)}). "
            "Điền openai_api_key trong config.json, hoặc đổi các mục đó sang gemini / local / edge.")

    ok = 0
    for v in a.videos:
        try:
            process(Path(v), cfg, a.out_dir, a.giu_tam)
            ok += 1
        except Exception as e:
            print(f"\nLỖI với {v}: {e}\n", file=sys.stderr, flush=True)
    log(f"Hoàn tất {ok}/{len(a.videos)} video.")
    if ok < len(a.videos):
        sys.exit(1)


def _check_cancel(cancelled: CancelFn) -> None:
    if cancelled():
        raise Cancelled("Đã huỷ.")


def analyze(video: Path, cfg: dict, work: Path, on_progress: ProgressFn = _no_progress,
            cancelled: CancelFn = _never) -> tuple[list[dict], float]:
    """Giai đoạn 1: tách âm thanh, chép lời, dịch.
    Trả về (các đoạn lời kèm bản dịch, thời lượng video). Dùng được cả từ dòng lệnh lẫn từ web."""
    if not video.exists():
        raise RuntimeError(f"Không thấy file {video}")
    dur, has_audio = probe(video)
    if not has_audio:
        raise RuntimeError("Video không có âm thanh nên không có gì để dịch.")
    msg = f"Thời lượng {dur:.1f}s. Đang tách âm thanh..."
    log(msg)
    on_progress("tach_am", 0.0, msg)
    audio = work / "audio.mp3"
    run(["ffmpeg", "-v", "error", "-y", "-i", str(video), "-vn", "-ac", "1", "-ar", "16000",
         "-b:a", "48k", str(audio)])
    if audio.stat().st_size > 24 * 1024 * 1024 and cfg["stt"] == "openai":
        raise RuntimeError("Âm thanh quá dài cho OpenAI (giới hạn 25 MB). Dùng --stt local hoặc cắt ngắn video.")
    _check_cancel(cancelled)

    log(f"Đang chép lời tiếng Trung ({cfg['stt']})...")
    on_progress("chep_loi", 0.0, "Đang chép lời tiếng Trung...")
    segs = (transcribe_local if cfg["stt"] == "local" else transcribe_openai)(audio, cfg)
    segs = merge_short(segs)
    if not segs:
        raise RuntimeError("Không nghe thấy lời thoại nào trong video.")
    _check_cancel(cancelled)

    msg = f"Có {len(segs)} đoạn lời. Đang dịch..."
    log(msg)
    on_progress("dich", 0.0, msg)
    translate(segs, cfg)
    return segs, dur


def _tts_cache_file(cache: Path | None, cfg: dict, text: str, ext: str) -> Path | None:
    """Đường dẫn file nhớ tạm cho một câu đọc (None nếu không dùng bộ nhớ đệm).
    Khoá theo giọng, tốc độ và nội dung, nên sửa một câu chỉ phải đọc lại đúng câu đó."""
    if cache is None:
        return None
    cache.mkdir(parents=True, exist_ok=True)
    voice = cfg["giong_edge"] if cfg["tts"] == "edge" else cfg["giong_openai"]
    key = hashlib.sha1(f"{cfg['tts']}|{voice}|{cfg['toc_do_edge']}|{text}".encode("utf-8")).hexdigest()
    return cache / f"{key}.{ext}"


def render(video: Path, segs: list[dict], dur: float, cfg: dict, out_dir: Path, stem: str, work: Path,
           on_progress: ProgressFn = _no_progress, cancelled: CancelFn = _never,
           tts_cache: Path | None = None) -> dict[str, Path]:
    """Giai đoạn 2: đọc giọng, ghép âm thanh, xuất video + phụ đề + bảng lời thoại.
    Trả về {"video": ..., "srt": ..., "txt": ...}. `segs[i]["vi"]` có thể đã được người dùng sửa.
    Nếu có `tts_cache`, câu nào đã đọc thành công trước đó sẽ được dùng lại."""
    out_dir.mkdir(parents=True, exist_ok=True)
    n = len(segs)
    for s in segs:
        s["vi"] = str(s.get("vi") or "").strip()
        for k in ("tts_loi", "tempo", "dub_start", "dub_end"):
            s.pop(k, None)

    log(f"Đang đọc giọng ({cfg['tts']})...")
    on_progress("doc_giong", 0.0, "Đang đọc giọng...")
    tts = tts_edge if cfg["tts"] == "edge" else tts_openai
    clips: list[Path | None] = []
    failed = 0
    for i, s in enumerate(segs):
        _check_cancel(cancelled)
        if not s["vi"]:
            clips.append(None)
            continue
        ext = "mp3" if cfg["tts"] == "edge" else "wav"
        p = work / f"tts_{i:03}.{ext}"
        cached = _tts_cache_file(tts_cache, cfg, s["vi"], ext)
        try:
            if cached is not None and cached.exists():
                clips.append(cached)
            else:
                tts(s["vi"], p, cfg)
                if cached is not None:
                    shutil.copyfile(p, cached)
                clips.append(p)
        except RuntimeError as e:
            # một câu lỗi không nên làm hỏng cả video: giữ tiếng gốc ở đoạn đó và ghi vào báo cáo
            clips.append(None)
            s["tts_loi"] = True
            failed += 1
            log(f"Không đọc được đoạn {i + 1}/{n}, giữ tiếng gốc ở đoạn này ({e})")
        print(f"  {i + 1}/{n}", end="\r", flush=True)
        on_progress("doc_giong", (i + 1) / n, f"Đang đọc giọng {i + 1}/{n}")
    if all(c is None for c in clips):
        if failed:
            raise RuntimeError("Không đọc được đoạn nào, giọng đọc đang lỗi. Thử lại sau ít phút hoặc đổi --tts.")
        raise RuntimeError("Không còn đoạn lời nào để đọc giọng.")
    if failed:
        log(f"CẢNH BÁO: {failed} đoạn không đọc được, xem file _loi-thoai.txt.")
    _check_cancel(cancelled)

    log("Đang ghép âm thanh...")
    on_progress("ghep_am", 0.0, "Đang ghép âm thanh...")
    mix = build_audio(segs, clips, video, dur, True, cfg)
    wav = work / "mix.wav"
    write_wav(wav, mix)
    _check_cancel(cancelled)

    # phụ đề theo thời điểm đọc thực tế
    for s in segs:
        s.setdefault("dub_start", s["start"])
        s.setdefault("dub_end", s["end"])
    sub_segs = [{"start": s["dub_start"], "end": max(s["dub_end"], s["dub_start"] + 0.8), "vi": s["vi"]}
                for s in segs]
    srt_out = out_dir / f"{stem}_vietsub.srt"
    write_srt(srt_out, sub_segs, "vi")

    out = out_dir / f"{stem}_vietdub.mp4"
    log("Đang xuất video...")
    on_progress("xuat_video", 0.0, "Đang xuất video...")
    if cfg["gan_phu_de"]:
        shutil.copy(srt_out, work / "sub.srt")
        style = ("FontName=Arial,FontSize=13,PrimaryColour=&H00FFFFFF,BackColour=&H99000000,"
                 "BorderStyle=3,Outline=1,Shadow=0,MarginV=40,Alignment=2")
        run(["ffmpeg", "-v", "error", "-y", "-i", str(video.resolve()), "-i", str(wav),
             "-map", "0:v:0", "-map", "1:a:0", "-vf", f"subtitles=sub.srt:force_style='{style}'",
             "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
             "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-shortest", str(out.resolve())],
            cwd=str(work))
    else:
        run(["ffmpeg", "-v", "error", "-y", "-i", str(video), "-i", str(wav),
             "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
             "-movflags", "+faststart", "-shortest", str(out)])

    # bảng lời thoại để kiểm tra/sửa
    report = out_dir / f"{stem}_loi-thoai.txt"
    with open(report, "w", encoding="utf-8") as f:
        for s in segs:
            note = f"  (tăng tốc x{s['tempo']})" if s.get("tempo", 1) > 1.01 else ""
            if s.get("tts_loi"):
                note = "  (KHÔNG CÓ GIỌNG ĐỌC: giữ tiếng gốc)"
            f.write(f"[{srt_time(s['start'])}] {s['zh']}\n    → {s['vi']}{note}\n")
    on_progress("xuat_video", 1.0, "Hoàn tất")
    return {"video": out, "srt": srt_out, "txt": report}


def process(video: Path, cfg: dict, out_dir: Path | None, keep: bool) -> None:
    if not video.exists():
        raise RuntimeError(f"Không thấy file {video}")
    out_dir = out_dir or video.parent
    tmp = Path(tempfile.mkdtemp(prefix="vietdub_"))
    t0 = time.time()
    log(f"=== {video.name} ===")
    try:
        segs, dur = analyze(video, cfg, tmp)
        res = render(video, segs, dur, cfg, out_dir, video.stem, tmp)
        log(f"Xong sau {time.time() - t0:.0f}s:\n    {res['video']}\n    {res['srt']}\n    {res['txt']}")
    finally:
        if keep:
            log(f"Giữ thư mục tạm: {tmp}")
        else:
            shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
