using System.Data;

namespace Reportman.Drawing
{
    /// <summary>
    /// Abstraction for executing an ADO.NET <see cref="IDbCommand"/> and creating new commands,
    /// returning query results as a <see cref="DataTable"/>.
    /// </summary>
    public interface IDbCommandExecuter
    {
        /// <summary>
        /// Executes the supplied command and returns its result set as a <see cref="DataTable"/>.
        /// </summary>
        /// <param name="ncommand">The command to execute.</param>
        /// <returns>A table populated with the rows returned by the command.</returns>
        DataTable Open(IDbCommand ncommand);
        /// <summary>
        /// Creates a new command bound to the underlying connection.
        /// </summary>
        /// <returns>A new, empty command ready to be configured.</returns>
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
        /// <summary>
        /// Runs a non-query SQL statement immediately in its own transaction and commits it.
        /// </summary>
        /// <param name="sql">The SQL statement to execute.</param>
        /// <returns>The number of rows affected by the statement.</returns>
        int ExecuteInmediate(string sql);
        /// <summary>
        /// Runs a non-query SQL statement within the current transaction.
        /// </summary>
        /// <param name="sql">The SQL statement to execute.</param>
        void Execute(string sql);
        /// <summary>
        /// Runs a non-query command within the current transaction.
        /// </summary>
        /// <param name="ncommand">The command to execute.</param>
        void Execute(System.Data.Common.DbCommand ncommand);
        /// <summary>
        /// Creates a new command bound to the underlying connection for the given SQL text.
        /// </summary>
        /// <param name="cadsql">The SQL text used to initialize the command.</param>
        /// <returns>A new command ready to be executed or configured further.</returns>
        System.Data.Common.DbCommand CreateCommand(string cadsql);
        /// <summary>
        /// Begins a new transaction using the specified isolation level.
        /// </summary>
        /// <param name="nisolation">The isolation level for the transaction.</param>
        void StartTransaction(IsolationLevel nisolation);
        /// <summary>
        /// Commits the current transaction.
        /// </summary>
        void Commit();
        /// <summary>
        /// Rolls back the current transaction.
        /// </summary>
        void Rollback();
        /// <summary>
        /// Rolls back the current transaction immediately, discarding any pending buffered work.
        /// </summary>
        void RollbackInmediate();
        /// <summary>
        /// Executes a query immediately in its own transaction and returns the result set as a table.
        /// </summary>
        /// <param name="ndataset">The dataset that will own the resulting table.</param>
        /// <param name="sql">The SQL query to execute.</param>
        /// <param name="tablename">The name to assign to the resulting table.</param>
        /// <returns>A table populated with the rows returned by the query.</returns>
        DataTable OpenInmediate(DataSet ndataset, string sql, string tablename);
        /// <summary>
        /// Executes a query and fills a table with the given name into the supplied dataset.
        /// </summary>
        /// <param name="ndataset">The dataset that will receive the resulting table.</param>
        /// <param name="sql">The SQL query to execute.</param>
        /// <param name="tablename">The name to assign to the resulting table.</param>
        void Open(DataSet ndataset, string sql, string tablename);
        /// <summary>
        /// Executes a command and fills a table with the given name into the supplied dataset.
        /// </summary>
        /// <param name="ndataset">The dataset that will receive the resulting table.</param>
        /// <param name="command">The command to execute.</param>
        /// <param name="tablename">The name to assign to the resulting table.</param>
        void Open(DataSet ndataset, System.Data.Common.DbCommand command, string tablename);
        /// <summary>
        /// Executes a query filling the dataset incrementally, capping the row count and
        /// reporting progress through a partial-fill callback.
        /// </summary>
        /// <param name="ndataset">The dataset that will receive the resulting table.</param>
        /// <param name="sql">The SQL query to execute.</param>
        /// <param name="tablename">The name to assign to the resulting table.</param>
        /// <param name="maxrecords">The maximum number of records to fetch.</param>
        /// <param name="eventpartial">Callback raised as the table is populated.</param>
        void Open(DataSet ndataset, string sql, string tablename, int maxrecords, ISqlExecuterPartialFillEvent eventpartial);
        /// <summary>
        /// Starts a block of buffered insert operations to be flushed together.
        /// </summary>
        void BeginInsertBlock();
        /// <summary>
        /// Ends the current block of buffered insert operations.
        /// </summary>
        void EndInsertBlock();
        /// <summary>
        /// Sends any pending buffered operations to the database.
        /// </summary>
        void Flush();
        /// <summary>
        /// Sends any pending buffered operations to the database, reporting progress.
        /// </summary>
        /// <param name="pgevent">Callback raised with the progress of the flush.</param>
        void Flush(ISqlExecuterProgressEvent pgevent);
        /// <summary>
        /// Obtains the next value of a named database generator or sequence.
        /// </summary>
        /// <param name="generatorName">The name of the generator or sequence.</param>
        /// <param name="increment">The amount by which to advance the generator.</param>
        /// <returns>The generated value.</returns>
        long GetGenerator(string generatorName, int increment);
        /// <summary>
        /// Executes a query and returns the value of the first column of the first row.
        /// </summary>
        /// <param name="sql">The SQL query to execute.</param>
        /// <returns>The scalar value produced by the query.</returns>
        object GetValueFromSql(string sql);
        /// <summary>
        /// Registers additional external columns and pending deletes to be applied to the last command.
        /// </summary>
        /// <param name="externalcolumns">The external column definitions to add.</param>
        /// <param name="deletes">The delete instructions to apply.</param>
        void AddExternalColumnsToLastCommand(string externalcolumns, string deletes);
        /// <summary>
        /// Queues a custom operation, identified by an operation code, carrying text and binary payloads.
        /// </summary>
        /// <param name="operation">The operation code identifying the action.</param>
        /// <param name="data">The textual payload for the operation.</param>
        /// <param name="binarydata">The binary payload for the operation.</param>
        void AddCustomOperation(int operation, string data, byte[] binarydata);
        /// <summary>
        /// Opens the underlying database connection.
        /// </summary>
        void Connect();
        /// <summary>
        /// Closes the underlying database connection.
        /// </summary>
        void Disconnect();
    }
    /// <summary>
    /// Arguments for a partial-fill event, carrying the total expected record count and the
    /// <see cref="DataTable"/> being populated.
    /// </summary>
    public class ISqlExecuterPartialFillArgs
    {
        /// <summary>
        /// The total number of records expected to be loaded.
        /// </summary>
        public int TotalCount;
        /// <summary>
        /// The table being populated during the partial fill.
        /// </summary>
        public DataTable Table;
        /// <summary>
        /// Initializes a new instance with the expected record count and the table being filled.
        /// </summary>
        /// <param name="nTotalCount">The total number of records expected.</param>
        /// <param name="nTable">The table being populated.</param>
        public ISqlExecuterPartialFillArgs(int nTotalCount, DataTable nTable)
        {
            TotalCount = nTotalCount;
            Table = nTable;
        }
    }

}
