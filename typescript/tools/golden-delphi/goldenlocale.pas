unit goldenlocale;

{ The locale of golden-delphi: en-US, whatever the language of the computer, before the engine
  units are initialized. The messages of the engine (rpmdconsts) are read from the translation
  resource of the language of the thread when rpmdconsts is initialized, and the drivers write
  some of them into the documents (an image they can not read); the date and number formats are
  those of the TypeScript engine by default. The first unit of the program, so its
  initialization runs before rpmdconsts'. }

interface

implementation

uses
  Windows, SysUtils;

const
  LCID_EN_US = $0409;

initialization
  SetThreadLocale(LCID_EN_US);
  SetThreadUILanguage(LCID_EN_US);
  FormatSettings := TFormatSettings.Create(LCID_EN_US);
end.
