# VietDub

Lồng tiếng Việt cho video ngắn tiếng Trung (Douyin, Bilibili…): chép lời, dịch, đọc giọng Việt, ghép lại vào video, kèm phụ đề `.srt` và bản lời thoại để kiểm tra.

```
video ──ffmpeg──▶ âm thanh ──faster-whisper──▶ lời Trung ──Gemini──▶ lời Việt ──Edge TTS──▶ giọng đọc ──ffmpeg──▶ video lồng tiếng
```

Có hai cách dùng, cùng một lõi xử lý (`vietdub.py`):

| Cách dùng | Dành cho |
|---|---|
| **Dòng lệnh / kéo thả `.bat`** | Làm nhanh từng video trên máy mình. Xem `HUONG-DAN.txt`. |
| **Web** (thư mục `web/` + `server/`) | Có trang thả video, thanh tiến độ, sửa bản dịch trước khi đọc giọng, nghe thử và tải kết quả. |

## Cài đặt

```powershell
winget install Gyan.FFmpeg                      # xong thì mở lại PowerShell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m pip install -r server\requirements.txt   # chỉ khi chạy web
copy config.example.json config.json            # rồi điền gemini_api_key (hoặc đặt biến GEMINI_API_KEY)
```

Khoá Gemini lấy tại <https://aistudio.google.com/apikey>. `config.json` đã nằm trong `.gitignore`, không đưa lên GitHub.

## Chạy web trên máy

Cần thêm [Node.js](https://nodejs.org) (bản LTS). Bấm đúp `chay-web.bat`, hoặc chạy tay hai cửa sổ:

```powershell
# cửa sổ 1: máy chủ xử lý (FastAPI)
.\.venv\Scripts\python.exe -m uvicorn server.app:app --host 127.0.0.1 --port 8000

# cửa sổ 2: giao diện (Next.js)
cd web
npm install
npm run dev
```

Mở <http://localhost:3000>. Việc chép lời chạy trên CPU nên video 1–2 phút mất khoảng một đến vài phút; giọng Edge là phần chậm nhất.

## Cấu hình máy chủ

Đặt bằng biến môi trường (đều có giá trị mặc định):

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `GEMINI_API_KEY` | trong `config.json` | Khoá dịch. Biến môi trường được ưu tiên hơn file. |
| `VIETDUB_ACCESS_TOKEN` | trống (không khoá) | Nếu đặt, mọi lời gọi API phải kèm mã này; trang web sẽ hiện ô nhập mã. |
| `VIETDUB_MAX_UPLOAD_MB` | `300` | Dung lượng video tối đa. |
| `VIETDUB_MAX_DURATION_S` | `600` | Thời lượng video tối đa (giây). |
| `VIETDUB_JOB_TTL_HOURS` | `24` | Tự xoá video và kết quả sau bấy nhiêu giờ. |
| `VIETDUB_JOBS_DIR` | `server/jobs` | Nơi lưu video, kết quả và trạng thái. |
| `VIETDUB_CORS_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` | Các địa chỉ trang web được phép gọi API, cách nhau bằng dấu phẩy. |

Giao diện đọc địa chỉ máy chủ từ `NEXT_PUBLIC_API_URL` (mặc định `http://127.0.0.1:8000`), xem `web/.env.example`.

## Đưa lên mạng

Giao diện (`web/`) deploy lên **Vercel**; máy chủ xử lý thì **không** chạy được trên Vercel (hàm chỉ nhận yêu cầu tối đa 4,5 MB, thời gian chạy ngắn, không có sẵn ffmpeg/Whisper), nên cần một nơi chạy lâu dài: VPS, máy tính ở nhà kèm Cloudflare Tunnel, hoặc dịch vụ container.

1. Chạy máy chủ ở nơi đó, **có HTTPS** (trang HTTPS không được gọi API HTTP). Đặt `VIETDUB_ACCESS_TOKEN` và `VIETDUB_CORS_ORIGINS=https://ten-mien-cua-ban.vercel.app`.
2. Trên Vercel: *Import* repo, đặt **Root Directory = `web`**, thêm biến `NEXT_PUBLIC_API_URL` = địa chỉ HTTPS của máy chủ.
3. Cho dùng công khai thì nên đổi giọng đọc sang dịch vụ chính thức (Azure Speech hoặc Gemini TTS): Edge TTS miễn phí nhưng không chính thức và hay lỗi tạm thời.

## API

Tất cả nằm dưới `/api`, mã truy cập (nếu bật) gửi qua header `X-Access-Token` hoặc `?token=`. Tài liệu tương tác ở `/api/docs`.

| Phương thức | Đường dẫn | |
|---|---|---|
| `GET` | `/health` | Tình trạng máy chủ, giới hạn, danh sách giọng |
| `POST` | `/jobs` | Tải video lên (`multipart`: `file`, `voice`, `hardsub`, `review`) |
| `GET` | `/jobs/{id}` | Trạng thái và tiến độ |
| `GET` | `/jobs/{id}/segments` | Lời gốc và lời dịch từng câu |
| `POST` | `/jobs/{id}/continue` | Gửi câu đã sửa rồi đọc giọng và xuất video (cũng dùng để chạy lại) |
| `POST` | `/jobs/{id}/cancel` | Huỷ |
| `DELETE` | `/jobs/{id}` | Xoá |
| `GET` | `/jobs/{id}/download/{video\|srt\|txt}` | Tải kết quả (`?inline=1` để xem trực tiếp) |
| `GET` | `/jobs/{id}/source` | Video gốc đã tải lên |

Máy chủ xử lý lần lượt từng việc (mỗi lần một). Không có API liệt kê việc, nên người dùng chỉ truy cập được việc có mã (`id`) của chính họ; trình duyệt tự nhớ danh sách của mình.

## Giới hạn đã biết

- Giọng Edge TTS không chính thức, hay lỗi tạm thời và khá chậm; các câu lỗi được đánh dấu và có nút đọc lại.
- Gói miễn phí của Gemini có hạn mức theo ngày; script tự thử lại khi bị chặn tạm thời.
- Chữ Trung in sẵn trên hình không xoá được, chỉ che bớt bằng phụ đề có nền.
