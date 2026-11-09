@echo off
chcp 65001 >nul
set PYTHONIOENCODING=utf-8
if "%~1"=="" (
  echo Keo tha video vao file nay de long tieng Viet va gan phu de len hinh.
  pause
  exit /b
)
"%~dp0.venv\Scripts\python.exe" "%~dp0vietdub.py" --gan-phu-de %*
echo.
pause
