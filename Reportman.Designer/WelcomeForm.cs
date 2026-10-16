using System;
using System.Collections.Generic;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Text;
using System.Windows.Forms;
using Reportman.Drawing.Windows;

namespace Reportman.Designer
{
    /// <summary>
    /// A sample report of the samples folder, as samples.ini describes it.
    /// </summary>
    public class SampleReportInfo
    {
        /// <summary>File name of the report, relative to the samples folder.</summary>
        public string FileName = "";
        /// <summary>Title in the language of the user.</summary>
        public string Title = "";
        /// <summary>Description in the language of the user.</summary>
        public string Description = "";
        /// <summary>Picture of the first page, relative to the samples folder (may be empty).</summary>
        public string Thumbnail = "";
    }

    /// <summary>
    /// The sample reports installed with the designer (the samples folder, the same for every
    /// Report Manager designer): their list, and the working copy in the documents of the user,
    /// where they can be changed and saved.
    /// </summary>
    public static class SampleReports
    {
        /// <summary>Name of the index of the samples folder.</summary>
        public const string IndexFileName = "samples.ini";

        /// <summary>
        /// The installed samples folder: <c>samples</c> next to the program, or, in a development tree,
        /// the first <c>samples</c> folder with an index above it. Empty when there is none.
        /// </summary>
        public static string InstalledFolder()
        {
            string dir = AppDomain.CurrentDomain.BaseDirectory;
            for (int level = 0; level < 7 && !string.IsNullOrEmpty(dir); level++)
            {
                string candidate = Path.Combine(dir, "samples");
                if (File.Exists(Path.Combine(candidate, IndexFileName)))
                    return candidate;
                dir = Path.GetDirectoryName(dir.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
            }
            return "";
        }

        /// <summary>
        /// The working copy of the samples: Documents\Report Manager\Samples. The installed folder may
        /// be read only (Program Files), and a changed sample must not change the installation.
        /// </summary>
        public static string WorkingFolder()
        {
            string documents = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
            if (string.IsNullOrEmpty(documents))
                documents = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            return Path.Combine(documents, "Report Manager", "Samples");
        }

        /// <summary>
        /// Copies the installed samples to the working folder: the files that are not there yet, and
        /// the database, the index and the pictures when the installed ones are newer. A report that is
        /// already there is never replaced: it may have been changed.
        /// </summary>
        public static void UpdateWorkingCopy(string installed, string working)
        {
            foreach (string source in Directory.GetFiles(installed, "*", SearchOption.AllDirectories))
            {
                string relative = source.Substring(installed.Length).TrimStart(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
                string target = Path.Combine(working, relative);
                bool copy = !File.Exists(target);
                if (!copy && !string.Equals(Path.GetExtension(source), ".rep", StringComparison.OrdinalIgnoreCase))
                    copy = File.GetLastWriteTimeUtc(source) > File.GetLastWriteTimeUtc(target);
                if (!copy)
                    continue;
                Directory.CreateDirectory(Path.GetDirectoryName(target));
                File.Copy(source, target, true);
                // A copy from Program Files is read only when the installed file is
                File.SetAttributes(target, File.GetAttributes(target) & ~FileAttributes.ReadOnly);
            }
        }

        /// <summary>
        /// The samples listed in the index of <paramref name="folder"/>, in its order, with the texts in
        /// the language of the user (Title.es, Description.es...) or else in English.
        /// </summary>
        public static List<SampleReportInfo> Load(string folder)
        {
            string language = CultureInfo.CurrentCulture.TwoLetterISOLanguageName.ToLowerInvariant();
            var result = new List<SampleReportInfo>();
            SampleReportInfo current = null;
            var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            Action flush = () =>
            {
                if (current == null)
                    return;
                current.Title = Localized(values, "Title", language, Path.GetFileNameWithoutExtension(current.FileName));
                current.Description = Localized(values, "Description", language, "");
                values.TryGetValue("Thumbnail", out current.Thumbnail);
                if (current.Thumbnail == null)
                    current.Thumbnail = "";
                if (File.Exists(Path.Combine(folder, current.FileName)))
                    result.Add(current);
            };
            // Read here and not with IniFile: it keeps the sections sorted, and the order matters
            foreach (string rawLine in File.ReadAllLines(Path.Combine(folder, IndexFileName), Encoding.UTF8))
            {
                string line = rawLine.Trim();
                if (line.Length == 0 || line[0] == ';' || line[0] == '#')
                    continue;
                if (line[0] == '[' && line[line.Length - 1] == ']')
                {
                    flush();
                    current = new SampleReportInfo { FileName = line.Substring(1, line.Length - 2).Trim() };
                    values.Clear();
                    continue;
                }
                int equal = line.IndexOf('=');
                if (equal > 0 && current != null)
                    values[line.Substring(0, equal).Trim()] = line.Substring(equal + 1).Trim();
            }
            flush();
            return result;
        }

        private static string Localized(Dictionary<string, string> values, string key, string language, string defaultValue)
        {
            string value;
            if (values.TryGetValue(key + "." + language, out value) && value.Length > 0)
                return value;
            if (values.TryGetValue(key, out value) && value.Length > 0)
                return value;
            return defaultValue;
        }
    }

    /// <summary>What the user chose in the welcome window.</summary>
    public enum WelcomeAction
    {
        /// <summary>Closed the window.</summary>
        None,
        /// <summary>Open the sample in <see cref="WelcomeForm.SamplePath"/>.</summary>
        OpenSample,
        /// <summary>Create a new report.</summary>
        NewReport,
        /// <summary>Open a report file.</summary>
        OpenReport
    }

    /// <summary>
    /// The welcome window of the designer: the sample reports, each with the picture of its first
    /// page, ready to open. Shown at startup (unless the user hides it) and from Help.
    /// The same window as the Delphi and Lazarus designers.
    /// </summary>
    public class WelcomeForm : Form
    {
        private static readonly Color BandColor = Color.FromArgb(0x1F, 0x4E, 0x79);
        private static readonly Color AccentColor = Color.FromArgb(0x2E, 0x75, 0xB6);
        private static readonly Color SelectedColor = Color.FromArgb(0xE3, 0xEC, 0xF6);
        private static readonly Color DescriptionColor = Color.FromArgb(0x59, 0x59, 0x59);

        private readonly float scale;
        private readonly string installedFolder;
        private readonly List<SampleReportInfo> samples;
        private ListBox listSamples;
        private PictureBox picture;
        private CheckBox checkHide;
        private Button buttonOpen;
        private Font titleFont;
        private Font descriptionFont;

        /// <summary>The choice of the user.</summary>
        [System.ComponentModel.Browsable(false)]
        [System.ComponentModel.DesignerSerializationVisibility(System.ComponentModel.DesignerSerializationVisibility.Hidden)]
        public WelcomeAction Action { get; private set; }
        /// <summary>The sample to open (in the working copy) when <see cref="Action"/> is OpenSample.</summary>
        [System.ComponentModel.Browsable(false)]
        [System.ComponentModel.DesignerSerializationVisibility(System.ComponentModel.DesignerSerializationVisibility.Hidden)]
        public string SamplePath { get; private set; } = "";
        /// <summary>The "do not show at startup" check box, the inverse of this value.</summary>
        [System.ComponentModel.Browsable(false)]
        [System.ComponentModel.DesignerSerializationVisibility(System.ComponentModel.DesignerSerializationVisibility.Hidden)]
        public bool ShowAtStartup
        {
            get { return !checkHide.Checked; }
            set { checkHide.Checked = !value; }
        }

        /// <summary>Builds the window with the samples of the installed samples folder.</summary>
        public WelcomeForm()
        {
            scale = GraphicUtils.DPIScale;
            installedFolder = SampleReports.InstalledFolder();
            samples = installedFolder.Length > 0 ? SampleReports.Load(installedFolder) : new List<SampleReportInfo>();
            BuildControls();
        }

        private int S(int value)
        {
            return (int)Math.Round(value * scale);
        }

        private void BuildControls()
        {
            SuspendLayout();
            Text = DesignerText.Tr(1);
            StartPosition = FormStartPosition.CenterParent;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            ShowInTaskbar = false;
            ShowIcon = false;
            Font = new Font("Segoe UI", 9F);
            BackColor = Color.White;
            ClientSize = new Size(S(920), S(620));
            KeyPreview = true;

            titleFont = new Font("Segoe UI", 10.5F, FontStyle.Bold);
            descriptionFont = new Font("Segoe UI", 9F);

            // The band of the samples, with the welcome and what the samples are
            Panel band = new Panel { Dock = DockStyle.Top, Height = S(104), BackColor = BandColor };
            Label title = new Label
            {
                Text = DesignerText.Tr(2010),
                Font = new Font("Segoe UI", 17F, FontStyle.Bold),
                ForeColor = Color.White,
                AutoSize = false,
                Location = new Point(S(28), S(14)),
                Size = new Size(S(860), S(40)),
                BackColor = Color.Transparent
            };
            Label subtitle = new Label
            {
                Text = DesignerText.Tr(2011),
                Font = new Font("Segoe UI", 9.75F),
                ForeColor = Color.FromArgb(0xD6, 0xE4, 0xF2),
                AutoSize = false,
                Location = new Point(S(30), S(56)),
                Size = new Size(S(860), S(42)),
                BackColor = Color.Transparent
            };
            band.Controls.Add(title);
            band.Controls.Add(subtitle);

            // Buttons and "do not show again"
            Panel bottom = new Panel { Dock = DockStyle.Bottom, Height = S(60), BackColor = Color.FromArgb(0xF3, 0xF3, 0xF3) };
            Panel bottomLine = new Panel { Dock = DockStyle.Top, Height = 1, BackColor = Color.FromArgb(0xDD, 0xDD, 0xDD) };
            bottom.Controls.Add(bottomLine);
            checkHide = new CheckBox
            {
                Text = DesignerText.Tr(2016),
                AutoSize = true,
                Location = new Point(S(28), S(20)),
                BackColor = Color.Transparent
            };
            bottom.Controls.Add(checkHide);
            Button buttonClose = MakeButton(DesignerText.Tr(1891));
            buttonClose.DialogResult = DialogResult.Cancel;
            Button buttonOpenReport = MakeButton(DesignerText.Tr(214) + "...");
            buttonOpenReport.Click += (s, e) => Finish(WelcomeAction.OpenReport);
            Button buttonNew = MakeButton(DesignerText.Tr(2015));
            buttonNew.Click += (s, e) => Finish(WelcomeAction.NewReport);
            buttonOpen = MakeButton(DesignerText.Tr(2014));
            buttonOpen.Font = new Font(Font, FontStyle.Bold);
            buttonOpen.Click += (s, e) => OpenSelected();
            int x = ClientSize.Width - S(28);
            foreach (Button b in new Button[] { buttonClose, buttonOpenReport, buttonNew, buttonOpen })
            {
                x -= b.Width;
                b.Location = new Point(x, S(14));
                bottom.Controls.Add(b);
                x -= S(8);
            }
            AcceptButton = buttonOpen;
            CancelButton = buttonClose;

            // Where the samples are opened from
            Panel info = new Panel { Dock = DockStyle.Bottom, Height = S(34), BackColor = Color.White };
            LinkLabel folderLink = new LinkLabel
            {
                AutoSize = false,
                Location = new Point(S(28), S(6)),
                Size = new Size(ClientSize.Width - S(56), S(22)),
                ForeColor = DescriptionColor,
                LinkColor = AccentColor,
                ActiveLinkColor = BandColor
            };
            string working = SampleReports.WorkingFolder();
            string infoText = DesignerText.Format(2017, working);
            folderLink.Text = infoText;
            int start = infoText.IndexOf(working, StringComparison.Ordinal);
            if (start >= 0)
                folderLink.LinkArea = new LinkArea(start, working.Length);
            folderLink.LinkClicked += (s, e) => OpenWorkingFolder();
            info.Controls.Add(folderLink);

            // The list and the picture of the selected sample
            Panel content = new Panel { Dock = DockStyle.Fill, Padding = new Padding(S(28), S(20), S(28), S(4)), BackColor = Color.White };
            Panel pictureFrame = new Panel
            {
                Dock = DockStyle.Right,
                Width = S(290),
                Padding = new Padding(1),
                BackColor = Color.FromArgb(0xC8, 0xC8, 0xC8)
            };
            picture = new PictureBox { Dock = DockStyle.Fill, SizeMode = PictureBoxSizeMode.Zoom, BackColor = Color.White };
            pictureFrame.Controls.Add(picture);
            Panel gap = new Panel { Dock = DockStyle.Right, Width = S(20), BackColor = Color.White };
            listSamples = new ListBox
            {
                Dock = DockStyle.Fill,
                DrawMode = DrawMode.OwnerDrawVariable,
                BorderStyle = BorderStyle.None,
                IntegralHeight = false,
                BackColor = Color.White
            };
            listSamples.MeasureItem += ListMeasureItem;
            listSamples.DrawItem += ListDrawItem;
            listSamples.SelectedIndexChanged += (s, e) => ShowThumbnail();
            listSamples.DoubleClick += (s, e) => OpenSelected();
            Panel listFrame = new Panel { Dock = DockStyle.Fill, Padding = new Padding(1), BackColor = Color.FromArgb(0xDD, 0xDD, 0xDD) };
            listFrame.Controls.Add(listSamples);
            content.Controls.Add(listFrame);
            content.Controls.Add(gap);
            content.Controls.Add(pictureFrame);

            Controls.Add(content);
            Controls.Add(info);
            Controls.Add(bottom);
            Controls.Add(band);
            ResumeLayout(false);

            if (samples.Count == 0)
            {
                buttonOpen.Enabled = false;
                folderLink.Text = DesignerText.Format(2018, Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "samples"));
                folderLink.LinkArea = new LinkArea(0, 0);
            }
        }

        /// <summary>Fills the list once the window has its layout: each item measures its text with
        /// the final width of the list.</summary>
        protected override void OnLoad(EventArgs e)
        {
            base.OnLoad(e);
            PerformLayout();
            listSamples.BeginUpdate();
            foreach (SampleReportInfo sample in samples)
                listSamples.Items.Add(sample);
            listSamples.EndUpdate();
            if (samples.Count > 0)
                listSamples.SelectedIndex = 0;
        }

        private Button MakeButton(string text)
        {
            Button button = new Button
            {
                Text = text,
                AutoSize = false,
                Size = new Size(S(132), S(32)),
                UseVisualStyleBackColor = true
            };
            int needed = TextRenderer.MeasureText(text, Font).Width + S(24);
            if (needed > button.Width)
                button.Width = needed;
            return button;
        }

        private int TextWidth()
        {
            return listSamples.ClientSize.Width - S(36);
        }

        private void ListMeasureItem(object sender, MeasureItemEventArgs e)
        {
            SampleReportInfo sample = (SampleReportInfo)listSamples.Items[e.Index];
            int width = TextWidth();
            Size titleSize = TextRenderer.MeasureText(e.Graphics, sample.Title, titleFont, new Size(width, 0), TextFormatFlags.WordBreak);
            Size descriptionSize = TextRenderer.MeasureText(e.Graphics, sample.Description, descriptionFont, new Size(width, 0), TextFormatFlags.WordBreak);
            e.ItemHeight = Math.Min(255, S(12) + titleSize.Height + S(3) + descriptionSize.Height + S(12));
        }

        private void ListDrawItem(object sender, DrawItemEventArgs e)
        {
            if (e.Index < 0)
                return;
            SampleReportInfo sample = (SampleReportInfo)listSamples.Items[e.Index];
            bool selected = (e.State & DrawItemState.Selected) == DrawItemState.Selected;
            Rectangle r = e.Bounds;
            using (SolidBrush back = new SolidBrush(selected ? SelectedColor : Color.White))
                e.Graphics.FillRectangle(back, r);
            if (selected)
            {
                using (SolidBrush accent = new SolidBrush(AccentColor))
                    e.Graphics.FillRectangle(accent, r.Left, r.Top, S(4), r.Height);
            }
            else if (e.Index < listSamples.Items.Count - 1)
            {
                using (Pen line = new Pen(Color.FromArgb(0xEC, 0xEC, 0xEC)))
                    e.Graphics.DrawLine(line, r.Left + S(18), r.Bottom - 1, r.Right - S(18), r.Bottom - 1);
            }
            int width = TextWidth();
            Size titleSize = TextRenderer.MeasureText(e.Graphics, sample.Title, titleFont, new Size(width, 0), TextFormatFlags.WordBreak);
            Rectangle titleRect = new Rectangle(r.Left + S(18), r.Top + S(12), width, titleSize.Height);
            TextRenderer.DrawText(e.Graphics, sample.Title, titleFont, titleRect, BandColor, TextFormatFlags.WordBreak);
            Rectangle descriptionRect = new Rectangle(r.Left + S(18), titleRect.Bottom + S(3), width, r.Bottom - titleRect.Bottom - S(3));
            TextRenderer.DrawText(e.Graphics, sample.Description, descriptionFont, descriptionRect, DescriptionColor, TextFormatFlags.WordBreak);
            e.DrawFocusRectangle();
        }

        private void ShowThumbnail()
        {
            Image old = picture.Image;
            picture.Image = null;
            if (old != null)
                old.Dispose();
            SampleReportInfo sample = listSamples.SelectedItem as SampleReportInfo;
            if (sample == null || sample.Thumbnail.Length == 0)
                return;
            string file = Path.Combine(installedFolder, sample.Thumbnail);
            if (!File.Exists(file))
                return;
            // A copy, so the file is not kept open
            using (Image image = Image.FromFile(file))
                picture.Image = new Bitmap(image);
        }

        private void OpenSelected()
        {
            SampleReportInfo sample = listSamples.SelectedItem as SampleReportInfo;
            if (sample == null)
                return;
            string working = SampleReports.WorkingFolder();
            try
            {
                SampleReports.UpdateWorkingCopy(installedFolder, working);
                SamplePath = Path.Combine(working, sample.FileName);
            }
            catch (Exception ex)
            {
                // Without a working copy (no documents folder, no space...) the installed sample
                // still opens; saving it may need another folder
                System.Diagnostics.Debug.WriteLine(ex.Message);
                SamplePath = Path.Combine(installedFolder, sample.FileName);
            }
            Finish(WelcomeAction.OpenSample);
        }

        private void OpenWorkingFolder()
        {
            try
            {
                string working = SampleReports.WorkingFolder();
                if (installedFolder.Length > 0)
                    SampleReports.UpdateWorkingCopy(installedFolder, working);
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(working) { UseShellExecute = true });
            }
            catch (Exception ex)
            {
                MessageBox.Show(this, ex.Message, Text, MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }

        private void Finish(WelcomeAction action)
        {
            Action = action;
            DialogResult = DialogResult.OK;
        }

        /// <summary>Disposes the fonts and the picture.</summary>
        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                if (picture != null && picture.Image != null)
                    picture.Image.Dispose();
                if (titleFont != null)
                    titleFont.Dispose();
                if (descriptionFont != null)
                    descriptionFont.Dispose();
            }
            base.Dispose(disposing);
        }

        /// <summary>
        /// Draws the window, with the first sample selected, to a PNG file without showing it (the
        /// <c>/welcome /shot</c> switch of the designer).
        /// </summary>
        public static void Capture(string pngFile, int selected)
        {
            using (WelcomeForm form = new WelcomeForm())
            {
                form.StartPosition = FormStartPosition.Manual;
                form.Location = new Point(-4000, -4000);
                form.Show();
                if (selected >= 0 && selected < form.listSamples.Items.Count)
                    form.listSamples.SelectedIndex = selected;
                Application.DoEvents();
                using (Bitmap bmp = new Bitmap(form.Width, form.Height))
                {
                    form.DrawToBitmap(bmp, new Rectangle(0, 0, bmp.Width, bmp.Height));
                    bmp.Save(pngFile, System.Drawing.Imaging.ImageFormat.Png);
                }
                form.Close();
            }
        }
    }
}
