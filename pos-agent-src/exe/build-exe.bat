@echo off
REM PointManager.exe 빌드 - Windows 에서 한 번 실행합니다(별도 설치 없이 Windows 에 들어 있는 .NET Framework 의 컴파일러를 씁니다).
REM 결과 파일 PointManager.exe 를 서버의 pos-agent-src 폴더에 올려 두면, 매장 화면의 "포스기 다운로드"가 exe 한 개로 내려줍니다.
REM (exe 가 없으면 서버는 예전처럼 압축파일을 내려줍니다.)
setlocal
set CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe
if not exist "%CSC%" set CSC=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe
if not exist "%CSC%" (
  echo .NET Framework 4 compiler not found.
  exit /b 1
)
set ICON=%~dp0..\pointmanager.ico
if exist "%ICON%" ( set ICONOPT=/win32icon:"%ICON%" ) else ( set ICONOPT= )
"%CSC%" /nologo /target:winexe /optimize+ /out:"%~dp0PointManager.exe" %ICONOPT% /reference:System.Windows.Forms.dll /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll "%~dp0PointManager.cs"
if errorlevel 1 ( echo build failed & exit /b 1 )
echo done: %~dp0PointManager.exe  ^(copy it to pos-agent-src on the server^)
endlocal
