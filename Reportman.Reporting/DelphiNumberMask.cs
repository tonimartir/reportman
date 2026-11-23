#region Copyright
/*
 *  Report Manager:  Database Reporting tool for .Net and Mono
 *
 *     This Source Code Form is subject to the terms of the Mozilla
 *     Public License, v. 2.0. If a copy of the MPL was not distributed
 *     with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 *  Copyright (c) 1994 - 2026 Toni Martir (toni@reportman.es)
 *  All Rights Reserved.
*/
#endregion
using System.Collections.Generic;
using System.Text;

namespace Reportman.Reporting
{
    /// <summary>
    /// The number masks of the Delphi engine (FormatFloat) as custom formats of .NET, for the reports
    /// converted from Delphi (<see cref="BaseReport.ConvertedFromDelphi"/>). The same code as
    /// delphinumbermask.ts of the TypeScript engine. What differs between the two mask languages:
    /// for Delphi % and the per mille sign are text (.NET multiplies by 100 and 1000), a backslash
    /// is text (.NET: an escape), a comma anywhere in a section asks for thousands separators (.NET:
    /// only between two digits of the integer part; before the decimal point it divides by 1000),
    /// and an E is an exponent only with a sign after it (.NET: also E0).
    /// </summary>
    public static class DelphiNumberMask
    {
        /// <summary>The custom format of .NET that formats as FormatFloat does with the mask.</summary>
        public static string ToDotNet(string mask)
        {
            if (string.IsNullOrEmpty(mask))
                return mask;
            var result = new StringBuilder(mask.Length + 8);
            int i = 0;
            while (true)
            {
                i = Section(mask, i, result);
                if (i >= mask.Length)
                    break;
                // The ; that ended the section
                result.Append(';');
                i++;
            }
            return result.ToString();
        }

        /// <summary>Translates the section that starts at i; returns the index of its ; or the length.</summary>
        private static int Section(string mask, int i, StringBuilder result)
        {
            var sb = new StringBuilder();
            // The positions in sb of the digit placeholders of the integer part
            var integerDigits = new List<int>();
            bool grouping = false;
            int decimalPoint = -1;
            while (i < mask.Length && mask[i] != ';')
            {
                char c = mask[i];
                switch (c)
                {
                    case '\'':
                    case '"':
                        {
                            int end = mask.IndexOf(c, i + 1);
                            if (end < 0) end = mask.Length - 1;
                            sb.Append(mask, i, end - i + 1);
                            i = end + 1;
                            continue;
                        }
                    case ',':
                        grouping = true;
                        break;
                    case '.':
                        // The first one is the decimal point; the others write nothing
                        if (decimalPoint < 0)
                        {
                            decimalPoint = sb.Length;
                            sb.Append('.');
                        }
                        break;
                    case '0':
                    case '#':
                        if (decimalPoint < 0)
                            integerDigits.Add(sb.Length);
                        sb.Append(c);
                        break;
                    case 'E':
                    case 'e':
                        // E+ and E- are the exponent in both; an E before a 0 is one for .NET only
                        if (i + 1 < mask.Length && mask[i + 1] == '0')
                            sb.Append('\\');
                        sb.Append(c);
                        if (i + 1 < mask.Length && (mask[i + 1] == '+' || mask[i + 1] == '-'))
                        {
                            sb.Append(mask[i + 1]);
                            i++;
                        }
                        break;
                    case '%':
                    case '‰':
                    case '\\':
                        sb.Append('\\').Append(c);
                        break;
                    default:
                        sb.Append(c);
                        break;
                }
                i++;
            }
            if (grouping)
            {
                // .NET groups when a comma is between two digits of the integer part
                if (integerDigits.Count >= 2)
                    sb.Insert(integerDigits[0] + 1, ',');
                else if (integerDigits.Count == 1)
                    sb.Insert(integerDigits[0], "#,");
                else if (decimalPoint >= 0)
                    sb.Insert(decimalPoint, "#,#");
            }
            result.Append(sb);
            return i;
        }
    }
}
