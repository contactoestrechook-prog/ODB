@echo off
rem ODB Pedidos (4/11/2026)
rem Abre el panel de ODB en una ventana de Chrome propia, para las PC con impresora:
rem  - la comanda de cada pedido nuevo sale derecho por la impresora predeterminada, sin preguntar;
rem  - la alarma del pedido suena aunque nadie haya tocado la pantalla.
rem La primera vez hay que entrar con el usuario y prender "Esta PC imprime las comandas" en Pedidos.
rem Para que se abra solo al prender la PC: Windows + R, escribir shell:startup y copiar este archivo ahi.

set "URL=https://sistema.odbpremiummarket.com.ar/pedidos"
set "PERFIL=%LOCALAPPDATA%\ODB-Pedidos"

set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" goto sinchrome

start "" "%CHROME%" --user-data-dir="%PERFIL%" --kiosk-printing --autoplay-policy=no-user-gesture-required --no-first-run --no-default-browser-check --start-maximized "%URL%"
exit /b

:sinchrome
echo No encontre Google Chrome en esta PC.
echo Instalalo desde google.com/chrome y volve a abrir este archivo.
pause
