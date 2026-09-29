@echo off
REM 포인트 복구 - 바탕화면의 초기화 백업 파일(포인트초기화백업_*.csv)로 포스 포인트를 초기화 이전 값으로 되돌립니다. 먼저 uninstall.bat 을 실행하세요.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0restore-bulk-import-backup.ps1"
pause
