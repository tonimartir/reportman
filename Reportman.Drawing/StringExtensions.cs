using System.Collections.Generic;
using System.Linq;
using System.Text;

namespace Reportman.Drawing
{
    /// <summary>
    /// Extension methods for <see cref="string"/> providing escape-aware splitting, escaping/unescaping with a custom escape character, diacritic removal and quoting helpers.
    /// </summary>
    public static class StringExtensions
    {
        /// <summary>
        /// Splits a string by a separator character, honoring an escape character to prevent splitting.
        /// </summary>
        /// <param name="text">The source string extension target.</param>
        /// <param name="separator">The character separator to split by.</param>
        /// <param name="escapeCharacter">The escape character.</param>
        /// <param name="useextension">Unused parameter for signature matching.</param>
        /// <param name="ex">Unused parameter for signature matching.</param>
        /// <returns>An enumerable collection of split string chunks.</returns>
        public static IEnumerable<string> Split(
    this string text,
    char separator,
    char escapeCharacter, bool useextension, bool ex)
        {
            var builder = new StringBuilder(text.Length);

            bool escaped = false;
            foreach (var ch in text)
            {
                if (separator == ch && !escaped)
                {
                    yield return builder.ToString();
                    builder.Clear();
                }
                else
                {
                    // separator is removed, escape characters are kept
                    builder.Append(ch);
                }
                // set escaped for next cycle, 
                // or reset unless escape character is escaped.
                escaped = escapeCharacter == ch && !escaped;
            }
            yield return builder.ToString();
        }
        /// <summary>
        /// Splits a string by a separator character, honoring an escape character, returning an array.
        /// </summary>
        /// <param name="text">The source string extension target.</param>
        /// <param name="separator">The character separator to split by.</param>
        /// <param name="escapeCharacter">The escape character.</param>
        /// <param name="escape">Unused parameter for signature matching.</param>
        /// <returns>An array of split string chunks.</returns>
        public static string[] Split(
            this string text,
            char separator,
            char escapeCharacter, bool escape)
        {
            List<string> nlist = new();
            foreach (string nstring in text.Split(separator, escapeCharacter, true, true))
            {
                nlist.Add(nstring);
            }
            return nlist.ToArray();
        }

        /// <summary>
        /// Escapes occurrences of any character in the controlChars string using the designated escape character.
        /// </summary>
        /// <param name="text">The source string extension target.</param>
        /// <param name="controlChars">The set of characters to escape.</param>
        /// <param name="escapeCharacter">The escape character prefix to inject.</param>
        /// <returns>The escaped string.</returns>
        public static string Escape(this string text, string controlChars, char escapeCharacter)
        {
            var builder = new StringBuilder(text.Length + 3);
            foreach (var ch in text)
            {
                if (controlChars.Contains(ch))
                {
                    builder.Append(escapeCharacter);
                }
                builder.Append(ch);
            }
            return builder.ToString();
        }

        /// <summary>
        /// Removes escape character prefixes from the string.
        /// </summary>
        /// <param name="text">The source string extension target.</param>
        /// <param name="escapeCharacter">The escape character to remove.</param>
        /// <returns>The unescaped string.</returns>
        public static string Unescape(this string text, char escapeCharacter)
        {
            var builder = new StringBuilder(text.Length);
            bool escaped = false;
            foreach (var ch in text)
            {
                escaped = escapeCharacter == ch && !escaped;
                if (!escaped)
                {
                    builder.Append(ch);
                }
            }
            return builder.ToString();
        }
        /// <summary>
        /// Removes diacritics (accents) from the string.
        /// </summary>
        /// <param name="input">The source string extension target.</param>
        /// <returns>The string without accents.</returns>
        public static string RemoveDiacritics(this string input)
        {
            return StringUtil.RemoveDiacritics(input);
        }
        /// <summary>
        /// Encloses the string in single quotes, escaping inner single quotes.
        /// </summary>
        /// <param name="input">The source string extension target.</param>
        /// <returns>The quoted string.</returns>
        public static string QuoteStr(this string input)
        {
            return StringUtil.QuoteStr(input);
        }
        /// <summary>
        /// Encloses the string in double quotes, escaping inner double quotes.
        /// </summary>
        /// <param name="input">The source string extension target.</param>
        /// <returns>The double-quoted string.</returns>
        public static string DoubleQuoteStr(this string input)
        {
            return StringUtil.DoubleQuoteStr(input);
        }
    }
}
