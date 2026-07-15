using AngleSharp.Html.Parser;
using Ganss.Xss;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;

namespace Reportman.Drawing
{
    /// <summary>
    /// A contiguous span of text together with the formatting (bold, italic, underline,
    /// strike-out, font family, font size and color) that applies to it, produced when
    /// parsing an HTML fragment into styled runs.
    /// </summary>
    public class HtmlFormatRun
    {
        /// <summary>The text content covered by this formatting run.</summary>
        public string Text;
        /// <summary>Whether the text in this run is rendered bold.</summary>
        public bool Bold;
        /// <summary>Whether the text in this run is rendered italic.</summary>
        public bool Italic;
        /// <summary>Whether the text in this run is underlined.</summary>
        public bool Underline;
        /// <summary>Whether the text in this run has a strike-through line.</summary>
        public bool StrikeOut;
        /// <summary>The font family applied to this run.</summary>
        public string FontFamily;
        /// <summary>The font size, in points, applied to this run; only meaningful when <see cref="HasFontSize"/> is true.</summary>
        public float FontSize;

        /// <summary>
        /// Whether an explicit font size was set for this run, so the caller knows when to
        /// override the default size.
        /// </summary>
        public bool HasFontSize;

        /// <summary>The text color as a BGR integer (Win32/TColor layout); only meaningful when <see cref="HasColor"/> is true.</summary>
        public int Color;
        /// <summary>Whether an explicit text color was set for this run.</summary>
        public bool HasColor;

        /// <summary>Creates a copy of this run carrying the same text and formatting attributes.</summary>
        /// <returns>A new <see cref="HtmlFormatRun"/> with identical values.</returns>
        public HtmlFormatRun Clone()
        {
            return new HtmlFormatRun
            {
                Text = this.Text,
                Bold = this.Bold,
                Italic = this.Italic,
                Underline = this.Underline,
                StrikeOut = this.StrikeOut,
                FontFamily = this.FontFamily,
                FontSize = this.FontSize,
                HasFontSize = this.HasFontSize,
                Color = this.Color,
                HasColor = this.HasColor
            };
        }
    }

    /// <summary>
    /// Parses a supported subset of HTML markup into a list of styled <see cref="HtmlFormatRun"/>
    /// segments, sanitizing and normalizing the input and resolving inline tags such as
    /// b/i/u/s, span and legacy font into bold, italic, font family, size and color attributes.
    /// </summary>
    public static class HtmlTextParser
    {
        private static readonly Regex TagRegex = new(@"<(/?)(\w+)([^>]*)>", RegexOptions.IgnoreCase | RegexOptions.Compiled);
        private static readonly Regex StyleRegex = new(@"font-family\s*:\s*'?([^';]+)'?", RegexOptions.IgnoreCase | RegexOptions.Compiled);
        private static readonly Regex SizeRegex = new(@"font-size\s*:\s*'?(\d+)(pt|px)?'?", RegexOptions.IgnoreCase | RegexOptions.Compiled);
        private static readonly Regex ColorRegex = new(@"(?<![-\w])color\s*[:=]\s*['""]?([^;'""\s>]+)", RegexOptions.IgnoreCase | RegexOptions.Compiled);
        private static readonly Regex MetaCharsetRegex = new(@"<meta\b[^>]*(charset\s*=|http-equiv\s*=\s*[""']?content-type[""']?)[^>]*>", RegexOptions.IgnoreCase | RegexOptions.Compiled);

        private sealed class HtmlCharsetEncodingProvider : EncodingProvider
        {
            public override Encoding GetEncoding(string name)
            {
                if (string.Equals(name, "iso-2022-cn", StringComparison.OrdinalIgnoreCase))
                {
                    return Encoding.UTF8;
                }

                return null;
            }

            public override Encoding GetEncoding(int codepage)
            {
                return null;
            }
        }

        static HtmlTextParser()
        {
            // The HTML arrives here already decoded as a .NET string. This alias only
            // prevents AngleSharp from failing when it sees an unsupported charset name.
            Encoding.RegisterProvider(new HtmlCharsetEncodingProvider());
            Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
        }

        /// <summary>
        /// Parses an HTML fragment into an ordered list of styled runs, sanitizing the input and
        /// resolving inline tags (b/i/u/s, span, legacy font) into per-run bold, italic, underline,
        /// strike-out, font family, size and color attributes. Consecutive runs sharing the same
        /// style are merged.
        /// </summary>
        /// <param name="htmlText">The HTML fragment to parse.</param>
        /// <param name="defaultFontFamily">The font family applied to text that carries no explicit font.</param>
        /// <returns>The styled runs in document order; an empty list when the input is null or empty.</returns>
        public static List<HtmlFormatRun> Parse(string htmlText, string defaultFontFamily = "")
        {
            var runs = new List<HtmlFormatRun>();

            if (string.IsNullOrEmpty(htmlText))
                return runs;

            // Normalize broken incoming HTML into the supported subset, but fall back to
            // the original fragment if the preprocessing pipeline cannot handle it.
            string preprocessedHtml = NormalizeSupportedHtml(htmlText);

            // Normalize line endings
            string normalizedHtml = preprocessedHtml.Replace("\r\n", "\n").Replace("\r", "\n");

            var currentRun = new HtmlFormatRun
            {
                Text = "",
                Bold = false,
                Italic = false,
                Underline = false,
                StrikeOut = false,
                FontFamily = defaultFontFamily,
                FontSize = 0,
                HasFontSize = false,
                Color = 0,
                HasColor = false
            };

            int lastIndex = 0;
            var matches = TagRegex.Matches(normalizedHtml);

            var fontFamilyStack = new Stack<string>();
            fontFamilyStack.Push(defaultFontFamily);

            var fontSizeStack = new Stack<float>();
            fontSizeStack.Push(0);

            var colorStack = new Stack<int>();
            colorStack.Push(-1); // -1 = no color override

            void AddSpecialText(string text)
            {
                var runToAdd = currentRun.Clone();
                runToAdd.Text = text;
                runs.Add(runToAdd);
            }

            foreach (Match match in matches)
            {
                // Add text before the tag
                if (match.Index > lastIndex)
                {
                    string textPart = normalizedHtml.Substring(lastIndex, match.Index - lastIndex);
                    // Decode common HTML entities
                    textPart = DecodeHtmlEntities(textPart);
                    if (!string.IsNullOrEmpty(textPart))
                    {
                        var runToAdd = currentRun.Clone();
                        runToAdd.Text = textPart;
                        runs.Add(runToAdd);
                    }
                }

                // Process the tag
                bool isClosing = match.Groups[1].Value == "/";
                string tagName = match.Groups[2].Value.ToLowerInvariant();
                string tagAttributes = match.Groups[3].Value;

                if (!isClosing)
                {
                    switch (tagName)
                    {
                        case "b":
                        case "strong":
                            currentRun.Bold = true;
                            break;
                        case "i":
                        case "em":
                            currentRun.Italic = true;
                            break;
                        case "u":
                            currentRun.Underline = true;
                            break;
                        case "s":
                        case "del":
                        case "strike":
                            currentRun.StrikeOut = true;
                            break;
                        case "span":
                            string family = ExtractFontFamily(tagAttributes);
                            if (!string.IsNullOrEmpty(family))
                            {
                                fontFamilyStack.Push(family);
                                currentRun.FontFamily = family;
                            }
                            else
                            {
                                fontFamilyStack.Push(currentRun.FontFamily); // Push current to keep stack balanced
                            }
                            float size = ExtractFontSize(tagAttributes);
                            if (size > 0)
                            {
                                fontSizeStack.Push(size);
                                currentRun.FontSize = size;
                                currentRun.HasFontSize = true;
                            }
                            else
                            {
                                fontSizeStack.Push(currentRun.FontSize);
                            }
                            {
                                int spanColor;
                                if (ExtractColorValue(tagAttributes, out spanColor))
                                {
                                    colorStack.Push(spanColor);
                                    currentRun.Color = spanColor;
                                    currentRun.HasColor = true;
                                }
                                else
                                {
                                    colorStack.Push(colorStack.Peek());
                                }
                            }
                            break;
                        case "font": // Legacy <font face="Arial" color="#ff0000"> support
                            string face = ExtractFontFace(tagAttributes);
                            if (!string.IsNullOrEmpty(face))
                            {
                                fontFamilyStack.Push(face);
                                currentRun.FontFamily = face;
                            }
                            else
                            {
                                fontFamilyStack.Push(currentRun.FontFamily);
                            }
                            float fsize = ExtractLegacyFontSize(tagAttributes);
                            if (fsize > 0)
                            {
                                fontSizeStack.Push(fsize);
                                currentRun.FontSize = fsize;
                                currentRun.HasFontSize = true;
                            }
                            else
                            {
                                fontSizeStack.Push(currentRun.FontSize);
                            }
                            {
                                int fontColor;
                                if (ExtractColorValue(tagAttributes, out fontColor))
                                {
                                    colorStack.Push(fontColor);
                                    currentRun.Color = fontColor;
                                    currentRun.HasColor = true;
                                }
                                else
                                {
                                    colorStack.Push(colorStack.Peek());
                                }
                            }
                            break;
                        case "br":
                            AddSpecialText("\n");
                            break;
                        case "p":
                        case "div":
                            break;
                        case "tr":
                            break;
                        case "td":
                        case "th":
                            break;
                    }
                }
                else
                {
                    switch (tagName)
                    {
                        case "b":
                        case "strong":
                            currentRun.Bold = false;
                            break;
                        case "i":
                        case "em":
                            currentRun.Italic = false;
                            break;
                        case "u":
                            currentRun.Underline = false;
                            break;
                        case "s":
                        case "del":
                        case "strike":
                            currentRun.StrikeOut = false;
                            break;
                        case "span":
                        case "font":
                            if (fontFamilyStack.Count > 1)
                            {
                                fontFamilyStack.Pop();
                                currentRun.FontFamily = fontFamilyStack.Peek();
                            }
                            if (fontSizeStack.Count > 1)
                            {
                                fontSizeStack.Pop();
                                float peekSize = fontSizeStack.Peek();
                                if (peekSize > 0)
                                {
                                    currentRun.FontSize = peekSize;
                                    currentRun.HasFontSize = true;
                                }
                                else
                                {
                                    currentRun.FontSize = 0;
                                    currentRun.HasFontSize = false;
                                }
                            }
                            if (colorStack.Count > 1)
                            {
                                colorStack.Pop();
                                int peekColor = colorStack.Peek();
                                if (peekColor >= 0)
                                {
                                    currentRun.Color = peekColor;
                                    currentRun.HasColor = true;
                                }
                                else
                                {
                                    currentRun.Color = 0;
                                    currentRun.HasColor = false;
                                }
                            }
                            break;
                        case "p":
                        case "div":
                        case "tr":
                            AddSpecialText("\n");
                            break;
                        case "td":
                        case "th":
                            AddSpecialText(" ");
                            break;
                    }
                }

                lastIndex = match.Index + match.Length;
            }

            // Add remaining text
            if (lastIndex < normalizedHtml.Length)
            {
                string textPart = normalizedHtml.Substring(lastIndex);
                textPart = DecodeHtmlEntities(textPart);
                if (!string.IsNullOrEmpty(textPart))
                {
                    var runToAdd = currentRun.Clone();
                    runToAdd.Text = textPart;
                    runs.Add(runToAdd);
                }
            }

            return MergeConsecutiveRunsWithSameStyle(runs);
        }

        private static List<HtmlFormatRun> MergeConsecutiveRunsWithSameStyle(List<HtmlFormatRun> runs)
        {
            if (runs.Count <= 1) return runs;

            var merged = new List<HtmlFormatRun>();
            var current = runs[0];

            for (int i = 1; i < runs.Count; i++)
            {
                var next = runs[i];
                if (current.Bold == next.Bold &&
                    current.Italic == next.Italic &&
                    current.Underline == next.Underline &&
                    current.StrikeOut == next.StrikeOut &&
                    current.FontFamily == next.FontFamily &&
                    current.FontSize == next.FontSize &&
                    current.HasFontSize == next.HasFontSize &&
                    current.Color == next.Color &&
                    current.HasColor == next.HasColor)
                {
                    current.Text += next.Text;
                }
                else
                {
                    merged.Add(current);
                    current = next;
                }
            }
            merged.Add(current);

            return merged;
        }

        private static string NormalizeSupportedHtml(string htmlText)
        {
            if (string.IsNullOrWhiteSpace(htmlText) || htmlText.IndexOf('<') < 0)
            {
                return htmlText;
            }

            try
            {
                string htmlWithoutCharsetDeclarations = MetaCharsetRegex.Replace(htmlText, string.Empty);
                var parser = new HtmlParser();
                var document = parser.ParseDocument(htmlWithoutCharsetDeclarations);
                string normalizedHtml = document.Body?.InnerHtml;

                if (string.IsNullOrEmpty(normalizedHtml))
                {
                    normalizedHtml = document.DocumentElement?.InnerHtml;
                }

                if (string.IsNullOrEmpty(normalizedHtml))
                {
                    normalizedHtml = htmlText;
                }

                var sanitizer = CreateSupportedHtmlSanitizer();
                return sanitizer.Sanitize(normalizedHtml);
            }
            catch
            {
                return htmlText;
            }
        }

        private static HtmlSanitizer CreateSupportedHtmlSanitizer()
        {
            var sanitizer = new HtmlSanitizer();

            sanitizer.AllowedTags.Clear();
            foreach (string tag in new[]
            {
                "b", "strong", "i", "em", "u", "s", "del", "strike",
                "span", "font", "br", "p", "div",
                "table", "tbody", "thead", "tfoot", "tr", "td", "th"
            })
            {
                sanitizer.AllowedTags.Add(tag);
            }

            sanitizer.AllowedAttributes.Clear();
            foreach (string attribute in new[]
            {
                "style", "face", "size", "color", "colspan", "rowspan"
            })
            {
                sanitizer.AllowedAttributes.Add(attribute);
            }

            sanitizer.AllowedCssProperties.Clear();
            foreach (string cssProperty in new[]
            {
                "color", "font-family", "font-size"
            })
            {
                sanitizer.AllowedCssProperties.Add(cssProperty);
            }

            return sanitizer;
        }

        private static string ExtractFontFamily(string attributes)
        {
            var match = StyleRegex.Match(attributes);
            if (match.Success && match.Groups.Count > 1)
            {
                return match.Groups[1].Value;
            }
            return string.Empty;
        }

        private static bool ExtractColorValue(string attributes, out int color)
        {
            color = 0;
            var match = ColorRegex.Match(attributes);
            if (!match.Success) return false;

            string val = match.Groups[1].Value.Trim();
            if (string.IsNullOrEmpty(val)) return false;

            // Parse #RRGGBB or #RGB
            if (val.StartsWith("#"))
            {
                val = val.Substring(1);
                int r, g, b;
                if (val.Length == 6)
                {
                    r = Convert.ToInt32(val.Substring(0, 2), 16);
                    g = Convert.ToInt32(val.Substring(2, 2), 16);
                    b = Convert.ToInt32(val.Substring(4, 2), 16);
                    color = r | (g << 8) | (b << 16); // BGR format (matches TColor/Win32)
                    return true;
                }
                else if (val.Length == 3)
                {
                    r = Convert.ToInt32("" + val[0] + val[0], 16);
                    g = Convert.ToInt32("" + val[1] + val[1], 16);
                    b = Convert.ToInt32("" + val[2] + val[2], 16);
                    color = r | (g << 8) | (b << 16);
                    return true;
                }
                return false;
            }

            // Named colors
            switch (val.ToLowerInvariant())
            {
                case "red": color = 0x0000FF; return true;
                case "blue": color = 0xFF0000; return true;
                case "green": color = 0x008000; return true;
                case "black": color = 0x000000; return true;
                case "white": color = 0xFFFFFF; return true;
                case "yellow": color = 0x00FFFF; return true;
                case "orange": color = 0x00A5FF; return true;
                case "purple": color = 0x800080; return true;
                case "gray": color = 0x808080; return true;
                case "grey": color = 0x808080; return true;
                default: return false;
            }
        }

        private static float ExtractFontSize(string attributes)
        {
            var match = SizeRegex.Match(attributes);
            if (match.Success)
            {
                if (float.TryParse(match.Groups[1].Value, out float size))
                {
                    return size;
                }
            }
            return 0f;
        }

        private static string ExtractFontFace(string attributes)
        {
            var match = Regex.Match(attributes, @"face\s*=\s*""([^""]+)""", RegexOptions.IgnoreCase);
            if (match.Success)
            {
                return match.Groups[1].Value;
            }
            match = Regex.Match(attributes, @"face\s*=\s*'([^']+)'", RegexOptions.IgnoreCase);
            if (match.Success)
            {
                return match.Groups[1].Value;
            }
            match = Regex.Match(attributes, @"face\s*=\s*([^\s>]+)", RegexOptions.IgnoreCase);
            if (match.Success)
            {
                return match.Groups[1].Value.Trim();
            }
            return string.Empty;
        }

        private static float ExtractLegacyFontSize(string attributes)
        {
            var match = Regex.Match(attributes, @"size\s*=\s*""?(\d+)""?", RegexOptions.IgnoreCase);
            if (match.Success)
            {
                if (float.TryParse(match.Groups[1].Value, out float size))
                {
                    var hasPtSuffix = match.Index + match.Length + 1 < attributes.Length &&
                        string.Compare(attributes, match.Index + match.Length, "pt", 0, 2, StringComparison.OrdinalIgnoreCase) == 0;
                    if (hasPtSuffix)
                        return size;

                    // Convert legacy HTML sizes (1-7) to approximate point sizes
                    switch ((int)size)
                    {
                        case 1: return 8f;
                        case 2: return 10f;
                        case 3: return 12f;
                        case 4: return 14f;
                        case 5: return 18f;
                        case 6: return 24f;
                        case 7: return 36f;
                        default: return size; // Assume it's already a point size or fallback
                    }
                }
            }
            return 0f;
        }

        private static string DecodeHtmlEntities(string text)
        {
            if (string.IsNullOrEmpty(text))
                return text;

            return text.Replace("&nbsp;", " ")
                       .Replace("&lt;", "<")
                       .Replace("&gt;", ">")
                       .Replace("&amp;", "&")
                       .Replace("&quot;", "\"")
                       .Replace("&#39;", "'");
        }
    }

    /// <summary>
    /// Identifies a single line within a larger text by its start position and length,
    /// as produced when splitting text on line breaks for layout.
    /// </summary>
    public class LineSubText
    {
        /// <summary>The zero-based start index of the line within the source text.</summary>
        public int Position;
        /// <summary>The number of characters in the line, excluding any trailing line break.</summary>
        public int Length;
    }

    /// <summary>
    /// Holds the shaped glyph positions for a single line of text, indexed from a base
    /// text offset, along with a cluster map that links each logical text cluster to the
    /// glyphs that render it.
    /// </summary>
    public class LineGlyphs
    {
        /// <summary>The index in the source text at which this line's glyphs begin.</summary>
        public int TextOffset;
        /// <summary>The shaped glyph positions that make up this line.</summary>
        public List<TGlyphPos> Glyphs = new();
        /// <summary>Maps each logical text cluster index to the list of glyph indices that render it.</summary>
        public Dictionary<int, List<int>> ClusterMap = new();

        /// <summary>Initializes a new instance for a line whose glyphs start at the given text offset.</summary>
        /// <param name="textOffset">The index in the source text where this line begins.</param>
        public LineGlyphs(int textOffset)
        {
            TextOffset = textOffset;
        }

        /// <summary>Appends a shaped glyph to the line and records it in the cluster map by its cluster index.</summary>
        /// <param name="g">The shaped glyph position to add.</param>
        /// <param name="logicalStart">The logical start index of the glyph in the source text.</param>
        public void AddGlyph(TGlyphPos g, int logicalStart)
        {
            Glyphs.Add(g);
            int idx = Glyphs.Count - 1;
            int cluster = g.LineCluster;
            if (!ClusterMap.ContainsKey(cluster))
                ClusterMap[cluster] = new List<int>();
            ClusterMap[cluster].Add(idx);
        }

        /// <summary>The smallest logical cluster index among the line's glyphs, or 0 when the line has no glyphs.</summary>
        public int MinClusterText
        {
            get
            {
                if (Glyphs.Count == 0) return 0;
                return Glyphs.Min(g => g.LineCluster);
            }
        }
        /// <summary>The largest logical cluster index among the line's glyphs, or 0 when the line has no glyphs.</summary>
        public int MaxClusterText
        {
            get
            {
                if (Glyphs.Count == 0) return 0;
                return Glyphs.Max(g => g.LineCluster);
            }
        }
    }

    /// <summary>
    /// Helper routines for laying out HTML text: splitting text into lines, locating
    /// possible line-break positions, and breaking shaped glyph runs into chunks that fit
    /// a given width for both left-to-right and right-to-left text.
    /// </summary>
    public static class HtmlLayoutUtils
    {
        /// <summary>Splits the text into lines on newline characters, excluding a trailing carriage return from each line's length.</summary>
        /// <param name="text">The text to divide into lines.</param>
        /// <returns>One <see cref="LineSubText"/> per line, each giving the line's start position and length.</returns>
        public static List<LineSubText> DividesIntoLines(string text)
        {
            var result = new List<LineSubText>();
            int pos = 0;
            while (pos < text.Length)
            {
                int nextPos = text.IndexOf('\n', pos);
                if (nextPos == -1)
                {
                    result.Add(new LineSubText { Position = pos, Length = text.Length - pos });
                    break;
                }
                int len = nextPos - pos;
                if (nextPos > pos && text[nextPos - 1] == '\r') len--;
                result.Add(new LineSubText { Position = pos, Length = len });
                pos = nextPos + 1;
            }
            return result;
        }

        /// <summary>Finds the character positions in the line where a soft line break is allowed (after spaces and hyphens).</summary>
        /// <param name="line">The line of text to inspect.</param>
        /// <returns>The set of character indices at which the line may be broken.</returns>
        public static HashSet<int> FillPossibleLineBreaksString(string line)
        {
            var breaks = new HashSet<int>();
            for (int i = 0; i < line.Length; i++)
            {
                if (line[i] == ' ' || line[i] == '-')
                    breaks.Add(i);
            }
            return breaks;
        }

        /// <summary>
        /// Breaks a left-to-right run of shaped glyphs into chunks that each fit within the
        /// remaining width, preferring word boundaries and only splitting mid-word when a single
        /// run is the sole content on its line.
        /// </summary>
        /// <param name="positions">The shaped glyph positions to break, in logical order.</param>
        /// <param name="remaining">The width still available on the current line; updated to the full line width after each break.</param>
        /// <param name="lineWidthLimit">The full width of a line, used once the current line is flushed.</param>
        /// <param name="possibleBreaks">Character indices where a break is allowed, or null to rely on spaces and newlines.</param>
        /// <param name="line">The source text, used to test characters at glyph cluster positions.</param>
        /// <param name="lineHasContent">Whether the current line already holds content, so an unbreakable run is pushed to the next line instead of split.</param>
        /// <returns>The glyph chunks in order; an empty chunk signals the caller to flush the current line first.</returns>
        public static List<List<TGlyphPos>> BreakChunksLTR(
            List<TGlyphPos> positions,
            ref double remaining,
            double lineWidthLimit,
            HashSet<int> possibleBreaks,
            string line,
            bool lineHasContent = false)
        {
            var chunks = new List<List<TGlyphPos>>();
            if (positions.Count == 0) return chunks;

            int startIdx = 0;
            bool firstChunk = true;
            while (startIdx < positions.Count)
            {
                double acc = 0.0;
                int lastBreakGlyphIdx = -1;
                int j = startIdx;

                while (j < positions.Count)
                {
                    acc += positions[j].XAdvance;
                    int charIdx = positions[j].LineCluster;

                    bool hasBreak = possibleBreaks != null && possibleBreaks.Contains(charIdx);
                    if (!hasBreak && charIdx >= 0 && charIdx < line.Length)
                    {
                        hasBreak = (line[charIdx] == ' ' || line[charIdx] == '\n');
                    }

                    if (hasBreak)
                        lastBreakGlyphIdx = j;

                    if (acc > remaining)
                        break;
                    j++;
                }

                int chunkEnd;
                if (j >= positions.Count)
                {
                    // Everything fits
                    chunkEnd = positions.Count - 1;
                }
                else
                {
                    if (lastBreakGlyphIdx != -1)
                    {
                        // Break at last word boundary
                        chunkEnd = lastBreakGlyphIdx;
                    }
                    else if (firstChunk && lineHasContent)
                    {
                        // No word break found, but the line already has content.
                        // Don't break the word - push the entire run to the next line.
                        // Return empty first chunk (signals caller to flush current line)
                        // then the full run as second chunk.
                        chunks.Add(new List<TGlyphPos>()); // empty = flush current line
                        var fullRun = new List<TGlyphPos>();
                        for (int k = startIdx; k < positions.Count; k++)
                            fullRun.Add(positions[k]);
                        chunks.Add(fullRun);
                        return chunks;
                    }
                    else
                    {
                        // No word break and this IS the only content on the line.
                        // Force break mid-word.
                        if (j == startIdx)
                            chunkEnd = j;
                        else
                            chunkEnd = j - 1;
                    }
                }

                var chunk = new List<TGlyphPos>(chunkEnd - startIdx + 1);
                for (int k = startIdx; k <= chunkEnd; k++)
                    chunk.Add(positions[k]);

                chunks.Add(chunk);
                remaining = lineWidthLimit;
                firstChunk = false;

                startIdx = chunkEnd + 1;
            }
            return chunks;
        }

        /// <summary>
        /// Breaks a right-to-left run of shaped glyphs into chunks that each fit within the
        /// remaining width, walking from the end of the run and preferring word boundaries, only
        /// splitting mid-word when a single run is the sole content on its line.
        /// </summary>
        /// <param name="positions">The shaped glyph positions to break, in logical order.</param>
        /// <param name="remaining">The width still available on the current line; updated to the full line width after each break.</param>
        /// <param name="lineWidthLimit">The full width of a line, used once the current line is flushed.</param>
        /// <param name="possibleBreaks">Character indices where a break is allowed, or null to rely on spaces and newlines.</param>
        /// <param name="line">The source text, used to test characters at glyph cluster positions.</param>
        /// <param name="lineHasContent">Whether the current line already holds content, so an unbreakable run is pushed to the next line instead of split.</param>
        /// <returns>The glyph chunks in order; an empty chunk signals the caller to flush the current line first.</returns>
        public static List<List<TGlyphPos>> BreakChunksRTL(
            List<TGlyphPos> positions,
            ref double remaining,
            double lineWidthLimit,
            HashSet<int> possibleBreaks,
            string line,
            bool lineHasContent = false)
        {
            var chunks = new List<List<TGlyphPos>>();
            if (positions.Count == 0) return chunks;

            int endIdx = positions.Count - 1;
            bool firstChunk = true;
            while (endIdx >= 0)
            {
                double acc = 0.0;
                int lastBreakGlyphIdx = -1;
                int j = endIdx;

                while (j >= 0)
                {
                    acc += positions[j].XAdvance;
                    int charIdx = positions[j].LineCluster;

                    bool hasBreak = possibleBreaks != null && possibleBreaks.Contains(charIdx);
                    if (!hasBreak && charIdx >= 0 && charIdx < line.Length)
                    {
                        hasBreak = (line[charIdx] == ' ' || line[charIdx] == '\n');
                    }

                    if (hasBreak)
                        lastBreakGlyphIdx = j;

                    if (acc > remaining)
                        break;
                    j--;
                }

                int chunkStart;
                if (j < 0)
                {
                    chunkStart = 0;
                }
                else
                {
                    if (lastBreakGlyphIdx != -1)
                    {
                        chunkStart = lastBreakGlyphIdx;
                    }
                    else if (firstChunk && lineHasContent)
                    {
                        // No word break found, but line already has content.
                        // Push entire run to next line.
                        chunks.Add(new List<TGlyphPos>()); // empty = flush current line
                        var fullRun = new List<TGlyphPos>();
                        for (int k = 0; k <= endIdx; k++)
                            fullRun.Add(positions[k]);
                        chunks.Add(fullRun);
                        return chunks;
                    }
                    else
                    {
                        if (j == endIdx)
                            chunkStart = j;
                        else
                            chunkStart = j + 1;
                    }
                }

                var chunk = new List<TGlyphPos>(endIdx - chunkStart + 1);
                for (int k = chunkStart; k <= endIdx; k++)
                    chunk.Add(positions[k]);

                chunks.Add(chunk);
                remaining = lineWidthLimit;
                firstChunk = false;

                endIdx = chunkStart - 1;
            }
            return chunks;
        }
    }
}
