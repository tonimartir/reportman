using System;
using System.Windows.Forms;

namespace TestDesignerApp
{
    internal static class Program
    {
        [STAThread]
        static void Main()
        {
            ApplicationConfiguration.Initialize();
            Application.Run(new Reportman.Designer.MainForm());
        }
    }
}