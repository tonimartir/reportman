#region Copyright
/*
 *  Report Manager:  Database Reporting tool for .Net and Mono
 *
 *     The contents of this file are subject to the MPL License
 *     with optional use of GPL or LGPL licenses.
 *     You may not use this file except in compliance with the
 *     Licenses. You may obtain copies of the Licenses at:
 *     http://reportman.sourceforge.net/license
 *
 *  Copyright (c) 1994 - 2026 Toni Martir (toni@reportman.es)
 *  All Rights Reserved.
*/
#endregion

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Reportman.Reporting;

namespace Reportman.Designer
{
    // The progress of the reads of the database (the catalog, the columns of some tables, the first rows of a table): each
    // one runs off the UI thread and, when it takes more than ProgressDelay, a small modal window says what is read, its
    // phase with the rows fetched and the seconds, and has Cancel, always enabled. A read cancelled changes nothing.
    public partial class LocalSchemaEditorForm
    {
        /// <summary>Milliseconds a read runs before its progress window shows: no flash for the fast ones.</summary>
        internal const int ProgressDelay = 300;
        /// <summary>Milliseconds between two refreshes of the status line of the progress window.</summary>
        internal const int ProgressRefresh = 250;
        /// <summary>
        /// Milliseconds a cancelled read is waited for before its window closes anyway: a driver that does not stop a
        /// statement (SQLite parsing its schema) goes on alone, and what it reads is thrown away.
        /// </summary>
        internal const int CancelGrace = 1000;

        // The reads running, cancelled when the dialog closes
        private readonly List<CancellationTokenSource> _reads = new List<CancellationTokenSource>();
        // The progress window shown now: a read that wants to show its own waits for it to close
        private ReadProgressForm _progressForm;

        /// <summary>
        /// Runs a read of the database off the UI thread (<paramref name="read"/> gets where to report its progress and
        /// its token) and, when it takes more than <see cref="ProgressDelay"/> ms, shows its progress window with
        /// <paramref name="title"/> until it ends. Returns what it read, or throws what it threw. Throws
        /// <see cref="OperationCanceledException"/> when it is cancelled: by the user (the window closes when the read
        /// stops, or after <see cref="CancelGrace"/> ms when the driver does not stop it: it goes on alone on its own
        /// connection, and its result is thrown away), by <paramref name="cancellation"/>, or by the dialog closing.
        /// </summary>
        /// <param name="title">What is read (2040, 2033, 2041).</param>
        /// <param name="cancellation">Cancels the read too (another table clicked for the preview); None for nothing else.</param>
        /// <param name="read">The read: it opens its own connection.</param>
        private async Task<T> RunReadAsync<T>(string title, CancellationToken cancellation,
            Func<IProgress<DatabaseReadProgress>, CancellationToken, Task<T>> read)
        {
            CancellationTokenSource cts = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
            CancellationToken token = cts.Token;
            _reads.Add(cts);
            var progress = new LatestReadProgress();
            Stopwatch watch = Stopwatch.StartNew();
            Task<T> task = Task.Run(() => read(progress, token), token);
            // The source goes with the read, which may outlive its window; its failure is observed there
            _ = task.ContinueWith(t =>
            {
                Exception ignored = t.Exception;
                cts.Dispose();
            }, TaskScheduler.Default);
            try
            {
                if (await Task.WhenAny(task, Task.Delay(ProgressDelay)) != task)
                {
                    // One window at a time: a read that wants to show its own while another one is shown waits for it
                    while (_progressForm != null && !task.IsCompleted)
                        await Task.WhenAny(task, _progressForm.WindowClosed);
                    if (!task.IsCompleted && !IsDisposed)
                    {
                        using (var form = new ReadProgressForm(_baseTitle, title, progress, watch, task, cts))
                        {
                            _progressForm = form;
                            try
                            {
                                form.ShowDialog(this);
                            }
                            finally
                            {
                                _progressForm = null;
                            }
                        }
                    }
                }
                // Cancelled, also when the read ended meanwhile or goes on alone: nothing it read is used
                if (token.IsCancellationRequested || !task.IsCompleted)
                    throw new OperationCanceledException(token);
                return await task;
            }
            finally
            {
                _reads.Remove(cts);
            }
        }

        /// <summary>
        /// The status line of a read: 2037 «Connecting (%s s)», 2038 «Executing (%s s)» or 2039 «Fetching %s rows (%s s)»
        /// (the rows of all its queries, with thousands separators), with the whole seconds since it started.
        /// </summary>
        /// <param name="progress">The last progress the read reported; null before the first one (connecting).</param>
        /// <param name="elapsed">The time since the read started.</param>
        internal static string ReadStatusText(DatabaseReadProgress progress, TimeSpan elapsed)
        {
            string seconds = ((long)Math.Max(0, elapsed.TotalSeconds)).ToString(CultureInfo.CurrentCulture);
            DatabaseReadPhase phase = progress != null ? progress.Phase : DatabaseReadPhase.Connecting;
            switch (phase)
            {
                case DatabaseReadPhase.Connecting:
                    return DesignerText.Format(2037, seconds);
                case DatabaseReadPhase.Executing:
                    return DesignerText.Format(2038, seconds);
                default:
                    return DesignerText.Format(2039, progress.Rows.ToString("N0", CultureInfo.CurrentCulture), seconds);
            }
        }

        /// <summary>The last progress a read reported (from the thread that reads), for the window that shows it.</summary>
        private sealed class LatestReadProgress : IProgress<DatabaseReadProgress>
        {
            private DatabaseReadProgress _latest;

            public DatabaseReadProgress Latest
            {
                get { return Volatile.Read(ref _latest); }
            }

            public void Report(DatabaseReadProgress value)
            {
                Volatile.Write(ref _latest, value);
            }
        }

        /// <summary>
        /// The progress window of a read: what is read, a marquee bar, the phase with the rows and the seconds (refreshed
        /// every <see cref="ProgressRefresh"/> ms) and Cancel, always enabled: the first click says «Cancelling...» (2042)
        /// and cancels the read, and the window closes when it stops or after <see cref="CancelGrace"/> ms; a second
        /// click closes it at once. It closes by itself when the read ends.
        /// </summary>
        private sealed class ReadProgressForm : Form
        {
            private readonly LatestReadProgress _progress;
            private readonly Stopwatch _watch;
            private readonly Task _read;
            private readonly CancellationTokenSource _cancel;
            private readonly Label _lblStatus;
            private readonly System.Windows.Forms.Timer _refresh;
            private readonly System.Windows.Forms.Timer _grace;
            private readonly TaskCompletionSource<bool> _closed = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            private bool _cancelling;
            private bool _closing;

            public ReadProgressForm(string caption, string title, LatestReadProgress progress, Stopwatch watch, Task read,
                CancellationTokenSource cancel)
            {
                _progress = progress;
                _watch = watch;
                _read = read;
                _cancel = cancel;
                Text = caption;
                FormBorderStyle = FormBorderStyle.FixedDialog;
                StartPosition = FormStartPosition.CenterParent;
                MinimizeBox = false;
                MaximizeBox = false;
                ControlBox = false;
                ShowIcon = false;
                ShowInTaskbar = false;
                // The sizes below are for Segoe UI 9 at 96 DPI: they scale with the screen
                Font = new Font("Segoe UI", 9f);
                AutoScaleDimensions = new SizeF(7F, 15F);
                AutoScaleMode = AutoScaleMode.Font;
                AutoSize = true;
                AutoSizeMode = AutoSizeMode.GrowAndShrink;

                var layout = new TableLayoutPanel
                {
                    Location = new Point(0, 0),
                    AutoSize = true,
                    AutoSizeMode = AutoSizeMode.GrowAndShrink,
                    ColumnCount = 1,
                    RowCount = 4,
                    Padding = new Padding(12, 12, 12, 10)
                };
                layout.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
                for (int i = 0; i < 4; i++)
                    layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
                // What is read: the names of some tables may take two lines
                var lblTitle = new Label
                {
                    Text = title,
                    AutoSize = true,
                    MaximumSize = new Size(420, 0),
                    Margin = new Padding(0, 0, 0, 8),
                    Font = new Font(Font, FontStyle.Bold)
                };
                var bar = new ProgressBar
                {
                    Style = ProgressBarStyle.Marquee,
                    MarqueeAnimationSpeed = 30,
                    Size = new Size(420, 18),
                    Margin = new Padding(0)
                };
                _lblStatus = new Label
                {
                    AutoSize = false,
                    Size = new Size(420, 22),
                    AutoEllipsis = true,
                    TextAlign = ContentAlignment.MiddleLeft,
                    Margin = new Padding(0, 6, 0, 6)
                };
                var btnCancel = new Button
                {
                    Text = Tr(94),
                    AutoSize = true,
                    MinimumSize = new Size(85, 0),
                    Anchor = AnchorStyles.Right,
                    Margin = new Padding(0)
                };
                btnCancel.Click += (s, e) => CancelRead();
                CancelButton = btnCancel;
                layout.Controls.Add(lblTitle, 0, 0);
                layout.Controls.Add(bar, 0, 1);
                layout.Controls.Add(_lblStatus, 0, 2);
                layout.Controls.Add(btnCancel, 0, 3);
                Controls.Add(layout);

                _refresh = new System.Windows.Forms.Timer { Interval = ProgressRefresh };
                _refresh.Tick += (s, e) => RefreshStatus();
                _grace = new System.Windows.Forms.Timer { Interval = CancelGrace };
                _grace.Tick += (s, e) => CloseNow();
                RefreshStatus();
                // The read ends: the window goes (on the UI thread; maybe before it is shown)
                _read.ContinueWith(t =>
                {
                    if (!IsDisposed && IsHandleCreated)
                        CloseNow();
                }, TaskScheduler.FromCurrentSynchronizationContext());
            }

            /// <summary>Completed when the window closed.</summary>
            public Task WindowClosed
            {
                get { return _closed.Task; }
            }

            protected override void OnShown(EventArgs e)
            {
                base.OnShown(e);
                if (_read.IsCompleted)
                {
                    CloseNow();
                    return;
                }
                _refresh.Start();
            }

            private void RefreshStatus()
            {
                string text = _cancelling ? Tr(2042) : ReadStatusText(_progress.Latest, _watch.Elapsed);
                if (_lblStatus.Text != text)
                    _lblStatus.Text = text;
            }

            private void CancelRead()
            {
                // A second click does not wait for the read
                if (_cancelling)
                {
                    CloseNow();
                    return;
                }
                _cancelling = true;
                RefreshStatus();
                try
                {
                    _cancel.Cancel();
                }
                catch (ObjectDisposedException)
                {
                    // The read ended: the window is closing anyway
                }
                // The read that stops closes the window (its continuation); one that does not, the grace
                _grace.Start();
            }

            private void CloseNow()
            {
                if (_closing)
                    return;
                _closing = true;
                _refresh.Stop();
                _grace.Stop();
                Close();
            }

            protected override void OnFormClosing(FormClosingEventArgs e)
            {
                // Closed by the keyboard or the system while it reads: that is Cancel, and the second time it closes
                if (!_closing)
                {
                    if (_cancelling)
                    {
                        _closing = true;
                        _refresh.Stop();
                        _grace.Stop();
                    }
                    else
                    {
                        e.Cancel = true;
                        CancelRead();
                    }
                }
                base.OnFormClosing(e);
            }

            protected override void OnFormClosed(FormClosedEventArgs e)
            {
                base.OnFormClosed(e);
                _closed.TrySetResult(true);
            }

            protected override void Dispose(bool disposing)
            {
                if (disposing)
                {
                    _refresh.Dispose();
                    _grace.Dispose();
                    _closed.TrySetResult(true);
                }
                base.Dispose(disposing);
            }
        }
    }
}
