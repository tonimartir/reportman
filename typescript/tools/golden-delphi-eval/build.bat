@echo off
rem Builds golden-delphi-eval (Delphi, Win32): the results of the Delphi expression evaluator
rem (TRpEvaluator), the reference the C# and TypeScript evaluators are compared with
rem (compare.mjs runs it).
rem The engine units are those of the Delphi repository: REPORTMAN_DELPHI is its root,
rem C:\desarrollo\prog\toni\reportman by default.
setlocal

set DCC_ROOT=C:\Program Files (x86)\Embarcadero\Studio\37.0
set DCC32="%DCC_ROOT%\bin\dcc32.exe"
if "%REPORTMAN_DELPHI%"=="" set REPORTMAN_DELPHI=C:\desarrollo\prog\toni\reportman
set RPROOT=%REPORTMAN_DELPHI%
set NS=System;System.Win;Winapi;Vcl;Vcl.Imaging;Xml;Data;Data.Win;Datasnap;Datasnap.Win;Web;Soap;Bde

if not exist "%RPROOT%\rpeval.pas" (
  echo The Delphi engine is not in "%RPROOT%": set REPORTMAN_DELPHI to the root of its repository.
  exit /b 1
)

cd /d "%~dp0"
if not exist bin_x86 mkdir bin_x86
if not exist dcu_x86 mkdir dcu_x86

%DCC32% -B -CC -DUNICODE -E.\bin_x86 -NU.\dcu_x86 -U"%RPROOT%" -I"%RPROOT%" -R"%RPROOT%" -NS%NS% golden-delphi-eval.dpr
if errorlevel 1 (
  echo BUILD FAILED
  exit /b 1
)
echo Build OK.
endlocal
