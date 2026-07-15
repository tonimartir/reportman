namespace Reportman.Reporting.Design.Json
{
    /// <summary>
    /// Identifies the serialization format used to read or write a report document,
    /// either JSON or XML.
    /// </summary>
    public enum ReportDocumentFormat
    {
        /// <summary>
        /// The report document is serialized in JSON format.
        /// </summary>
        Json,
        /// <summary>
        /// The report document is serialized in XML format.
        /// </summary>
        Xml
    }
}