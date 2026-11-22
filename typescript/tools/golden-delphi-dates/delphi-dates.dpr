program delphidates;

(* The reference of the date masks of Delphi for the C# and TypeScript engines: a report converted
  from Delphi formats its dates as the Delphi engine does, with FormatDateTime of the RTL and the
  format settings of the locale (rptypes FormatVariant, FORMATSTR of rpevalfunc).

    delphi-dates settings OUT.json CULTURE...
      The TFormatSettings of each culture as TFormatSettings.Create gives it on Windows ('' is
      TFormatSettings.Invariant), and the era name of its calendar (GetDateFormat 'gg', which
      FormatDateTime asks for the g mask).

    delphi-dates format CASES.json OUT.json
      FormatDateTime of each case, {"culture", "mask", "value"} (value: the TDateTime, a double),
      with the format settings and the thread locale of its culture, as a Delphi program running
      with that locale: an array of strings.

  Build with build.bat (Delphi, Win32; the RTL only). *)

{$APPTYPE CONSOLE}

uses
  Winapi.Windows, System.SysUtils, System.Classes, System.IOUtils, System.JSON,
  System.Generics.Collections;

const
  LOCALE_INVARIANT_ID = $007F;

function SettingsOf(const Culture: string): TFormatSettings;
begin
  if Culture = '' then
    Result := TFormatSettings.Invariant
  else
    Result := TFormatSettings.Create(Culture);
end;

function LocaleIdOf(const Culture: string): LCID;
begin
  if Culture = '' then
    Result := LOCALE_INVARIANT_ID
  else
    Result := LocaleNameToLCID(PChar(Culture), 0);
end;

function EraName(const Culture: string): string;
var
  st: TSystemTime;
  buf: array[0..255] of Char;
begin
  FillChar(st, SizeOf(st), 0);
  st.wYear := 2026;
  st.wMonth := 1;
  st.wDay := 1;
  if GetDateFormatEx(PChar(Culture), DATE_USE_ALT_CALENDAR, @st, 'gg', buf, Length(buf), nil) > 0 then
    Result := buf
  else
    Result := '';
end;

function Names(const A: array of string): TJSONArray;
var
  s: string;
begin
  Result := TJSONArray.Create;
  for s in A do
    Result.Add(s);
end;

function CharText(C: Char): string;
begin
  if C = #0 then
    Result := ''
  else
    Result := C;
end;

procedure WriteUtf8(const FileName, Text: string);
begin
  TFile.WriteAllBytes(FileName, TEncoding.UTF8.GetBytes(Text));
end;

procedure Settings;
var
  root, one: TJSONObject;
  fs: TFormatSettings;
  i: Integer;
  culture: string;
begin
  root := TJSONObject.Create;
  try
    for i := 3 to ParamCount do
    begin
      culture := ParamStr(i);
      if culture = '-' then
        culture := '';
      fs := SettingsOf(culture);
      one := TJSONObject.Create;
      one.AddPair('shortDateFormat', fs.ShortDateFormat);
      one.AddPair('longDateFormat', fs.LongDateFormat);
      one.AddPair('shortTimeFormat', fs.ShortTimeFormat);
      one.AddPair('longTimeFormat', fs.LongTimeFormat);
      one.AddPair('timeAMString', fs.TimeAMString);
      one.AddPair('timePMString', fs.TimePMString);
      one.AddPair('dateSeparator', CharText(fs.DateSeparator));
      one.AddPair('timeSeparator', CharText(fs.TimeSeparator));
      one.AddPair('shortMonthNames', Names(fs.ShortMonthNames));
      one.AddPair('longMonthNames', Names(fs.LongMonthNames));
      one.AddPair('shortDayNames', Names(fs.ShortDayNames));
      one.AddPair('longDayNames', Names(fs.LongDayNames));
      one.AddPair('eraName', EraName(culture));
      root.AddPair(culture, one);
    end;
    WriteUtf8(ParamStr(2), root.ToJSON);
  finally
    root.Free;
  end;
end;

procedure Format;
var
  cases: TJSONArray;
  results: TJSONArray;
  item: TJSONValue;
  c: TJSONObject;
  culture, mask: string;
  value: Double;
  cache: TDictionary<string, TFormatSettings>;
  fs: TFormatSettings;
begin
  cases := TJSONObject.ParseJSONValue(TFile.ReadAllText(ParamStr(2), TEncoding.UTF8)) as TJSONArray;
  results := TJSONArray.Create;
  cache := TDictionary<string, TFormatSettings>.Create;
  try
    for item in cases do
    begin
      c := item as TJSONObject;
      culture := c.GetValue<string>('culture');
      if not cache.TryGetValue(culture, fs) then
      begin
        fs := SettingsOf(culture);
        cache.Add(culture, fs);
      end;
      // The era of the g mask comes from the locale of the thread, as in a program of that locale
      SetThreadLocale(LocaleIdOf(culture));
      mask := c.GetValue<string>('mask');
      value := c.GetValue<Double>('value');
      results.Add(System.SysUtils.FormatDateTime(mask, value, fs));
    end;
    WriteUtf8(ParamStr(3), results.ToJSON);
  finally
    cache.Free;
    results.Free;
    cases.Free;
  end;
end;

begin
  try
    if (ParamCount >= 2) and (ParamStr(1) = 'settings') then
      Settings
    else if (ParamCount = 3) and (ParamStr(1) = 'format') then
      Format
    else
    begin
      Writeln(ErrOutput, 'usage: delphi-dates settings OUT.json CULTURE... | delphi-dates format CASES.json OUT.json');
      ExitCode := 2;
    end;
  except
    on E: Exception do
    begin
      Writeln(ErrOutput, E.ClassName, ': ', E.Message);
      ExitCode := 1;
    end;
  end;
end.
