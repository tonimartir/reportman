using MySql.Data.MySqlClient;
using System;
using System.Data.Common;
using System.Threading;
using System.Windows.Forms;

namespace designer
{
    static class Program
    {
        /// <summary>
        /// Punto de entrada principal para la aplicación.
        /// </summary>
        [STAThread]
        static void Main(string[] args)
        {
            // Adds the event handler  to the event.
            try
            {
                MyExceptionHandler eh = new MyExceptionHandler();
                Application.ThreadException += new ThreadExceptionEventHandler(eh.OnThreadException);
                // Reportman.Drawing.AssemblyResolver.HandleUnresolvedAssemblies();
                AddCustomFactories();

                //var nresult = Reportman.Reporting.BarcodeItem.DetectBarcode("c:\\dades\\prova18.png");
                // Creates an instance of the methods that will handle the exception.


                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);

                // designer.exe /dbconfig  -> shows the standalone connection assistant
                // designer.exe /dbconfig /shot <png> [/test]  -> headless screenshot
                if (HasArg(args, "/dbconfig"))
                {
                    RunDbConfig(args);
                    return;
                }
                // designer.exe /newwizard  -> shows the new report connection wizard
                // designer.exe /newwizard /shot <pngBase>  -> headless page captures + commit self-test
                if (HasArg(args, "/newwizard"))
                {
                    RunNewWizard(args);
                    return;
                }
                // designer.exe /undotest [/rep <file>] [/out <txt>] -> headless undo-on-select test
                if (HasArg(args, "/undotest"))
                {
                    string repFile = GetArgValue(args, "/rep");
                    if (string.IsNullOrEmpty(repFile))
                        repFile = "C:\\desarrollo\\danzai\\comunnt\\reportman\\tests\\htmltest.rep";
                    string outFile = GetArgValue(args, "/out");
                    if (string.IsNullOrEmpty(outFile))
                        outFile = "C:\\desarrollo\\_rmwizbuild\\undotest.txt";
                    System.IO.File.WriteAllText(outFile, Reportman.Designer.DesignerSelfTest.RunUndoSelectTest(repFile));
                    return;
                }

                Application.Run(new Reportman.Designer.MainForm());
            }
            catch(Exception ex)
            {
                MyExceptionHandler.ShowThreadExceptionDialog(ex);
            }

        }
        static bool HasArg(string[] args, string name)
        {
            if (args == null)
                return false;
            foreach (string a in args)
            {
                if (string.Equals(a, name, StringComparison.OrdinalIgnoreCase))
                    return true;
                if (a != null && a.StartsWith(name + "=", StringComparison.OrdinalIgnoreCase))
                    return true;
            }
            return false;
        }
        static string GetArgValue(string[] args, string name)
        {
            if (args == null)
                return null;
            for (int i = 0; i < args.Length; i++)
            {
                string a = args[i];
                if (a == null)
                    continue;
                if (a.StartsWith(name + "=", StringComparison.OrdinalIgnoreCase))
                    return a.Substring(name.Length + 1);
                if (string.Equals(a, name, StringComparison.OrdinalIgnoreCase) && i + 1 < args.Length)
                    return args[i + 1];
            }
            return null;
        }
        static void RunDbConfig(string[] args)
        {
            string provider = Reportman.Reporting.DatabaseInfo.FIREBIRD_PROVIDER2;
            string sample = "DataSource=localhost;Database=c:\\data\\example.fdb;User=SYSDBA;Password=tw2000;Port=3050;Dialect=3;Charset=UTF8";
            string shot = GetArgValue(args, "/shot");
            if (string.IsNullOrEmpty(shot))
            {
                Reportman.Designer.ConnectionEditor.ConnResult res;
                if (Reportman.Designer.ConnectionEditor.Edit(provider, sample, false, "", "", 0, null, out res))
                {
                    if (res.IsAgent)
                        MessageBox.Show("HTTP Agent\r\nAPI key: " + res.AgentApiKey +
                            "\r\nHub database id: " + res.AgentHubDatabaseId,
                            "Connection", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    else
                        MessageBox.Show("Provider factory: " + res.ProviderInvariant +
                            "\r\n\r\nConnection string:\r\n" + res.ConnectionString,
                            "Connection", MessageBoxButtons.OK, MessageBoxIcon.Information);
                }
                return;
            }
            CaptureDbConfig(provider, sample, shot, HasArg(args, "/test"));
        }
        static void RunNewWizard(string[] args)
        {
            string shot = GetArgValue(args, "/shot");
            if (string.IsNullOrEmpty(shot))
            {
                Reportman.Reporting.Report rep = new Reportman.Reporting.Report();
                rep.CreateNew();
                DialogResult dr = Reportman.Designer.NewReportWizard.Run(rep, null);
                string msg = "DialogResult: " + dr + "\r\nConnections: " + rep.DatabaseInfo.Count;
                if (rep.DatabaseInfo.Count > 0)
                {
                    Reportman.Reporting.DatabaseInfo di = rep.DatabaseInfo[0];
                    msg += "\r\nAlias: " + di.Alias + "\r\nDriver: " + di.Driver +
                           "\r\nProviderFactory: " + di.ProviderFactory +
                           "\r\nConnString: " + di.ConnectionString;
                }
                MessageBox.Show(msg, "New report wizard", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }
            try
            {
                Reportman.Designer.NewReportWizard.CapturePages(shot);
            }
            catch (Exception ex)
            {
                System.IO.File.WriteAllText(shot + ".err.txt", ex.ToString());
            }
        }
        static void CaptureDbConfig(string provider, string connstr, string pngpath, bool doTest)
        {
            using (Form f = new Form())
            {
                f.Text = "Database connection";
                f.StartPosition = FormStartPosition.Manual;
                f.Location = new System.Drawing.Point(-3000, -3000);
                float scale = Reportman.Drawing.Windows.GraphicUtils.DPIScale;
                f.ClientSize = new System.Drawing.Size(
                    Convert.ToInt32(720 * scale), Convert.ToInt32(560 * scale));
                Reportman.Designer.ConnectionParamsControl ctrl =
                    new Reportman.Designer.ConnectionParamsControl();
                ctrl.Dock = DockStyle.Fill;
                f.Controls.Add(ctrl);
                f.Show();
                Application.DoEvents();
                ctrl.Populate(provider, connstr);
                ctrl.ScrollToTop();
                Application.DoEvents();
                if (doTest)
                {
                    ctrl.TestConnection();
                    Application.DoEvents();
                }
                using (System.Drawing.Bitmap bmp =
                    new System.Drawing.Bitmap(f.ClientSize.Width, f.ClientSize.Height))
                {
                    f.DrawToBitmap(bmp,
                        new System.Drawing.Rectangle(0, 0, bmp.Width, bmp.Height));
                    bmp.Save(pngpath, System.Drawing.Imaging.ImageFormat.Png);
                }
                // Sidecar diagnostics so the result is verifiable without reading the image.
                string info = "Provider: " + ctrl.SelectedProviderDisplay + "\r\n" +
                              "ProviderInvariant: " + ctrl.ProviderInvariant + "\r\n" +
                              "ConnectionString: " + ctrl.ConnectionString + "\r\n";
                if (doTest)
                    info += "TestOk: " + ctrl.LastOk + "\r\nTestResult: " + ctrl.LastResultText + "\r\n";
                System.IO.File.WriteAllText(pngpath + ".txt", info);
                f.Close();
            }
        }
        static void AddCustomFactories()
        {
            DbProviderFactories.RegisterFactory(Reportman.Reporting.DatabaseInfo.FIREBIRD_PROVIDER2, FirebirdSql.Data.FirebirdClient.FirebirdClientFactory.Instance);
            DbProviderFactories.RegisterFactory(Reportman.Reporting.DatabaseInfo.MYSQL_PROVIDER, MySql.Data.MySqlClient.MySqlClientFactory.Instance);
            DbProviderFactories.RegisterFactory(Reportman.Reporting.DatabaseInfo.SQLITE_PROVIDER, System.Data.SQLite.SQLiteFactory.Instance);
            DbProviderFactories.RegisterFactory("SQLiteCore", Microsoft.Data.Sqlite.SqliteFactory.Instance);
            DbProviderFactories.RegisterFactory("System.Data.Odbc", System.Data.Odbc.OdbcFactory.Instance);
            DbProviderFactories.RegisterFactory("SQLServer", Microsoft.Data.SqlClient.SqlClientFactory.Instance);
            DbProviderFactories.RegisterFactory("MySQLConnector", MySqlConnector.MySqlConnectorFactory.Instance);
            DbProviderFactories.RegisterFactory("PostgreSQL", Npgsql.NpgsqlFactory.Instance);
            DbProviderFactories.RegisterFactory("Oracle", Oracle.ManagedDataAccess.Client.OracleClientFactory.Instance);

            if (Reportman.Reporting.DatabaseInfo.CustomProviderFactories.Count == 0)
            {
            }
        }
        // Creates a class to handle the exception event.
        internal class MyExceptionHandler
        {
            // Handles the exception event.
            public void OnThreadException(object sender, ThreadExceptionEventArgs t)
            {
                DialogResult result = DialogResult.Cancel;
                try
                {
                    result = ShowThreadExceptionDialog(t.Exception);
                }
                catch
                {
                    try
                    {
                        MessageBox.Show("Fatal Error", "Fatal Error", MessageBoxButtons.AbortRetryIgnore, MessageBoxIcon.Stop);
                    }
                    finally
                    {
                        Application.Exit();
                    }
                }

                // Exits the program when the user clicks Abort.
                if (result == DialogResult.Abort)
                    Application.Exit();
            }

            // Creates the error message and displays it.
            public static DialogResult ShowThreadExceptionDialog(Exception e)
            {
                string errorMsg = "Exception raised:\n\n";
                errorMsg = errorMsg + e.Message + "\n\nStack call:\n" + e.StackTrace;
                ThreadExceptionDialog ndia = new ThreadExceptionDialog(e);

                DialogResult aresult = ndia.ShowDialog();
                //DialogResult aresult = MessageBox.Show(errorMsg, "Application Error", MessageBoxButtons.AbortRetryIgnore, MessageBoxIcon.Stop);
                return aresult;
            }
        }
    }
}