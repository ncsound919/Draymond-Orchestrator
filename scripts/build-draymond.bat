@echo off
REM Draymond Next.js production build (node directly, no npm shim).
set ORCH=C:\Users\User\Downloads\Uplift\Draymond-Orchestrator
set LOG=%ORCH%\data\next-build.log
set ERR=%ORCH%\data\next-build.err.log
cd /d "%ORCH%"
echo [%date% %time%] build start >> "%LOG%"
"C:\Program Files\nodejs\node.exe" "%ORCH%\node_modules\next\dist\bin\next" build >> "%LOG%" 2>> "%ERR%"
echo [%date% %time%] build end exit=%errorlevel% >> "%LOG%"
exit %errorlevel%
