@echo off
rem halugraph-client for cmd.exe and PowerShell: runs tools\cmd\halugraph-client (a python 3.8+ file)
rem with HALUGRAPH_PYTHON when set, else with the first of py -3, python, python3 that really runs: each
rem is probed first (`call` also returns from .bat shims), which skips the Microsoft Store stubs Windows
rem puts on the PATH. Git Bash (what Claude Code uses on Windows) runs tools/cmd/halugraph-client itself;
rem both take the same commands and give the same exit codes (127: no python found).
setlocal
set "HLG_SELF=%~dp0halugraph-client"
set "HLG_PROBE=import sys; sys.exit(0 if sys.version_info[:2] >= (3, 8) else 1)"
if defined HALUGRAPH_PYTHON goto custom
call py -3 -S -c "%HLG_PROBE%" <nul >nul 2>&1 && goto py3
call python -S -c "%HLG_PROBE%" <nul >nul 2>&1 && goto python
call python3 -S -c "%HLG_PROBE%" <nul >nul 2>&1 && goto python3
echo {"error": "no python 3.8 or newer found (tried py -3, python and python3)", "hint": "Ask the user to install Python 3.8+ (python.org; tick Add python.exe to PATH), or to set HALUGRAPH_PYTHON to a python executable."} 1>&2
exit /b 127
:custom
call "%HALUGRAPH_PYTHON%" -S -c "%HLG_PROBE%" <nul >nul 2>&1 || goto badcustom
"%HALUGRAPH_PYTHON%" "%HLG_SELF%" %*
exit /b %ERRORLEVEL%
:badcustom
echo {"error": "HALUGRAPH_PYTHON is set but does not run python 3.8 or newer", "hint": "Point HALUGRAPH_PYTHON at a python 3.8+ executable, or unset it to search py -3, python and python3."} 1>&2
exit /b 127
:py3
py -3 "%HLG_SELF%" %*
exit /b %ERRORLEVEL%
:python
python "%HLG_SELF%" %*
exit /b %ERRORLEVEL%
:python3
python3 "%HLG_SELF%" %*
exit /b %ERRORLEVEL%
