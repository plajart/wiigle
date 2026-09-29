@echo off
REM 포인트 관리 프로그램 - 제거(프로그램 종료, 자동시작/바로가기 삭제, 포스DB 연동 장치 정리). 마지막에 포인트 복구 여부를 묻습니다.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1"
pause
