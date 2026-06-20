using System.Data;

namespace Reportman.Drawing
{
    /// <summary>
    /// Abstraction for executing an ADO.NET <see cref="IDbCommand"/> and creating new commands,
    /// returning query results as a <see cref="DataTable"/>.
    /// </summary>
    public interface IDbCommandExecuter
    {
        DataTable Open(IDbCommand ncommand);
        IDbCommand CreateCommand();
    }
    /// <summary>
    /// Callback reporting the progress of a long-running SQL operation as the number of
    /// records processed so far out of the total.
    /// </summary>
    public delegate void ISqlExecuterProgressEvent(int current, int total);
    /// <summary>
    /// Callback raised while a result set is being filled incrementally, giving access to the
    /// partially populated table through <see cref="ISqlExecuterPartialFillArgs"/>.
    /// </summary>
    public delegate void ISqlExecuterPartialFillEvent(object sender, ISqlExecuterPartialFillArgs args);
    /// <summary>
    /// Abstraction over a database connection used by the reporting engine to run SQL,
    /// open result sets, manage transactions, batch inserts, and obtain generator values,
    /// independent of the underlying data driver.
    /// </summary>
    public interface ISqlExecuter
    {
        int ExecuteInmediate(string sql);
        void Execute(string sql);
        void Execute(System.Data.Common.DbCommand ncommand);
        System.Data.Common.DbCommand CreateCommand(string cadsql);
        void StartTransaction(IsolationLevel nisolation);
        void Commit();
        void Rollback();
        void RollbackInmediate();
        DataTable OpenInmediate(DataSet ndataset, string sql, string tablename);
        void Open(DataSet ndataset, string sql, string tablename);
        void Open(DataSet ndataset, System.Data.Common.DbCommand command, string tablename);
        void Open(DataSet ndataset, string sql, string tablename, int maxrecords, ISqlExecuterPartialFillEvent eventpartial);
        void BeginInsertBlock();
        void EndInsertBlock();
        void Flush();
        void Flush(ISqlExecuterProgressEvent pgevent);
        long GetGenerator(string generatorName, int increment);
        object GetValueFromSql(string sql);
        void AddExternalColumnsToLastCommand(string externalcolumns, string deletes);
        void AddCustomOperation(int operation, string data, byte[] binarydata);
        void Connect();
        void Disconnect();
    }
    /// <summary>
    /// Arguments for a partial-fill event, carrying the total expected record count and the
    /// <see cref="DataTable"/> being populated.
    /// </summary>
    public class ISqlExecuterPartialFillArgs
    {
        public int TotalCount;
        public DataTable Table;
        public ISqlExecuterPartialFillArgs(int nTotalCount, DataTable nTable)
        {
            TotalCount = nTotalCount;
            Table = nTable;
        }
    }

}
