using System;
using System.Globalization;
using Reportman.Drawing;

namespace Reportman.Reporting
{
    public static class VariantCoercion
    {
        private enum BaseType
        {
            Error,
            Empty,
            Null,
            Integer,
            Float,
            Currency,
            String,
            Boolean,
            DateTime,
            Int64,
            UInt64,
            Any
        }

        private static readonly BaseType[,] CoercionTypeMap = new BaseType[,]
        {
            { BaseType.Error, BaseType.Error, BaseType.Error, BaseType.Error, BaseType.Error, BaseType.Error, BaseType.Error, BaseType.Error, BaseType.Error, BaseType.Error, BaseType.Error, BaseType.Error },
            { BaseType.Error, BaseType.Empty, BaseType.Null, BaseType.Integer, BaseType.Float, BaseType.Currency, BaseType.String, BaseType.Boolean, BaseType.DateTime, BaseType.Int64, BaseType.UInt64, BaseType.Any },
            { BaseType.Error, BaseType.Null, BaseType.Null, BaseType.Null, BaseType.Null, BaseType.Null, BaseType.Null, BaseType.Null, BaseType.Null, BaseType.Null, BaseType.Null, BaseType.Any },
            { BaseType.Error, BaseType.Integer, BaseType.Null, BaseType.Integer, BaseType.Float, BaseType.Currency, BaseType.Float, BaseType.Integer, BaseType.DateTime, BaseType.Int64, BaseType.UInt64, BaseType.Any },
            { BaseType.Error, BaseType.Float, BaseType.Null, BaseType.Float, BaseType.Float, BaseType.Currency, BaseType.Float, BaseType.Float, BaseType.DateTime, BaseType.Float, BaseType.Float, BaseType.Any },
            { BaseType.Error, BaseType.Currency, BaseType.Null, BaseType.Currency, BaseType.Currency, BaseType.Currency, BaseType.Currency, BaseType.Currency, BaseType.DateTime, BaseType.Currency, BaseType.Currency, BaseType.Any },
            { BaseType.Error, BaseType.String, BaseType.Null, BaseType.Float, BaseType.Float, BaseType.Currency, BaseType.String, BaseType.Boolean, BaseType.DateTime, BaseType.Float, BaseType.Float, BaseType.Any },
            { BaseType.Error, BaseType.Boolean, BaseType.Null, BaseType.Integer, BaseType.Float, BaseType.Currency, BaseType.Boolean, BaseType.Boolean, BaseType.DateTime, BaseType.Int64, BaseType.UInt64, BaseType.Any },
            { BaseType.Error, BaseType.DateTime, BaseType.Null, BaseType.DateTime, BaseType.DateTime, BaseType.DateTime, BaseType.DateTime, BaseType.DateTime, BaseType.DateTime, BaseType.DateTime, BaseType.DateTime, BaseType.Any },
            { BaseType.Error, BaseType.Int64, BaseType.Null, BaseType.Int64, BaseType.Float, BaseType.Currency, BaseType.Float, BaseType.Int64, BaseType.DateTime, BaseType.Int64, BaseType.UInt64, BaseType.Any },
            { BaseType.Error, BaseType.UInt64, BaseType.Null, BaseType.UInt64, BaseType.Float, BaseType.Currency, BaseType.Float, BaseType.UInt64, BaseType.DateTime, BaseType.UInt64, BaseType.UInt64, BaseType.Any },
            { BaseType.Error, BaseType.Any, BaseType.Any, BaseType.Any, BaseType.Any, BaseType.Any, BaseType.Any, BaseType.Any, BaseType.Any, BaseType.Any, BaseType.Any, BaseType.Any }
        };

        public static bool Coercion(ref Variant value1, ref Variant value2)
        {
            if (value1.VarType == value2.VarType)
                return false;

            BaseType leftBaseType = GetBaseType(value1.VarType);
            BaseType rightBaseType = GetBaseType(value2.VarType);
            BaseType targetBaseType = CoercionTypeMap[(int)leftBaseType, (int)rightBaseType];

            if (targetBaseType == BaseType.Error)
                RaiseInvalidCoercion(value1, value2);

            if (targetBaseType == BaseType.Null)
                return false;

            value1 = CastToBaseType(value1, targetBaseType);
            value2 = CastToBaseType(value2, targetBaseType);
            return true;
        }

        private static BaseType GetBaseType(VariantType variantType)
        {
            switch (variantType)
            {
                case VariantType.Null:
                    return BaseType.Null;
                case VariantType.Byte:
                case VariantType.Integer:
                    return BaseType.Integer;
                case VariantType.Long:
                    return BaseType.Int64;
                case VariantType.Double:
                    return BaseType.Float;
                case VariantType.Decimal:
                    return BaseType.Currency;
                case VariantType.String:
                case VariantType.Char:
                    return BaseType.String;
                case VariantType.Boolean:
                    return BaseType.Boolean;
                case VariantType.DateTime:
                    return BaseType.DateTime;
                default:
                    return BaseType.Error;
            }
        }

        private static Variant CastToBaseType(Variant value, BaseType targetBaseType)
        {
            switch (targetBaseType)
            {
                case BaseType.Integer:
                    return ToInteger(value);
                case BaseType.Int64:
                    return ToInt64(value);
                case BaseType.Float:
                    return ToDouble(value);
                case BaseType.Currency:
                    return ToCurrency(value);
                case BaseType.String:
                    return value.ToString();
                case BaseType.Boolean:
                    return ToBoolean(value);
                case BaseType.DateTime:
                    return ToDateTime(value);
                default:
                    RaiseInvalidCoercion(value, value);
                    return value;
            }
        }

        private static int ToInteger(Variant value)
        {
            switch (value.VarType)
            {
                case VariantType.Null:
                    return 0;
                case VariantType.Boolean:
                    return ToDelphiBooleanInteger((bool)value);
                case VariantType.Byte:
                    return (byte)value;
                case VariantType.Integer:
                    return (int)value;
                case VariantType.Long:
                    return checked((int)(long)value);
                case VariantType.Decimal:
                    return Convert.ToInt32((decimal)value, CultureInfo.CurrentCulture);
                case VariantType.Double:
                    return Convert.ToInt32((double)value, CultureInfo.CurrentCulture);
                case VariantType.DateTime:
                    return Convert.ToInt32(((DateTime)value).ToOADate(), CultureInfo.CurrentCulture);
                case VariantType.String:
                case VariantType.Char:
                    return ParseInteger(value.ToString());
                default:
                    RaiseInvalidCoercion(value, value);
                    return 0;
            }
        }

        private static long ToInt64(Variant value)
        {
            switch (value.VarType)
            {
                case VariantType.Null:
                    return 0;
                case VariantType.Boolean:
                    return ToDelphiBooleanInteger((bool)value);
                case VariantType.Byte:
                    return (byte)value;
                case VariantType.Integer:
                    return (int)value;
                case VariantType.Long:
                    return (long)value;
                case VariantType.Decimal:
                    return Convert.ToInt64((decimal)value, CultureInfo.CurrentCulture);
                case VariantType.Double:
                    return Convert.ToInt64((double)value, CultureInfo.CurrentCulture);
                case VariantType.DateTime:
                    return Convert.ToInt64(((DateTime)value).ToOADate(), CultureInfo.CurrentCulture);
                case VariantType.String:
                case VariantType.Char:
                    return ParseInt64(value.ToString());
                default:
                    RaiseInvalidCoercion(value, value);
                    return 0;
            }
        }

        private static double ToDouble(Variant value)
        {
            switch (value.VarType)
            {
                case VariantType.Null:
                    return 0.0;
                case VariantType.Boolean:
                    return ToDelphiBooleanInteger((bool)value);
                case VariantType.Byte:
                    return (byte)value;
                case VariantType.Integer:
                    return (int)value;
                case VariantType.Long:
                    return (long)value;
                case VariantType.Decimal:
                    return (double)(decimal)value;
                case VariantType.Double:
                    return (double)value;
                case VariantType.DateTime:
                    return ((DateTime)value).ToOADate();
                case VariantType.String:
                case VariantType.Char:
                    return ParseDouble(value.ToString());
                default:
                    RaiseInvalidCoercion(value, value);
                    return 0.0;
            }
        }

        private static decimal ToCurrency(Variant value)
        {
            switch (value.VarType)
            {
                case VariantType.Null:
                    return 0m;
                case VariantType.Boolean:
                    return ToDelphiBooleanInteger((bool)value);
                case VariantType.Byte:
                    return (byte)value;
                case VariantType.Integer:
                    return (int)value;
                case VariantType.Long:
                    return (long)value;
                case VariantType.Decimal:
                    return (decimal)value;
                case VariantType.Double:
                    return Convert.ToDecimal((double)value, CultureInfo.CurrentCulture);
                case VariantType.DateTime:
                    return Convert.ToDecimal(((DateTime)value).ToOADate(), CultureInfo.CurrentCulture);
                case VariantType.String:
                case VariantType.Char:
                    return ParseCurrency(value.ToString());
                default:
                    RaiseInvalidCoercion(value, value);
                    return 0m;
            }
        }

        private static bool ToBoolean(Variant value)
        {
            switch (value.VarType)
            {
                case VariantType.Null:
                    return false;
                case VariantType.Boolean:
                    return (bool)value;
                case VariantType.Byte:
                    return (byte)value != 0;
                case VariantType.Integer:
                    return (int)value != 0;
                case VariantType.Long:
                    return (long)value != 0;
                case VariantType.Decimal:
                    return (decimal)value != 0m;
                case VariantType.Double:
                    return (double)value != 0.0;
                case VariantType.DateTime:
                    return ((DateTime)value).ToOADate() != 0.0;
                case VariantType.String:
                case VariantType.Char:
                    return ParseBoolean(value.ToString());
                default:
                    RaiseInvalidCoercion(value, value);
                    return false;
            }
        }

        private static DateTime ToDateTime(Variant value)
        {
            switch (value.VarType)
            {
                case VariantType.Null:
                    return DateTime.FromOADate(0.0);
                case VariantType.Boolean:
                    return DateTime.FromOADate(ToDelphiBooleanInteger((bool)value));
                case VariantType.Byte:
                    return DateTime.FromOADate((byte)value);
                case VariantType.Integer:
                    return DateTime.FromOADate((int)value);
                case VariantType.Long:
                    return DateTime.FromOADate((long)value);
                case VariantType.Decimal:
                    return DateTime.FromOADate((double)(decimal)value);
                case VariantType.Double:
                    return DateTime.FromOADate((double)value);
                case VariantType.DateTime:
                    return (DateTime)value;
                case VariantType.String:
                case VariantType.Char:
                    return ParseDateTime(value.ToString());
                default:
                    RaiseInvalidCoercion(value, value);
                    return DateTime.FromOADate(0.0);
            }
        }

        private static int ParseInteger(string value)
        {
            int integerValue;
            if (int.TryParse(value, NumberStyles.Integer, CultureInfo.CurrentCulture, out integerValue))
                return integerValue;

            bool booleanValue;
            if (TryParseBoolean(value, out booleanValue))
                return ToDelphiBooleanInteger(booleanValue);

            return Convert.ToInt32(ParseDouble(value), CultureInfo.CurrentCulture);
        }

        private static long ParseInt64(string value)
        {
            long int64Value;
            if (long.TryParse(value, NumberStyles.Integer, CultureInfo.CurrentCulture, out int64Value))
                return int64Value;

            bool booleanValue;
            if (TryParseBoolean(value, out booleanValue))
                return ToDelphiBooleanInteger(booleanValue);

            return Convert.ToInt64(ParseDouble(value), CultureInfo.CurrentCulture);
        }

        private static double ParseDouble(string value)
        {
            return double.Parse(value, NumberStyles.Float | NumberStyles.AllowThousands, CultureInfo.CurrentCulture);
        }

        private static decimal ParseCurrency(string value)
        {
            return decimal.Parse(value, NumberStyles.Currency, CultureInfo.CurrentCulture);
        }

        private static DateTime ParseDateTime(string value)
        {
            DateTime dateTimeValue;
            if (DateTime.TryParse(value, CultureInfo.CurrentCulture, DateTimeStyles.None, out dateTimeValue))
                return dateTimeValue;

            return DateTime.FromOADate(ParseDouble(value));
        }

        private static bool ParseBoolean(string value)
        {
            bool booleanValue;
            if (TryParseBoolean(value, out booleanValue))
                return booleanValue;

            throw new UnNamedException(Translator.TranslateStr(438));
        }

        private static bool TryParseBoolean(string value, out bool result)
        {
            if (value == "0")
            {
                result = false;
                return true;
            }

            if (value == "-1")
            {
                result = true;
                return true;
            }

            return bool.TryParse(value, out result);
        }

        private static int ToDelphiBooleanInteger(bool value)
        {
            return value ? -1 : 0;
        }

        private static void RaiseInvalidCoercion(Variant value1, Variant value2)
        {
            throw new UnNamedException(Translator.TranslateStr(438) +
                " Variant coercion " + value1.GetTypeString() + "-" + value2.GetTypeString());
        }
    }
}