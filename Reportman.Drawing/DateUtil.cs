using System;


namespace Reportman.Drawing
{
    /// <summary>
    /// Provide utitilies about handling DateTime values
    /// </summary>
    public class DateUtil
    {
        /// <summary>
        /// The starting DateTime base date (December 30, 1899) used by Delphi's date representation.
        /// </summary>
        public static DateTime FIRST_DELPHI_DAY = new DateTime(1899, 12, 30);
        /// <summary>
        /// Converts a double representing the number of days from 30 Dec 1899 to DateTime
        /// </summary>
        public static DateTime DelphiDateToDateTime(double avalue)
        {
            return DateTime.FromOADate(avalue);
        }
        /// <summary>
        /// Converts a DateTime to a double value representing the number of days from 30 Dec 1899
        /// It mantains the time
        /// </summary>
        public static double DateTimeToDelphiDateTime(DateTime avalue)
        {
            TimeSpan difdate = avalue - FIRST_DELPHI_DAY;
            return difdate.TotalDays;
        }
        /// <summary>
        /// Converts a <see cref="DateTime"/> value to a Firebird SQL literal string representation including hours, minutes, and seconds.
        /// </summary>
        /// <param name="nvalue">The <see cref="DateTime"/> value to convert.</param>
        /// <returns>A quoted string containing the formatted date and time.</returns>
        public static string DateTimeToFbLiteralHour(DateTime nvalue)
        {
            System.Globalization.DateTimeFormatInfo dateinfo = new System.Globalization.DateTimeFormatInfo();
            dateinfo.TimeSeparator = ":";
            dateinfo.DateSeparator = "/";
            string nresult = StringUtil.QuoteStr(nvalue.ToString("yyyy-MM-dd HH:mm:ss", dateinfo));
            return nresult;
        }
        /// <summary>
        /// Converts a DateTime to a double value representing the number of days from 30 Dec 1899
        /// </summary>
        public static double DateTimeToDelphiDate(DateTime avalue)
        {
            TimeSpan difdate = avalue - FIRST_DELPHI_DAY;
            return difdate.Days + difdate.Hours / 24 + difdate.Minutes / (24 * 60) + difdate.Seconds / (24 * 60 * 60);
        }
        /// <summary>
        /// Calculates the sql literal date value, to include it in sql sentences
        /// </summary>
        /// <param name="value"></param>
        /// <returns>The sql representation, with quotes of the date (not including time information)</returns>
        public static string DateToSqlLiteral(DateTime value)
        {
            return StringUtil.QuoteStr(value.ToString("yyyy-MM-dd"));
        }
        /// <summary>
        /// Converts a Delphi DateTime to a TimeSpan, time since 30 DEC 1899
        /// </summary>
        public static TimeSpan DelphiDateTimeToTimeSpan(double avalue)
        {
            int days = (int)avalue;
            double atime = avalue - (int)avalue;
            int seconds = (int)(atime * 86400);
            int hours = (int)(seconds / 3600);
            seconds = seconds - hours * 3600;
            int minutes = (int)(seconds / 60);
            seconds = seconds - minutes * 60;
            return new TimeSpan(days, hours, minutes, seconds);
        }
        /// <summary>
        /// Converts a <see cref="DateTime"/> to an ISO 8601 string representation.
        /// </summary>
        /// <param name="value">The <see cref="DateTime"/> value to convert.</param>
        /// <param name="useZone">A boolean indicating whether to format without timezone info (true) or with timezone info (false).</param>
        /// <returns>An ISO 8601 formatted date/time string.</returns>
        public static string DateToISO8601(DateTime value, bool useZone)
        {
            if (useZone)
            {
                return value.ToString("yyyy-MM-ddTHH:mm:ss");
            }
            else
            {
                return value.ToString("yyyy-MM-ddTHH:mm:ssK");

            }
        }
        /// <summary>
        /// Validates and parses a string value to check if it represents a valid date within reasonable range.
        /// </summary>
        /// <param name="val">The input string to validate.</param>
        /// <param name="result">When this method returns, contains the parsed <see cref="DateTime"/> if successful, or <see cref="DateTime.MinValue"/> if not.</param>
        /// <returns>true if the string is a valid date within the range of years 1800 to 8999; otherwise, false.</returns>
        public static bool IsDateTime(string val, out DateTime result)
        {
            result = DateTime.MinValue;
            // 
            if ((val.Length < 8) || (val.Length > 10))
                return false;
            bool aresult = false;
            aresult = DateTime.TryParse(val, out result);
            if ((result.Year < 1800) || (result.Year >= 9000))
                aresult = false;
            return aresult;
        }
        /// <summary>
        /// Returns the next Saturday date relative to the given date value.
        /// </summary>
        /// <param name="value">The starting date.</param>
        /// <returns>The calculated <see cref="DateTime"/> representing the next Saturday.</returns>
        public static DateTime NextSaturday(DateTime value)
        {
            DateTime result = value;
            while (result.DayOfWeek != DayOfWeek.Saturday)
                result = result.AddDays(1);
            return result;
        }
        /// <summary>
        /// Returns the next Friday date relative to the given date value.
        /// </summary>
        /// <param name="value">The starting date.</param>
        /// <returns>The calculated <see cref="DateTime"/> representing the next Friday.</returns>
        public static DateTime NextFriDay(DateTime value)
        {
            DateTime result = value;
            while (result.DayOfWeek != DayOfWeek.Friday)
                result = result.AddDays(1);
            return result;
        }
        /// <summary>
        /// Calculates the next date matching the specified day number in the current or subsequent month.
        /// </summary>
        /// <param name="value">The starting date.</param>
        /// <param name="nday">The target day of the month.</param>
        /// <returns>The calculated <see cref="DateTime"/>.</returns>
        public static DateTime NextDayOfMonth(DateTime value, int nday)
        {
            int dayofmon = value.Day;
            if (dayofmon <= nday)
            {
                return value.AddDays(nday - dayofmon);
            }
            else
            {
                value = value.AddMonths(1);
                dayofmon = value.Day;
                if (dayofmon <= nday)
                {
                    return value.AddDays(nday - dayofmon);
                }
                else
                    return value.AddDays(-(dayofmon - nday));
            }
        }
        /// <summary>
        /// Calculates the last day of the month for the given date.
        /// </summary>
        /// <param name="value">The date to determine the month from.</param>
        /// <returns>The calculated <see cref="DateTime"/> representing the last day of that month.</returns>
        public static DateTime LastDayOfMonth(DateTime value)
        {
            DateTime dtTo = value;


            dtTo = dtTo.AddMonths(1);
            dtTo = dtTo.AddDays(-(dtTo.Day));

            return dtTo;
        }
        /// <summary>
        /// Adds a specified number of workable days (excluding weekends) to the given date.
        /// </summary>
        /// <param name="value">The starting date.</param>
        /// <param name="days">The number of workable days to add.</param>
        /// <returns>The calculated <see cref="DateTime"/>.</returns>
        public static DateTime AddWorkableDays(DateTime value, int days)
        {
            while (days > 0)
            {
                if ((value.DayOfWeek != DayOfWeek.Saturday) && (value.DayOfWeek != DayOfWeek.Sunday))
                {
                    days--;
                }
                value = value.AddDays(1);
            }
            return value;
        }
        /// <summary>
        /// Converts a <see cref="DateTime"/> value to a Unix timestamp (total seconds elapsed since January 1, 1970 UTC).
        /// </summary>
        /// <param name="dateTime">The <see cref="DateTime"/> to convert.</param>
        /// <returns>The calculated Unix timestamp as a double.</returns>
        public static double DateTimeToUnixTimestamp(DateTime dateTime)
        {
            return (TimeZoneInfo.ConvertTimeToUtc(dateTime) -
                     new DateTime(1970, 1, 1, 0, 0, 0, 0, System.DateTimeKind.Utc)).TotalSeconds;
        }
    }

}
