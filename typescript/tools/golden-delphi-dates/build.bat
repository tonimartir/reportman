@echo off
rem Builds delphi-dates (Delphi, Win32, the RTL only): the format settings of each culture and
rem FormatDateTime of the date masks, the reference of the reports converted from Delphi
rem (packages\reportman-engine\test\generate-delphi-date-fixtures.mjs runs it).
setlocal

set DCC_ROOT=C:\Program Files (x86)\Embarcadero\Studio\37.0
set DCC32="%DCC_ROOT%\bin\dcc32.exe"

cd /d "%~dp0"
if not exist bin_x86 mkdir bin_x86
if not exist dcu_x86 mkdir dcu_x86

%DCC32% -B -CC -E.\bin_x86 -NU.\dcu_x86 -NSSystem;Winapi delphi-dates.dpr
if errorlevel 1 (
  echo BUILD FAILED
  exit /b 1
)
echo Build OK.
endlocal
