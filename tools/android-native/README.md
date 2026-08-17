# The PDF driver on Android — what travels in the APK and what the platform already has

`PrintOutPDFFreeType` needs FreeType, HarfBuzz, ICU (BiDi only) and fonts. Android has all
four inside the platform (Skia + FreeType + HarfBuzz + ICU behind `Canvas.drawText`), but the
linker namespaces do not let an app `dlopen` the private ones (`libft2.so`, `libharfbuzz_ng.so`).
So:

| Piece | On Android | Where it comes from |
|---|---|---|
| FreeType | **ours**, `Reportman.Drawing.CrossPlatform/native/android/<abi>/libfreetype.so` | `build-freetype.sh` (NDK r27c, FreeType 2.13.3, cmake, `-DFT_DISABLE_{ZLIB,BZIP2,PNG,HARFBUZZ,BROTLI}=ON`, `-Wl,-z,max-page-size=16384`, stripped; ~800 KB per ABI). FreeTypeSharp's own natives are not used: its linux-x64 (glibc) build leaks into the APK through the RID graph and its `.aar` ones are old, unstripped and 4 KB-paged. |
| HarfBuzz | HarfBuzzSharp's `libHarfBuzzSharp.so` (Android build) | NuGet, nothing to do |
| ICU | **the platform's**, through `libicu.so` (stable ICU4C C API, unversioned symbols, public to apps since API 31) | `Bidi.cs`: `IcuNative` binds `ubidi_*` by function pointer; icu.net is not used on Android (its platform detection throws on "Android (API level N)") |
| Fonts | `/system/fonts` (Roboto, Noto…) plus what the app adds through `FontInfoFt.ExtraFontDirectories` (ReportmanFiscal ships Liberation Sans) | no fontconfig: `SelectFontPorNombre` resolves metric aliases (Arial → Liberation Sans → Arimo → Roboto…) and the default sans is chosen by preference, not by directory order |
| Images | SkiaSharp's `libSkiaSharp.so` (Android build) | NuGet |

The alternative with no native at all is `PrintOutPDFStandard`: the 14 PDF standard fonts, nothing
embedded, WinAnsi — what the Delphi engine does on Android.

## Rebuilding libfreetype.so

```bash
# any Linux (WSL is fine); ~1 GB download for the NDK, a few minutes to build both ABIs
mkdir -p ~/ftbuild && cp tools/android-native/build-freetype.sh ~/ftbuild/
docker run --rm -v ~/ftbuild:/work ubuntu:24.04 bash /work/build-freetype.sh
# → ~/ftbuild/out/{arm64-v8a,x86_64}/libfreetype.so, then copy into native/android/<abi>/
```

## How an Android app gets the natives

Project outputs are not RID-resolved by the Android SDK, so an app that references
`Reportman.Drawing.CrossPlatform` as a **project** declares them itself and drops the package ones:

```xml
<PackageReference Include="FreeTypeSharp" Version="3.0.0" ExcludeAssets="native" />
<AndroidNativeLibrary Include="..\reportman\Reportman.Drawing.CrossPlatform\native\android\arm64-v8a\libfreetype.so" Abi="arm64-v8a" />
<AndroidNativeLibrary Include="..\reportman\Reportman.Drawing.CrossPlatform\native\android\x86_64\libfreetype.so" Abi="x86_64" />
```

(The `.aar` of FreeTypeSharp still contributes its copies; the build keeps the first and warns
XA4301 for the rest.) NuGet consumers get them as `runtimes/android-*/native`.
