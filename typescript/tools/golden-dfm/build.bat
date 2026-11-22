@echo off
rem Builds golden-dfm (Delphi, Win32): the reference DFM forms and XML of the Delphi engine
rem for @reportman/dfm (packages\reportman-dfm\test\generate-dfm-fixtures.mjs runs it).
rem The engine units are those of the Delphi repository: REPORTMAN_DELPHI is its root,
rem C:\desarrollo\prog\toni\reportman by default.
setlocal

set DCC_ROOT=C:\Program Files (x86)\Embarcadero\Studio\37.0
set DCC32="%DCC_ROOT%\bin\dcc32.exe"
if "%REPORTMAN_DELPHI%"=="" set REPORTMAN_DELPHI=C:\desarrollo\prog\toni\reportman
set RPROOT=%REPORTMAN_DELPHI%
set NS=System;System.Win;Winapi;Vcl;Vcl.Imaging;Xml;Data;Data.Win;Datasnap;Datasnap.Win;Web;Soap;Bde

if not exist "%RPROOT%\rpreport.pas" (
  echo The Delphi engine is not in "%RPROOT%": set REPORTMAN_DELPHI to the root of its repository.
  exit /b 1
)

cd /d "%~dp0"
if not exist bin_x86 mkdir bin_x86
if not exist dcu_x86 mkdir dcu_x86

%DCC32% -B -CC -DUNICODE -E.\bin_x86 -NU.\dcu_x86 -U"%RPROOT%" -I"%RPROOT%" -R"%RPROOT%" -NS%NS% golden-dfm.dpr
if errorlevel 1 (
  echo BUILD FAILED
  exit /b 1
)
echo Build OK.
endlocal
