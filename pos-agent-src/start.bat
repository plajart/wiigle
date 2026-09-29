@echo off
REM 포인트 관리 프로그램 - 더블클릭 실행용. .ps1을 직접 더블클릭하면 메모장이 열리기 때문에
REM 이 파일로 감싸서 실제로 실행되게 한다.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0point-terminal-agent.ps1"
pause
