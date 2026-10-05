@echo off
REM 포인트 복구 - 바탕화면의 포인트 이전 백업 파일(포인트서버이전백업_*.csv)로 포스 포인트를 이전 전 값으로 되돌립니다. 먼저 uninstall.bat 을 실행하세요.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0restore-bulk-import-backup.ps1"
pause
