// MultipleActiveResultSets in the SQL Server connections of a report: without it SqlClient keeps one
// open reader per connection, and a report that keeps two datasets of a connection open (master/detail)
// fails. DatabaseInfo.WithMultipleActiveResultSets turns it on unless the connection string sets it.
//
//   SqlServerMarsTest                         the connection strings only
//   SqlServerMarsTest --server "<string>"     also two open readers on that server, through the engine
//
// Exit code 0 when everything passes, 1 otherwise.
using System.Globalization;
using Microsoft.Data.SqlClient;
using Microsoft.Data.Sqlite;
using Reportman.Reporting;

// The messages of SqlClient in English, whatever the language of the machine
CultureInfo.CurrentUICulture = CultureInfo.InvariantCulture;
CultureInfo.DefaultThreadCurrentUICulture = CultureInfo.InvariantCulture;

int failures = 0;
void Check(string name, bool ok, string detail)
{
    Console.WriteLine((ok ? "[OK] " : "[TEST_FAILED] ") + name + (ok ? "" : ": " + detail));
    if (!ok)
        failures++;
}

bool? Mars(string connectionString)
{
    var builder = new SqlConnectionStringBuilder(connectionString);
    return builder.ShouldSerialize("MultipleActiveResultSets") ? builder.MultipleActiveResultSets : null;
}

string quoted = new SqlConnectionStringBuilder { DataSource = "db.example.com,1433", InitialCatalog = "sales", UserID = "reports", Password = "p;w'd" }.ConnectionString;
SqlClientFactory sql = SqlClientFactory.Instance;

string added = DatabaseInfo.WithMultipleActiveResultSets(sql, quoted);
Check("added when the string does not set it", Mars(added) == true, added);
var addedBuilder = new SqlConnectionStringBuilder(added);
Check("the other keywords are kept", addedBuilder.DataSource == "db.example.com,1433" && addedBuilder.InitialCatalog == "sales"
    && addedBuilder.UserID == "reports" && addedBuilder.Password == "p;w'd", added);

foreach (string explicitValue in new[] { "MultipleActiveResultSets=False", "Multiple Active Result Sets=no", "multipleactiveresultsets=false" })
{
    string s = quoted + ";" + explicitValue;
    Check("kept as it is: " + explicitValue, DatabaseInfo.WithMultipleActiveResultSets(sql, s) == s, DatabaseInfo.WithMultipleActiveResultSets(sql, s));
}
string on = quoted + ";MultipleActiveResultSets=True";
Check("kept as it is: MultipleActiveResultSets=True", DatabaseInfo.WithMultipleActiveResultSets(sql, on) == on, DatabaseInfo.WithMultipleActiveResultSets(sql, on));

Check("an empty string is left to SqlClient", DatabaseInfo.WithMultipleActiveResultSets(sql, "") == "", "changed");
Check("a null string is left to SqlClient", DatabaseInfo.WithMultipleActiveResultSets(sql, null) == null, "changed");
const string sqlite = "Data Source=samples.db";
Check("another provider is not touched", DatabaseInfo.WithMultipleActiveResultSets(SqliteFactory.Instance, sqlite) == sqlite, "changed");
try
{
    DatabaseInfo.WithMultipleActiveResultSets(sql, "Server=x;Bogus=1");
    Check("a wrong keyword fails as SqlClient fails", false, "no error");
}
catch (ArgumentException e)
{
    Check("a wrong keyword fails as SqlClient fails", e.Message.StartsWith("Keyword not supported: 'bogus'."), e.Message);
}

// Two open readers on one connection of the engine, on a real server
int iServer = Array.IndexOf(args, "--server");
if (iServer >= 0 && iServer + 1 < args.Length)
{
    DatabaseInfo.CustomProviderFactories["SQLServer"] = sql;
    foreach (var (name, suffix, expectOk) in new[] { ("default", "", true), ("explicit False", ";MultipleActiveResultSets=False", false) })
    {
        var info = new DatabaseInfo { Alias = "SAMPLES", Driver = DriverType.DotNet2, ProviderFactory = "SQLServer", ConnectionString = args[iServer + 1] + suffix };
        try
        {
            info.Connect();
            using System.Data.IDbCommand first = info.Connection.CreateCommand();
            first.Transaction = info.CurrentTransaction;
            first.CommandText = "SELECT 1 UNION ALL SELECT 2";
            using System.Data.IDataReader r1 = first.ExecuteReader();
            r1.Read();
            using System.Data.IDbCommand second = info.Connection.CreateCommand();
            second.Transaction = info.CurrentTransaction;
            second.CommandText = "SELECT 3";
            using System.Data.IDataReader r2 = second.ExecuteReader();
            r2.Read();
            Check("two open readers, " + name, expectOk, "the second reader opened");
        }
        catch (InvalidOperationException e)
        {
            Check("two open readers, " + name, !expectOk && e.Message.StartsWith("There is already an open DataReader"), e.Message);
        }
        finally
        {
            info.DisConnect();
        }
    }
}

Console.WriteLine(failures == 0 ? "All tests passed." : failures + " test(s) failed.");
return failures == 0 ? 0 : 1;
