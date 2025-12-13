# Reportman .Net Library

A cross-platform reporting library for .NET and Delphi/C++Builder, ActiveX and command line.

Report Designer and Report server, supporting .Net, Delphi/C++Builder, ActiveX and command line tools.
Currently supported platforms: Windows and Linux.
Supported .NET versions: .NET Framework 4.8, .NET 8, .NET 9

## Usage

```csharp
var report = new Reportman.Reporting.Report();
report.LoadFromFile("test.rep");

// PDF
var printout = new Reportman.Drawing.Windows.PrintOutPDF();
printout.FileName = "test.pdf";
printout.Print(report.metafile);

// Preview/print report
var printoutWin = new Reportman.Reporting.Forms.PrintOutReportWinForms();
printoutWin.Preview = true;
printoutWin.Print(report.metafile);
```

---

## Architecture Overview

Reportman is organized into several **modular libraries**, each with a specific responsibility. Developers can choose which components to use, and cross-platform compatibility is ensured where possible.

### Core Libraries

| Library                             | Purpose                                                                                                                                 | Platforms / Notes                                                     |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **Reportman.Reporting**             | Core reporting engine. Loads, parses, and executes report templates (`.rep`). Produces a **metafile** representing the rendered report, but allways using an output driver defined in other libraries. | Cross-platform: Windows, Linux. Supports .NET Framework 4.8, .NET 8/9 |
| **Reportman.Drawing**               | Base drawing and rendering library used by all output formats. Provides common graphics abstraction. Core for all output formats                                    | Cross-platform                                                        |
| **Reportman.Drawing.CrossPlatform** | Output to PDF using FreeType and SkiaSharp. Handles fonts, PDF generation, and multiplatform PDF rendering.                                 | Cross-platform                                                        |
| **Reportman.Drawing.Windows**       | Output to PDF, Bitmap, or Excel using Windows APIs (OLE, GDI, DirectWrite).                                                                          | Windows only                                                          |
| **Reportman.Drawing.Excel**         | Cross-platform Excel output using ClosedXML. No Excel installation required.                                                            | Cross-platform                                                        |

### UI Libraries

| Library                       | Purpose                                                                                                                                               | Platforms / Notes           |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| **Reportman.Reporting.Forms** | Preview reports and modify report parameters. Page setup and basic report properties can be edited via UI.                                            | Windows Forms, Windows only |
| **Reportman.Drawing.Forms**   | Provides UI controls to preview and print a **metafile**. Works with both PDF and Excel outputs.                                                      | Windows Forms, Windows only |
| **Reportman.WPF**             | Preview and print metafiles in a Windows Presentation Foundation (WPF) application.                                                                   | WPF, Windows only           |
| **Reportman.Designer**        | Embed the Reportman designer into your Windows Forms application. Allows creating, editing, executing, previewing, printing, and exporting templates. | Windows Forms, Windows only |

### Executables

* **PrintReportPDF** – multiplatform command line tool to render reports to PDF.
* **PrintReport** – Windows-only preview and print tool with UI for parameters.
* **Designer** – .Net Standalone designer executable for editing report templates.

* **Classic native Designer** – Standalone designer executable for editing report templates, Report Manager Designer, not .net but more mature. 

* **Classic command line tools** – Command line tools, not .net, allow also to execute reports in Windows and linux (printreptopdf), not .net but more mature. 
* **Classic server and web tools** – Web server (CGI/ISAPI), and TCP Reort Server and Client are also availzable (not .net).

---

## How It Works

1. **Design a Report**
   Using `Reportman.Designer` (embedded in your app), create a `.rep` template defining data sources, layout, and formatting.
   You can also download the classic designer from the proyect page, at page setup set prefered save format to XML for .net compatibility.

2. **Load the Report**

   ```csharp
   var report = new Reportman.Reporting.Report();
   report.LoadFromFile("test.rep");
   ```

   The report reads the template, you can alter parameters.

3. **Output Options**

   * **PDF**

     ```csharp
     var printout = new Reportman.Drawing.Windows.PrintOutPDF();
     printout.FileName = "test.pdf";
     printout.Print(report.metafile);
     ```

     * Supports Windows APIs for rendering or cross-platform via SkiaSharp/Freetype using Reportman.Drawing.CrossPlatform.
   * **Preview / Print**

     ```csharp
     var printoutWin = new Reportman.Drawing.Forms.PrintOuttWinForms();
     printoutWin.Preview = true;
     printoutWin.Print(report.metafile);
     ```

     * UI allows preview, print, pdf and excel output.

4. **Excel Export**
   If the report contains tabular data, export to Excel using `Reportman.Drawing.Excel` (ClosedXML), fully cross-platform without requiring Excel installation.

---

---
## Dependency Flow (Textual Diagram)

```
+-------------------+
| Reportman.Reporting | <-- core engine (templates)
+-------------------+
           |
           v
+-------------------+       +--------------------------+
| Reportman.Drawing | ----> | Drawing output (PDF/Excel) |
+-------------------+       +--------------------------+
           |
+-------------------+       +-------------------------+
| CrossPlatform      |       | Windows-specific (GDI/OLE) |
+-------------------+       +-------------------------+
           |
+-------------------+       +----------------------+
| Preview / Print UI |       | Designer embedding   |
| (Forms / WPF)     |       | in Windows Forms    |
+-------------------+       +----------------------+
```

---

## Project Links

* Project homepage, downloadable designer and tools, including .net and native: [https://reportman.es](https://reportman.es)
* GitHub repository: [https://github.com/tonimartir/reportman](https://github.com/tonimartir/reportman)
