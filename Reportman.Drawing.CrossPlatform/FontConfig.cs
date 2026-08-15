#region Copyright
/*
 *  Report Manager:  Database Reporting tool for .Net and Mono
 *
 *     The contents of this file are subject to the MPL License
 *     with optional use of GPL or LGPL licenses.
 *     You may not use this file except in compliance with the
 *     Licenses. You may obtain copies of the Licenses at:
 *     http://reportman.sourceforge.net/license
 *
 *     Software is distributed on an "AS IS" basis,
 *     WITHOUT WARRANTY OF ANY KIND, either
 *     express or implied.  See the License for the specific
 *     language  rights and limitations.
 *
 *  Copyright (c) 1994 - 2008 Toni Martir (toni@reportman.es)
 *  All Rights Reserved.
*/
#endregion

using System;
using System.Runtime.InteropServices;
using System.Text;

namespace Reportman.Drawing
{
    /// <summary>
    /// Late-bound binding to the system fontconfig library, the C# counterpart of the Delphi
    /// unit rpfontconfig.pas.
    ///
    /// Fontconfig is the font database every desktop Unix already maintains: it knows where the
    /// fonts are, and it knows the substitution rules, including the metric aliases that map
    /// Arial to Liberation Sans, Helvetica to Nimbus Sans and Times New Roman to Liberation
    /// Serif. Asking it is the difference between a report that keeps its layout on Linux and
    /// one that falls back to whatever font happened to be first in a directory listing.
    ///
    /// The library is loaded by name at run time and every symbol is resolved individually, so
    /// a machine without fontconfig (Windows, Android, a stripped container) simply reports
    /// <see cref="Available"/> false and the caller falls back to scanning directories. Nothing
    /// here ever throws.
    /// </summary>
    public static class FontConfig
    {
        // Object names of the fontconfig properties used here (see fontconfig.h).
        private const string FC_FAMILY = "family";
        private const string FC_FILE = "file";
        private const string FC_INDEX = "index";
        private const string FC_WEIGHT = "weight";
        private const string FC_SLANT = "slant";
        private const string FC_SCALABLE = "scalable";
        private const string FC_EMBEDDEDBITMAP = "embeddedbitmap";
        private const string FC_VARIABLE = "variable";
        private const string FC_FONTVARIATIONS = "fontvariations";
        private const string FC_CHARSET = "charset";
        private const string FC_FONTFORMAT = "fontformat";

        private const int FC_WEIGHT_NORMAL = 80;
        private const int FC_WEIGHT_BOLD = 200;
        private const int FC_SLANT_ROMAN = 0;
        private const int FC_SLANT_ITALIC = 100;
        private const int FC_MATCH_PATTERN = 0;
        private const int FcResultMatch = 0;
        private const int FcTrue = 1;
        private const int FcFalse = 0;

        /// <summary>Library file names tried in order; the first one that loads wins.</summary>
        private static readonly string[] LibraryNames =
        {
            "libfontconfig.so.1",
            "libfontconfig.so",
            "libfontconfig.1.dylib",
            "libfontconfig.dylib"
        };

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate int FcInitDelegate();
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate IntPtr FcConfigGetCurrentDelegate();
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate IntPtr FcPatternCreateDelegate();
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate void FcPatternDestroyDelegate(IntPtr pattern);
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate IntPtr FcFontMatchDelegate(IntPtr config, IntPtr pattern, out int result);
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate int FcPatternGetStringDelegate(IntPtr pattern, IntPtr objectName, int n, out IntPtr value);
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate int FcPatternGetIntegerDelegate(IntPtr pattern, IntPtr objectName, int n, out int value);
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate int FcPatternAddStringDelegate(IntPtr pattern, IntPtr objectName, IntPtr value);
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate int FcPatternAddIntegerDelegate(IntPtr pattern, IntPtr objectName, int value);
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate int FcPatternAddBoolDelegate(IntPtr pattern, IntPtr objectName, int value);
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate void FcDefaultSubstituteDelegate(IntPtr pattern);
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate int FcConfigSubstituteDelegate(IntPtr config, IntPtr pattern, int kind);
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate IntPtr FcCharSetCreateDelegate();
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate void FcCharSetDestroyDelegate(IntPtr charset);
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate int FcCharSetAddCharDelegate(IntPtr charset, uint ucs4);
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate int FcPatternAddCharSetDelegate(IntPtr pattern, IntPtr objectName, IntPtr charset);

        private static FcInitDelegate FcInit;
        private static FcConfigGetCurrentDelegate FcConfigGetCurrent;
        private static FcPatternCreateDelegate FcPatternCreate;
        private static FcPatternDestroyDelegate FcPatternDestroy;
        private static FcFontMatchDelegate FcFontMatch;
        private static FcPatternGetStringDelegate FcPatternGetString;
        private static FcPatternGetIntegerDelegate FcPatternGetInteger;
        private static FcPatternAddStringDelegate FcPatternAddString;
        private static FcPatternAddIntegerDelegate FcPatternAddInteger;
        private static FcPatternAddBoolDelegate FcPatternAddBool;
        private static FcDefaultSubstituteDelegate FcDefaultSubstitute;
        private static FcConfigSubstituteDelegate FcConfigSubstitute;
        private static FcCharSetCreateDelegate FcCharSetCreate;
        private static FcCharSetDestroyDelegate FcCharSetDestroy;
        private static FcCharSetAddCharDelegate FcCharSetAddChar;
        private static FcPatternAddCharSetDelegate FcPatternAddCharSet;

        // Property names are passed as const char* on every call. They are allocated once and
        // never released: there is a handful of them and they live as long as the process.
        private static IntPtr ObjFamily, ObjFile, ObjIndex, ObjWeight, ObjSlant, ObjScalable,
            ObjEmbeddedBitmap, ObjVariable, ObjFontVariations, ObjCharSet, ObjFontFormat;

        private static readonly object InitLock = new object();
        private static bool initialized;
        private static IntPtr library;

        /// <summary>True when the fontconfig library was found, bound and initialized correctly.</summary>
        public static bool Available { get; private set; }

        /// <summary>Name of the shared library that was loaded, empty when none was.</summary>
        public static string LibraryName { get; private set; }

        /// <summary>
        /// Loads and initializes fontconfig once per process. Safe to call from anywhere and as
        /// often as wanted: it never throws and it never retries a failed load.
        /// </summary>
        public static void Init()
        {
            lock (InitLock)
            {
                if (initialized)
                    return;
                initialized = true;
                LibraryName = "";
                try
                {
                    Available = Bind();
                }
                catch
                {
                    Available = false;
                }
                if (!Available)
                {
                    library = IntPtr.Zero;
                    LibraryName = "";
                }
            }
        }

        /// <summary>
        /// Asks fontconfig for the font file that best matches a family, a style and, optionally,
        /// the text that must be representable with it.
        /// </summary>
        /// <param name="family">Font family requested; an empty string asks for the system default,
        /// which is how the caller retries when the requested family yielded nothing usable.</param>
        /// <param name="bold">True to ask for a bold weight.</param>
        /// <param name="italic">True to ask for an italic slant.</param>
        /// <param name="content">Text whose characters the font must cover; empty to ignore coverage.
        /// This is what makes fontconfig fall back to a font that carries the script at hand.</param>
        /// <param name="fileName">Receives the full path of the matched font file.</param>
        /// <param name="faceIndex">Receives the face index inside that file.</param>
        /// <returns>True when a font file was matched.</returns>
        public static bool Match(string family, bool bold, bool italic, string content,
            out string fileName, out int faceIndex)
        {
            fileName = "";
            faceIndex = 0;
            if (!Available)
                return false;
            IntPtr pattern = CreatePattern(family, bold, italic, content);
            if (pattern == IntPtr.Zero)
                return false;
            IntPtr match = IntPtr.Zero;
            try
            {
                IntPtr config = FcConfigGetCurrent();
                // Order matters and it is the one the fontconfig manual prescribes: the
                // configuration rules first -that is where the metric aliases live, the ones that
                // turn Arial into Liberation Sans- and only then the defaults for whatever the
                // pattern still leaves unsaid.
                FcConfigSubstitute(config, pattern, FC_MATCH_PATTERN);
                FcDefaultSubstitute(pattern);
                int result;
                match = FcFontMatch(config, pattern, out result);
                if (match == IntPtr.Zero)
                    return false;
                IntPtr filePtr;
                if (FcPatternGetString(match, ObjFile, 0, out filePtr) != FcResultMatch)
                    return false;
                if (filePtr == IntPtr.Zero)
                    return false;
                // The string belongs to the match pattern, so it is copied before that is destroyed.
                fileName = Utf8ToString(filePtr);
                if (FcPatternGetInteger != null)
                {
                    int index;
                    if (FcPatternGetInteger(match, ObjIndex, 0, out index) == FcResultMatch)
                        faceIndex = index;
                }
                return fileName.Length > 0;
            }
            catch
            {
                fileName = "";
                faceIndex = 0;
                return false;
            }
            finally
            {
                if (match != IntPtr.Zero)
                    FcPatternDestroy(match);
                FcPatternDestroy(pattern);
            }
        }

        private static IntPtr CreatePattern(string family, bool bold, bool italic, string content)
        {
            IntPtr pattern = FcPatternCreate();
            if (pattern == IntPtr.Zero)
                return IntPtr.Zero;
            try
            {
                FcPatternAddInteger(pattern, ObjWeight, bold ? FC_WEIGHT_BOLD : FC_WEIGHT_NORMAL);
                FcPatternAddInteger(pattern, ObjSlant, italic ? FC_SLANT_ITALIC : FC_SLANT_ROMAN);
                if (FcPatternAddBool != null)
                {
                    // Bitmap fonts have no outlines to embed in a PDF, and variable fonts would
                    // hand back a file whose default instance is not the weight that was asked for.
                    FcPatternAddBool(pattern, ObjScalable, FcTrue);
                    FcPatternAddBool(pattern, ObjEmbeddedBitmap, FcFalse);
                    FcPatternAddBool(pattern, ObjVariable, FcFalse);
                }
                AddString(pattern, ObjFontVariations, "");
                // A preference, not a filter -fontconfig scores, it does not exclude-, and it sits
                // far below the family in that scoring, so it only breaks ties: among the fonts
                // that answer for this family, the plain TrueType one first. It is the only kind
                // this engine can subset into a PDF; the caller checks the answer anyway.
                AddString(pattern, ObjFontFormat, "TrueType");
                if (!string.IsNullOrEmpty(family))
                    AddString(pattern, ObjFamily, family);
                if (!string.IsNullOrEmpty(content) && FcCharSetCreate != null
                    && FcCharSetAddChar != null && FcPatternAddCharSet != null
                    && FcCharSetDestroy != null)
                {
                    IntPtr charset = FcCharSetCreate();
                    if (charset != IntPtr.Zero)
                    {
                        try
                        {
                            for (int i = 0; i < content.Length; i++)
                            {
                                uint codepoint;
                                if (char.IsHighSurrogate(content[i]) && i + 1 < content.Length
                                    && char.IsLowSurrogate(content[i + 1]))
                                {
                                    codepoint = (uint)char.ConvertToUtf32(content[i], content[i + 1]);
                                    i++;
                                }
                                else
                                    codepoint = content[i];
                                FcCharSetAddChar(charset, codepoint);
                            }
                            // The pattern keeps its own copy of the set.
                            FcPatternAddCharSet(pattern, ObjCharSet, charset);
                        }
                        finally
                        {
                            FcCharSetDestroy(charset);
                        }
                    }
                }
                return pattern;
            }
            catch
            {
                FcPatternDestroy(pattern);
                return IntPtr.Zero;
            }
        }

        private static void AddString(IntPtr pattern, IntPtr objectName, string value)
        {
            if (FcPatternAddString == null)
                return;
            IntPtr native = Utf8ToNative(value);
            try
            {
                // fontconfig duplicates the string, so the buffer can go as soon as the call returns.
                FcPatternAddString(pattern, objectName, native);
            }
            finally
            {
                Marshal.FreeHGlobal(native);
            }
        }

        private static bool Bind()
        {
            IntPtr handle = IntPtr.Zero;
            string loaded = "";
            foreach (string name in LibraryNames)
            {
                if (TryLoad(name, out handle) && handle != IntPtr.Zero)
                {
                    loaded = name;
                    break;
                }
            }
            if (handle == IntPtr.Zero)
                return false;
            library = handle;
            LibraryName = loaded;

            FcInit = Bind<FcInitDelegate>("FcInit");
            FcConfigGetCurrent = Bind<FcConfigGetCurrentDelegate>("FcConfigGetCurrent");
            FcPatternCreate = Bind<FcPatternCreateDelegate>("FcPatternCreate");
            FcPatternDestroy = Bind<FcPatternDestroyDelegate>("FcPatternDestroy");
            FcFontMatch = Bind<FcFontMatchDelegate>("FcFontMatch");
            FcPatternGetString = Bind<FcPatternGetStringDelegate>("FcPatternGetString");
            FcPatternGetInteger = Bind<FcPatternGetIntegerDelegate>("FcPatternGetInteger");
            FcPatternAddString = Bind<FcPatternAddStringDelegate>("FcPatternAddString");
            FcPatternAddInteger = Bind<FcPatternAddIntegerDelegate>("FcPatternAddInteger");
            FcPatternAddBool = Bind<FcPatternAddBoolDelegate>("FcPatternAddBool");
            FcDefaultSubstitute = Bind<FcDefaultSubstituteDelegate>("FcDefaultSubstitute");
            FcConfigSubstitute = Bind<FcConfigSubstituteDelegate>("FcConfigSubstitute");
            FcCharSetCreate = Bind<FcCharSetCreateDelegate>("FcCharSetCreate");
            FcCharSetDestroy = Bind<FcCharSetDestroyDelegate>("FcCharSetDestroy");
            FcCharSetAddChar = Bind<FcCharSetAddCharDelegate>("FcCharSetAddChar");
            FcPatternAddCharSet = Bind<FcPatternAddCharSetDelegate>("FcPatternAddCharSet");

            // Everything the matching path calls unconditionally has to be there; the rest
            // degrades gracefully.
            if (FcInit == null || FcConfigGetCurrent == null || FcPatternCreate == null
                || FcPatternDestroy == null || FcFontMatch == null || FcPatternGetString == null
                || FcPatternAddString == null || FcPatternAddInteger == null
                || FcDefaultSubstitute == null || FcConfigSubstitute == null)
                return false;

            ObjFamily = Utf8ToNative(FC_FAMILY);
            ObjFile = Utf8ToNative(FC_FILE);
            ObjIndex = Utf8ToNative(FC_INDEX);
            ObjWeight = Utf8ToNative(FC_WEIGHT);
            ObjSlant = Utf8ToNative(FC_SLANT);
            ObjScalable = Utf8ToNative(FC_SCALABLE);
            ObjEmbeddedBitmap = Utf8ToNative(FC_EMBEDDEDBITMAP);
            ObjVariable = Utf8ToNative(FC_VARIABLE);
            ObjFontVariations = Utf8ToNative(FC_FONTVARIATIONS);
            ObjCharSet = Utf8ToNative(FC_CHARSET);
            ObjFontFormat = Utf8ToNative(FC_FONTFORMAT);

            return FcInit() != 0;
        }

        private static T Bind<T>(string name) where T : class
        {
            IntPtr address = TryGetExport(library, name);
            if (address == IntPtr.Zero)
                return null;
            return (T)(object)Marshal.GetDelegateForFunctionPointer(address, typeof(T));
        }

        private static IntPtr Utf8ToNative(string value)
        {
            byte[] bytes = Encoding.UTF8.GetBytes(value);
            IntPtr native = Marshal.AllocHGlobal(bytes.Length + 1);
            Marshal.Copy(bytes, 0, native, bytes.Length);
            Marshal.WriteByte(native, bytes.Length, 0);
            return native;
        }

        private static string Utf8ToString(IntPtr native)
        {
            int length = 0;
            while (Marshal.ReadByte(native, length) != 0)
                length++;
            if (length == 0)
                return "";
            byte[] bytes = new byte[length];
            Marshal.Copy(native, bytes, 0, length);
            return Encoding.UTF8.GetString(bytes);
        }

#if NETFRAMEWORK
        // .NET Framework only ever runs on Windows, where there is no fontconfig to load.
        private static bool TryLoad(string name, out IntPtr handle)
        {
            handle = IntPtr.Zero;
            return false;
        }

        private static IntPtr TryGetExport(IntPtr lib, string name)
        {
            return IntPtr.Zero;
        }
#else
        private static bool TryLoad(string name, out IntPtr handle)
        {
            return NativeLibrary.TryLoad(name, out handle);
        }

        private static IntPtr TryGetExport(IntPtr lib, string name)
        {
            IntPtr address;
            if (NativeLibrary.TryGetExport(lib, name, out address))
                return address;
            return IntPtr.Zero;
        }
#endif
    }
}
