@echo off
REM 포인트 관리 프로그램 - 설치/실행. 여러 번 실행해도 안전합니다(이미 실행 중이면 새로 띄우지 않고, 이미 등록된 PC면 다시 등록하지 않습니다).
REM .ps1을 직접 더블클릭하면 메모장이 열리기 때문에 이 파일로 감싸서 실행합니다.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0point-terminal-agent.ps1" -Setup
pause
