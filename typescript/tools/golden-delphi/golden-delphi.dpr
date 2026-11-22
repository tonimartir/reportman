program golden_delphi;

{ Reference outputs of the Delphi engine for the TypeScript port of its SVG and HTML drivers
  (@reportman/export, packages/reportman-export/test/generate-delphi-fixtures.mjs).

  Runs a report as printreptopdf -svg, -html and -htmlsingle do (PrintReportToMetafile: the PDF
  driver measures the text), keeps the first pages of the metafile and writes into <outdir>:

    meta.json            the metafile the drivers read: page size and color, the objects of each
                         page with their strings and the bytes of their images, so the TypeScript
                         drivers can be run on exactly the same metafile
    svg\<name>N.svg      ExportMetafileToSVG: one file per page, and the images it saves
    html\<name>N.html    ExportMetafileToHtml: one file per page, and the images it saves
    single\<name>.html   ExportMetafileToHtmlSingle: every page kept in one file, images inline

  The drivers write the file name they are given into the documents (the names of the images), so
  each export runs in its own folder with a relative name.

  Usage: golden-delphi <report.rep> <outdir> [-name NAME] [-pages N] [-caption TEXT]
    -name     base name of the files (the name of the report by default)
    -pages    the first N pages only (all of them by default); the report still runs to its end,
              so the page count texts are those of the whole report
    -caption  the caption the drivers write (<desc> of the SVG, <TITLE> of the HTML)

  Exit code 0 when every output was written. }

{$APPTYPE CONSOLE}

{$I rpconf.inc}

uses
  // First: en-US before the engine units read their messages
  goldenlocale in 'goldenlocale.pas',
  SysUtils,
  Classes,
  DateUtils,
  NetEncoding,
{$IFDEF MSWINDOWS}
  ActiveX,
{$IFDEF USEVARIANTS}
{$IFNDEF MIDASOUT}
  midaslib,
{$ENDIF}
{$ENDIF}
{$ENDIF}
  rptypes,
  rpmdconsts,
  rpmetafile,
  rpreport,
  rppdfdriver,
  rpsvgdriver,
  rphtmldriver;

var
  ReportFile, OutDir, BaseName, Caption: string;
  PageLimit: Integer;

procedure Fail(const AMessage: string);
begin
  raise Exception.Create(AMessage);
end;

// A JSON string: only ASCII is written, the rest as \u escapes of its UTF-16 code units
procedure AppendJsonString(sb: TStringBuilder; const S: string);
var
  i: Integer;
  c: Char;
begin
  sb.Append('"');
  for i := 1 to Length(S) do
  begin
    c := S[i];
    if c = '"' then
      sb.Append('\"')
    else if c = '\' then
      sb.Append('\\')
    else if (Ord(c) < 32) or (Ord(c) > 126) then
      sb.Append('\u' + LowerCase(IntToHex(Ord(c), 4)))
    else
      sb.Append(c);
  end;
  sb.Append('"');
end;

procedure AppendInt(sb: TStringBuilder; const AName: string; AValue: Int64);
begin
  sb.Append(',"').Append(AName).Append('":').Append(IntToStr(AValue));
end;

procedure AppendBool(sb: TStringBuilder; const AName: string; AValue: Boolean);
begin
  sb.Append(',"').Append(AName).Append('":');
  if AValue then
    sb.Append('true')
  else
    sb.Append('false');
end;

procedure AppendStr(sb: TStringBuilder; const AName, AValue: string);
begin
  sb.Append(',"').Append(AName).Append('":');
  AppendJsonString(sb, AValue);
end;

const
  TypeNames: array[TRpMetaObjectType] of string = ('text', 'draw', 'image', 'polygon', 'export');

procedure AppendObject(sb: TStringBuilder; page: TRpMetafilePage; const obj: TRpMetaObject);
var
  stream: TMemoryStream;
  bytes: TBytes;
  encoder: TBase64Encoding;
begin
  sb.Append('{"type":');
  AppendJsonString(sb, TypeNames[obj.Metatype]);
  AppendInt(sb, 'top', obj.Top);
  AppendInt(sb, 'left', obj.Left);
  AppendInt(sb, 'width', obj.Width);
  AppendInt(sb, 'height', obj.Height);
  if obj.AnnotationS > 0 then
    AppendStr(sb, 'annotation', page.GetAnnotation(obj));
  case obj.Metatype of
    rpMetaText:
      begin
        AppendStr(sb, 'text', page.GetText(obj));
        AppendStr(sb, 'wFontName', page.GetWFontName(obj));
        AppendStr(sb, 'lFontName', page.GetLFontName(obj));
        AppendInt(sb, 'fontSize', obj.FontSize);
        AppendInt(sb, 'fontRotation', obj.FontRotation);
        AppendInt(sb, 'fontStyle', obj.FontStyle);
        AppendInt(sb, 'type1Font', obj.Type1Font);
        AppendInt(sb, 'fontColor', obj.FontColor);
        AppendInt(sb, 'backColor', obj.BackColor);
        AppendBool(sb, 'transparent', obj.Transparent);
        AppendBool(sb, 'cutText', obj.CutText);
        AppendInt(sb, 'alignment', obj.Alignment);
        AppendBool(sb, 'wordWrap', obj.WordWrap);
        AppendBool(sb, 'rightToLeft', obj.RightToLeft);
        AppendInt(sb, 'printStep', Ord(obj.PrintStep));
        AppendBool(sb, 'isHtml', obj.IsHtml);
      end;
    rpMetaDraw:
      begin
        AppendInt(sb, 'drawStyle', obj.DrawStyle);
        AppendInt(sb, 'brushStyle', obj.BrushStyle);
        AppendInt(sb, 'brushColor', obj.BrushColor);
        AppendInt(sb, 'penStyle', obj.PenStyle);
        AppendInt(sb, 'penWidth', obj.PenWidth);
        AppendInt(sb, 'penColor', obj.PenColor);
      end;
    rpMetaImage:
      begin
        AppendInt(sb, 'copyMode', obj.CopyMode);
        AppendInt(sb, 'drawImageStyle', obj.DrawImageStyle);
        AppendInt(sb, 'dpiRes', obj.DPIres);
        AppendBool(sb, 'previewOnly', obj.PreviewOnly);
        AppendBool(sb, 'sharedImage', obj.SharedImage);
        stream := page.GetStream(obj);
        SetLength(bytes, stream.Size);
        if stream.Size > 0 then
          stream.ReadBuffer(bytes[0], stream.Size);
        encoder := TBase64Encoding.Create(0);
        try
          AppendStr(sb, 'data', encoder.EncodeBytesToString(bytes));
        finally
          encoder.Free;
        end;
      end;
  end;
  // The HTML driver reads the alignment of every object to know if it is a single line; in the
  // variant record of a shape or an image those bytes are past their fields
  if obj.Metatype <> rpMetaText then
    AppendInt(sb, 'rawAlignment', obj.Alignment);
  sb.Append('}');
end;

procedure WriteMetafileJson(report: TRpReport; totalPages: Integer; runTime: TDateTime;
  const AFileName: string);
var
  sb: TStringBuilder;
  meta: TRpMetafileReport;
  page: TRpMetafilePage;
  i, j: Integer;
  list: TStringList;
begin
  meta := report.Metafile;
  sb := TStringBuilder.Create;
  try
    sb.Append('{"customX":').Append(IntToStr(meta.CustomX));
    AppendInt(sb, 'customY', meta.CustomY);
    AppendInt(sb, 'backColor', meta.BackColor);
    AppendInt(sb, 'totalPages', totalPages);
    // The local time of the run and its offset from UTC, for the clock of TODAY and NOW
    AppendStr(sb, 'runTime', FormatDateTime('yyyy"-"mm"-"dd"T"hh":"nn":"ss', runTime));
    AppendInt(sb, 'runTimeOffsetMinutes', Round(
      (runTime - TTimeZone.Local.ToUniversalTime(runTime)) * MinsPerDay));
    sb.Append(',"pages":[');
    for i := 0 to meta.CurrentPageCount - 1 do
    begin
      page := meta.Pages[i];
      if i > 0 then
        sb.Append(',');
      sb.Append(sLineBreak).Append('{"objects":[');
      for j := 0 to page.ObjectCount - 1 do
      begin
        if j > 0 then
          sb.Append(',');
        sb.Append(sLineBreak);
        AppendObject(sb, page, page.Objects[j]);
      end;
      sb.Append(']}');
    end;
    sb.Append(']}').Append(sLineBreak);
    list := TStringList.Create;
    try
      list.Text := sb.ToString;
      // Pure ASCII: every other character is a \u escape
      list.WriteBOM := False;
      list.SaveToFile(AFileName, TEncoding.ASCII);
    finally
      list.Free;
    end;
  finally
    sb.Free;
  end;
end;

procedure ParseArguments;
var
  i: Integer;
  arg: string;
begin
  ReportFile := '';
  OutDir := '';
  BaseName := '';
  Caption := '';
  PageLimit := 0;
  i := 1;
  while i <= ParamCount do
  begin
    arg := ParamStr(i);
    if (arg = '-name') or (arg = '-pages') or (arg = '-caption') then
    begin
      if i = ParamCount then
        Fail('A value is expected after ' + arg);
      Inc(i);
      if arg = '-name' then
        BaseName := ParamStr(i)
      else if arg = '-pages' then
        PageLimit := StrToInt(ParamStr(i))
      else
        Caption := ParamStr(i);
    end
    else if ReportFile = '' then
      ReportFile := arg
    else if OutDir = '' then
      OutDir := arg
    else
      Fail('Too many arguments: ' + arg);
    Inc(i);
  end;
  if (ReportFile = '') or (OutDir = '') then
    Fail('Usage: golden-delphi <report.rep> <outdir> [-name NAME] [-pages N] [-caption TEXT]');
  ReportFile := ExpandFileName(ReportFile);
  OutDir := ExcludeTrailingPathDelimiter(ExpandFileName(OutDir));
  if BaseName = '' then
    BaseName := ChangeFileExt(ExtractFileName(ReportFile), '');
end;

// Runs an export in a folder of the output, with a relative file name
procedure InFolder(const AFolder: string);
var
  folder: string;
begin
  folder := OutDir + PathDelim + AFolder;
  if not ForceDirectories(folder) then
    Fail('The folder can not be created: ' + folder);
  if not SetCurrentDir(folder) then
    Fail('The folder can not be entered: ' + folder);
end;

procedure Run;
var
  report: TRpReport;
  totalPages: Integer;
  runTime: TDateTime;
begin
  ParseArguments;
  if not ForceDirectories(OutDir) then
    Fail('The folder can not be created: ' + OutDir);
  report := TRpReport.Create(nil);
  try
    report.LoadFromFile(ReportFile);
    runTime := Now;
    // As printreptopdf: every page, the parameters with their default values
    PrintReportToMetafile(report, '', False, True, 1, MAX_PAGECOUNT, 1, '', False);
    totalPages := report.Metafile.CurrentPageCount;
    if (PageLimit > 0) and (PageLimit < totalPages) then
      report.Metafile.PageRange(1, PageLimit);
    WriteMetafileJson(report, totalPages, runTime, OutDir + PathDelim + 'meta.json');
    InFolder('svg');
    ExportMetafileToSVG(report.Metafile, Caption, BaseName + '.svg', False, True, 1, MAX_PAGECOUNT);
    InFolder('html');
    ExportMetafileToHtml(report.Metafile, Caption, BaseName + '.html', False, True, 1, MAX_PAGECOUNT);
    InFolder('single');
    ExportMetafileToHtmlSingle(report.Metafile, Caption, BaseName + '.html');
    SetCurrentDir(OutDir);
    Writeln(BaseName, ': ', report.Metafile.CurrentPageCount, ' of ', totalPages, ' pages');
  finally
    report.Free;
  end;
end;

begin
  try
{$IFDEF MSWINDOWS}
    CoInitialize(nil);
{$ENDIF}
    Run;
  except
    on E: Exception do
    begin
      Writeln(ErrOutput, E.ClassName, ': ', E.Message);
      ExitCode := 1;
    end;
  end;
end.
