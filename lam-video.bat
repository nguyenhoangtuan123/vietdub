@echo off
chcp 65001 >nul
set PYTHONIOENCODING=utf-8
if "%~1"=="" (
  echo Keo tha 1 hoac nhieu file video vao file nay de long tieng Viet.
  pause
  exit /b
)
"%~dp0.venv\Scripts\python.exe" "%~dp0vietdub.py" %*
echo.
pause
