using System;
using System.Collections.Generic;
using System.Threading;
using System.Drawing;
#if CROSSPF
#else
using System.Drawing.Imaging;
#endif
using System.Globalization;
using System.Collections;
using System.ComponentModel;
using System.Linq;


namespace Reportman.Drawing
{
    public class GraphicUtils
    {
        public static object flag = 2;
        public static int DefaultDPI = 96;
#if CROSSPF
        public static SortedList<string, Color> ColorNames;

#else
        public static SortedList<string, KnownColor> ColorNames;
#endif


        public static bool FontStyleIsBold(int intfontstyle)
        {
            if ((intfontstyle & 1) > 0)
                return true;
            else
                return false;
        }
        public static bool FontStyleIsItalic(int intfontstyle)
        {
            if ((intfontstyle & 2) > 0)
                return true;
            else
                return false;
        }
        public static bool FontStyleIsUnderline(int intfontstyle)
        {
            if ((intfontstyle & 4) > 0)
                return true;
            else
                return false;
        }
        public static bool FontStyleIsStrikeOut(int intfontstyle)
        {
            if ((intfontstyle & 8) > 0)
                return true;
            else
                return false;
        }

        private static void UpdateColorNames()
        {
            Monitor.Enter(flag);
            try
            {
                if (ColorNames == null)
                {
#if CROSSPF
                    ColorNames = new SortedList<string, Color>();
                    /*var typeToCheckTo = typeof(Color);
                    var type = typeof(SystemColors);
                    var fields = type.GetProperties(System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.Public).Where(p => p.PropertyType.Equals(typeToCheckTo));
                    foreach (var field in fields)
                    {
                        object value = field.GetValue(null, null);
                        ColorNames.Add(field.Name, (Color)value);
                   }*/
#else
                    ColorNames = new SortedList<string, KnownColor>();
                    KnownColor ncolor = KnownColor.ActiveBorder;
                    string[] names = Enum.GetNames(ncolor.GetType());
                    KnownColor[] values = (KnownColor[])Enum.GetValues(ncolor.GetType());
                    int i = 0;
                    foreach (string s in names)
                    {
                        ColorNames.Add(s, values[i]);
                        i++;
                    }
#endif
                }
            }
            finally
            {
                Monitor.Exit(flag);
            }
        }

        /// <summary>
        /// Create a Color based on a 32 bit integer
        /// </summary>
        /// <param name="aint">Integer color value in the form of $00BBGGRR</param>
        /// <returns>Returs a Color usable in any System.Drawing function</returns>
        public static Color ColorFromInteger(int aint)
        {
            UpdateColorNames();
            if ((aint >= 0) || (aint < -ColorNames.Count))
            {
                byte r = (byte)(aint);
                byte g = (byte)(aint >> 8);
                byte b = (byte)(aint >> 16);
                Color ncolor = Color.FromArgb(r, g, b);
                return ncolor;
            }
            else
            {
#if CROSSPF
                // Known colors not implemented in NET STandard
                if (-aint >= ColorNames.Count)
                {
                    return ColorFromInteger(-aint);
                }
                else
                {
                    string keycolor = ColorNames.Keys[-aint];
                    return ColorNames[keycolor];
                }
#else

                string keycolor = ColorNames.Keys[-aint];
                return Color.FromKnownColor(ColorNames[keycolor]);
#endif
            }
        }


        /// <summary>
        /// Create an integer value based on a Color        /// </summary>
        /// <param name="acolor">Color value</param>
        /// <returns>Returs an integer value  in the form of $00BBGGRR</returns>
        public static int IntegerFromColor(Color acolor)
        {
            int aresult;
            UpdateColorNames();
#if NETSTANDARD2_0 || NETSTANDARD6_0
            aresult = (int)acolor.R + (int)(acolor.G << 8) + ((int)acolor.B << 16);
#else
            if (acolor.IsKnownColor)
            {
                aresult = -ColorNames.IndexOfValue(acolor.ToKnownColor());
            }
            else
                aresult = (int)acolor.R + (int)(acolor.G << 8) + ((int)acolor.B << 16);
#endif
            return aresult;
        }
        public static int IntegerFromColorA(Color acolor)
        {
            int aresult;
            aresult = (int)acolor.R + (int)(acolor.G << 8) + ((int)acolor.B << 16);
            return aresult;
        }
#if NETCOREAPP

        private static Hashtable htmlSysColorTable;
        /// <include file='doc\ColorTranslator.uex' path='docs/doc[@for="ColorTranslator.FromHtml"]/*' />
        /// <devdoc>
        ///    Translates an Html color representation to
        ///    a GDI+ <see cref='System.Drawing.Color'/>.
        /// </devdoc>
        public static Color ColorFromHtml(string htmlColor)
        {
            Color c = Color.Empty;

            // empty color
            if ((htmlColor == null) || (htmlColor.Length == 0))
                return c;

            // #RRGGBB or #RGB
            if ((htmlColor[0] == '#') &&
                ((htmlColor.Length == 7) || (htmlColor.Length == 4)))
            {

                if (htmlColor.Length == 7)
                {
                    c = Color.FromArgb(Convert.ToInt32(htmlColor.Substring(1, 2), 16),
                                       Convert.ToInt32(htmlColor.Substring(3, 2), 16),
                                       Convert.ToInt32(htmlColor.Substring(5, 2), 16));
                }
                else
                {
                    string r = Char.ToString(htmlColor[1]);
                    string g = Char.ToString(htmlColor[2]);
                    string b = Char.ToString(htmlColor[3]);

                    c = Color.FromArgb(Convert.ToInt32(r + r, 16),
                                       Convert.ToInt32(g + g, 16),
                                       Convert.ToInt32(b + b, 16));
                }
            }

            // special case. Html requires LightGrey, but .NET uses LightGray
            if (c.IsEmpty && String.Equals(htmlColor, "LightGrey", StringComparison.OrdinalIgnoreCase))
            {
                c = Color.LightGray;
            }

            // System color
            if (c.IsEmpty)
            {
                if (htmlSysColorTable == null)
                {
                    InitializeHtmlSysColorTable();
                }

                object o = htmlSysColorTable[htmlColor.ToLower(CultureInfo.InvariantCulture)];
                if (o != null)
                {
                    c = (Color)o;
                }
            }

            // resort to type converter which will handle named colors
            if (c.IsEmpty)
            {
                c = (Color)TypeDescriptor.GetConverter(typeof(Color)).ConvertFromString(htmlColor);
            }

            return c;
        }
        private static void InitializeHtmlSysColorTable()
        {
            htmlSysColorTable = new Hashtable(0);
            /*
            htmlSysColorTable = new Hashtable(26);
            htmlSysColorTable["activeborder"] = Color.FromKnownColor(KnownColor.ActiveBorder);
            htmlSysColorTable["activecaption"] = Color.FromKnownColor(KnownColor.ActiveCaption);
            htmlSysColorTable["appworkspace"] = Color.FromKnownColor(KnownColor.AppWorkspace);
            htmlSysColorTable["background"] = Color.FromKnownColor(KnownColor.Desktop);
            htmlSysColorTable["buttonface"] = Color.FromKnownColor(KnownColor.Control);
            htmlSysColorTable["buttonhighlight"] = Color.FromKnownColor(KnownColor.ControlLightLight);
            htmlSysColorTable["buttonshadow"] = Color.FromKnownColor(KnownColor.ControlDark);
            htmlSysColorTable["buttontext"] = Color.FromKnownColor(KnownColor.ControlText);
            htmlSysColorTable["captiontext"] = Color.FromKnownColor(KnownColor.ActiveCaptionText);
            htmlSysColorTable["graytext"] = Color.FromKnownColor(KnownColor.GrayText);
            htmlSysColorTable["highlight"] = Color.FromKnownColor(KnownColor.Highlight);
            htmlSysColorTable["highlighttext"] = Color.FromKnownColor(KnownColor.HighlightText);
            htmlSysColorTable["inactiveborder"] = Color.FromKnownColor(KnownColor.InactiveBorder);
            htmlSysColorTable["inactivecaption"] = Color.FromKnownColor(KnownColor.InactiveCaption);
            htmlSysColorTable["inactivecaptiontext"] = Color.FromKnownColor(KnownColor.InactiveCaptionText);
            htmlSysColorTable["infobackground"] = Color.FromKnownColor(KnownColor.Info);
            htmlSysColorTable["infotext"] = Color.FromKnownColor(KnownColor.InfoText);
            htmlSysColorTable["menu"] = Color.FromKnownColor(KnownColor.Menu);
            htmlSysColorTable["menutext"] = Color.FromKnownColor(KnownColor.MenuText);
            htmlSysColorTable["scrollbar"] = Color.FromKnownColor(KnownColor.ScrollBar);
            htmlSysColorTable["threeddarkshadow"] = Color.FromKnownColor(KnownColor.ControlDarkDark);
            htmlSysColorTable["threedface"] = Color.FromKnownColor(KnownColor.Control);
            htmlSysColorTable["threedhighlight"] = Color.FromKnownColor(KnownColor.ControlLight);
            htmlSysColorTable["threedlightshadow"] = Color.FromKnownColor(KnownColor.ControlLightLight);
            htmlSysColorTable["window"] = Color.FromKnownColor(KnownColor.Window);
            htmlSysColorTable["windowframe"] = Color.FromKnownColor(KnownColor.WindowFrame);
            htmlSysColorTable["windowtext"] = Color.FromKnownColor(KnownColor.WindowText);*/
        }
#else
#endif
        public static Color ColorFromString(string ncolor)
        {
            if (ncolor.Length == 0)
                throw new Exception("Invalid color, ColorFromString, empty string");
            if (ncolor[0] == '#')
#if NETSTANDARD2_0
                return ColorFromHtml(ncolor);
#else
                return ColorTranslator.FromHtml(ncolor);
#endif
            if (ncolor[0] == '(')
            {
                ncolor = ncolor.Substring(1, ncolor.Length - 1);
                int index = ncolor.IndexOf(')');
                if (index == (ncolor.Length - 1))
                    ncolor = ncolor.Substring(0, ncolor.Length - 1);
                char separator = ';';
                index = ncolor.IndexOf(",");
                if (index >= 0)
                    separator = ',';
                string[] colorarray = ncolor.Split(separator);
                byte r = 0;
                byte g = 0;
                byte b = 0;
                int i = 0;
                foreach (string acolor in colorarray)
                {
                    switch (i)
                    {
                        case 0:
                            r = System.Convert.ToByte(acolor);
                            break;
                        case 1:
                            g = System.Convert.ToByte(acolor);
                            break;
                        default:
                            b = System.Convert.ToByte(acolor);
                            break;
                    }
                    i++;
                }
                return Color.FromArgb(r, g, b);
            }
            else
                return Color.FromName(ncolor);

        }
        /// <summary>
        /// Create a Color based on a 32 bit integer
        /// </summary>
        /// <param name="aint">Integer color value in the form of $00BBGGRR</param>
        /// <returns>Returs a Color usable in any System.Drawing function</returns>
        public static Color ColorFromIntegerA(int aint)
        {
            byte r = (byte)(aint);
            byte g = (byte)(aint >> 8);
            byte b = (byte)(aint >> 16);
            Color ncolor = Color.FromArgb(255, r, g, b);
            return ncolor;
        }

    }
}
