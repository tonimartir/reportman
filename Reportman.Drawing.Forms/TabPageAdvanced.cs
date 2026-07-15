#region Copyright
/* Code based on Magic Library tab control
 * Crownwood.Magic.Controls.TabControl
 *
 *
 *
 *
 *
 *
 */
#endregion
using System;
using System.ComponentModel;
using System.Drawing;
using System.Windows.Forms;

namespace Reportman.Drawing.Forms
{
    /// <summary>
    /// A single page within an advanced tab control, carrying its title, icon, hosted control and selection state, and raising change notifications; also supports animated processing and alerting icons.
    /// </summary>
    public class TabPageAdvanced : PanelAdvanced
    {
        /// <summary>
        /// Identifies which property of a <see cref="TabPageAdvanced"/> changed, reported through the page's property-changed notification.
        /// </summary>
        // Enumeration of property change events
        public enum Property
        {
            /// <summary>The page's title text changed.</summary>
            Title,
            /// <summary>The control hosted by the page changed.</summary>
            Control,
            /// <summary>The image index used for the page's tab icon changed.</summary>
            ImageIndex,
            /// <summary>The image list supplying the page's tab icon changed.</summary>
            ImageList,
            /// <summary>The page's tab icon image changed.</summary>
            Icon,
            /// <summary>The current animation frame of the page's icon changed.</summary>
            IconFrame,
            /// <summary>The page's selected state changed.</summary>
            Selected,
            /// <summary>The page's closable state changed.</summary>
            CanClose,
            /// <summary>The flag controlling whether the page's icon is drawn highlighted changed.</summary>
            DrawIconHightlight,
            /// <summary>The fixed tab width for the page changed.</summary>
            TabWidth,
            /// <summary>The alignment of the page's title text changed.</summary>
            TitleAlignment
        }

        /// <summary>
        /// Handler signature for a tab page property change, receiving the page, the <see cref="Property"/> that changed and its previous value.
        /// </summary>
        // Declare the property change event signature
        public delegate void PropChangeHandler(TabPageAdvanced page, Property prop, object oldValue);

        // Public events
        /// <summary>
        /// Occurs when one of the page's properties changes, reporting the property that changed and its previous value.
        /// </summary>
        public event PropChangeHandler PropertyChanged;

        // Instance fields
        /// <summary>Backing field for the page's title text.</summary>
        protected string _title;
        /// <summary>Backing field for the control hosted by the page.</summary>
        protected Control _control;
        /// <summary>Backing field for the index of the page's tab icon within its image list.</summary>
        protected int _imageIndex;
        /// <summary>Backing field for the image list supplying the page's tab icon.</summary>
        protected ImageList _imageList;
        /// <summary>Backing field for the page's tab icon image.</summary>
        protected Image _icon;
        /// <summary>Backing field indicating whether the page is currently selected.</summary>
        protected bool _selected;
        /// <summary>Control that should receive focus when the page is first shown.</summary>
        protected Control _startFocus;
        /// <summary>Backing field indicating whether the page has already been shown.</summary>
        protected bool _shown;

        /// <summary>
        /// Initializes a new tab page with default values and no hosted control.
        /// </summary>
        public TabPageAdvanced()
        {

            InternalConstruct("Page", null, null, -1, null);
        }
        /// <summary>
        /// Changes an attribute of the specified window through the Win32 SetWindowLong API.
        /// </summary>
        /// <param name="hWnd">Handle of the window whose attribute is set.</param>
        /// <param name="nIndex">Zero-based offset of the attribute to change.</param>
        /// <param name="dwNewLong">New value for the attribute.</param>
        /// <returns>The previous value of the attribute.</returns>
        [System.Runtime.InteropServices.DllImport("user32.dll", EntryPoint = "SetWindowLong")]
        public static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);
        /// <summary>
        /// Retrieves an attribute of the specified window through the Win32 GetWindowLong API.
        /// </summary>
        /// <param name="hWnd">Handle of the window whose attribute is read.</param>
        /// <param name="nIndex">Zero-based offset of the attribute to retrieve.</param>
        /// <returns>The requested window attribute value.</returns>
        [System.Runtime.InteropServices.DllImport("user32.dll", EntryPoint = "GetWindowLong")]
        public static extern int GetWindowLong(IntPtr hWnd, int nIndex);

        bool _Composited = true;
        /// <summary>
        /// Gets or sets whether the page uses the WS_EX_COMPOSITED extended window style for double-buffered, flicker-free painting.
        /// </summary>
        [DesignerSerializationVisibility(DesignerSerializationVisibility.Visible)]
        public bool Composited
        {
            get
            {
                return _Composited;
            }
            set
            {
                if (_Composited != value)
                {
                    _Composited = value;
                    int newexstyle = initialparams.ExStyle;
                    if (Composited)
                    {
                        newexstyle |= 0x02000000;  // Turn on WS_EX_COMPOSITED
                    }
                    int wl = GetWindowLong(this.Handle, newexstyle);
                    SetWindowLong(this.Handle, newexstyle, wl);
                    UpdateStyles();

                }
            }
        }
        CreateParams initialparams;
        /// <summary>
        /// Gets the window creation parameters, adding the WS_EX_COMPOSITED extended style when compositing is enabled.
        /// </summary>
        protected override CreateParams CreateParams
        {
            get
            {
                initialparams = base.CreateParams;
                CreateParams cp = base.CreateParams;
                if (Composited)
                {
                    cp.ExStyle |= 0x02000000;  // Turn on WS_EX_COMPOSITED
                }


                //cp.Style = cp.Style | 0x04000000 | 0x02000000; // WS_CLIPSIBLINGS WS_CLIPCHILDREN
                return cp;
            }
        }

        /// <summary>
        /// Handles resizing of the page; forwards the event to the base implementation.
        /// </summary>
        /// <param name="eventargs">Data for the resize event.</param>
        protected override void OnResize(EventArgs eventargs)
        {
            base.OnResize(eventargs);

        }
        /// <summary>
        /// Overrides background painting and intentionally skips it to avoid flicker.
        /// </summary>
        /// <param name="e">Data for the paint event.</param>
        protected override void OnPaintBackground(PaintEventArgs e)
        {
            //base.OnPaintBackground(e);
        }
        /// <summary>
        /// Initializes a new tab page with the given title and no hosted control.
        /// </summary>
        /// <param name="title">Title text shown on the page's tab.</param>
        public TabPageAdvanced(string title)
        {
            InternalConstruct(title, null, null, -1, null);
        }
        bool _processing;
        Image oldIcon;
        Image localprogessimage;

        /// <summary>
        /// Gets or sets whether the page displays an animated progress icon in its tab, temporarily replacing the current icon.
        /// </summary>
        [DesignerSerializationVisibility(DesignerSerializationVisibility.Hidden), Browsable(false)]
        public bool Processing
        {
            get
            {
                return _processing;
            }
            set
            {
                if (_processing != value)
                {
                    if (value)
                    {
                        if (Alerting)
                            Alerting = false;
                        _processing = value;
                        oldIcon = Icon;
                        localprogessimage ??= (Image)Properties.Resources.progress_wheel.Clone();
                        _icon = localprogessimage;
                        OnPropertyChanged(Property.IconFrame, Icon);
                        ImageAnimator.Animate(localprogessimage, OnFrameChanged);
                    }
                    else
                    {
                        _processing = value;
                        ImageAnimator.StopAnimate(localprogessimage, OnFrameChanged);
                        _icon = oldIcon;
                        OnPropertyChanged(Property.Icon, Icon);
                    }
                }
            }
        }
        private void OnFrameChanged(object sender, EventArgs e)
        {
            try
            {
                ImageAnimator.UpdateFrames();
                OnPropertyChanged(Property.IconFrame, Icon);
            }
            catch
            {

            }
        }
        bool _alerting;
        Image localalertingimage;
        Image _AlertingIcon = Properties.Resources.flag_finish;
        /// <summary>
        /// Gets or sets the image used as the animated alerting icon shown while <see cref="Alerting"/> is active.
        /// </summary>
        [DesignerSerializationVisibility(DesignerSerializationVisibility.Visible)]
        public Image AlertingIcon
        {
            get
            {
                return _AlertingIcon;
            }
            set
            {
                if (_AlertingIcon != value)
                {
                    _AlertingIcon = value;
                    if (localalertingimage != null)
                    {
                        localalertingimage.Dispose();
                        localalertingimage = null;
                    }
                }
            }
        }
        /// <summary>
        /// Gets the default image used for the alerting icon.
        /// </summary>
        public static Image DefaultAlertingIcon
        {
            get
            {
                return Properties.Resources.flag_finish;
            }
        }
        /// <summary>
        /// Gets the default image used for the animated progress icon.
        /// </summary>
        public static Image DefaultProgressIcon
        {
            get
            {
                return Properties.Resources.progress_wheel;
            }
        }
        /// <summary>
        /// Gets or sets whether the page displays an animated alerting icon in its tab, temporarily replacing the current icon.
        /// </summary>
        [DesignerSerializationVisibility(DesignerSerializationVisibility.Visible)]
        public bool Alerting
        {
            get
            {
                return _alerting;
            }
            set
            {
                if (_alerting != value)
                {
                    if (value)
                    {
                        if (Processing)
                            Processing = false;
                        _alerting = value;
                        oldIcon = Icon;
                        localalertingimage ??= (Image)_AlertingIcon.Clone();
                        _icon = localalertingimage;
                        OnPropertyChanged(Property.IconFrame, Icon);
                        ImageAnimator.Animate(localalertingimage, OnFrameChangedFinish);
                    }
                    else
                    {
                        _alerting = value;
                        ImageAnimator.StopAnimate(localalertingimage, OnFrameChangedFinish);
                        _icon = oldIcon;
                        OnPropertyChanged(Property.IconFrame, Icon);
                    }
                }
            }
        }
        private void OnFrameChangedFinish(object sender, EventArgs e)
        {
            if (Icon == null)
                return;
            ImageAnimator.UpdateFrames();
            OnPropertyChanged(Property.IconFrame, Icon);
        }
        /// <summary>
        /// Initializes a new tab page with the given title and hosted control.
        /// </summary>
        /// <param name="title">Title text shown on the page's tab.</param>
        /// <param name="control">Control hosted inside the page.</param>
        public TabPageAdvanced(string title, Control control)
        {
            InternalConstruct(title, control, null, -1, null);
        }

        /// <summary>
        /// Initializes a new tab page with the given title, hosted control and image index.
        /// </summary>
        /// <param name="title">Title text shown on the page's tab.</param>
        /// <param name="control">Control hosted inside the page.</param>
        /// <param name="imageIndex">Index of the tab icon within the associated image list.</param>
        public TabPageAdvanced(string title, Control control, int imageIndex)
        {
            InternalConstruct(title, control, null, imageIndex, null);
        }

        /// <summary>
        /// Initializes a new tab page with the given title, hosted control, image list and image index.
        /// </summary>
        /// <param name="title">Title text shown on the page's tab.</param>
        /// <param name="control">Control hosted inside the page.</param>
        /// <param name="imageList">Image list supplying the tab icon.</param>
        /// <param name="imageIndex">Index of the tab icon within <paramref name="imageList"/>.</param>
        public TabPageAdvanced(string title, Control control, ImageList imageList, int imageIndex)
        {
            InternalConstruct(title, control, imageList, imageIndex, null);
        }

        /// <summary>
        /// Initializes a new tab page with the given title, hosted control and icon image.
        /// </summary>
        /// <param name="title">Title text shown on the page's tab.</param>
        /// <param name="control">Control hosted inside the page.</param>
        /// <param name="icon">Icon image shown on the page's tab.</param>
        public TabPageAdvanced(string title, Control control, Image icon)
        {
            InternalConstruct(title, control, null, -1, icon);
        }

        /// <summary>
        /// Shared initialization applying the supplied title, control, image list, image index and icon and setting the page's default state.
        /// </summary>
        /// <param name="title">Title text shown on the page's tab.</param>
        /// <param name="control">Control hosted inside the page.</param>
        /// <param name="imageList">Image list supplying the tab icon.</param>
        /// <param name="imageIndex">Index of the tab icon within <paramref name="imageList"/>.</param>
        /// <param name="icon">Icon image shown on the page's tab.</param>
        protected void InternalConstruct(string title,
                                         Control control,
                                         ImageList imageList,
                                         int imageIndex,
                                         Image icon)
        {
            // Assign parameters to internal fields
            _title = title;
            _control = control;
            _imageIndex = imageIndex;
            _imageList = imageList;
            _icon = icon;
            _canClose = true;
            _drawIconHightlight = false;

            // Appropriate defaults
            _selected = false;
            _startFocus = null;
#if DON6
            BackColor = Color.White;
#else
#endif
        }

        /// <summary>
        /// Gets or sets the title text shown on the page's tab.
        /// </summary>
        [DefaultValue("Page")]
        [Localizable(true)]
        public string Title
        {
            get { return _title; }

            set
            {
                if (_title != value)
                {
                    string oldValue = _title;
                    _title = value;

                    OnPropertyChanged(Property.Title, oldValue);
                }
            }
        }
        bool _canClose;
        /// <summary>
        /// Gets or sets whether the page can be closed by the user.
        /// </summary>
        [DefaultValue(true)]
        public bool CanClose
        {
            get { return _canClose; }

            set
            {
                if (_canClose != value)
                {
                    bool oldValue = _canClose;
                    _canClose = value;

                    OnPropertyChanged(Property.CanClose, oldValue);
                }
            }
        }
        StringAlignment _TitleAlignment = StringAlignment.Center;
        /// <summary>
        /// Gets or sets the alignment of the page's title text within its tab.
        /// </summary>
        [DefaultValue(StringAlignment.Center)]
        public StringAlignment TitleAlignment
        {
            get { return _TitleAlignment; }

            set
            {
                if (_TitleAlignment != value)
                {
                    StringAlignment oldValue = _TitleAlignment;
                    _TitleAlignment = value;

                    OnPropertyChanged(Property.TitleAlignment, oldValue);
                }
            }
        }
        int _TabWidth;
        /// <summary>
        /// Gets or sets a fixed width for the page's tab, or zero to size the tab automatically.
        /// </summary>
        [DefaultValue(0)]
        public int TabWidth
        {
            get { return _TabWidth; }

            set
            {
                if (_TabWidth != value)
                {
                    int oldValue = _TabWidth;
                    _TabWidth = value;

                    OnPropertyChanged(Property.TabWidth, oldValue);
                }
            }
        }



        bool _drawIconHightlight;
        /// <summary>
        /// Gets or sets whether the page's tab icon is drawn with a highlight.
        /// </summary>
        [DefaultValue(false)]
        public bool DrawIconHightlight
        {
            get { return _drawIconHightlight; }

            set
            {
                if (_drawIconHightlight != value)
                {
                    bool oldValue = _drawIconHightlight;
                    _drawIconHightlight = value;

                    OnPropertyChanged(Property.DrawIconHightlight, oldValue);
                }
            }
        }

        /// <summary>
        /// Gets or sets the control hosted inside the page.
        /// </summary>
        [DefaultValue(null)]
        public Control Control
        {
            get { return _control; }

            set
            {
                if (_control != value)
                {
                    Control oldValue = _control;
                    _control = value;

                    OnPropertyChanged(Property.Control, oldValue);
                }
            }
        }

        /// <summary>
        /// Gets or sets the index of the page's tab icon within its image list.
        /// </summary>
        [DefaultValue(-1)]
        public int ImageIndex
        {
            get { return _imageIndex; }

            set
            {
                if (_imageIndex != value)
                {
                    int oldValue = _imageIndex;
                    _imageIndex = value;

                    OnPropertyChanged(Property.ImageIndex, oldValue);
                }
            }
        }

        /// <summary>
        /// Gets or sets the image list supplying the page's tab icon.
        /// </summary>
        [DefaultValue(null)]
        public ImageList ImageList
        {
            get { return _imageList; }

            set
            {
                if (_imageList != value)
                {
                    ImageList oldValue = _imageList;
                    _imageList = value;

                    OnPropertyChanged(Property.ImageList, oldValue);
                }
            }
        }

        /// <summary>
        /// Gets or sets the page's tab icon image. While the page is processing or alerting the change is deferred until the animation ends.
        /// </summary>
        [DefaultValue(null)]
        public Image Icon
        {
            get { return _icon; }

            set
            {
                if (_icon != value)
                {
                    if ((Processing) || (Alerting))
                    {
                        oldIcon = value;
                    }
                    else
                    {
                        oldIcon = value;
                        Image oldValue = _icon;
                        _icon = value;

                        OnPropertyChanged(Property.Icon, oldValue);
                    }

                }
            }
        }

        /// <summary>
        /// Gets or sets whether the page is the selected page within its tab control.
        /// </summary>
        [DefaultValue(true)]
        public bool Selected
        {
            get { return _selected; }

            set
            {
                if (_selected != value)
                {
                    bool oldValue = _selected;
                    _selected = value;

                    OnPropertyChanged(Property.Selected, oldValue);
                }
            }
        }

        /// <summary>
        /// Gets or sets the control that receives focus when the page is first shown.
        /// </summary>
        [DefaultValue(null)]
        public Control StartFocus
        {
            get { return _startFocus; }
            set { _startFocus = value; }
        }

        /// <summary>
        /// Raises the <see cref="PropertyChanged"/> event for the given property, passing its previous value.
        /// </summary>
        /// <param name="prop">The property that changed.</param>
        /// <param name="oldValue">The property's value before the change.</param>
        public virtual void OnPropertyChanged(Property prop, object oldValue)
        {
            // Any attached event handlers?
            if (PropertyChanged != null)
                PropertyChanged(this, prop, oldValue);
        }
        [DesignerSerializationVisibility(DesignerSerializationVisibility.Hidden), Browsable(false)]
        internal bool Shown
        {
            get { return _shown; }
            set { _shown = value; }
        }

    }
}
