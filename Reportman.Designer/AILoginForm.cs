using System;
using System.Drawing;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace Reportman.Designer
{
    /// <summary>
    /// Port of Delphi's TFRpLoginVCL: modal dialog with Google, Microsoft, Apple and Email OTP login.
    /// Uses RpAuthManager for all auth operations.
    /// </summary>
    public class AILoginForm : Form
    {
        private Label lblTitle;
        private Panel panelButtons;
        private Button btnGoogle;
        private Button btnMicrosoft;
        private Button btnApple;
        private Button btnEmail;
        private Panel panelEmail;
        private Label lblEmail;
        private TextBox txtEmail;
        private Button btnSendCode;
        private Label lblCode;
        private TextBox txtCode;
        private Button btnLoginCode;
        private Label lblStatus;
        private TextBox txtLog;

        /// <summary>
        /// Initializes a new instance of the AILoginForm class, registering log event listeners.
        /// </summary>
        public AILoginForm()
        {
            InitializeComponent();
            // Register log listener
            RpAuthManager.Instance.LogMessage += OnAuthLog;
        }

        /// <summary>
        /// Performs cleanup when the form is closed, unregistering event handlers.
        /// </summary>
        /// <param name="e">Event arguments containing form closed details.</param>
        protected override void OnFormClosed(FormClosedEventArgs e)
        {
            RpAuthManager.Instance.LogMessage -= OnAuthLog;
            base.OnFormClosed(e);
        }

        private void OnAuthLog(string msg)
        {
            if (IsDisposed) return;
            if (InvokeRequired)
            {
                try { Invoke(new Action(() => OnAuthLog(msg))); } catch { }
                return;
            }
            txtLog.AppendText("[" + DateTime.Now.ToString("HH:mm:ss") + "] " + msg + Environment.NewLine);
        }

        // A login button with the logo of its provider at the left and the caption centered.
        // FlatStyle.Standard: a System button does not draw images
        private Button NewProviderButton(string text, string icon)
        {
            var button = new Button
            {
                Text = text,
                Dock = DockStyle.Top,
                Height = 40,
                FlatStyle = FlatStyle.Standard,
                UseVisualStyleBackColor = true,
                Cursor = Cursors.Hand,
                TextAlign = ContentAlignment.MiddleCenter,
                ImageAlign = ContentAlignment.MiddleLeft,
                TextImageRelation = TextImageRelation.Overlay,
                Padding = new Padding(12, 0, 0, 0),
                Image = LoadProviderIcon(icon)
            };
            return button;
        }

        // The icon of the screen's DPI: 20 pixels at 100 %, the 30 and 40 pixel files above
        private Image LoadProviderIcon(string icon)
        {
            int target = (int)Math.Round(20 * DeviceDpi / 96.0);
            int size = target <= 20 ? 20 : target <= 30 ? 30 : 40;
            using (var stream = typeof(AILoginForm).Assembly.GetManifestResourceStream($"LoginIcons.{icon}_{size}.png"))
            {
                if (stream == null)
                    return null;
                using (var image = Image.FromStream(stream))
                {
                    var result = new Bitmap(target, target);
                    using (var g = Graphics.FromImage(result))
                    {
                        g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
                        g.PixelOffsetMode = System.Drawing.Drawing2D.PixelOffsetMode.HighQuality;
                        g.DrawImage(image, 0, 0, target, target);
                    }
                    return result;
                }
            }
        }

        private void InitializeComponent()
        {
            this.Text = DesignerText.Tr(1499);
            this.Size = new Size(420, 606);
            this.StartPosition = FormStartPosition.CenterParent;
            this.FormBorderStyle = FormBorderStyle.FixedDialog;
            this.MaximizeBox = false;
            this.MinimizeBox = false;

            lblTitle = new Label
            {
                Text = DesignerText.Tr(1500),
                Font = new Font("Segoe UI", 14, FontStyle.Bold),
                Dock = DockStyle.Top,
                TextAlign = ContentAlignment.MiddleCenter,
                Height = 50
            };

            // === Button panel ===
            // The provider buttons as in the Delphi designer: 40 pixels high, 10 apart,
            // with the provider's logo at their left
            panelButtons = new Panel { Dock = DockStyle.Top, Height = 206, Padding = new Padding(30, 8, 30, 8) };

            btnGoogle = NewProviderButton(DesignerText.Tr(1501), "google");
            btnGoogle.Click += BtnGoogle_Click;
            btnMicrosoft = NewProviderButton(DesignerText.Tr(1502), "microsoft");
            btnMicrosoft.Click += BtnMicrosoft_Click;
            btnApple = NewProviderButton(DesignerText.Tr(2009), "apple");
            btnApple.Click += BtnApple_Click;
            btnEmail = NewProviderButton(DesignerText.Tr(1503), "email");
            btnEmail.Click += BtnEmail_Click;

            // Docked to the top: the last one added is the topmost
            panelButtons.Controls.Add(btnEmail);
            panelButtons.Controls.Add(new Panel { Dock = DockStyle.Top, Height = 10 });
            panelButtons.Controls.Add(btnApple);
            panelButtons.Controls.Add(new Panel { Dock = DockStyle.Top, Height = 10 });
            panelButtons.Controls.Add(btnMicrosoft);
            panelButtons.Controls.Add(new Panel { Dock = DockStyle.Top, Height = 10 });
            panelButtons.Controls.Add(btnGoogle);

            // === Email panel (initially hidden) ===
            panelEmail = new Panel { Dock = DockStyle.Top, Height = 160, Padding = new Padding(30, 5, 30, 5), Visible = false };

            lblEmail = new Label { Text = DesignerText.Tr(1504), Dock = DockStyle.Top, Height = 20 };
            txtEmail = new TextBox { Dock = DockStyle.Top };
            btnSendCode = new Button { Text = DesignerText.Tr(1506), Dock = DockStyle.Top, Height = 30 };
            btnSendCode.Click += BtnSendCode_Click;

            lblCode = new Label { Text = DesignerText.Tr(1505), Dock = DockStyle.Top, Height = 20 };
            txtCode = new TextBox { Dock = DockStyle.Top };
            btnLoginCode = new Button { Text = DesignerText.Tr(1492), Dock = DockStyle.Top, Height = 30 };
            btnLoginCode.Click += BtnLoginCode_Click;

            panelEmail.Controls.Add(btnLoginCode);
            panelEmail.Controls.Add(txtCode);
            panelEmail.Controls.Add(lblCode);
            panelEmail.Controls.Add(btnSendCode);
            panelEmail.Controls.Add(txtEmail);
            panelEmail.Controls.Add(lblEmail);

            // === Status label ===
            lblStatus = new Label
            {
                Dock = DockStyle.Top,
                Height = 30,
                TextAlign = ContentAlignment.MiddleCenter,
                ForeColor = Color.Blue
            };

            // === Log textbox ===
            txtLog = new TextBox
            {
                Dock = DockStyle.Fill,
                Multiline = true,
                ReadOnly = true,
                ScrollBars = ScrollBars.Vertical,
                Font = new Font("Consolas", 8.5f),
                BackColor = Color.FromArgb(245, 245, 245)
            };

            this.Controls.Add(txtLog);
            this.Controls.Add(lblStatus);
            this.Controls.Add(panelEmail);
            this.Controls.Add(panelButtons);
            this.Controls.Add(lblTitle);
        }

        private void SetAllButtonsEnabled(bool enabled)
        {
            btnGoogle.Enabled = enabled;
            btnMicrosoft.Enabled = enabled;
            btnApple.Enabled = enabled;
            btnEmail.Enabled = enabled;
            btnSendCode.Enabled = enabled;
            btnLoginCode.Enabled = enabled;
        }

        private void SetStatus(string text, Color color)
        {
            lblStatus.ForeColor = color;
            lblStatus.Text = text;
        }

        // ===== Google Login =====

        private async void BtnGoogle_Click(object sender, EventArgs e)
        {
            SetAllButtonsEnabled(false);
            SetStatus(DesignerText.Tr(1507), Color.Blue);
            try
            {
                bool ok = await RpAuthManager.Instance.LoginGoogleAsync();
                if (ok)
                {
                    SetStatus(DesignerText.Tr(1773), Color.Green);
                    this.DialogResult = DialogResult.OK;
                    this.Close();
                }
                else
                {
                    SetStatus(DesignerText.Tr(1508), Color.Red);
                }
            }
            catch (Exception ex)
            {
                SetStatus(DesignerText.Tr(355) + ": " + ex.Message, Color.Red);
            }
            finally
            {
                SetAllButtonsEnabled(true);
            }
        }

        // ===== Microsoft Login =====

        private async void BtnMicrosoft_Click(object sender, EventArgs e)
        {
            SetAllButtonsEnabled(false);
            SetStatus(DesignerText.Tr(1507), Color.Blue);
            try
            {
                bool ok = await RpAuthManager.Instance.LoginMicrosoftAsync();
                if (ok)
                {
                    SetStatus(DesignerText.Tr(1773), Color.Green);
                    this.DialogResult = DialogResult.OK;
                    this.Close();
                }
                else
                {
                    SetStatus(DesignerText.Tr(1508), Color.Red);
                }
            }
            catch (Exception ex)
            {
                SetStatus(DesignerText.Tr(355) + ": " + ex.Message, Color.Red);
            }
            finally
            {
                SetAllButtonsEnabled(true);
            }
        }

        // ===== Apple Login =====

        private async void BtnApple_Click(object sender, EventArgs e)
        {
            SetAllButtonsEnabled(false);
            SetStatus(DesignerText.Tr(1507), Color.Blue);
            try
            {
                bool ok = await RpAuthManager.Instance.LoginAppleAsync();
                if (ok)
                {
                    SetStatus(DesignerText.Tr(1773), Color.Green);
                    this.DialogResult = DialogResult.OK;
                    this.Close();
                }
                else
                {
                    // What the server said (Sign in with Apple not configured...)
                    string reason = RpAuthManager.Instance.LastLoginError;
                    SetStatus(string.IsNullOrEmpty(reason) ? DesignerText.Tr(1508) : reason, Color.Red);
                }
            }
            catch (Exception ex)
            {
                SetStatus(DesignerText.Tr(355) + ": " + ex.Message, Color.Red);
            }
            finally
            {
                SetAllButtonsEnabled(true);
            }
        }

        // ===== Email Login =====

        private void BtnEmail_Click(object sender, EventArgs e)
        {
            panelEmail.Visible = true;
            panelButtons.Visible = false;
            txtEmail.Focus();
        }

        private async void BtnSendCode_Click(object sender, EventArgs e)
        {
            if (string.IsNullOrWhiteSpace(txtEmail.Text))
            {
                SetStatus(DesignerText.Tr(1509), Color.Red);
                return;
            }

            SetAllButtonsEnabled(false);
            SetStatus(DesignerText.Tr(1510), Color.Blue);

            bool ok = await RpAuthManager.Instance.RequestLoginCodeAsync(txtEmail.Text.Trim());
            if (ok)
            {
                SetStatus(DesignerText.Tr(1511), Color.Green);
                txtCode.Focus();
            }
            else
            {
                SetStatus(DesignerText.Tr(1512), Color.Red);
            }
            SetAllButtonsEnabled(true);
        }

        private async void BtnLoginCode_Click(object sender, EventArgs e)
        {
            if (string.IsNullOrWhiteSpace(txtCode.Text))
            {
                SetStatus(DesignerText.Tr(1513), Color.Red);
                return;
            }

            SetAllButtonsEnabled(false);
            SetStatus(DesignerText.Tr(1514), Color.Blue);

            bool ok = await RpAuthManager.Instance.LoginWithCodeAsync(
                txtEmail.Text.Trim(), txtCode.Text.Trim());
            if (ok)
            {
                SetStatus(DesignerText.Tr(1773), Color.Green);
                this.DialogResult = DialogResult.OK;
                this.Close();
            }
            else
            {
                SetStatus(DesignerText.Tr(1515), Color.Red);
            }
            SetAllButtonsEnabled(true);
        }
    }
}
