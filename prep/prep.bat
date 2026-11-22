@echo off
rem Prep a song for the pitch game. Double-click, or: prep.bat <youtube-url | audio-file>
set "PSG_TOOLS=%USERPROFILE%\PitchScoreGameTools"
set "UV_PYTHON_INSTALL_DIR=%PSG_TOOLS%\python"
set "UV_PROJECT_ENVIRONMENT=%PSG_TOOLS%\venv"
set "UV_CACHE_DIR=%PSG_TOOLS%\uv-cache"
set "PATH=%PSG_TOOLS%\bin;%PSG_TOOLS%\venv\Scripts;%PATH%"
"%PSG_TOOLS%\bin\uv.exe" run --frozen --project "%~dp0." python "%~dp0prep.py" %*
echo.
pause
