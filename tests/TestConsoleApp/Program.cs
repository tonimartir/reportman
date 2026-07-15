using System;
using System.IO;
using Reportman.Reporting;
using Reportman.Drawing;

namespace TestConsoleApp
{
    class Program
    {
        static void Main(string[] args)
        {
            Console.WriteLine("Inicializando Reportman...");
            
            Report report = new Report();
            
            // Creamos un reporte muy básico en memoria
            report.CreateNew();
            report.DocTitle = "Reporte de Prueba";
            
            Console.WriteLine($"Reporte '{report.DocTitle}' creado en memoria exitosamente.");
            Console.WriteLine("¡Todo funciona correctamente!");
        }
    }
}
