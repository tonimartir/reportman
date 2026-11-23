program goldendelphieval;

(* The results of the Delphi expression evaluator (TRpEvaluator of rpeval.pas), the reference of
  the C# and TypeScript evaluators for the reports designed in Delphi.

    golden-delphi-eval CULTURE CASES.json OUT.json [--today yyyy-mm-dd] [--trace]

  CASES.json is the input of "golden-cs eval": an array of {"expr", "format"?}. Each case is
  evaluated by a new evaluator, with the format settings of CULTURE (en-US, es-ES...). OUT.json is
  an array with one line per case:

    ["Type", "text"]               the result: its Variant type and its value, written the same
                                   in every culture
    ["Type", "text", "formatted"]  with "format": FormatVariant of rptypes.pas, as an expression
                                   item of a report formats its value with its DisplayFormat
    ["Type", "text", null, "class: message"]  with "format", when FormatVariant fails
    ["!", "class", "message"]      the exception of the evaluation

  Types and texts:
    Null, Empty                    ""
    Boolean                        "True" or "False"
    Smallint, Integer, Int64...    the digits
    Double, Single                 17 significant digits, "." (NAN, INF, -INF)
    Currency                       as CurrToStr, "."
    DateTime                       yyyy-mm-ddThh:nn:ss.zzz
    String                         the text
    Bytes                          a Variant array of bytes: the bytes in hexadecimal
    Bcd                            a TBcd: as BcdToStr, "."
    TypeN                          another Variant type N: its text

  --today pins TODAY to a date (NOW is then that date at the time of the clock), to compare
  with fixtures generated another day. TIME is always the clock.
  --trace writes the number and the expression of each case before evaluating it, to find the
  one that never ends (OUT.json is only written at the end).

  Build with build.bat (Delphi, Win32). *)

{$APPTYPE CONSOLE}
{$I rpconf.inc}

uses
  evallocale,
  System.SysUtils, System.Variants, System.Classes, System.JSON,
  System.Generics.Collections,
  Data.FMTBcd,
  rptypes, rptypeval, rpeval;

type
  // TODAY and NOW of a pinned date
  TPinnedDate = class(TIdenConstant)
  private
    FDate: TDateTime;
    FWithTime: Boolean;
  protected
    function GetRpValue: TRpValue; override;
  end;

function TPinnedDate.GetRpValue: TRpValue;
begin
  if FWithTime then
    Result := TDateTime(FDate + Time)
  else
    Result := FDate;
end;

var
  Invariant: TFormatSettings;
  PinToday: Boolean = False;
  PinnedToday: TDateTime;
  Trace: Boolean = False;

function JsonText(const S: string): string;
var
  I: Integer;
  C: Char;
  B: TStringBuilder;
begin
  B := TStringBuilder.Create;
  try
    B.Append('"');
    for I := 1 to Length(S) do
    begin
      C := S[I];
      case C of
        '"': B.Append('\"');
        '\': B.Append('\\');
        #8: B.Append('\b');
        #9: B.Append('\t');
        #10: B.Append('\n');
        #12: B.Append('\f');
        #13: B.Append('\r');
      else
        // Control characters, the line separators, the surrogates and the BOM as \uXXXX
        if (Ord(C) < 32) or (Ord(C) = $2028) or (Ord(C) = $2029) or
          ((Ord(C) >= $D800) and (Ord(C) <= $DFFF)) or (Ord(C) >= $FEFF) then
          B.Append('\u' + IntToHex(Ord(C), 4))
        else
          B.Append(C);
      end;
    end;
    B.Append('"');
    Result := B.ToString;
  finally
    B.Free;
  end;
end;

function DoubleText(const D: Double): string;
begin
  Result := FloatToStrF(D, ffGeneral, 17, 0, Invariant);
end;

function BytesText(const V: Variant): string;
var
  I: Integer;
begin
  Result := '';
  if VarArrayDimCount(V) <> 1 then
    Exit('?');
  for I := VarArrayLowBound(V, 1) to VarArrayHighBound(V, 1) do
    Result := Result + IntToHex(Byte(V[I]), 2);
end;

procedure Describe(const V: Variant; out TypeName, Text: string);
var
  T: TVarType;
begin
  T := VarType(V);
  if (T and varArray) <> 0 then
  begin
    TypeName := 'Bytes';
    Text := BytesText(V);
    Exit;
  end;
  T := T and varTypeMask;
  case T of
    varNull: begin TypeName := 'Null'; Text := ''; end;
    varEmpty: begin TypeName := 'Empty'; Text := ''; end;
    varBoolean: begin TypeName := 'Boolean'; Text := BoolToStr(Boolean(V), True); end;
    varSmallint: begin TypeName := 'Smallint'; Text := VarToStr(V); end;
    varInteger: begin TypeName := 'Integer'; Text := VarToStr(V); end;
    varShortInt: begin TypeName := 'ShortInt'; Text := VarToStr(V); end;
    varByte: begin TypeName := 'Byte'; Text := VarToStr(V); end;
    varWord: begin TypeName := 'Word'; Text := VarToStr(V); end;
    varLongWord: begin TypeName := 'LongWord'; Text := VarToStr(V); end;
    varInt64: begin TypeName := 'Int64'; Text := VarToStr(V); end;
    varUInt64: begin TypeName := 'UInt64'; Text := VarToStr(V); end;
    varSingle: begin TypeName := 'Single'; Text := DoubleText(V); end;
    varDouble: begin TypeName := 'Double'; Text := DoubleText(V); end;
    varCurrency: begin TypeName := 'Currency'; Text := CurrToStr(V, Invariant); end;
    varDate:
      begin
        TypeName := 'DateTime';
        Text := FormatDateTime('yyyy-mm-dd"T"hh:nn:ss.zzz', VarToDateTime(V), Invariant);
      end;
    varString, varUString, varOleStr: begin TypeName := 'String'; Text := VarToStr(V); end;
  else
    if VarIsFMTBcd(V) then
    begin
      TypeName := 'Bcd';
      Text := BcdToStr(VarToBcd(V), Invariant);
    end
    else
    begin
      TypeName := 'Type' + IntToStr(T);
      Text := VarToStr(V);
    end;
  end;
end;

// The identifiers of the functions are shared by every evaluator (and not freed by them): the
// pinned ones replace TODAY and NOW in the table of this evaluator only
procedure ReplaceIdentifier(Eval: TRpEvaluator; const Name: string; Iden: TRpIdentifier);
{$IFNDEF USEEVALHASH}
var
  Index: Integer;
{$ENDIF}
begin
{$IFDEF USEEVALHASH}
  Eval.Identifiers.setValue(Name, Iden);
{$ELSE}
  Index := Eval.Identifiers.IndexOf(Name);
  if Index >= 0 then
    Eval.Identifiers.Objects[Index] := Iden
  else
    Eval.Identifiers.AddObject(Name, Iden);
{$ENDIF}
end;

function EvaluateCase(const Expr: string; HasFormat: Boolean; const Format: string): string;
var
  Eval: TRpEvaluator;
  V: Variant;
  TypeName, Text: string;
  Pinned: TPinnedDate;
begin
  Eval := TRpEvaluator.Create(nil);
  try
    try
      if PinToday then
      begin
        Pinned := TPinnedDate.Create(Eval);
        Pinned.FDate := PinnedToday;
        ReplaceIdentifier(Eval, 'TODAY', Pinned);
        Pinned := TPinnedDate.Create(Eval);
        Pinned.FDate := PinnedToday;
        Pinned.FWithTime := True;
        ReplaceIdentifier(Eval, 'NOW', Pinned);
      end;
      V := Eval.EvaluateText(Expr);
      Describe(V, TypeName, Text);
      Result := '[' + JsonText(TypeName) + ',' + JsonText(Text);
    except
      on E: Exception do
        Exit('["!",' + JsonText(E.ClassName) + ',' + JsonText(E.Message) + ']');
    end;
    if HasFormat then
      try
        Result := Result + ',' + JsonText(FormatVariant(Format, V, rpParamUnknown, True));
      except
        on E: Exception do
          Result := Result + ',null,' + JsonText(E.ClassName + ': ' + E.Message);
      end;
    Result := Result + ']';
  finally
    Eval.Free;
  end;
end;

var
  Cases: TJSONValue;
  Item: TJSONObject;
  FormatValue: TJSONValue;
  Output: TStringList;
  I: Integer;
  Line: string;
begin
  if ParamCount < 3 then
  begin
    Writeln('golden-delphi-eval CULTURE CASES.json OUT.json [--today yyyy-mm-dd]');
    Halt(2);
  end;
  Invariant := TFormatSettings.Invariant;
  for I := 4 to ParamCount do
    if (ParamStr(I) = '--today') and (I < ParamCount) then
    begin
      PinToday := True;
      PinnedToday := EncodeDate(StrToInt(Copy(ParamStr(I + 1), 1, 4)), StrToInt(Copy(ParamStr(I + 1), 6, 2)),
        StrToInt(Copy(ParamStr(I + 1), 9, 2)));
    end
    else if ParamStr(I) = '--trace' then
      Trace := True;
  // The floating point exceptions the program runs with decide what a division of doubles by
  // zero or an overflow gives ($1332, the default of Delphi, raises them; $133F masks them)
  if Trace then
    Writeln('8087CW=$', IntToHex(Get8087CW, 4));
  Output := TStringList.Create;
  try
    with TStringList.Create do
    try
      LoadFromFile(ParamStr(2), TEncoding.UTF8);
      Cases := TJSONObject.ParseJSONValue(Text, False, True);
    finally
      Free;
    end;
    try
      Output.Add('[');
      for I := 0 to TJSONArray(Cases).Count - 1 do
      begin
        Item := TJSONArray(Cases).Items[I] as TJSONObject;
        FormatValue := Item.Values['format'];
        if Trace then
        begin
          Writeln(I, ' ', string(UTF8Encode(Item.Values['expr'].Value)));
          Flush(System.Output);
        end;
        if FormatValue <> nil then
          Line := EvaluateCase(Item.Values['expr'].Value, True, FormatValue.Value)
        else
          Line := EvaluateCase(Item.Values['expr'].Value, False, '');
        if I < TJSONArray(Cases).Count - 1 then
          Line := Line + ',';
        Output.Add(Line);
      end;
      Output.Add(']');
    finally
      Cases.Free;
    end;
    Output.WriteBOM := False;
    Output.LineBreak := #10;
    Output.SaveToFile(ParamStr(3), TEncoding.UTF8);
  finally
    Output.Free;
  end;
end.
