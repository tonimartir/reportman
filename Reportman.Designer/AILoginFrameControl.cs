using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;

namespace Reportman.Designer
{
    /// <summary>
    /// Replicates Delphi's TFRpLoginFrameVCL: a compact login banner that shows
    /// "Guest (Login available)" when logged out, or [Tier][Avatar][Username][▼] when logged in.
    /// Connected to RpAuthManager for real auth state and persistence.
    /// </summary>
    public class AILoginFrameControl : UserControl
    {
        // Visual controls
        private Panel _container;
        private Button _btnLogin;
        private Label _lblTier;
        private PictureBox _imgAvatar;
        private Label _lblUser;
        private Label _lblArrow;

        // Popup menu
        private ContextMenuStrip _popupMenu;
        private ToolStripMenuItem _menuLogin;
        private ToolStripMenuItem _menuLanguage;
        private ToolStripMenuItem _menuPricePlans;
        private ToolStripMenuItem _menuConfigureSchemas;
        private ToolStripMenuItem _menuDbAiAgent;
        private ToolStripSeparator _menuSepLogout;
        private ToolStripMenuItem _menuLogout;

        public AILoginFrameControl()
        {
            InitializeComponent();

            // Listen to auth manager state changes
            RpAuthManager.Instance.AuthChanged += OnAuthChanged;

            // Initial UI state from persisted config
            UpdateUI();
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                RpAuthManager.Instance.AuthChanged -= OnAuthChanged;
            }
            base.Dispose(disposing);
        }

        private void OnAuthChanged(bool success)
        {
            if (InvokeRequired)
            {
                try { Invoke(new Action(() => UpdateUI())); } catch { }
            }
            else
            {
                UpdateUI();
            }
        }

        private void InitializeComponent()
        {
            this.AutoSize = true;
            this.AutoSizeMode = AutoSizeMode.GrowAndShrink;

            // Build popup menu (matches Delphi's PopupUser + dynamic items)
            BuildPopupMenu();

            // Main container panel
            _container = new Panel
            {
                Dock = DockStyle.Fill,
                Height = 40,
                MinimumSize = new Size(0, 40),
                Cursor = Cursors.Hand,
                BackColor = SystemColors.Control
            };
            _container.Click += Container_Click;

            // "Login with AI" button - hidden per Delphi behavior (we use popup menu instead)
            _btnLogin = new Button
            {
                Text = "Sign in with AI",
                Dock = DockStyle.Fill,
                FlatStyle = FlatStyle.System,
                Visible = false
            };
            _btnLogin.Click += (s, e) => ShowLoginDialog();

            // Tier badge label (e.g. "FREE", "PRO")
            _lblTier = new Label
            {
                AutoSize = false,
                Size = new Size(40, 18),
                TextAlign = ContentAlignment.MiddleCenter,
                Font = new Font("Segoe UI", 7.5f, FontStyle.Bold),
                ForeColor = Color.White,
                BackColor = Color.Gray,
                Visible = false
            };
            _lblTier.Click += Container_Click;

            // Avatar image
            _imgAvatar = new PictureBox
            {
                Size = new Size(28, 28),
                SizeMode = PictureBoxSizeMode.Zoom,
                Visible = false,
                Cursor = Cursors.Hand
            };
            _imgAvatar.Click += Container_Click;

            // Username label
            _lblUser = new Label
            {
                Text = "Guest (Login available)",
                AutoSize = false,
                TextAlign = ContentAlignment.MiddleLeft,
                Font = new Font("Segoe UI", 9f, FontStyle.Regular),
                Cursor = Cursors.Hand,
                Visible = true
            };
            _lblUser.Click += Container_Click;

            // Dropdown arrow (Marlett font char '6' = ▼)
            _lblArrow = new Label
            {
                Text = "6",
                Font = new Font("Marlett", 9f, FontStyle.Bold),
                ForeColor = Color.Gray,
                AutoSize = true,
                Cursor = Cursors.Hand,
                Visible = true
            };
            _lblArrow.Click += Container_Click;

            // Add controls to container
            _container.Controls.Add(_btnLogin);
            _container.Controls.Add(_lblTier);
            _container.Controls.Add(_imgAvatar);
            _container.Controls.Add(_lblUser);
            _container.Controls.Add(_lblArrow);

            _container.Resize += (s, e) => LayoutControls();

            // Wrap in TableLayoutPanel for AutoSize support
            TableLayoutPanel table = new TableLayoutPanel
            {
                Dock = DockStyle.Fill,
                ColumnCount = 1,
                RowCount = 1,
                AutoSize = true,
                AutoSizeMode = AutoSizeMode.GrowAndShrink
            };
            table.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            table.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100f));
            table.Controls.Add(_container, 0, 0);

            this.Controls.Add(table);
        }

        private void BuildPopupMenu()
        {
            _popupMenu = new ContextMenuStrip();

            _menuLogin = new ToolStripMenuItem("Login");
            _menuLogin.Click += (s, e) => ShowLoginDialog();

            _menuLanguage = new ToolStripMenuItem("Language");
            // Build language submenu from supported languages
            string[] languages = new string[] { "English", "Spanish", "Italian", "French", "German", "Portuguese", "Chinese", "Catalan" };
            foreach (string lang in languages)
            {
                var item = new ToolStripMenuItem(lang);
                string langCopy = lang;
                item.Click += (s, e) =>
                {
                    RpAuthManager.Instance.AILanguage = langCopy;
                    UpdateLanguageChecks();
                };
                _menuLanguage.DropDownItems.Add(item);
            }
            UpdateLanguageChecks();

            _menuPricePlans = new ToolStripMenuItem("AI price plans");
            _menuPricePlans.Click += (s, e) =>
            {
                try { System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo { FileName = "https://app.reportman.es/subscription", UseShellExecute = true }); } catch { }
            };

            _menuConfigureSchemas = new ToolStripMenuItem("Configure DB Schemas");
            _menuConfigureSchemas.Click += (s, e) =>
            {
                try { System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo { FileName = "https://app.reportman.es/database-config", UseShellExecute = true }); } catch { }
            };

            _menuDbAiAgent = new ToolStripMenuItem("DB && AI Agent");

            _menuSepLogout = new ToolStripSeparator();
            _menuLogout = new ToolStripMenuItem("Logout");
            _menuLogout.Click += (s, e) =>
            {
                RpAuthManager.Instance.Logout();
                UpdateUI();
            };

            _popupMenu.Items.AddRange(new ToolStripItem[]
            {
                _menuLogin,
                _menuLanguage,
                _menuPricePlans,
                _menuConfigureSchemas,
                _menuDbAiAgent,
                _menuSepLogout,
                _menuLogout
            });
        }

        private void UpdateLanguageChecks()
        {
            foreach (ToolStripMenuItem item in _menuLanguage.DropDownItems)
            {
                item.Checked = string.Equals(item.Text, RpAuthManager.Instance.AILanguage, StringComparison.OrdinalIgnoreCase);
            }
        }

        private void Container_Click(object sender, EventArgs e)
        {
            _popupMenu.Show(_container, new Point(0, _container.Height));
        }

        private void ShowLoginDialog()
        {
            using (var frm = new AILoginForm())
            {
                if (frm.ShowDialog(this.FindForm()) == DialogResult.OK)
                {
                    UpdateUI();
                }
            }
        }

        private void UpdateUI()
        {
            var auth = RpAuthManager.Instance;
            _btnLogin.Visible = false; // Always hidden per Delphi behavior

            if (auth.IsLoggedIn)
            {
                int tierId = (int)auth.Profile.TierId;
                _lblTier.Text = GetTierName(tierId);
                ApplyTierColors(tierId);
                _lblTier.Visible = true;
                _imgAvatar.Visible = false; // Avatar download not yet implemented
                _lblUser.Text = !string.IsNullOrEmpty(auth.Profile.UserName) ? auth.Profile.UserName : auth.Profile.Email;
                _lblUser.Visible = true;
                _lblArrow.Visible = true;

                // Popup menu state
                _menuLogin.Visible = false;
                _menuSepLogout.Visible = true;
                _menuLogout.Visible = true;
            }
            else
            {
                _lblTier.Visible = false;
                _imgAvatar.Visible = false;
                _lblUser.Text = "Guest (Login available)";
                _lblUser.Visible = true;
                _lblArrow.Visible = true;

                // Popup menu state
                _menuLogin.Visible = true;
                _menuSepLogout.Visible = false;
                _menuLogout.Visible = false;
            }

            UpdateLanguageChecks();
            LayoutControls();
        }

        private void LayoutControls()
        {
            int containerW = _container.ClientSize.Width;
            int containerH = _container.ClientSize.Height;
            int margin = 8;

            // Arrow always at right
            _lblArrow.Location = new Point(containerW - _lblArrow.Width - margin,
                                           (containerH - _lblArrow.Height) / 2);

            if (RpAuthManager.Instance.IsLoggedIn && _lblTier.Visible)
            {
                // [TierBadge] [Avatar] [Username] [Arrow▼]
                int x = 6;
                _lblTier.Location = new Point(x, (containerH - _lblTier.Height) / 2);
                x = _lblTier.Right + 6;

                if (_imgAvatar.Visible)
                {
                    _imgAvatar.Location = new Point(x, (containerH - _imgAvatar.Height) / 2);
                    x = _imgAvatar.Right + 8;
                }

                _lblUser.Location = new Point(x, 0);
                _lblUser.Size = new Size(Math.Max(0, _lblArrow.Left - x - 4), containerH);
            }
            else
            {
                // Guest mode: [Username] [Arrow▼]
                _lblUser.Location = new Point(margin, 0);
                _lblUser.Size = new Size(Math.Max(0, _lblArrow.Left - margin - 4), containerH);
            }
        }

        private string GetTierName(int tierId)
        {
            switch (tierId)
            {
                case 1: return "GUEST";
                case 2: return "FREE";
                case 3: return "LITE";
                case 4: return "PRO";
                case 5: return "ENT";
                default: return "FREE";
            }
        }

        private void ApplyTierColors(int tierId)
        {
            switch (tierId)
            {
                case 1: // GUEST
                    _lblTier.BackColor = Color.FromArgb(0xE0, 0xE0, 0xE0);
                    _lblTier.ForeColor = Color.FromArgb(0x4F, 0x45, 0x36);
                    break;
                case 2: // FREE
                    _lblTier.BackColor = Color.FromArgb(0xE0, 0xF2, 0xF1);
                    _lblTier.ForeColor = Color.FromArgb(0x1B, 0x5E, 0x20);
                    break;
                case 3: // LITE
                    _lblTier.BackColor = Color.FromArgb(0xE1, 0xF5, 0xFE);
                    _lblTier.ForeColor = Color.FromArgb(0x0D, 0x47, 0xA1);
                    break;
                case 4: // PRO
                    _lblTier.BackColor = Color.FromArgb(0x02, 0x77, 0xBD);
                    _lblTier.ForeColor = Color.White;
                    break;
                case 5: // ENT
                    _lblTier.BackColor = Color.FromArgb(0x21, 0x21, 0x21);
                    _lblTier.ForeColor = Color.FromArgb(0xFF, 0xD7, 0x00);
                    break;
            }
        }
    }
}
