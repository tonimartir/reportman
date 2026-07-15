using System;
using System.Text;

namespace Reportman.Drawing
{
    /// <summary>
    /// Parses the application-identifier data of a GS1-128 (UCC/EAN-128) barcode payload, exposing decoded fields such as SSCC, product code, dates, batch/serial numbers and a wide set of weight, dimension and volume measurements.
    /// </summary>
    public class GS1_128
    {
        /// <summary>
        /// Expiration date of the product (application identifier 17).
        /// </summary>
        public DateTime ExpirationDate = DateTime.MinValue;
        /// <summary>
        /// Best-before / sell-by date of the product (application identifier 15).
        /// </summary>
        public DateTime SellByDate = DateTime.MinValue;
        /// <summary>
        /// Serial Shipping Container Code, an 18-digit logistics unit identifier (application identifier 00).
        /// </summary>
        public string SSCC = "";
        /// <summary>
        /// Company prefix portion extracted from the <see cref="SSCC"/>.
        /// </summary>
        public string SSCC_Company = "";
        /// <summary>
        /// Serial reference portion extracted from the <see cref="SSCC"/>.
        /// </summary>
        public string SSCC_Number = "";
        /// <summary>
        /// Global Trade Item Number (GTIN) of the item (application identifiers 01 and 02).
        /// </summary>
        public string ProductCode = "";
        /// <summary>
        /// Production date and time as a raw string (application identifier 8008).
        /// </summary>
        public string ProductionDateTime = "";
        /// <summary>
        /// Production date of the product (application identifier 11).
        /// </summary>
        public DateTime ProductionDate = DateTime.MinValue;
        /// <summary>
        /// Packaging date of the product (application identifier 13).
        /// </summary>
        public DateTime PackagingDate = DateTime.MinValue;
        /// <summary>
        /// Product variant number (application identifier 20).
        /// </summary>
        public string ProductVariant = "";
        /// <summary>
        /// Serial number of the item (application identifiers 21 and 250).
        /// </summary>
        public string SerialNumber = "";
        /// <summary>
        /// HIBCC (Health Industry Business Communications Council) identifier.
        /// </summary>
        public string HIBCC = "";
        /// <summary>
        /// Lot number of the item.
        /// </summary>
        public string LotNumber = "";
        /// <summary>
        /// Secondary serial number of the item.
        /// </summary>
        public string SecondSerialNumber = "";
        /// <summary>
        /// Count or quantity of contained items (application identifiers 30 and 37).
        /// </summary>
        public decimal Quantity = 0.0m;
        /// <summary>
        /// Volume of the product.
        /// </summary>
        public decimal ProductVolume = 0.0m;
        /// <summary>
        /// Gross weight of the container.
        /// </summary>
        public decimal ContainerGrossWeight = 0.0m;
        /// <summary>
        /// Customer purchase order number (application identifier 400).
        /// </summary>
        public string CustomerPurchaseNumber = "";
        /// <summary>
        /// Batch or lot number (application identifier 10).
        /// </summary>
        public string BatchNumber = "";
        /// <summary>
        /// Mutually agreed information between trading partners (application identifier 90).
        /// </summary>
        public string Mutual = "";
        /// <summary>
        /// Company-internal information (application identifiers 91 to 99).
        /// </summary>
        public string InternalCode = "";
        // 31
        /// <summary>
        /// Net weight of the product in kilograms (application identifier 310).
        /// </summary>
        public decimal ProductNetWeightKg = 0m;
        /// <summary>
        /// Length or first dimension of the product in meters (application identifier 311).
        /// </summary>
        public decimal ProductLengthMeters = 0m;
        /// <summary>
        /// Width or second dimension of the product in meters (application identifier 312).
        /// </summary>
        public decimal ProductWidthMeters = 0m;
        /// <summary>
        /// Depth or third dimension of the product in meters (application identifier 313).
        /// </summary>
        public decimal ProductDepthMeters = 0m;
        /// <summary>
        /// Area of the product in square meters (application identifier 314).
        /// </summary>
        public decimal ProductAreaMeters2 = 0m;
        /// <summary>
        /// Net volume of the product in liters (application identifier 315).
        /// </summary>
        public decimal ProductNetVolumeLiters = 0m;
        /// <summary>
        /// Net volume of the product in cubic meters (application identifier 316).
        /// </summary>
        public decimal ProductNetVolumeMeters3 = 0m;
        // 32
        /// <summary>
        /// Net weight of the product in pounds (application identifier 320).
        /// </summary>
        public decimal ProductNetWeightPounds = 0m;
        /// <summary>
        /// Length or first dimension of the product in inches (application identifier 321).
        /// </summary>
        public decimal ProductLengthInch = 0m;
        /// <summary>
        /// Length or first dimension of the product in feet (application identifier 322).
        /// </summary>
        public decimal ProductLengthFeet = 0m;
        /// <summary>
        /// Length or first dimension of the product in yards (application identifier 323).
        /// </summary>
        public decimal ProductLengthYard = 0m;
        /// <summary>
        /// Width or second dimension of the product in inches (application identifier 324).
        /// </summary>
        public decimal ProductWidthInch = 0m;
        /// <summary>
        /// Width or second dimension of the product in feet (application identifier 325).
        /// </summary>
        public decimal ProductWidthFeet = 0m;
        /// <summary>
        /// Width or second dimension of the product in yards (application identifier 326).
        /// </summary>
        public decimal ProductWidthYard = 0m;
        /// <summary>
        /// Depth or third dimension of the product in inches (application identifier 327).
        /// </summary>
        public decimal ProductDepthInch = 0m;
        /// <summary>
        /// Depth or third dimension of the product in feet (application identifier 328).
        /// </summary>
        public decimal ProductDepthFeet = 0m;
        /// <summary>
        /// Depth or third dimension of the product in yards (application identifier 329).
        /// </summary>
        public decimal ProductDepthYard = 0m;
        // 33
        /// <summary>
        /// Gross weight of the container in kilograms (application identifier 330).
        /// </summary>
        public decimal ContainerGrossWeightKg = 0m;
        /// <summary>
        /// Length or first dimension of the container in meters (application identifier 331).
        /// </summary>
        public decimal ContainerLengthMeters = 0m;
        /// <summary>
        /// Width or second dimension of the container in meters (application identifier 332).
        /// </summary>
        public decimal ContainerWidthMeters = 0m;
        /// <summary>
        /// Depth or third dimension of the container in meters (application identifier 333).
        /// </summary>
        public decimal ContainerDepthMeters = 0m;
        /// <summary>
        /// Area of the container in square meters (application identifier 334).
        /// </summary>
        public decimal ContainerAreaMeters2 = 0m;
        /// <summary>
        /// Gross volume of the container in liters (application identifier 335).
        /// </summary>
        public decimal ContainerGrossVolumeLiters = 0m;
        /// <summary>
        /// Gross volume of the container in cubic meters (application identifier 336).
        /// </summary>
        public decimal ContainerGrossVolumeMeters3 = 0m;
        // 34
        /// <summary>
        /// Gross weight of the container in pounds (application identifier 340).
        /// </summary>
        public decimal ContainerGrossWeightPounds = 0m;
        /// <summary>
        /// Length or first dimension of the container in inches (application identifier 341).
        /// </summary>
        public decimal ContainerLengthInch = 0m;
        /// <summary>
        /// Length or first dimension of the container in feet (application identifier 342).
        /// </summary>
        public decimal ContainerLengthFeet = 0m;
        /// <summary>
        /// Length or first dimension of the container in yards (application identifier 343).
        /// </summary>
        public decimal ContainerLengthYard = 0m;
        /// <summary>
        /// Width or second dimension of the container in inches (application identifier 344).
        /// </summary>
        public decimal ContainerWidthInch = 0m;
        /// <summary>
        /// Width or second dimension of the container in feet (application identifier 345).
        /// </summary>
        public decimal ContainerWidthFeet = 0m;
        /// <summary>
        /// Width or second dimension of the container in yards (application identifier 346).
        /// </summary>
        public decimal ContainerWidthYard = 0m;
        /// <summary>
        /// Depth or third dimension of the container in inches (application identifier 347).
        /// </summary>
        public decimal ContainerDepthInch = 0m;
        /// <summary>
        /// Depth or third dimension of the container in feet (application identifier 348).
        /// </summary>
        public decimal ContainerDepthFeet = 0m;
        /// <summary>
        /// Depth or third dimension of the container in yards (application identifier 349).
        /// </summary>
        public decimal ContainerDepthYard = 0m;
        // 35
        /// <summary>
        /// Area of the product in square inches (application identifier 350).
        /// </summary>
        public decimal ProductAreaInch2 = 0m;
        /// <summary>
        /// Area of the product in square feet (application identifier 351).
        /// </summary>
        public decimal ProductAreaFeet2 = 0m;
        /// <summary>
        /// Area of the product in square yards (application identifier 352).
        /// </summary>
        public decimal ProductAreaYard2 = 0m;
        /// <summary>
        /// Area of the container in square inches (application identifier 353).
        /// </summary>
        public decimal ContainerAreaInch2 = 0m;
        /// <summary>
        /// Area of the container in square feet (application identifier 354).
        /// </summary>
        public decimal ContainerAreaFeet2 = 0m;
        /// <summary>
        /// Area of the container in square yards (application identifier 355).
        /// </summary>
        public decimal ContainerAreaYard2 = 0m;
        /// <summary>
        /// Net weight in troy ounces (application identifier 356).
        /// </summary>
        public decimal NetWeightTroyOunces = 0m;
        /// <summary>
        /// Net weight in ounces (application identifier 357).
        /// </summary>
        public decimal NetWeightOunces = 0m;
        // 36
        /// <summary>
        /// Volume of the product in quarts (application identifier 360).
        /// </summary>
        public decimal ProductVolumeQuarts = 0m;
        /// <summary>
        /// Volume of the product in gallons (application identifier 361).
        /// </summary>
        public decimal ProductVolumeGallons = 0m;
        /// <summary>
        /// Volume of the container in quarts (application identifier 362).
        /// </summary>
        public decimal ContainerVolumeQuarts = 0m;
        /// <summary>
        /// Volume of the container in gallons (application identifier 363).
        /// </summary>
        public decimal ContainerVolumeGallons = 0m;
        /// <summary>
        /// Volume of the product in cubic inches (application identifier 364).
        /// </summary>
        public decimal ProductVolumeInch3 = 0m;
        /// <summary>
        /// Volume of the product in cubic feet (application identifier 365).
        /// </summary>
        public decimal ProductVolumeFeet3 = 0m;
        /// <summary>
        /// Volume of the product in cubic yards (application identifier 366).
        /// </summary>
        public decimal ProductVolumeYard3 = 0m;
        /// <summary>
        /// Volume of the container in cubic inches (application identifier 367).
        /// </summary>
        public decimal ContainerVolumeInch3 = 0m;
        /// <summary>
        /// Volume of the container in cubic feet (application identifier 368).
        /// </summary>
        public decimal ContainerVolumeFeet3 = 0m;
        /// <summary>
        /// Volume of the container in cubic yards (application identifier 369).
        /// </summary>
        public decimal ContainerVolumeYard3 = 0m;




        /// <summary>
        /// Decodes a fixed six-digit GS1 measurement value with a leading implied-decimal-point indicator, advancing <paramref name="idx"/> past the consumed characters.
        /// </summary>
        /// <param name="nbarcode">The barcode payload being decoded.</param>
        /// <param name="idx">The current read position, advanced past the seven consumed characters on return.</param>
        /// <returns>The decoded value with the implied decimal point applied.</returns>
        public decimal DecodeNumber(string nbarcode, ref int idx)
        {
            if (!(char.IsDigit(nbarcode[idx])))
                throw new Exception("Invalid digit number DecodeNumber 128");
            int decimalplaces = System.Convert.ToInt32(nbarcode[idx] + "");
            if (decimalplaces > 6)
                throw new Exception("Invalid digit number decimal places DecodeNumber 128");
            idx++;
            decimal intpart = 0;
            if (decimalplaces == 0)
            {
                intpart = System.Convert.ToDecimal(nbarcode.Substring(idx, 6));
            }
            else
            {
                if (decimalplaces > 4)
                    decimalplaces = 4;
                intpart = System.Convert.ToDecimal(nbarcode.Substring(idx, 6 - decimalplaces));
                decimal decpart = System.Convert.ToDecimal(nbarcode.Substring(idx + 6 - decimalplaces, decimalplaces));
                while (decimalplaces > 0)
                {
                    decpart = decpart / 10.0m;
                    decimalplaces--;
                }
                intpart = intpart + decpart;
            }
            idx = idx + 6;
            return intpart;
        }
        /// <summary>
        /// Reads a variable-length field starting at <paramref name="idx"/> until a FNC1 separator (character 29) or the end of the string, advancing <paramref name="idx"/> past the separator.
        /// </summary>
        /// <param name="nbarcode">The barcode payload being decoded.</param>
        /// <param name="idx">The current read position, advanced past the read field and separator on return.</param>
        /// <returns>The characters read up to the separator.</returns>
        public string Advance(string nbarcode, ref int idx)
        {
            StringBuilder nresult = new();
            for (; idx < nbarcode.Length; idx++)
            {
                if (nbarcode[idx] == (char)29)
                {
                    idx++;
                    break;
                }
                else
                    nresult.Append(nbarcode[idx]);
            }
            return nresult.ToString();
        }
        /// <summary>
        /// Parses a full GS1-128 payload, populating the decoded fields of this instance according to the application identifiers found in <paramref name="nbarcode"/>.
        /// </summary>
        /// <param name="nbarcode">The concatenated GS1-128 application-identifier data to decode.</param>
        public void Decode(string nbarcode)
        {
            int idx = 0;
            string previousprefix = "";
            while (idx < nbarcode.Length - 1)
            {
                string prefix2 = nbarcode.Substring(idx, 2);
                if (prefix2[0] == (char)29)
                {
                    idx++;
                    if (!(idx < nbarcode.Length - 1))
                        break;
                    prefix2 = nbarcode.Substring(idx, 2);
                }
                string prefix3 = nbarcode.Substring(idx, 3);
                string prefix4 = prefix3;
                if (nbarcode.Length > idx + 2)
                    prefix4 = nbarcode.Substring(idx, 4);

                switch (prefix2)
                {
                    case "00":
                        if (nbarcode.Length < 20)
                            throw new Exception("Incorrect SSCC Length, expected 20");
                        SSCC = nbarcode.Substring(idx + 2, 18);
                        SSCC_Company = SSCC.Substring(1, 8);
                        SSCC_Number = SSCC.Substring(9, 9);
                        idx = idx + 20;
                        break;
                    case "01":
                    case "02":
                        ProductCode = nbarcode.Substring(idx + 2, 14);
                        idx = idx + 16;
                        break;
                    case "10":
                        idx = idx + 2;
                        BatchNumber = Advance(nbarcode, ref idx); ;

                        break;
                    case "11":
                        ProductionDate = DecodeDate(nbarcode, idx + 2);
                        idx = idx + 8;
                        break;
                    case "13":
                        PackagingDate = DecodeDate(nbarcode, idx + 2);
                        idx = idx + 8;
                        break;
                    case "15":
                        SellByDate = DecodeDate(nbarcode, idx + 2);
                        idx = idx + 8;
                        break;
                    case "17":
                        ExpirationDate = DecodeDate(nbarcode, idx + 2);
                        idx = idx + 8;
                        break;
                    case "20":
                        ProductVariant = nbarcode.Substring(idx + 2, 2);
                        idx = idx + 4;
                        break;
                    case "21":
                        idx = idx + 2;
                        SerialNumber = Advance(nbarcode, ref idx); ;


                        break;
                    case "25":
                        switch (prefix3)
                        {
                            case "250":
                                idx = idx + 3;
                                string SecondarySerialNumber = Advance(nbarcode, ref idx);
                                if (SerialNumber.Length == 0)
                                    SerialNumber = SecondarySerialNumber;
                                break;
                            case "251":
                                idx = idx + 3;
                                string ReferenceToSource = Advance(nbarcode, ref idx);
                                break;
                            case "253":
                                idx = idx + 3;
                                string GlobalDocumentTypeIdentifier = Advance(nbarcode, ref idx);
                                break;
                            case "254":
                                idx = idx + 3;
                                string GLNExtensionComponent = Advance(nbarcode, ref idx);
                                break;
                            case "255":
                                idx = idx + 3;
                                string GlobalCouponNumber = Advance(nbarcode, ref idx);
                                break;
                            default:
                                throw new Exception("Unimplemented prefix: " + prefix3);
                        }
                        break;
                    case "37":
                        idx = idx + 2;
                        string numberunits = Advance(nbarcode, ref idx);
                        if (DoubleUtil.IsNumeric(numberunits, System.Globalization.NumberStyles.Number))
                            Quantity = System.Convert.ToDecimal(numberunits);
                        break;
                    case "30":
                        idx = idx + 2;
                        string numberunits2 = Advance(nbarcode, ref idx);
                        if (DoubleUtil.IsNumeric(numberunits2, System.Globalization.NumberStyles.Number))
                            Quantity = System.Convert.ToDecimal(numberunits2);
                        break;
                    case "40":
                        if (prefix3 == "400")
                        {
                            idx = idx + 3;
                            CustomerPurchaseNumber = Advance(nbarcode, ref idx);
                        }
                        break;
                    case "24":
                        if (prefix3 == "240")
                        {
                            idx = idx + 3;
                            Advance(nbarcode, ref idx);
                        }
                        else
                            throw new Exception("Unimplemented prefix: " + prefix3);
                        break;
                    case "90":
                        idx = idx + 2;
                        Mutual = Advance(nbarcode, ref idx);
                        break;
                    case "91":
                    case "92":
                    case "93":
                    case "94":
                    case "95":
                    case "96":
                    case "97":
                    case "98":
                    case "99":
                        idx = idx + 2;
                        InternalCode = Advance(nbarcode, ref idx);
                        break;
                    case "31":
                        switch (prefix3)
                        {
                            case "310":
                                idx = idx + 3;
                                ProductNetWeightKg = DecodeNumber(nbarcode, ref idx);
                                break;
                            case "311":
                                idx = idx + 3;
                                ProductLengthMeters = DecodeNumber(nbarcode, ref idx);
                                break;
                            case "312":
                                idx = idx + 3;
                                ProductWidthMeters = DecodeNumber(nbarcode, ref idx);
                                break;
                            case "313":
                                idx = idx + 3;
                                ProductDepthMeters = DecodeNumber(nbarcode, ref idx);
                                break;
                            case "314":
                                idx = idx + 3;
                                ProductAreaMeters2 = DecodeNumber(nbarcode, ref idx);
                                break;
                            case "315":
                                idx = idx + 3;
                                ProductNetVolumeLiters = DecodeNumber(nbarcode, ref idx);
                                break;
                            case "316":
                                idx = idx + 3;
                                ProductNetVolumeMeters3 = DecodeNumber(nbarcode, ref idx);
                                break;
                            default:
                                throw new Exception("Unimplemented prefix: " + prefix3);
                        }
                        break;
                    case "32":
                        switch (prefix3)
                        {
                            case "320":
                                idx = idx + 3;
                                ProductNetWeightPounds = DecodeNumber(nbarcode, ref idx);
                                break;
                            case "321":
                                idx = idx + 3;
                                ProductLengthInch = DecodeNumber(nbarcode, ref idx);
                                break;
                            case "322":
                                idx = idx + 3;
                                ProductLengthFeet = DecodeNumber(nbarcode, ref idx);
                                break;
                            case "323":
                                idx = idx + 3;
                                ProductLengthYard = DecodeNumber(nbarcode, ref idx);
                                break;
                            case "324":
                                idx = idx + 3;
                                ProductWidthInch = DecodeNumber(nbarcode, ref idx);
                                break;
                            case "325":
                                idx = idx + 3;
                                ProductWidthFeet = DecodeNumber(nbarcode, ref idx);
                                break;
                            case "326":
                                idx = idx + 3;
                                ProductWidthYard = DecodeNumber(nbarcode, ref idx);
                                break;
                            case "327":
                                idx = idx + 3;
                                ProductDepthInch = DecodeNumber(nbarcode, ref idx);
                                break;
                            case "328":
                                idx = idx + 3;
                                ProductDepthFeet = DecodeNumber(nbarcode, ref idx);
                                break;
                            case "329":
                                idx = idx + 3;
                                ProductDepthYard = DecodeNumber(nbarcode, ref idx);
                                break;
                            default:
                                throw new Exception("Unimplemented prefix: " + prefix3);
                        }
                        break;
                    case "33":
                        switch (prefix3)
                        {
                            case "330":
                                idx = idx + 3;
                                ContainerGrossWeightKg = DecodeNumber(nbarcode, ref idx);
                                break;
                            case "331":
                                idx = idx + 3;
                                ContainerLengthMeters = DecodeNumber(nbarcode, ref idx);
                                break;
                            case "332":
                                idx = idx + 3;
                                ContainerWidthMeters = DecodeNumber(nbarcode, ref idx);
                                break;
                            case "333":
                                idx = idx + 3;
                                ContainerDepthMeters = DecodeNumber(nbarcode, ref idx);
                                break;
                            case "334":
                                idx = idx + 3;
                                ContainerAreaMeters2 = DecodeNumber(nbarcode, ref idx);
                                break;
                            case "335":
                                idx = idx + 3;
                                ContainerGrossVolumeLiters = DecodeNumber(nbarcode, ref idx);
                                break;
                            case "336":
                                idx = idx + 3;
                                ContainerGrossVolumeMeters3 = DecodeNumber(nbarcode, ref idx);
                                break;
                            default:
                                throw new Exception("Unimplemented prefix: " + prefix3);
                        }
                        break;
                    case "34":
                        switch (prefix3)
                        {
                            case "340":
                                idx = idx + 3;
                                ContainerGrossWeightPounds = DecodeNumber(nbarcode, ref idx);
                                break;
                            case "341":
                                idx = idx + 3;
                                ContainerLengthInch = DecodeNumber(nbarcode, ref idx);
                                break;
                            case "342":
                                idx = idx + 3;
                                ContainerLengthFeet = DecodeNumber(nbarcode, ref idx);
                                break;
                            case "343":
                                idx = idx + 3;
                                ContainerLengthYard = DecodeNumber(nbarcode, ref idx);
                                break;
                            case "344":
                                idx = idx + 3;
                                ContainerWidthInch = DecodeNumber(nbarcode, ref idx);
                                break;
                            case "345":
                                idx = idx + 3;
                                ContainerWidthFeet = DecodeNumber(nbarcode, ref idx);
                                break;
                            case "346":
                                idx = idx + 3;
                                ContainerWidthYard = DecodeNumber(nbarcode, ref idx);
                                break;
                            case "347":
                                idx = idx + 3;
                                ContainerDepthInch = DecodeNumber(nbarcode, ref idx);
                                break;
                            case "348":
                                idx = idx + 3;
                                ContainerDepthFeet = DecodeNumber(nbarcode, ref idx);
                                break;
                            case "349":
                                idx = idx + 3;
                                ContainerDepthYard = DecodeNumber(nbarcode, ref idx);
                                break;
                            default:
                                throw new Exception("Unimplemented prefix: " + prefix3);
                        }
                        break;
                    case "35":
                        switch (prefix3)
                        {
                            case "350":
                                idx = idx + 3;
                                ProductAreaInch2 = DecodeNumber(nbarcode, ref idx);
                                break;
                            case "351":
                                idx = idx + 3;
                                ProductAreaFeet2 = DecodeNumber(nbarcode, ref idx);
                                break;
                            case "352":
                                idx = idx + 3;
                                ProductAreaYard2 = DecodeNumber(nbarcode, ref idx);
                                break;
                            case "353":
                                idx = idx + 3;
                                ContainerAreaInch2 = DecodeNumber(nbarcode, ref idx);
                                break;
                            case "354":
                                idx = idx + 3;
                                ContainerAreaFeet2 = DecodeNumber(nbarcode, ref idx);
                                break;
                            case "355":
                                idx = idx + 3;
                                ContainerAreaYard2 = DecodeNumber(nbarcode, ref idx);
                                break;
                            case "356":
                                idx = idx + 3;
                                NetWeightTroyOunces = DecodeNumber(nbarcode, ref idx);
                                break;
                            case "357":
                                idx = idx + 3;
                                NetWeightOunces = DecodeNumber(nbarcode, ref idx);
                                break;
                            default:
                                throw new Exception("Unimplemented prefix: " + prefix3);
                        }
                        break;
                    case "36":
                        switch (prefix3)
                        {
                            case "360":
                                idx = idx + 3;
                                ProductVolumeQuarts = DecodeNumber(nbarcode, ref idx);
                                break;
                            case "361":
                                idx = idx + 3;
                                ProductVolumeGallons = DecodeNumber(nbarcode, ref idx);
                                break;
                            case "362":
                                idx = idx + 3;
                                ContainerVolumeQuarts = DecodeNumber(nbarcode, ref idx);
                                break;
                            case "363":
                                idx = idx + 3;
                                ContainerVolumeGallons = DecodeNumber(nbarcode, ref idx);
                                break;
                            case "364":
                                idx = idx + 3;
                                ProductVolumeInch3 = DecodeNumber(nbarcode, ref idx);
                                break;
                            case "365":
                                idx = idx + 3;
                                ProductVolumeFeet3 = DecodeNumber(nbarcode, ref idx);
                                break;
                            case "366":
                                idx = idx + 3;
                                ProductVolumeYard3 = DecodeNumber(nbarcode, ref idx);
                                break;
                            case "367":
                                idx = idx + 3;
                                ContainerVolumeInch3 = DecodeNumber(nbarcode, ref idx);
                                break;
                            case "368":
                                idx = idx + 3;
                                ContainerVolumeFeet3 = DecodeNumber(nbarcode, ref idx);
                                break;
                            case "369":
                                idx = idx + 3;
                                ContainerVolumeYard3 = DecodeNumber(nbarcode, ref idx);
                                break;
                            default:
                                throw new Exception("Unimplemented prefix: " + prefix3);
                        }
                        break;
                    case "80":
                        switch (prefix3)
                        {
                            case "800":
                                switch (prefix4)
                                {
                                    // Fecha y hora de fabricación de 8 a 12
                                    case "8008":
                                        idx = idx + 4;

                                        ProductionDateTime = Advance(nbarcode, ref idx); ;

                                        break;
                                }
                                break;
                        }
                        break;
                    default:
                        {
                            if (previousprefix == "01")
                                idx--;
                            else
                                throw new Exception("Unimplemented prefix: " + prefix2);
                        }
                        break;
                }
                previousprefix = prefix2;
            }
        }
        private DateTime DecodeDate(string barcode, int position)
        {
            string nyear = barcode.Substring(position, 2);
            int prefixyear = System.Convert.ToInt32(nyear);
            if (prefixyear > 80)
            {
                prefixyear = 1900 + prefixyear;
            }
            else
            {
                prefixyear = 2000 + prefixyear;
            }
            int nday = System.Convert.ToInt32(barcode.Substring(position + 4, 2));
            int nmonth = System.Convert.ToInt32(barcode.Substring(position + 2, 2));
            if (nday == 0)
            {
                nday = DateTime.DaysInMonth(prefixyear, nmonth);
            }
            return new DateTime(prefixyear, nmonth,
                nday);
        }
    }
}
