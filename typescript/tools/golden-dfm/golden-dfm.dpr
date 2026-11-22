program golden_dfm;
{ Reference outputs of the Delphi engine for @reportman/dfm, the DFM to XML converter
  (packages\reportman-dfm\test\generate-dfm-fixtures.mjs runs it).
  Loads a report (XML or DFM, as the designer does) and writes it into <outdir> in the three DFM
  forms of TRpBaseReport.SaveToStream, then loads each of them again and saves it as XML, as
  reptotxt -xml does (StreamFormat rpStreamXML, SaveToStream):
    <name>.text.rep     rpStreamText: WriteComponent and ObjectBinaryToText
    <name>.binary.rep   rpStreamBinary: WriteComponent
    <name>.zlib.rep     rpStreamZLib: WriteComponent through a TCompressionStream
    <name>.xml          the XML of the report loaded from <name>.text.rep; the ones of the binary
                        and zlib forms must be the same bytes, or it fails
  The DFM forms are written directly, not through SaveToStream, which writes XML for a report
  with a .Net connection (forcexml).
  Usage: golden-dfm <report.rep> <outdir> <name>          one report
         golden-dfm -xml <dfm.rep> <out.xml>              the XML of a DFM file, as reptotxt -xml
         golden-dfm -textxml <dfm.rep> <out.xml>          the same through ObjectTextToBinary
         golden-dfm -floats <hex>...                      FloatToStr of doubles
         golden-dfm -upper <out.bin>                      AnsiUpperCase of every code unit
         golden-dfm -utf8 <hex>...                        TEncoding.UTF8.GetString of bytes
         golden-dfm -writestring <hex>...                 TWriter.WriteString, TReader.ReadString
  Exit code 0 when every output was written. }

{$APPTYPE CONSOLE}
{$I rpconf.inc}

uses
  // First: en-US before the engine units read their messages
  goldenlocale in '..\golden-delphi\goldenlocale.pas',
  SysUtils,
  Classes,
  zlib,
{$IFDEF MSWINDOWS}
{$IFDEF USEVARIANTS}
{$IFNDEF MIDASOUT}
  midaslib,
{$ENDIF}
{$ENDIF}
{$ENDIF}
  rptypes,
  rpreport;

procedure WriteBytes(const FileName: string; Stream: TMemoryStream);
begin
  Stream.Seek(0, soFromBeginning);
  Stream.SaveToFile(FileName);
end;

function XmlOf(const FileName: string): TMemoryStream;
var
  report: TRpReport;
begin
  Result := TMemoryStream.Create;
  report := TRpReport.Create(nil);
  try
    report.LoadFromFile(FileName);
    report.StreamFormat := rpStreamXML;
    report.SaveToStream(Result);
  finally
    report.Free;
  end;
end;

// The XML of a text DFM read by ObjectTextToBinary itself, without the first byte check of
// LoadFromStream (which takes only a text form that starts with "object"): what TParser makes of
// a text form with a UTF-8 BOM, for example
function XmlOfText(const FileName: string): TMemoryStream;
var
  text, binary: TMemoryStream;
  report: TRpReport;
begin
  Result := TMemoryStream.Create;
  text := TMemoryStream.Create;
  binary := TMemoryStream.Create;
  report := TRpReport.Create(nil);
  try
    text.LoadFromFile(FileName);
    ObjectTextToBinary(text, binary);
    binary.Seek(0, soFromBeginning);
    report.LoadFromStream(binary);
    report.StreamFormat := rpStreamXML;
    report.SaveToStream(Result);
  finally
    report.Free;
    binary.Free;
    text.Free;
  end;
end;

function SameBytes(A, B: TMemoryStream): Boolean;
begin
  Result := (A.Size = B.Size) and CompareMem(A.Memory, B.Memory, A.Size);
end;

procedure Convert(const Source, OutDir, Name: string);
var
  report: TRpReport;
  binary, text, zipped: TMemoryStream;
  zstream: TCompressionStream;
  xmltext, xmlbinary, xmlzlib: TMemoryStream;
  base: string;
begin
  base := IncludeTrailingPathDelimiter(OutDir) + Name;
  report := TRpReport.Create(nil);
  binary := TMemoryStream.Create;
  text := TMemoryStream.Create;
  zipped := TMemoryStream.Create;
  try
    report.LoadFromFile(Source);
    // What SaveToStream does before it writes any form
    report.Params.RestoreInitialValues;
    if report.SubReports.Count < 1 then
      report.AddSubReport;
    binary.WriteComponent(report);
    WriteBytes(base + '.binary.rep', binary);
    binary.Seek(0, soFromBeginning);
    ObjectBinaryToText(binary, text);
    WriteBytes(base + '.text.rep', text);
    zstream := TCompressionStream.Create(clDefault, zipped);
    try
      zstream.WriteComponent(report);
    finally
      zstream.Free;
    end;
    WriteBytes(base + '.zlib.rep', zipped);
  finally
    zipped.Free;
    text.Free;
    binary.Free;
    report.Free;
  end;
  xmltext := XmlOf(base + '.text.rep');
  xmlbinary := XmlOf(base + '.binary.rep');
  xmlzlib := XmlOf(base + '.zlib.rep');
  try
    if not SameBytes(xmltext, xmlbinary) then
      raise Exception.Create(Name + ': the XML of the binary form is not the one of the text form');
    if not SameBytes(xmltext, xmlzlib) then
      raise Exception.Create(Name + ': the XML of the zlib form is not the one of the text form');
    WriteBytes(base + '.xml', xmltext);
  finally
    xmlzlib.Free;
    xmlbinary.Free;
    xmltext.Free;
  end;
end;

// -floats <hex of a double>...: RpDoubleToStr of each double (FloatToStr with '.' as the decimal
// separator), one per line, for the doubles the XML writes (WritePropertyD)
procedure PrintFloats;
var
  i: Integer;
  bits: Int64;
  value: Double;
  fs: TFormatSettings;
begin
  fs := TFormatSettings.Create('en-US');
  fs.DecimalSeparator := '.';
  for i := 2 to ParamCount do
  begin
    bits := StrToInt64('$' + ParamStr(i));
    Move(bits, value, SizeOf(value));
    Writeln(FloatToStr(value, fs));
  end;
end;

// The UTF-16 code units of a string, 4 hexadecimal digits each
function UnitsHex(const S: string): string;
var
  i: Integer;
begin
  Result := '';
  for i := 1 to Length(S) do
    Result := Result + IntToHex(Ord(S[i]), 4);
end;

function HexUnits(const Hex: string): string;
var
  i: Integer;
begin
  SetLength(Result, Length(Hex) div 4);
  for i := 1 to Length(Result) do
    Result[i] := Char(StrToInt('$' + Copy(Hex, (i - 1) * 4 + 1, 4)));
end;

// -upper <out.bin>: AnsiUpperCase (CharUpperBuff) of each UTF-16 code unit, 65536 little endian
// words, the setters of Alias, DatabaseAlias, DataSource and the parameter names
procedure WriteUpper(const FileName: string);
var
  c: Integer;
  w: Word;
  s: string;
  stream: TFileStream;
begin
  stream := TFileStream.Create(FileName, fmCreate);
  try
    for c := 0 to $FFFF do
    begin
      s := AnsiUpperCase(string(Char(c)));
      w := Ord(s[1]);
      stream.WriteBuffer(w, SizeOf(w));
    end;
  finally
    stream.Free;
  end;
end;

// -utf8 <hex bytes>...: TEncoding.UTF8.GetString of each byte sequence (vaUTF8String, and the
// strings of a text DFM with a UTF-8 BOM), the code units one line each, or ERROR when it raises
procedure PrintUtf8;
var
  i, j: Integer;
  hex: string;
  bytes: TBytes;
begin
  for i := 2 to ParamCount do
  begin
    hex := ParamStr(i);
    SetLength(bytes, Length(hex) div 2);
    for j := 0 to High(bytes) do
      bytes[j] := StrToInt('$' + Copy(hex, j * 2 + 1, 2));
    try
      Writeln(UnitsHex(TEncoding.UTF8.GetString(bytes)));
    except
      on EEncodingError do
        Writeln('ERROR');
    end;
  end;
end;

// -writestring <hex code units>...: TWriter.WriteString and TReader.ReadString, the round trip
// of every string of a text DFM in ObjectTextToBinary: the value type written and the code
// units read back, one line each
procedure PrintWriteString;
var
  i: Integer;
  stream: TMemoryStream;
  writer: TWriter;
  reader: TReader;
  back: string;
  tag: Byte;
begin
  for i := 2 to ParamCount do
  begin
    stream := TMemoryStream.Create;
    try
      writer := TWriter.Create(stream, 4096);
      try
        writer.WriteString(HexUnits(ParamStr(i)));
      finally
        writer.Free;
      end;
      tag := PByte(stream.Memory)^;
      stream.Seek(0, soFromBeginning);
      reader := TReader.Create(stream, 4096);
      try
        back := reader.ReadString;
      finally
        reader.Free;
      end;
    finally
      stream.Free;
    end;
    Writeln(IntToStr(tag) + ' ' + UnitsHex(back));
  end;
end;

var
  xml: TMemoryStream;
begin
  try
    if (ParamCount = 2) and (ParamStr(1) = '-upper') then
      WriteUpper(ParamStr(2))
    else
    if (ParamCount >= 2) and (ParamStr(1) = '-utf8') then
      PrintUtf8
    else
    if (ParamCount >= 2) and (ParamStr(1) = '-writestring') then
      PrintWriteString
    else
    if (ParamCount = 3) and (ParamStr(1) = '-xml') then
    begin
      xml := XmlOf(ParamStr(2));
      try
        WriteBytes(ParamStr(3), xml);
      finally
        xml.Free;
      end;
    end
    else
    if (ParamCount = 3) and (ParamStr(1) = '-textxml') then
    begin
      xml := XmlOfText(ParamStr(2));
      try
        WriteBytes(ParamStr(3), xml);
      finally
        xml.Free;
      end;
    end
    else
    if (ParamCount >= 2) and (ParamStr(1) = '-floats') then
      PrintFloats
    else
    if ParamCount = 3 then
      Convert(ParamStr(1), ParamStr(2), ParamStr(3))
    else
    begin
      Writeln('Usage: golden-dfm <report.rep> <outdir> <name> | golden-dfm -xml <dfm.rep> <out.xml>');
      ExitCode := 2;
    end;
  except
    on E: Exception do
    begin
      Writeln(ErrOutput, E.Message);
      ExitCode := 1;
    end;
  end;
end.
