@echo off
REM Starts Rehber in production mode: database, Redis, API and website, all in Docker.
REM They restart by themselves whenever Docker Desktop starts, so you rarely need this file.
cd /d "%~dp0"
set DOCKER=docker
where docker >NUL 2>NUL || set DOCKER="D:\Docker\Program\resources\bin\docker.exe"
%DOCKER% compose --profile prod up -d --build
echo.
echo Rehber is starting. In about a minute open your public address (see PUBLIC_URL in .env).
pause
