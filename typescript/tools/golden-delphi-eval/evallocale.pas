unit evallocale;

{ The locale of golden-delphi-eval: the culture of the command line (its first parameter), set
  before the engine units are initialized, as a Delphi program running on a computer with that
  language: the messages of the engine (rpmdconsts) are read from the translation of the language
  of the thread when rpmdconsts is initialized. The first unit of the program, so its
  initialization runs before rpmdconsts'.

  What it can not set is the collation of AnsiCompareText and the case mapping of AnsiUpperCase,
  which are those of the user locale of Windows (LOCALE_USER_DEFAULT), whatever the thread. }

interface

implementation

uses
  Windows, SysUtils;

var
  Id: LCID;

initialization
  if ParamCount >= 1 then
  begin
    Id := LocaleNameToLCID(PChar(ParamStr(1)), 0);
    if Id <> 0 then
    begin
      SetThreadLocale(Id);
      SetThreadUILanguage(Id);
      FormatSettings := TFormatSettings.Create(ParamStr(1));
    end;
  end;
end.
