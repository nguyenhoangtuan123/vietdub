@echo off
chcp 65001 >nul
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8

if not exist ".venv\Scripts\python.exe" (
  echo Chua co moi truong ao .venv. Lam theo muc CAI DAT trong HUONG-DAN.txt truoc.
  pause
  exit /b 1
)
where node >nul 2>nul
if errorlevel 1 (
  echo Chua cai Node.js. Cai ban LTS tu https://nodejs.org roi chay lai file nay.
  pause
  exit /b 1
)

".venv\Scripts\python.exe" -c "import fastapi, uvicorn, multipart" >nul 2>nul
if errorlevel 1 (
  echo Dang cai thu vien cho may chu web...
  ".venv\Scripts\python.exe" -m pip install -r server\requirements.txt
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
if not exist "web\node_modules" (
  echo Dang cai thu vien giao dien lan dau, doi mot chut...
  pushd web
  call npm install
  popd
)

start "VietDub - may chu (cong 8000)" cmd /k "cd /d %~dp0 && .venv\Scripts\python.exe -m uvicorn server.app:app --host 127.0.0.1 --port 8000"
start "VietDub - giao dien (cong 3000)" cmd /k "cd /d %~dp0web && npm run dev"

echo.
echo Dang khoi dong. Trinh duyet se tu mo sau it giay: http://localhost:3000
echo De tat: dong 2 cua so den vua hien ra.
timeout /t 8 /nobreak >nul
start http://localhost:3000
