@echo off
setlocal
set "NODE_EXE=C:\Users\1\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
set "ROOT=%~dp0"
start "" /b "%NODE_EXE%" "%ROOT%server.js"
endlocal
