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
using Microsoft.Win32;
using System;
using System.Collections;
using System.Collections.Generic;
using System.ComponentModel;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace Reportman.Drawing.Forms
{
    /// <summary>
    /// Event arguments for a tab page action that can be vetoed, carrying the affected
    /// page and a <c>Cancel</c> flag a handler can set to prevent the operation.
    /// </summary>
    public class CancelArgs
    {
        /// <summary>
        /// When set to true by a handler, cancels the pending tab page operation.
        /// </summary>
        public bool Cancel = false;
        /// <summary>
        /// The tab page affected by the operation.
        /// </summary>
        public TabPageAdvanced Page;
        /// <summary>
        /// Initializes a new instance for the given tab page, with cancellation not requested.
        /// </summary>
        /// <param name="npage">The tab page the operation applies to.</param>
        public CancelArgs(TabPageAdvanced npage)
        {
            Page = npage;
        }
    }
    /// <summary>
    /// Callback for tab page events that may be cancelled, supplying <see cref="CancelArgs"/>
    /// whose <c>Cancel</c> flag the handler can set to stop the action.
    /// </summary>
    public delegate void CancelEvent(object sender, CancelArgs args);

    /// <summary>
    /// The overall visual rendering style used to paint the tab control (Visual Studio IDE
    /// look, a flat Plain look, or a Chrome-browser-like look).
    /// </summary>
    public enum VisualStyle
    {
        /// <summary>
        /// Visual Studio IDE-style tabs.
        /// </summary>
        IDE = 0,
        /// <summary>
        /// Flat, plain-style tabs with a simple border.
        /// </summary>
        Plain = 1,
        /// <summary>
        /// Chrome-browser-like rounded tabs.
        /// </summary>
        Chrome
    }
    /// <summary>
    /// Orientation of a drawing or layout operation, either vertical or horizontal.
    /// </summary>
    public enum Direction
    {
        /// <summary>
        /// Vertical orientation.
        /// </summary>
        Vertical = 0,
        /// <summary>
        /// Horizontal orientation.
        /// </summary>
        Horizontal = 1
    }

    /// <summary>
    /// Identifies a side of a rectangle (top, left, bottom, or right), or none.
    /// </summary>
    public enum Edge
    {
        /// <summary>
        /// The top edge.
        /// </summary>
        Top,
        /// <summary>
        /// The left edge.
        /// </summary>
        Left,
        /// <summary>
        /// The bottom edge.
        /// </summary>
        Bottom,
        /// <summary>
        /// The right edge.
        /// </summary>
        Right,
        /// <summary>
        /// No edge.
        /// </summary>
        None
    }
    /// <summary>
    /// An owner-drawn, multi-style tabbed container control that hosts a collection of
    /// <see cref="TabPageAdvanced"/> pages with configurable appearance, close/scroll/drop-down
    /// buttons, hot tracking, multiline tabs, and optional tab reordering.
    /// </summary>
    public partial class TabControlAdvanced : Panel
    {
        //      public TabControlAdvanced()
        //      {
        //         InitializeComponent();
        //      }
        /// <summary>
        /// Gets the embedded finish-flag image resource used to mark a completed page.
        /// </summary>
        public static Image FinishFlag
        {
            get
            {
                return Properties.Resources.flag_finish;
            }
        }
        /// <summary>
        /// Gets the embedded progress-wheel image resource used to indicate a page is working.
        /// </summary>
        public static Image ProgresWheel
        {
            get
            {
                return Properties.Resources.progress_wheel;
            }
        }
        // Enumeration of appearance styles
        /// <summary>
        /// High-level appearance preset for the tab control: a multi-document (MDI-like)
        /// look, a multi-form look, or a compact multi-box look.
        /// </summary>
        public enum VisualAppearance
        {
            /// <summary>
            /// Multi-document (MDI-like) appearance.
            /// </summary>
            MultiDocument = 0,
            /// <summary>
            /// Multi-form appearance.
            /// </summary>
            MultiForm = 1,
            /// <summary>
            /// Compact multi-box appearance.
            /// </summary>
            MultiBox = 2
        }
        /// <summary>
        /// Background color used to highlight a tab page that is alerting for attention.
        /// </summary>
        public Color AlertingColor = Color.FromArgb(200, 150, 150);
        /// <summary>
        /// Walks up the parent chain of the given page and returns the owning
        /// <see cref="TabControlAdvanced"/>, or null if the page is not hosted in one.
        /// </summary>
        /// <param name="npage">The tab page whose owning control is sought.</param>
        /// <returns>The owning tab control, or null if none is found.</returns>
        public static TabControlAdvanced GetTabControlAdvanced(TabPageAdvanced npage)
        {
            Control ncontrol = npage.Parent;
            while (ncontrol != null)
            {
                if (ncontrol is TabControlAdvanced)
                {
                    break;
                }
                else
                {
                    ncontrol = ncontrol.Parent;
                }
            }
            if (ncontrol == null)
                return null;
            else
                return (TabControlAdvanced)ncontrol;
        }
        // Enumeration of modes that control display of the tabs area
        /// <summary>
        /// Controls when the tabs area is shown or hidden: always shown, always hidden,
        /// hidden based on logic (e.g. a single page), or hidden when the mouse is away.
        /// </summary>
        public enum HideTabsModes
        {
            /// <summary>
            /// The tabs area is always shown.
            /// </summary>
            ShowAlways,
            /// <summary>
            /// The tabs area is always hidden.
            /// </summary>
            HideAlways,
            /// <summary>
            /// The tabs area is hidden based on logic, such as when only one page exists.
            /// </summary>
            HideUsingLogic,
            /// <summary>
            /// The tabs area is hidden while the mouse is not over the control.
            /// </summary>
            HideWithoutMouse
        }

        // Indexes into the menu images strip
        /// <summary>
        /// Indexes into the internal image strip used for the tab control's buttons.
        /// </summary>
        protected enum ImageStrip
        {
            /// <summary>
            /// Enabled left scroll arrow image.
            /// </summary>
            LeftEnabled = 0,
            /// <summary>
            /// Disabled left scroll arrow image.
            /// </summary>
            LeftDisabled = 1,
            /// <summary>
            /// Enabled right scroll arrow image.
            /// </summary>
            RightEnabled = 2,
            /// <summary>
            /// Disabled right scroll arrow image.
            /// </summary>
            RightDisabled = 3,
            /// <summary>
            /// Close button image.
            /// </summary>
            Close = 4,
            /// <summary>
            /// Error image shown when a page image cannot be resolved.
            /// </summary>
            Error = 5,
            /// <summary>
            /// Drop-down button image.
            /// </summary>
            DropDown = 6
        }

        // Enumeration of Indexes into positioning constants array
        /// <summary>
        /// Indexes into the per-style array of sizing and positioning constants.
        /// </summary>
        protected enum PositionIndex
        {
            /// <summary>
            /// Size of the border above the tabs.
            /// </summary>
            BorderTop = 0,
            /// <summary>
            /// Size of the border to the left of a tab.
            /// </summary>
            BorderLeft = 1,
            /// <summary>
            /// Size of the border below a tab.
            /// </summary>
            BorderBottom = 2,
            /// <summary>
            /// Size of the border to the right of a tab.
            /// </summary>
            BorderRight = 3,
            /// <summary>
            /// Gap above the tab image.
            /// </summary>
            ImageGapTop = 4,
            /// <summary>
            /// Gap to the left of the tab image.
            /// </summary>
            ImageGapLeft = 5,
            /// <summary>
            /// Gap below the tab image.
            /// </summary>
            ImageGapBottom = 6,
            /// <summary>
            /// Gap to the right of the tab image.
            /// </summary>
            ImageGapRight = 7,
            /// <summary>
            /// Vertical offset applied to the tab text.
            /// </summary>
            TextOffset = 8,
            /// <summary>
            /// Gap to the left of the tab text.
            /// </summary>
            TextGapLeft = 9,
            /// <summary>
            /// Gap below the tabs area.
            /// </summary>
            TabsBottomGap = 10,
            /// <summary>
            /// Vertical offset applied to the tabs area buttons.
            /// </summary>
            ButtonOffset = 11,
        }

        // Helper class for handling multiline calculations
        /// <summary>
        /// Associates a tab's display rectangle with its page index while laying out
        /// multiline tabs.
        /// </summary>
        protected class MultiRect
        {
            /// <summary>
            /// The display rectangle of the tab.
            /// </summary>
            protected Rectangle _rect;
            /// <summary>
            /// The index of the associated tab page.
            /// </summary>
            protected int _index;

            /// <summary>
            /// Initializes a new instance with the given rectangle and page index.
            /// </summary>
            /// <param name="rect">The tab display rectangle.</param>
            /// <param name="index">The index of the associated tab page.</param>
            public MultiRect(Rectangle rect, int index)
            {
                _rect = rect;
                _index = index;
            }

            /// <summary>
            /// Gets the index of the associated tab page.
            /// </summary>
            public int Index
            {
                get { return _index; }
            }

            /// <summary>
            /// Gets or sets the display rectangle of the tab.
            /// </summary>
            public Rectangle Rect
            {
                get { return _rect; }
                set { _rect = value; }
            }

            /// <summary>
            /// Gets or sets the left position of the tab rectangle.
            /// </summary>
            public int X
            {
                get { return _rect.X; }
                set { _rect.X = value; }
            }

            /// <summary>
            /// Gets or sets the top position of the tab rectangle.
            /// </summary>
            public int Y
            {
                get { return _rect.Y; }
                set { _rect.Y = value; }
            }

            /// <summary>
            /// Gets or sets the width of the tab rectangle.
            /// </summary>
            public int Width
            {
                get { return _rect.Width; }
                set { _rect.Width = value; }
            }

            /// <summary>
            /// Gets or sets the height of the tab rectangle.
            /// </summary>
            public int Height
            {
                get { return _rect.Height; }
                set { _rect.Height = value; }
            }
        }
        /// <summary>
        /// Double-buffered panel that hosts the control or form of the currently selected
        /// tab page and keeps its children sized to match.
        /// </summary>
        protected class HostPanel : Panel
        {
            /// <summary>
            /// Initializes a new instance with double buffering enabled to prevent flicker.
            /// </summary>
            public HostPanel()
            {
                // Prevent flicker with double buffering and all painting inside WM_PAINT
                SetStyle(ControlStyles.DoubleBuffer, true);
                SetStyle(ControlStyles.AllPaintingInWmPaint, true);
                SetStyle(ControlStyles.UserPaint, true);
            }

            /// <summary>
            /// Resizes each hosted child control to match the panel size.
            /// </summary>
            /// <param name="e">The event data.</param>
            protected override void OnResize(EventArgs e)
            {
                // Update size of each child to match ourself
                foreach (Control c in this.Controls)
                    c.Size = this.Size;

                base.OnResize(e);
            }
        }


        // Class constants for sizing/positioning each style
        /// <summary>
        /// Per-style table of sizing and positioning constants, indexed by style and by
        /// <see cref="PositionIndex"/>.
        /// </summary>
        protected static int[,] _position = {
                                                {3, 1, 1, 1, 1, 2, 1, 1, 2, 1, 3, 2},	// IDE
                                                {6, 2, 2, 3, 3, 1, 1, 0, 1, 1, 2, 0},   // Plain

                                                //                                                {3, 1, 1, 1, 1, 2, 1, 1, 2, 1, 3, 2}	// Chrome
#if DON6
                                                {3, 1, 1, 1, 1, 6, 1, -4, 2, 1, 1, 0}   // Chrome
#else
                                                {3, 1, 1, 1, 1, 1, 1, 0, 2, 1, 1, 0}   // Chrome
#endif
        };

        // Class constants
        /// <summary>
        /// Width in pixels of the plain-style border.
        /// </summary>
        protected static int _plainBorder = 3;
        /// <summary>
        /// Width in pixels of a doubled plain-style border.
        /// </summary>
        protected static int _plainBorderDouble = 6;
        /// <summary>
        /// Inset in pixels from the start (left) of the tabs area before the first tab.
        /// </summary>
        protected static int _tabsAreaStartInset = 5;
        /// <summary>
        /// Inset in pixels from the end (right) of the tabs area after the last tab.
        /// </summary>
        protected static int _tabsAreaEndInset = 5;
        /// <summary>
        /// Alpha factor used when blending colors in the IDE appearance.
        /// </summary>
        protected static float _alphaIDE = 1.5F;
        /// <summary>
        /// Gap in pixels between the tabs area buttons.
        /// </summary>
        protected static int _buttonGap = 3;
        /// <summary>
        /// Current (DPI-scaled) width in pixels of a tabs area button.
        /// </summary>
        protected static int _buttonWidth = 14;
        /// <summary>
        /// Current (DPI-scaled) height in pixels of a tabs area button.
        /// </summary>
        protected static int _buttonHeight = 14;
        /// <summary>
        /// Unscaled width in pixels of a tabs area button.
        /// </summary>
        protected static int _unScaledButtonWidth = 14;
        /// <summary>
        /// Original (DPI-scaled) width in pixels of a tabs area button.
        /// </summary>
        protected static int _originalButtonWidth = 14;
        /// <summary>
        /// Original (DPI-scaled) height in pixels of a tabs area button.
        /// </summary>
        protected static int _originalButtonHeight = 14;
        /// <summary>
        /// DPI-scaled width in pixels of a button image.
        /// </summary>
        protected static int _imageButtonWidth = 12;
        /// <summary>
        /// DPI-scaled height in pixels of a button image.
        /// </summary>
        protected static int _imageButtonHeight = 12;
        /// <summary>
        /// Vertical adjustment in pixels applied to tabs in the multi-box appearance.
        /// </summary>
        protected static int _multiBoxAdjust = 2;
        /// <summary>
        /// Off-screen rectangle used to represent a tab that is not currently displayed.
        /// </summary>
        protected readonly Rectangle _nullPosition = new Rectangle(-999, -999, 0, 0);

        static TabControlAdvanced()
        {
            _buttonWidth = Convert.ToInt32(_buttonWidth * Reportman.Drawing.Windows.GraphicUtils.DPIScale);
            _buttonHeight = Convert.ToInt32(_buttonHeight * Reportman.Drawing.Windows.GraphicUtils.DPIScale);
            _buttonGap = Convert.ToInt32(_buttonGap * Reportman.Drawing.Windows.GraphicUtils.DPIScale);

            _originalButtonHeight = Convert.ToInt32(_originalButtonHeight * Reportman.Drawing.Windows.GraphicUtils.DPIScale);
            _originalButtonWidth = Convert.ToInt32(_originalButtonWidth * Reportman.Drawing.Windows.GraphicUtils.DPIScale);
            _imageButtonHeight = Convert.ToInt32(_imageButtonHeight * Reportman.Drawing.Windows.GraphicUtils.DPIScale);
            _imageButtonWidth = Convert.ToInt32(_imageButtonWidth * Reportman.Drawing.Windows.GraphicUtils.DPIScale);

            _MouseOffsetTriggerReorder = Convert.ToInt32(5 * Reportman.Drawing.Windows.GraphicUtils.DPIScale);
            //_imageButtonWidth = Convert.ToInt32(_imageButtonWidth * Reportman.Drawing.Windows.GraphicUtils.DPIScale);
            //_imageButtonHeight = Convert.ToInt32(_imageButtonHeight * Reportman.Drawing.Windows.GraphicUtils.DPIScale);

            // Create a strip of images by loading an embedded bitmap resource
            _internalImages = new ImageList();
            _internalImages.ImageSize = new Size(_imageButtonWidth, _imageButtonHeight);
            _internalImages.ImageSize = new Size(_imageButtonWidth, _imageButtonHeight);
            _internalImages.Images.Add(Properties.Resources.left_1);
            _internalImages.Images.Add(Properties.Resources.left_2_empty);
            _internalImages.Images.Add(Properties.Resources.right_3);
            _internalImages.Images.Add(Properties.Resources.right_4_empty);
            _internalImages.Images.Add(Properties.Resources.close_5);
            _internalImages.Images.Add(Properties.Resources.close_6);
            _internalImages.Images.Add(Properties.Resources.dropdown_7);

        }

        // Class state
        /// <summary>
        /// Shared image list holding the built-in button images (arrows, close, drop-down).
        /// </summary>
        protected static ImageList _internalImages;

        // Instance fields - size/positioning
        /// <summary>
        /// Height in pixels of the tab text for the current font.
        /// </summary>
        protected int _textHeight;
        int _imageWidth;
        int _imageHeight;
        /// <summary>
        /// Gets or sets the width in pixels used to draw tab images.
        /// </summary>
        [DesignerSerializationVisibility(DesignerSerializationVisibility.Visible)]
        public int ImageWidth
        {
            get
            {
                return _imageWidth;
            }
            set
            {
                _imageWidth = value;
                Invalidate();
            }
        }
        bool _autoShrinkPages;
        /// <summary>
        /// Gets or sets whether tab pages are shrunk so they all fit within the control width.
        /// </summary>
        [DesignerSerializationVisibility(DesignerSerializationVisibility.Visible)]
        public bool AutoShrinkPages
        {
            get
            {
                return _autoShrinkPages;
            }
            set
            {
                _autoShrinkPages = value;
                Recalculate();
            }
        }
        /// <summary>
        /// Gets the creation parameters used when the control window is created.
        /// </summary>
        protected override CreateParams CreateParams
        {
            get
            {
                CreateParams cp = base.CreateParams;
                //cp.ExStyle |= 0x02000000;  // Turn on WS_EX_COMPOSITED


                //cp.Style = cp.Style | 0x04000000 | 0x02000000; // WS_CLIPSIBLINGS WS_CLIPCHILDREN
                return cp;
            }
        }
        /// <summary>
        /// Gets or sets whether clicking an empty part of the tabs area starts moving the
        /// hosting form.
        /// </summary>
#if DON6
        public bool EmptyMoveForm = true;
#else
        public bool EmptyMoveForm = false;
#endif

        bool _autoHidePaging;
        /// <summary>
        /// Gets or sets whether the scrolling arrows are hidden automatically when paging
        /// is not required.
        /// </summary>
        [DesignerSerializationVisibility(DesignerSerializationVisibility.Visible)]
        public bool AutoHidePaging
        {
            get
            {
                return _autoHidePaging;
            }
            set
            {
                _autoHidePaging = value;
                Recalculate();
            }
        }
        int _autoShrinkMinimum;
        /// <summary>
        /// Gets or sets the minimum tab width in pixels below which pages are not shrunk
        /// any further.
        /// </summary>
        [DesignerSerializationVisibility(DesignerSerializationVisibility.Visible)]
        public int AutoShrinkMinimum
        {
            get
            {
                return _autoShrinkMinimum;
            }
            set
            {
                _autoShrinkMinimum = value;
                Recalculate();
            }
        }
        /// <summary>
        /// Additional margin in pixels added around the tab image.
        /// </summary>
        public int ImageMargin = 0;
        /// <summary>
        /// Gets or sets the height in pixels used to draw tab images.
        /// </summary>
        [DesignerSerializationVisibility(DesignerSerializationVisibility.Visible)]
        public int ImageHeight
        {
            get
            {
                return _imageHeight;
            }
            set
            {
                _imageHeight = value;
                Invalidate();
            }
        }

        /// <summary>
        /// Extra spacing in pixels added above the image so it aligns with taller text.
        /// </summary>
        protected int _imageGapTopExtra;
        /// <summary>
        /// Extra spacing in pixels added below the image so it aligns with taller text.
        /// </summary>
        protected int _imageGapBottomExtra;
        /// <summary>
        /// Rectangle occupied by the hosted page control.
        /// </summary>
        protected Rectangle _pageRect;
        /// <summary>
        /// Rectangle covering the whole area available to pages.
        /// </summary>
        protected Rectangle _pageAreaRect;
        /// <summary>
        /// Rectangle covering the whole tabs area.
        /// </summary>
        protected Rectangle _tabsAreaRect;

        // Instance fields - state
        /// <summary>
        /// How far from the top edge embedded controls should be offset.
        /// </summary>
        protected int _ctrlTopOffset;
        /// <summary>
        /// How far from the left edge embedded controls should be offset.
        /// </summary>
        protected int _ctrlLeftOffset;
        /// <summary>
        /// How far from the right edge embedded controls should be offset.
        /// </summary>
        protected int _ctrlRightOffset;
        /// <summary>
        /// How far from the bottom edge embedded controls should be offset.
        /// </summary>
        protected int _ctrlBottomOffset;
        /// <summary>
        /// Index into the position constants array for the current style.
        /// </summary>
        protected int _styleIndex;
        /// <summary>
        /// Index of the currently selected page (-1 when none).
        /// </summary>
        protected int _pageSelected;
        /// <summary>
        /// Index of the first page to draw, used when scrolling pages.
        /// </summary>
        protected int _startPage;
        /// <summary>
        /// Index of the page currently displayed as being hot tracked.
        /// </summary>
        protected int _hotTrackPage;
        /// <summary>
        /// Whether the close indicator is highlighted on the hot-tracked page.
        /// </summary>
        protected bool _hotTrackPageHightlightClose;
        /// <summary>
        /// Y position of the first line in multiline mode.
        /// </summary>
        protected int _topYPos;
        /// <summary>
        /// Y position of the last line in multiline mode.
        /// </summary>
        protected int _bottomYPos;
        /// <summary>
        /// Delay in milliseconds from the mouse leaving until the timeout occurs.
        /// </summary>
        protected int _leaveTimeout;
        /// <summary>
        /// Whether the mouse must leave the whole control before drag events are generated.
        /// </summary>
        protected bool _dragFromControl;
        /// <summary>
        /// Whether the mouse is currently over the control or its child pages.
        /// </summary>
        protected bool _mouseOver;
        /// <summary>
        /// Whether tabs that cannot fit on one line create new lines.
        /// </summary>
        protected bool _multiline;
        /// <summary>
        /// Whether, in multiline mode, all lines are extended to the end.
        /// </summary>
        protected bool _multilineFullWidth;
        /// <summary>
        /// Whether pages are shrunk so they all fit within the control width.
        /// </summary>
        protected bool _shrinkPagesToFit;
        /// <summary>
        /// Flag used while updating the contents of the page collection.
        /// </summary>
        protected bool _changed;
        /// <summary>
        /// Whether the tabs are displayed at the top or bottom of the control.
        /// </summary>
        protected bool _positionAtTop;
        /// <summary>
        /// Whether the close button is displayed.
        /// </summary>
        protected bool _showClose;
        /// <summary>
        /// Whether the drop-down tabs button is displayed.
        /// </summary>
        protected bool _showDropDown;
        /// <summary>
        /// Whether an individual close button is displayed on each page.
        /// </summary>
        protected bool _showCloseIndividual;
        /// <summary>
        /// Whether the scroll arrow buttons are displayed.
        /// </summary>
        protected bool _showArrows;
        /// <summary>
        /// Whether the inset border is shown for controls.
        /// </summary>
        protected bool _insetPlain;
        /// <summary>
        /// Whether the border is drawn only around pages in Plain mode.
        /// </summary>
        protected bool _insetBorderPagesOnly;
        /// <summary>
        /// Whether text is drawn only for the selected tab.
        /// </summary>
        protected bool _selectedTextOnly;
        /// <summary>
        /// Whether the right scroll button should be enabled.
        /// </summary>
        protected bool _rightScroll;
        /// <summary>
        /// Whether the left scroll button should be enabled.
        /// </summary>
        protected bool _leftScroll;
        /// <summary>
        /// Whether unselected pages are drawn slightly dimmed.
        /// </summary>
        protected bool _dimUnselected;
        /// <summary>
        /// Whether the selected page uses a bold font.
        /// </summary>
        protected bool _boldSelected;
        /// <summary>
        /// Whether moving the mouse over tab text hot tracks it.
        /// </summary>
        protected bool _hotTrack;
        /// <summary>
        /// Whether a page is selected when the mouse hovers over it.
        /// </summary>
        protected bool _hoverSelect;
        /// <summary>
        /// Flag indicating a recalculation is needed before painting.
        /// </summary>
        protected bool _recalculate;
        /// <summary>
        /// Whether the left mouse button is currently down.
        /// </summary>
        protected bool _leftMouseDown;
        /// <summary>
        /// Whether a drag operation has begun.
        /// </summary>
        protected bool _leftMouseDownDrag;
        /// <summary>
        /// Prevents a single left button press from generating two drags.
        /// </summary>
        protected bool _ignoreDownDrag;
        /// <summary>
        /// Whether the background color is the default one.
        /// </summary>
        protected bool _defaultColor;
        /// <summary>
        /// Whether the font is the default one.
        /// </summary>
        protected bool _defaultFont;
        /// <summary>
        /// Whether to record the control with focus when leaving a page.
        /// </summary>
        protected bool _recordFocus;
        /// <summary>
        /// Whether to place a one pixel border at the top and bottom of the tabs area.
        /// </summary>
        protected bool _idePixelArea;
        /// <summary>
        /// Whether to place a one pixel border around the whole control.
        /// </summary>
        protected bool _idePixelBorder;
        /// <summary>
        /// Context menu shown on a right mouse up over the tabs area.
        /// </summary>
        protected ContextMenuStrip _contextMenu;
        /// <summary>
        /// Initial mouse down position for the left mouse button.
        /// </summary>
        protected Point _leftMouseDownPos;
        /// <summary>
        /// Color used when drawing text as hot.
        /// </summary>
        protected Color _hotTextColor;
        /// <summary>
        /// Color used when drawing text that is not hot.
        /// </summary>
        protected Color _textColor;
        /// <summary>
        /// Color used when drawing text that is neither hot nor on the active tab.
        /// </summary>
        protected Color _textInactiveColor;
        /// <summary>
        /// Background drawing color used in the IDE appearance.
        /// </summary>
        protected Color _backIDE;
        /// <summary>
        /// Color used to draw button images when active.
        /// </summary>
        protected Color _buttonActiveColor;
        /// <summary>
        /// Color used to draw button images when inactive.
        /// </summary>
        protected Color _buttonInactiveColor;
        /// <summary>
        /// Light variation of the back color.
        /// </summary>
        protected Color _backLight;
        /// <summary>
        /// Light-light variation of the back color.
        /// </summary>
        protected Color _backLightLight;
        /// <summary>
        /// Dark variation of the back color.
        /// </summary>
        protected Color _backDark;
        /// <summary>
        /// Dark-dark variation of the back color.
        /// </summary>
        protected Color _backDarkDark;
        /// <summary>
        /// The visual style used to paint the tabs.
        /// </summary>
        protected VisualStyle _style;
        /// <summary>
        /// Mode that decides when to hide or show the tabs area.
        /// </summary>
        protected HideTabsModes _hideTabsMode;
        /// <summary>
        /// Timer measuring how long the mouse has left the control.
        /// </summary>
        protected System.Windows.Forms.Timer _overTimer;
        /// <summary>
        /// Panel that hosts the current page's control or form.
        /// </summary>
        protected HostPanel _hostPanel;
        /// <summary>
        /// The current appearance style.
        /// </summary>
        protected VisualAppearance _appearance;
        /// <summary>
        /// Collection of images used in the tabs.
        /// </summary>
        protected ImageList _imageList;
        /// <summary>
        /// Display rectangles for each associated page.
        /// </summary>
        protected ArrayList _tabRects;
        /// <summary>
        /// Collection of tab pages.
        /// </summary>
        protected TabPageCollection _tabPages;

        // Instance fields - buttons
        /// <summary>
        /// The close button shown in the tabs area.
        /// </summary>
        protected InertButton _closeButton;
        /// <summary>
        /// The drop-down button shown in the tabs area.
        /// </summary>
        protected InertButton _dropDownButton;
        /// <summary>
        /// The left scroll arrow button shown in the tabs area.
        /// </summary>
        protected InertButton _leftArrow;
        /// <summary>
        /// The right scroll arrow button shown in the tabs area.
        /// </summary>
        protected InertButton _rightArrow;

        /// <summary>
        /// Callback raised when a tab is double-clicked, supplying the originating control
        /// and the tab page that was double-clicked.
        /// </summary>
        public delegate void DoubleClickTabHandler(TabControlAdvanced sender, TabPageAdvanced page);

        // Exposed events
        /// <summary>
        /// Raised when the close button is pressed; handlers may cancel the close.
        /// </summary>
        public event CancelEvent ClosePressed;
        /// <summary>
        /// Raised before the selected page changes; handlers may cancel the change.
        /// </summary>
        public event CancelEvent SelectionChanging;
        /// <summary>
        /// Raised after the selected page has changed.
        /// </summary>
        public event EventHandler SelectionChanged;
        /// <summary>
        /// Raised when a hosted page gains focus.
        /// </summary>
        public event EventHandler PageGotFocus;
        /// <summary>
        /// Raised when a hosted page loses focus.
        /// </summary>
        public event EventHandler PageLostFocus;
        /// <summary>
        /// Raised before the context popup menu is displayed; handlers may cancel it.
        /// </summary>
        public event CancelEventHandler PopupMenuDisplay;
        /// <summary>
        /// Raised when a tab page drag operation starts.
        /// </summary>
        public event MouseEventHandler PageDragStart;
        /// <summary>
        /// Raised as a tab page drag operation moves.
        /// </summary>
        public event MouseEventHandler PageDragMove;
        /// <summary>
        /// Raised when a tab page drag operation ends.
        /// </summary>
        public event MouseEventHandler PageDragEnd;
        /// <summary>
        /// Raised when a tab page drag operation is quit without completing.
        /// </summary>
        public event MouseEventHandler PageDragQuit;
        /// <summary>
        /// Raised when a tab is double-clicked.
        /// </summary>
        public event DoubleClickTabHandler DoubleClickTab;


        /// <summary>
        /// Initializes a new instance of the <see cref="TabControlAdvanced"/> control with
        /// its default appearance, colors, buttons, and event hookups.
        /// </summary>
        public TabControlAdvanced()
        {

            InitializeComponent();

            // Prevent flicker with double buffering and all painting inside WM_PAINT
            SetStyle(ControlStyles.DoubleBuffer, true);
            SetStyle(ControlStyles.AllPaintingInWmPaint, true);
            SetStyle(ControlStyles.UserPaint, true);

            // Create collections
            _tabRects = new ArrayList();
            _tabPages = new TabPageCollection();

            // Hookup to collection events
            _tabPages.Clearing += new CollectionClear(OnClearingPages);
            _tabPages.Cleared += new CollectionClear(OnClearedPages);
            _tabPages.Inserting += new CollectionChange(OnInsertingPage);
            _tabPages.Inserted += new CollectionChange(OnInsertedPage);
            _tabPages.Removing += new CollectionChange(OnRemovingPage);
            _tabPages.Removed += new CollectionChange(OnRemovedPage);

            // Define the default state of the control
            _startPage = -1;
            _pageSelected = -1;
            _hotTrackPage = -1;
            _imageList = null;
            _insetPlain = true;
            _multiline = false;
            _multilineFullWidth = false;
            _dragFromControl = true;
            _mouseOver = false;
            _leftScroll = false;
            _defaultFont = true;
            _defaultColor = true;
            _rightScroll = false;
            _hoverSelect = false;
            _leftMouseDown = false;
            _ignoreDownDrag = true;
            _selectedTextOnly = false;
            _leftMouseDownDrag = false;
            _insetBorderPagesOnly = false;
            _hideTabsMode = HideTabsModes.ShowAlways;
            _recordFocus = true;
            _styleIndex = 1;
            _leaveTimeout = 200;
            _ctrlTopOffset = 0;
            _ctrlLeftOffset = 0;
            _ctrlRightOffset = 0;
            _ctrlBottomOffset = 0;
            _style = VisualStyle.IDE;
            _buttonActiveColor = Color.FromArgb(128, this.ForeColor);
            _buttonInactiveColor = _buttonActiveColor;
            _textColor = TabControlAdvanced.DefaultForeColor;
            //_textInactiveColor = Color.FromArgb(128, _textColor);
            _textInactiveColor = SystemColors.InactiveCaptionText;
            _hotTextColor = SystemColors.Highlight;

            // Create the panel that hosts each page control. This is done to prevent the problem where a 
            // hosted Control/Form has 'AutoScaleBaseSize' defined. In which case our attempt to size it the
            // first time is ignored and the control sizes itself to big and would overlap the tabs area.
            _hostPanel = new HostPanel();
            _hostPanel.Location = new Point(-1, -1);
            _hostPanel.Size = new Size(0, 0);
            _hostPanel.MouseEnter += new EventHandler(OnPageMouseEnter);
            _hostPanel.MouseLeave += new EventHandler(OnPageMouseLeave);

            // Create hover buttons
            _closeButton = new InertButton(_internalImages, (int)ImageStrip.Close);
            _dropDownButton = new InertButton(_internalImages, (int)ImageStrip.DropDown);
            _leftArrow = new InertButton(_internalImages, (int)ImageStrip.LeftEnabled, (int)ImageStrip.LeftDisabled);
            _rightArrow = new InertButton(_internalImages, (int)ImageStrip.RightEnabled, (int)ImageStrip.RightDisabled);

            // We want our buttons to have very thin borders
            _closeButton.BorderWidth = _leftArrow.BorderWidth = _rightArrow.BorderWidth = 1;
            _dropDownButton.BorderWidth = 1;

            // Hookup to the button events
            _closeButton.Click += new EventHandler(OnCloseButton);
            _dropDownButton.Click += new EventHandler(OnDropDownButton);
            _leftArrow.Click += new EventHandler(OnLeftArrow);
            _rightArrow.Click += new EventHandler(OnRightArrow);


            int arrowsize;
            // Set their fixed sizes
            //_originalButtonWidth = Convert.ToInt32(_originalButtonWidth *1.25);
            //_originalButtonHeight = Convert.ToInt32(_originalButtonHeight *1.25);
            bool dpiAware = WinFormsGraphics.IsWindowsFormsDPIAware();

            if (dpiAware)
                arrowsize = Convert.ToInt32(_unScaledButtonWidth);
            else
                arrowsize = Convert.ToInt32(_originalButtonWidth);
            _leftArrow.Size = _rightArrow.Size = _closeButton.Size = _dropDownButton.Size = new Size(arrowsize, arrowsize);

            // Add child controls
            Controls.AddRange(new Control[] { _closeButton, _leftArrow, _rightArrow, _hostPanel, _dropDownButton });



            // Grab some contant values
            _imageWidth = Convert.ToInt32(16 * Reportman.Drawing.Windows.GraphicUtils.DPIScale);
            _imageHeight = Convert.ToInt32(16 * Reportman.Drawing.Windows.GraphicUtils.DPIScale);

            // Default to having a MultiForm usage
            SetAppearance(VisualAppearance.MultiForm);

            // Need a timer so that when the mouse leaves, a fractionaly delay occurs before
            // noticing and hiding the tabs area when the appropriate style is set
            _overTimer = new System.Windows.Forms.Timer();
            _overTimer.Interval = _leaveTimeout;
            _overTimer.Tick += new EventHandler(OnMouseTick);

            // Need notification when the MenuFont is changed
            Microsoft.Win32.SystemEvents.UserPreferenceChanged +=
                new UserPreferenceChangedEventHandler(OnPreferenceChanged);

            // Define the default Font, BackColor and Button images
            DefineFont(SystemInformation.MenuFont);
            DefineBackColor(SystemColors.Control);
            DefineButtonImages();

            Recalculate();
        }


        /// <summary>
        /// Gets the collection of tab pages hosted by the control.
        /// </summary>
        [Category("Appearance")]
        [DesignerSerializationVisibility(DesignerSerializationVisibility.Content)]
        public virtual TabPageCollection TabPages
        {
            get { return _tabPages; }
        }

        /// <summary>
        /// Gets or sets the font used to draw the tab text.
        /// </summary>
        [Category("Appearance")]
        public override Font Font
        {
            get { return base.Font; }

            set
            {
                if (value != null)
                {
                    if (value != base.Font)
                    {
                        _defaultFont = (value == SystemInformation.MenuFont);

                        DefineFont(value);

                        _recalculate = true;
                        Invalidate();
                    }
                }
            }
        }

        private bool ShouldSerializeFont()
        {
            return !_defaultFont;
        }

        /// <summary>
        /// Gets or sets the foreground color used to draw the tab text.
        /// </summary>
        [Category("Appearance")]
        public override Color ForeColor
        {
            get { return _textColor; }

            set
            {
                if (_textColor != value)
                {
                    _textColor = value;

                    _recalculate = true;
                    Invalidate();
                }
            }
        }

        private bool ShouldSerializeForeColor()
        {
            return _textColor != TabControlAdvanced.DefaultForeColor;
        }

        /// <summary>
        /// Gets or sets the background color of the control, from which the tab shading
        /// colors are derived.
        /// </summary>
        [Category("Appearance")]
        public override Color BackColor
        {
            get { return base.BackColor; }

            set
            {
                if (this.BackColor != value)
                {
                    _defaultColor = (value == SystemColors.Control);

                    DefineBackColor(value);

                    _recalculate = true;
                    Invalidate();
                }
            }
        }

        private bool ShouldSerializeBackColor()
        {
            return this.BackColor != SystemColors.Control;
        }

        /// <summary>
        /// Gets or sets the color used to draw the tabs area button images when active.
        /// </summary>
        [Category("Appearance")]
        public virtual Color ButtonActiveColor
        {
            get { return _buttonActiveColor; }

            set
            {
                if (_buttonActiveColor != value)
                {
                    _buttonActiveColor = value;
                    DefineButtonImages();
                }
            }
        }

        private bool ShouldSerializeButtonActiveColor()
        {
            return _buttonActiveColor != Color.FromArgb(128, this.ForeColor);
        }

        /// <summary>
        /// Resets <see cref="ButtonActiveColor"/> to its default value.
        /// </summary>
        public void ResetButtonActiveColor()
        {
            ButtonActiveColor = Color.FromArgb(128, this.ForeColor);
        }

        /// <summary>
        /// Gets or sets the color used to draw the tabs area button images when inactive.
        /// </summary>
        [Category("Appearance")]
        public virtual Color ButtonInactiveColor
        {
            get { return _buttonInactiveColor; }

            set
            {
                if (_buttonInactiveColor != value)
                {
                    _buttonInactiveColor = value;
                    DefineButtonImages();
                }
            }
        }

        private bool ShouldSerializeButtonInactiveColor()
        {
            return _buttonInactiveColor != Color.FromArgb(128, this.ForeColor);
        }

        /// <summary>
        /// Resets <see cref="ButtonInactiveColor"/> to its default value.
        /// </summary>
        public void ResetButtonInactiveColor()
        {
            ButtonInactiveColor = Color.FromArgb(128, this.ForeColor);
        }

        /// <summary>
        /// Gets or sets the high-level appearance preset of the tab control.
        /// </summary>
        [Category("Appearance")]
        [DefaultValue(typeof(VisualAppearance), "MultiForm")]
        public virtual VisualAppearance Appearance
        {
            get { return _appearance; }

            set
            {
                if (_appearance != value)
                {
                    SetAppearance(value);

                    Recalculate();
                    Invalidate();
                }
            }
        }

        /// <summary>
        /// Resets <see cref="Appearance"/> to its default value.
        /// </summary>
        public void ResetAppearance()
        {
            Appearance = VisualAppearance.MultiForm;
        }

        /// <summary>
        /// Gets or sets the visual rendering style used to paint the tabs.
        /// </summary>
        [Category("Appearance")]
        [DefaultValue(typeof(VisualStyle), "IDE")]
        public virtual VisualStyle Style
        {
            get { return _style; }

            set
            {
                if (_style != value)
                {
                    _style = value;

                    // Define the correct style indexer
                    SetStyleIndex();

                    Recalculate();
                    Invalidate();
                }
            }
        }

        /// <summary>
        /// Resets <see cref="Style"/> to its default value.
        /// </summary>
        public void ResetStyle()
        {
            Style = VisualStyle.IDE;
        }

        /// <summary>
        /// Gets or sets the context menu shown when the tabs area is right-clicked.
        /// </summary>
        [Category("Behavour")]
        public virtual ContextMenuStrip ContextPopupMenu
        {
            get { return _contextMenu; }
            set { _contextMenu = value; }
        }

        /// <summary>
        /// Determines whether <see cref="ContextPopupMenu"/> should be serialized by the designer.
        /// </summary>
        /// <returns>True if a context menu is assigned.</returns>
        protected bool ShouldSerializeContextPopupMenu()
        {
            return _contextMenu != null;
        }

        /// <summary>
        /// Resets <see cref="ContextPopupMenu"/> to its default value of none.
        /// </summary>
        public void ResetContextPopupMenu()
        {
            ContextPopupMenu = null;
        }

        /// <summary>
        /// Gets or sets whether moving the mouse over a tab hot tracks it.
        /// </summary>
        [Category("Appearance")]
        [DefaultValue(false)]
        public virtual bool HotTrack
        {
            get { return _hotTrack; }

            set
            {
                if (_hotTrack != value)
                {
                    _hotTrack = value;

                    if (!_hotTrack)
                    {
                        _hotTrackPage = -1;
                    }

                    _recalculate = true;
                    Invalidate();
                }
            }
        }
        private bool _allowTabReordering = false;
        private bool _reorderingtab;
        private static int _MouseOffsetTriggerReorder;
        /// <summary>
        /// Gets or sets whether the user can reorder tabs by dragging them.
        /// </summary>
        [Category("Appearance")]
        [DefaultValue(false)]
        public virtual bool AllowTabReordering
        {
            get { return _allowTabReordering; }

            set
            {
                if (_allowTabReordering != value)
                {
                    _allowTabReordering = value;
                }
            }
        }
        /// <summary>
        /// When true, the last tab may also be reordered and included in shrink calculations.
        /// </summary>
        [Category("Appearance")]
        [DefaultValue(false)]
        public bool AllowLastTabReordering = false;


        /// <summary>
        /// Resets <see cref="HotTrack"/> to its default value.
        /// </summary>
        public void ResetHotTrack()
        {
            HotTrack = false;
        }

        /// <summary>
        /// Gets or sets the color used to draw tab text when it is hot tracked.
        /// </summary>
        [Category("Appearance")]
        public virtual Color HotTextColor
        {
            get { return _hotTextColor; }

            set
            {
                if (_hotTextColor != value)
                {
                    _hotTextColor = value;

                    _recalculate = true;
                    Invalidate();
                }
            }
        }

        private bool ShouldSerializeHotTextColor()
        {
            return _hotTextColor != SystemColors.ActiveCaption;
        }

        /// <summary>
        /// Resets <see cref="HotTextColor"/> to its default value.
        /// </summary>
        public void ResetHotTextColor()
        {
            HotTextColor = SystemColors.ActiveCaption;
        }

        /// <summary>
        /// Gets or sets the color used to draw tab text when not hot tracked.
        /// </summary>
        [Category("Appearance")]
        public virtual Color TextColor
        {
            get { return _textColor; }

            set
            {
                if (_textColor != value)
                {
                    _textColor = value;

                    _recalculate = true;
                    Invalidate();
                }
            }
        }

        private bool ShouldSerializeTextColor()
        {
            return _textColor != TabControlAdvanced.DefaultForeColor;
        }

        /// <summary>
        /// Resets <see cref="TextColor"/> to its default value.
        /// </summary>
        public void ResetTextColor()
        {
            TextColor = TabControlAdvanced.DefaultForeColor;
        }

        /// <summary>
        /// Gets or sets the color used to draw tab text on inactive (unselected) tabs.
        /// </summary>
        [Category("Appearance")]
        public virtual Color TextInactiveColor
        {
            get { return _textInactiveColor; }

            set
            {
                if (_textInactiveColor != value)
                {
                    _textInactiveColor = value;

                    _recalculate = true;
                    Invalidate();
                }
            }
        }

        private bool ShouldSerializeTextInactiveColor()
        {
            return _textInactiveColor != Color.FromArgb(128, TabControlAdvanced.DefaultForeColor);
        }

        /// <summary>
        /// Resets <see cref="TextInactiveColor"/> to its default value.
        /// </summary>
        public void TextTextInactiveColor()
        {
            TextInactiveColor = Color.FromArgb(128, TabControlAdvanced.DefaultForeColor);
        }

        /// <summary>
        /// Gets the rectangle occupied by the tabs area.
        /// </summary>
        [Browsable(false)]
        public virtual Rectangle TabsAreaRect
        {
            get { return _tabsAreaRect; }
        }

        /// <summary>
        /// Gets or sets the image list from which tab images are drawn.
        /// </summary>
        [Category("Appearance")]
        public virtual ImageList ImageList
        {
            get { return _imageList; }

            set
            {
                if (_imageList != value)
                {
                    _imageList = value;

                    _recalculate = true;
                    Invalidate();
                }
            }
        }

        private bool ShouldSerializeImageList()
        {
            return _imageList != null;
        }

        /// <summary>
        /// Resets <see cref="ImageList"/> to its default value of none.
        /// </summary>
        public void ResetImageList()
        {
            ImageList = null;
        }

        /// <summary>
        /// Gets or sets whether the tabs are positioned at the top of the control.
        /// </summary>
        [Category("Appearance")]
        public virtual bool PositionTop
        {
            get { return _positionAtTop; }

            set
            {
                if (_positionAtTop != value)
                {
                    _positionAtTop = value;

                    _recalculate = true;
                    Invalidate();
                }
            }
        }

        /// <summary>
        /// Determines whether <see cref="PositionTop"/> should be serialized by the designer.
        /// </summary>
        /// <returns>True if the value differs from the appearance default.</returns>
        protected bool ShouldSerializePositionTop()
        {
            switch (_appearance)
            {
                case VisualAppearance.MultiBox:
                case VisualAppearance.MultiForm:
                    return _positionAtTop != false;
                case VisualAppearance.MultiDocument:
                default:
                    return _positionAtTop != true;
            }
        }

        /// <summary>
        /// Resets <see cref="PositionTop"/> to the default for the current appearance.
        /// </summary>
        public void ResetPositionTop()
        {
            switch (_appearance)
            {
                case VisualAppearance.MultiBox:
                case VisualAppearance.MultiForm:
                    PositionTop = false;
                    break;
                case VisualAppearance.MultiDocument:
                default:
                    PositionTop = true;
                    break;
            }
        }

        /// <summary>
        /// Gets or sets whether the shared close button is shown in the tabs area.
        /// </summary>
        [Category("Appearance")]
        public virtual bool ShowClose
        {
            get { return _showClose; }

            set
            {
                if (_showClose != value)
                {
                    _showClose = value;

                    _recalculate = true;
                    Invalidate();
                }
            }
        }
        /// <summary>
        /// Gets or sets whether the drop-down tabs button is shown in the tabs area.
        /// </summary>
        [Category("Appearance")]
        [DesignerSerializationVisibility(DesignerSerializationVisibility.Visible)]
        public virtual bool ShowDropDown
        {
            get { return _showDropDown; }

            set
            {
                if (_showDropDown != value)
                {
                    _showDropDown = value;

                    _recalculate = true;
                    Invalidate();
                }
            }
        }
        /// <summary>
        /// Gets or sets whether each closable page shows its own individual close button.
        /// </summary>
        [Category("Appearance")]
        [DesignerSerializationVisibility(DesignerSerializationVisibility.Visible)]
        public virtual bool ShowCloseIndividual
        {
            get { return _showCloseIndividual; }

            set
            {
                if (_showCloseIndividual != value)
                {
                    _showCloseIndividual = value;

                    _recalculate = true;
                    Invalidate();
                }
            }
        }

        /// <summary>
        /// Determines whether <see cref="ShowClose"/> should be serialized by the designer.
        /// </summary>
        /// <returns>True if the value differs from the appearance default.</returns>
        protected bool ShouldSerializeShowClose()
        {
            switch (_appearance)
            {
                case VisualAppearance.MultiBox:
                case VisualAppearance.MultiForm:
                    return _showClose != false;
                case VisualAppearance.MultiDocument:
                default:
                    return _showClose != true;
            }
        }

        /// <summary>
        /// Resets <see cref="ShowClose"/> to the default for the current appearance.
        /// </summary>
        public void ResetShowClose()
        {
            switch (_appearance)
            {
                case VisualAppearance.MultiBox:
                case VisualAppearance.MultiForm:
                    ShowClose = false;
                    break;
                case VisualAppearance.MultiDocument:
                default:
                    ShowClose = true;
                    break;
            }
        }

        /// <summary>
        /// Gets or sets whether the left and right scroll arrow buttons are shown.
        /// </summary>
        [Category("Appearance")]
        public virtual bool ShowArrows
        {
            get { return _showArrows; }

            set
            {
                if (_showArrows != value)
                {
                    _showArrows = value;

                    _recalculate = true;
                    Invalidate();
                }
            }
        }

        /// <summary>
        /// Determines whether <see cref="ShowArrows"/> should be serialized by the designer.
        /// </summary>
        /// <returns>True if the value differs from the appearance default.</returns>
        protected bool ShouldSerializeShowArrows()
        {
            switch (_appearance)
            {
                case VisualAppearance.MultiBox:
                case VisualAppearance.MultiForm:
                    return _showArrows != false;
                case VisualAppearance.MultiDocument:
                default:
                    return _showArrows != true;
            }
        }

        /// <summary>
        /// Resets <see cref="ShowArrows"/> to the default for the current appearance.
        /// </summary>
        public void ResetShowArrows()
        {
            switch (_appearance)
            {
                case VisualAppearance.MultiBox:
                case VisualAppearance.MultiForm:
                    ShowArrows = false;
                    break;
                case VisualAppearance.MultiDocument:
                default:
                    ShowArrows = true;
                    break;
            }
        }

        /// <summary>
        /// Gets or sets whether pages are shrunk so they all fit within the control width.
        /// </summary>
        [Category("Appearance")]
        public virtual bool ShrinkPagesToFit
        {
            get { return _shrinkPagesToFit; }

            set
            {
                if (_shrinkPagesToFit != value)
                {
                    _shrinkPagesToFit = value;

                    _recalculate = true;
                    Invalidate();
                }
            }
        }

        /// <summary>
        /// Determines whether <see cref="ShrinkPagesToFit"/> should be serialized by the designer.
        /// </summary>
        /// <returns>True if the value differs from the appearance default.</returns>
        protected bool ShouldSerializeShrinkPagesToFit()
        {
            switch (_appearance)
            {
                case VisualAppearance.MultiBox:
                case VisualAppearance.MultiForm:
                    return _shrinkPagesToFit != true;
                case VisualAppearance.MultiDocument:
                default:
                    return _shrinkPagesToFit != false;
            }
        }

        /// <summary>
        /// Resets <see cref="ShrinkPagesToFit"/> to the default for the current appearance.
        /// </summary>
        public void ResetShrinkPagesToFit()
        {
            switch (_appearance)
            {
                case VisualAppearance.MultiBox:
                case VisualAppearance.MultiForm:
                    ShrinkPagesToFit = true;
                    break;
                case VisualAppearance.MultiDocument:
                default:
                    ShrinkPagesToFit = false;
                    break;
            }
        }

        /// <summary>
        /// Gets or sets whether the selected page's tab text is drawn in bold.
        /// </summary>
        [Category("Appearance")]
        public virtual bool BoldSelectedPage
        {
            get { return _boldSelected; }

            set
            {
                if (_boldSelected != value)
                {
                    _boldSelected = value;

                    _recalculate = true;
                    Invalidate();
                }
            }
        }

        /// <summary>
        /// Determines whether <see cref="BoldSelectedPage"/> should be serialized by the designer.
        /// </summary>
        /// <returns>True if the value differs from the appearance default.</returns>
        protected bool ShouldSerializeBoldSelectedPage()
        {
            switch (_appearance)
            {
                case VisualAppearance.MultiBox:
                case VisualAppearance.MultiForm:
                    return _boldSelected != false;
                case VisualAppearance.MultiDocument:
                default:
                    return _boldSelected != true;
            }
        }

        /// <summary>
        /// Resets <see cref="BoldSelectedPage"/> to the default for the current appearance.
        /// </summary>
        public void ResetBoldSelectedPage()
        {
            switch (_appearance)
            {
                case VisualAppearance.MultiBox:
                case VisualAppearance.MultiForm:
                    BoldSelectedPage = false;
                    break;
                case VisualAppearance.MultiDocument:
                default:
                    BoldSelectedPage = true;
                    break;
            }
        }

        /// <summary>
        /// Gets or sets whether, in multiline mode, every line is stretched to the full width.
        /// </summary>
        [Category("Appearance")]
        [DefaultValue(false)]
        public virtual bool MultilineFullWidth
        {
            get { return _multilineFullWidth; }

            set
            {
                if (_multilineFullWidth != value)
                {
                    _multilineFullWidth = value;

                    _recalculate = true;
                    Invalidate();
                }
            }
        }

        /// <summary>
        /// Resets <see cref="MultilineFullWidth"/> to its default value.
        /// </summary>
        public void ResetMultilineFullWidth()
        {
            MultilineFullWidth = false;
        }

        /// <summary>
        /// Gets or sets whether tabs that do not fit on one line wrap onto multiple lines.
        /// </summary>
        [Category("Appearance")]
        [DefaultValue(false)]
        public virtual bool Multiline
        {
            get { return _multiline; }

            set
            {
                if (_multiline != value)
                {
                    _multiline = value;

                    _recalculate = true;
                    Invalidate();
                }
            }
        }

        /// <summary>
        /// Resets <see cref="Multiline"/> to its default value.
        /// </summary>
        public void ResetMultiline()
        {
            Multiline = false;
        }

        /// <summary>
        /// Gets or sets how far from the left edge hosted controls are offset.
        /// </summary>
        [Category("Appearance")]
        [DefaultValue(0)]
        public virtual int ControlLeftOffset
        {
            get { return _ctrlLeftOffset; }

            set
            {
                if (_ctrlLeftOffset != value)
                {
                    _ctrlLeftOffset = value;

                    Recalculate();
                    Invalidate();
                }
            }
        }

        /// <summary>
        /// Resets <see cref="ControlLeftOffset"/> to its default value.
        /// </summary>
        public void ResetControlLeftOffset()
        {
            ControlLeftOffset = 0;
        }

        /// <summary>
        /// Gets or sets how far from the top edge hosted controls are offset.
        /// </summary>
        [Category("Appearance")]
        [DefaultValue(0)]
        public virtual int ControlTopOffset
        {
            get { return _ctrlTopOffset; }

            set
            {
                if (_ctrlTopOffset != value)
                {
                    _ctrlTopOffset = value;

                    Recalculate();
                    Invalidate();
                }
            }
        }

        /// <summary>
        /// Resets <see cref="ControlTopOffset"/> to its default value.
        /// </summary>
        public void ResetControlTopOffset()
        {
            ControlTopOffset = 0;
        }

        /// <summary>
        /// Gets or sets how far from the right edge hosted controls are offset.
        /// </summary>
        [Category("Appearance")]
        [DefaultValue(0)]
        public virtual int ControlRightOffset
        {
            get { return _ctrlRightOffset; }

            set
            {
                if (_ctrlRightOffset != value)
                {
                    _ctrlRightOffset = value;

                    Recalculate();
                    Invalidate();
                }
            }
        }

        /// <summary>
        /// Resets <see cref="ControlRightOffset"/> to its default value.
        /// </summary>
        public void ResetControlRightOffset()
        {
            ControlRightOffset = 0;
        }

        /// <summary>
        /// Gets or sets how far from the bottom edge hosted controls are offset.
        /// </summary>
        [Category("Appearance")]
        [DefaultValue(0)]
        public virtual int ControlBottomOffset
        {
            get { return _ctrlBottomOffset; }

            set
            {
                if (_ctrlBottomOffset != value)
                {
                    _ctrlBottomOffset = value;

                    Recalculate();
                    Invalidate();
                }
            }
        }

        /// <summary>
        /// Resets <see cref="ControlBottomOffset"/> to its default value.
        /// </summary>
        public void ResetControlBottomOffset()
        {
            ControlBottomOffset = 0;
        }

        /// <summary>
        /// Gets or sets whether the inset border is shown around pages in Plain style.
        /// </summary>
        [Category("Appearance")]
        [DefaultValue(true)]
        public virtual bool InsetPlain
        {
            get { return _insetPlain; }

            set
            {
                if (_insetPlain != value)
                {
                    _insetPlain = value;

                    Recalculate();
                    Invalidate();
                }
            }
        }

        /// <summary>
        /// Resets <see cref="InsetPlain"/> to its default value.
        /// </summary>
        public void ResetInsetPlain()
        {
            InsetPlain = true;
        }

        /// <summary>
        /// Gets or sets whether, in Plain style, the border is drawn around pages only.
        /// </summary>
        [Category("Appearance")]
        [DefaultValue(false)]
        public virtual bool InsetBorderPagesOnly
        {
            get { return _insetBorderPagesOnly; }

            set
            {
                if (_insetBorderPagesOnly != value)
                {
                    _insetBorderPagesOnly = value;

                    Recalculate();
                    Invalidate();
                }
            }
        }

        /// <summary>
        /// Resets <see cref="InsetBorderPagesOnly"/> to its default value.
        /// </summary>
        public void ResetInsetBorderPagesOnly()
        {
            InsetBorderPagesOnly = true;
        }

        /// <summary>
        /// Gets or sets whether a one-pixel border is drawn around the whole control in IDE style.
        /// </summary>
        [Category("Appearance")]
        public virtual bool IDEPixelBorder
        {
            get { return _idePixelBorder; }

            set
            {
                if (_idePixelBorder != value)
                {
                    _idePixelBorder = value;

                    Recalculate();
                    Invalidate();
                }
            }
        }

        /// <summary>
        /// Determines whether <see cref="IDEPixelBorder"/> should be serialized by the designer.
        /// </summary>
        /// <returns>True if the value differs from the appearance default.</returns>
        protected bool ShouldSerializeIDEPixelBorder()
        {
            switch (_appearance)
            {
                case VisualAppearance.MultiBox:
                case VisualAppearance.MultiForm:
                    return _idePixelBorder != false;
                case VisualAppearance.MultiDocument:
                default:
                    return _idePixelBorder != true;
            }
        }

        /// <summary>
        /// Resets <see cref="IDEPixelBorder"/> to the default for the current appearance.
        /// </summary>
        public void ResetIDEPixelBorder()
        {
            switch (_appearance)
            {
                case VisualAppearance.MultiBox:
                case VisualAppearance.MultiForm:
                    IDEPixelBorder = false;
                    break;
                case VisualAppearance.MultiDocument:
                default:
                    IDEPixelBorder = true;
                    break;
            }
        }

        /// <summary>
        /// Gets or sets whether a one-pixel border is drawn at the top or bottom of the
        /// tabs area in IDE style.
        /// </summary>
        [Category("Appearance")]
        [DefaultValue(true)]
        public virtual bool IDEPixelArea
        {
            get { return _idePixelArea; }

            set
            {
                if (_idePixelArea != value)
                {
                    _idePixelArea = value;

                    Recalculate();
                    Invalidate();
                }
            }
        }

        /// <summary>
        /// Resets <see cref="IDEPixelArea"/> to its default value.
        /// </summary>
        public void ResetIDEPixelArea()
        {
            IDEPixelArea = true;
        }

        /// <summary>
        /// Gets or sets whether tab text is drawn only for the selected tab.
        /// </summary>
        [Category("Appearance")]
        [DefaultValue(false)]
        public virtual bool SelectedTextOnly
        {
            get { return _selectedTextOnly; }

            set
            {
                if (_selectedTextOnly != value)
                {
                    _selectedTextOnly = value;

                    _recalculate = true;
                    Invalidate();
                }
            }
        }

        /// <summary>
        /// Resets <see cref="SelectedTextOnly"/> to its default value.
        /// </summary>
        public void ResetSelectedTextOnly()
        {
            SelectedTextOnly = false;
        }

        /// <summary>
        /// Gets or sets the delay in milliseconds before the control reacts to the mouse leaving.
        /// </summary>
        [Category("Behavour")]
        [DefaultValue(200)]
        public int MouseLeaveTimeout
        {
            get { return _leaveTimeout; }

            set
            {
                if (_leaveTimeout != value)
                {
                    _leaveTimeout = value;
                    _overTimer.Interval = value;
                }
            }
        }

        /// <summary>
        /// Resets <see cref="MouseLeaveTimeout"/> to its default value.
        /// </summary>
        public void ResetMouseLeaveTimeout()
        {
            _leaveTimeout = 200;
        }

        /// <summary>
        /// Gets or sets whether the mouse must leave the whole control before a page drag begins.
        /// </summary>
        [Category("Behavour")]
        [DefaultValue(true)]
        public bool DragFromControl
        {
            get { return _dragFromControl; }
            set { _dragFromControl = value; }
        }

        /// <summary>
        /// Resets <see cref="DragFromControl"/> to its default value.
        /// </summary>
        public void ResetDragFromControl()
        {
            DragFromControl = true;
        }

        /// <summary>
        /// Gets or sets the mode that decides when the tabs area is hidden or shown.
        /// </summary>
        [Category("Appearance")]
        [DefaultValue(false)]
        public virtual HideTabsModes HideTabsMode
        {
            get { return _hideTabsMode; }

            set
            {
                if (_hideTabsMode != value)
                {
                    _hideTabsMode = value;

                    Recalculate();
                    Invalidate();
                }
            }
        }

        /// <summary>
        /// Determines whether <see cref="HideTabsMode"/> should be serialized by the designer.
        /// </summary>
        /// <returns>True if the mode is not the default.</returns>
        protected bool ShouldSerializeHideTabsMode()
        {
            return HideTabsMode != HideTabsModes.ShowAlways;
        }

        /// <summary>
        /// Resets <see cref="HideTabsMode"/> to its default value.
        /// </summary>
        public void ResetHideTabsMode()
        {
            HideTabsMode = HideTabsModes.ShowAlways;
        }

        /// <summary>
        /// Gets or sets whether a page is selected when the mouse hovers over its tab.
        /// </summary>
        [Category("Appearance")]
        [DefaultValue(false)]
        public virtual bool HoverSelect
        {
            get { return _hoverSelect; }

            set
            {
                if (_hoverSelect != value)
                {
                    _hoverSelect = value;

                    _recalculate = true;
                    Invalidate();
                }
            }
        }

        /// <summary>
        /// Resets <see cref="HoverSelect"/> to its default value.
        /// </summary>
        public void ResetHoverSelect()
        {
            HoverSelect = false;
        }

        /// <summary>
        /// Gets or sets whether the control with focus is remembered when leaving a page.
        /// </summary>
        [Category("Behavour")]
        [DefaultValue(true)]
        public virtual bool RecordFocus
        {
            get { return _recordFocus; }

            set
            {
                if (_recordFocus != value)
                    _recordFocus = value;
            }
        }

        /// <summary>
        /// Resets <see cref="RecordFocus"/> to its default value.
        /// </summary>
        public void ResetRecordFocus()
        {
            RecordFocus = true;
        }

        /// <summary>
        /// Gets or sets the index of the selected page; setting it raises the selection
        /// changing and changed events.
        /// </summary>
        [Browsable(false)]
        [DefaultValue(-1)]
        public virtual int SelectedIndex
        {
            get { return _pageSelected; }

            set
            {
                if ((value >= 0) && (value < _tabPages.Count))
                {
                    if (_pageSelected != value)
                    {
                        // Raise selection changing event
                        CancelArgs args = new CancelArgs(_tabPages[value]);
                        OnSelectionChanging(this, args);
                        if (args.Cancel)
                            throw new Exception("Can not change tab, cancelled");
                        // Any page currently selected?
                        if (_pageSelected != -1)
                            DeselectPage(_tabPages[_pageSelected]);

                        _pageSelected = value;

                        if (_pageSelected != -1)
                        {
                            SelectPage(_tabPages[_pageSelected]);

                            // If newly selected page is scrolled off the left hand side
                            if (_pageSelected < _startPage)
                                _startPage = _pageSelected;  // then bring it into view
                        }

                        // Change in selection causes tab pages sizes to change
                        if (_boldSelected)
                        {
                            Recalculate();
                            Invalidate();
                        }

                        // Raise selection change event
                        OnSelectionChanged(EventArgs.Empty);

                        Invalidate();
                    }
                }
            }
        }

        /// <summary>
        /// Gets or sets the currently selected tab page, or null when none is selected.
        /// </summary>
        [Browsable(false)]
        [DefaultValue(null)]
        public virtual TabPageAdvanced SelectedTab
        {
            get
            {
                // If nothing is selected we return null
                if (_pageSelected == -1)
                    return null;
                else
                    return _tabPages[_pageSelected];
            }

            set
            {
                // Cannot change selection to be none of the tabs
                if (value != null)
                {
                    // Get the requested page from the collection
                    int index = _tabPages.IndexOf(value);

                    // If a valid known page then using existing property to perform switch
                    if (index != -1)
                        this.SelectedIndex = index;
                }
            }
        }

        /// <summary>
        /// Scrolls the tabs so that the given page becomes visible.
        /// </summary>
        /// <param name="page">The page to bring into view.</param>
        public virtual void MakePageVisible(TabPageAdvanced page)
        {
            MakePageVisible(_tabPages.IndexOf(page));
        }

        /// <summary>
        /// Scrolls the tabs so that the page at the given index becomes visible.
        /// </summary>
        /// <param name="index">The index of the page to bring into view.</param>
        public virtual void MakePageVisible(int index)
        {
            // Only relevant if we do not shrink all pages to fit and not in multiline
            if (!_shrinkPagesToFit && !_multiline)
            {
                // Range check the request page
                if ((index >= 0) && (index < _tabPages.Count))
                {
                    // Is requested page before those shown?
                    if (index < _startPage)
                    {
                        // Define it as the new start page
                        _startPage = index;

                        _recalculate = true;
                        Invalidate();
                    }
                    else
                    {
                        // Find the last visible position
                        int xMax = GetMaximumDrawPos();

                        Rectangle rect = (Rectangle)_tabRects[index];

                        // Is the page drawn off over the maximum position?
                        if (rect.Right >= xMax)
                        {
                            // Need to find the new start page to bring this one into view
                            int newStart = index;

                            // Space left over for other tabs to be drawn inside
                            int spaceLeft = xMax - rect.Width - _tabsAreaRect.Left - _tabsAreaStartInset;

                            do
                            {
                                // Is there a previous tab to check?
                                if (newStart == 0)
                                    break;

                                Rectangle rectStart = (Rectangle)_tabRects[newStart - 1];

                                // Is there enough space to draw it?
                                if (rectStart.Width > spaceLeft)
                                    break;

                                // Move to new tab and reduce available space left
                                newStart--;
                                spaceLeft -= rectStart.Width;

                            } while (true);

                            // Define the new starting page
                            _startPage = newStart;

                            _recalculate = true;
                            Invalidate();
                        }
                    }
                }
            }
        }

        /// <summary>
        /// Selects the next tab page whose title contains the given mnemonic key.
        /// </summary>
        /// <param name="key">The mnemonic character.</param>
        /// <returns>True if a matching page was found and selected.</returns>
        protected override bool ProcessMnemonic(char key)
        {
            int total = _tabPages.Count;
            int index = this.SelectedIndex + 1;

            for (int count = 0; count < total; count++, index++)
            {
                // Range check the index
                if (index >= total)
                    index = 0;

                TabPageAdvanced page = _tabPages[index];

                // Find position of first mnemonic character
                int position = page.Title.IndexOf('&');

                // Did we find a mnemonic indicator?
                if (IsMnemonic(key, page.Title))
                {
                    // Select this page
                    this.SelectedTab = page;

                    return true;
                }
            }

            return false;
        }

        /// <summary>
        /// Recalculates and repaints the control when it is resized.
        /// </summary>
        /// <param name="e">The event data.</param>
        protected override void OnResize(EventArgs e)
        {
            Recalculate();
            Invalidate();

            base.OnResize(e);
        }

        /// <summary>
        /// Recalculates and repaints the control when its size changes.
        /// </summary>
        /// <param name="e">The event data.</param>
        protected override void OnSizeChanged(EventArgs e)
        {
            Recalculate();
            Invalidate();

            base.OnSizeChanged(e);
        }

        /// <summary>
        /// Raises the <see cref="PopupMenuDisplay"/> event.
        /// </summary>
        /// <param name="e">The cancelable event data.</param>
        public virtual void OnPopupMenuDisplay(CancelEventArgs e)
        {
            // Has anyone registered for the event?
            if (PopupMenuDisplay != null)
                PopupMenuDisplay(this, e);
        }

        /// <summary>
        /// Raises the <see cref="SelectionChanging"/> event.
        /// </summary>
        /// <param name="sender">The source of the event.</param>
        /// <param name="args">The cancelable event data.</param>
        public virtual void OnSelectionChanging(object sender, CancelArgs args)
        {
            // Has anyone registered for the event?
            if (SelectionChanging != null)
                SelectionChanging(this, args);
        }

        /// <summary>
        /// Raises the <see cref="SelectionChanged"/> event.
        /// </summary>
        /// <param name="e">The event data.</param>
        public virtual void OnSelectionChanged(EventArgs e)
        {
            if (SelectedTab != null)
            {
                if (SelectedTab.Alerting)
                    SelectedTab.Alerting = false;
            }
            // Has anyone registered for the event?
            if (SelectionChanged != null)
                SelectionChanged(this, e);
        }

        /// <summary>
        /// Raises the <see cref="ClosePressed"/> event.
        /// </summary>
        /// <param name="e">The cancelable event data.</param>
        public virtual void OnClosePressed(CancelArgs e)
        {
            if (_reorderingtab)
                return;
            // Has anyone registered for the event?
            if (ClosePressed != null)
                ClosePressed(this, e);
        }

        /// <summary>
        /// Raises the <see cref="PageGotFocus"/> event.
        /// </summary>
        /// <param name="e">The event data.</param>
        public virtual void OnPageGotFocus(EventArgs e)
        {
            // Has anyone registered for the event?
            if (PageGotFocus != null)
                PageGotFocus(this, e);
        }

        /// <summary>
        /// Raises the <see cref="PageLostFocus"/> event.
        /// </summary>
        /// <param name="e">The event data.</param>
        public virtual void OnPageLostFocus(EventArgs e)
        {
            // Has anyone registered for the event?
            if (PageLostFocus != null)
                PageLostFocus(this, e);
        }

        /// <summary>
        /// Raises the <see cref="PageDragStart"/> event.
        /// </summary>
        /// <param name="e">The mouse event data.</param>
        public virtual void OnPageDragStart(MouseEventArgs e)
        {
            // Has anyone registered for the event?
            if (PageDragStart != null)
                PageDragStart(this, e);
        }

        /// <summary>
        /// Raises the <see cref="PageDragMove"/> event.
        /// </summary>
        /// <param name="e">The mouse event data.</param>
        public virtual void OnPageDragMove(MouseEventArgs e)
        {
            // Has anyone registered for the event?
            if (PageDragMove != null)
                PageDragMove(this, e);
        }

        /// <summary>
        /// Raises the <see cref="PageDragEnd"/> event.
        /// </summary>
        /// <param name="e">The mouse event data.</param>
        public virtual void OnPageDragEnd(MouseEventArgs e)
        {
            // Has anyone registered for the event?
            if (PageDragEnd != null)
                PageDragEnd(this, e);
        }

        /// <summary>
        /// Raises the <see cref="PageDragQuit"/> event.
        /// </summary>
        /// <param name="e">The mouse event data.</param>
        public virtual void OnPageDragQuit(MouseEventArgs e)
        {
            // Has anyone registered for the event?
            if (PageDragQuit != null)
                PageDragQuit(this, e);
        }

        /// <summary>
        /// Raises the <see cref="DoubleClickTab"/> event for the given page.
        /// </summary>
        /// <param name="page">The tab page that was double-clicked.</param>
        public virtual void OnDoubleClickTab(TabPageAdvanced page)
        {
            // Has anyone registered for the event?
            if (DoubleClickTab != null)
                DoubleClickTab(this, page);
        }

        /// <summary>
        /// Handles the shared close button by requesting the selected page be closed.
        /// </summary>
        /// <param name="sender">The source of the event.</param>
        /// <param name="e">The event data.</param>
        protected virtual void OnCloseButton(object sender, EventArgs e)
        {
            OnClosePressed(new CancelArgs(SelectedTab));
        }
        ContextMenuStrip dropmenu;
        /// <summary>
        /// Handles the drop-down button by showing a menu that lists all tab pages.
        /// </summary>
        /// <param name="sender">The source of the event.</param>
        /// <param name="e">The event data.</param>
        protected virtual void OnDropDownButton(object sender, EventArgs e)
        {
            if (TabPages.Count == 0)
                return;
            dropmenu ??= new ContextMenuStrip();
            dropmenu.Items.Clear();
            foreach (TabPageAdvanced ntab in TabPages)
            {
                dropmenu.ImageList = ntab.ImageList;
                ToolStripMenuItem nitem = new ToolStripMenuItem(ntab.Title);
                dropmenu.Items.Add(nitem);
                nitem.Tag = ntab;
                nitem.Click += new EventHandler(Nitem_Click);
                nitem.ImageIndex = ntab.ImageIndex;
                if (ntab == SelectedTab)
                    nitem.Checked = true;
            }
            dropmenu.Show(_dropDownButton, new Point(_dropDownButton.Width, _dropDownButton.Height), ToolStripDropDownDirection.BelowLeft);
        }

        void Nitem_Click(object sender, EventArgs e)
        {
            ToolStripMenuItem nitem = (ToolStripMenuItem)sender;
            TabPageAdvanced ntab = (TabPageAdvanced)nitem.Tag;
            if (TabPages.IndexOf(ntab) >= 0)
                SelectedTab = ntab;
        }

        /// <summary>
        /// Scrolls the tabs one page to the left.
        /// </summary>
        /// <param name="sender">The source of the event.</param>
        /// <param name="e">The event data.</param>
        protected virtual void OnLeftArrow(object sender, EventArgs e)
        {
            // Set starting page back one
            _startPage--;

            _recalculate = true;
            Invalidate();
        }

        /// <summary>
        /// Scrolls the tabs one page to the right.
        /// </summary>
        /// <param name="sender">The source of the event.</param>
        /// <param name="e">The event data.</param>
        protected virtual void OnRightArrow(object sender, EventArgs e)
        {
            // Set starting page forward one
            _startPage++;

            _recalculate = true;
            Invalidate();
        }

        /// <summary>
        /// Stores the given font and recalculates the text height and image spacing derived
        /// from it.
        /// </summary>
        /// <param name="newFont">The font to apply.</param>
        protected virtual void DefineFont(Font newFont)
        {
            // Use base class for storage of value
            base.Font = newFont;

            // Update internal height value using Font
            _textHeight = newFont.Height;

            // Is the font height bigger than the image height?
            if (_imageHeight >= _textHeight)
            {
                // No, do not need extra spacing around the image to fit in text
                _imageGapTopExtra = 0;
                _imageGapBottomExtra = 0;
            }
            else
            {
                // Yes, need to make the image area bigger so that its height calculation
                // matchs that height of the text
                int extraHeight = _textHeight - _imageHeight;

                // Split the extra height between the top and bottom of image
                _imageGapTopExtra = extraHeight / 2;
                _imageGapBottomExtra = extraHeight - _imageGapTopExtra;
            }
        }

        /// <summary>
        /// Stores the given background color and derives the light, dark, and IDE shading
        /// colors from it.
        /// </summary>
        /// <param name="newColor">The background color to apply.</param>
        protected virtual void DefineBackColor(Color newColor)
        {
            base.BackColor = newColor;

            // Calculate the modified colors from this base
            _backLight = ControlPaint.Light(newColor);
            _backLightLight = ControlPaint.LightLight(newColor);
            _backDark = ControlPaint.Dark(newColor);
            _backDarkDark = ControlPaint.DarkDark(newColor);

#if DON6
            _backIDE = Color.White;
#else
            _backIDE = ColorHelper.TabBackgroundFromBaseColor(newColor);
#endif
        }

        /// <summary>
        /// Builds the color-remapping attributes and applies them to the tabs area buttons
        /// so their images use the active and inactive colors.
        /// </summary>
        protected virtual void DefineButtonImages()
        {
            ImageAttributes ia = new ImageAttributes();

            ColorMap activeMap = new ColorMap();
            ColorMap inactiveMap = new ColorMap();

            // Define the color transformations needed
            activeMap.OldColor = Color.Black;
            activeMap.NewColor = _buttonActiveColor;
            inactiveMap.OldColor = Color.White;
            inactiveMap.NewColor = _buttonInactiveColor;

            // Create remap attributes for use by button
            ia.SetRemapTable(new ColorMap[] { activeMap, inactiveMap }, ColorAdjustType.Bitmap);

            // Pass attributes to the buttons
            _leftArrow.ImageAttributes = ia;
            _rightArrow.ImageAttributes = ia;
            _closeButton.ImageAttributes = ia;
            _dropDownButton.ImageAttributes = ia;
        }

        /// <summary>
        /// Applies the default property values for the given appearance preset.
        /// </summary>
        /// <param name="appearance">The appearance preset to apply.</param>
        protected virtual void SetAppearance(VisualAppearance appearance)
        {
            switch (appearance)
            {
                case VisualAppearance.MultiForm:
                case VisualAppearance.MultiBox:
                    _shrinkPagesToFit = true;					// shrink tabs to fit width
                    _positionAtTop = false;						// draw tabs at bottom of control
                    _showClose = false;							// do not show the close button
                    _showDropDown = false;							// do not show the close button
                    _showCloseIndividual = false;							// do not show the close button
                    _showArrows = false;						// do not show the scroll arrow buttons
                    _boldSelected = false;						// do not show selected pages in bold
                    _idePixelArea = true;                       // show a one pixel border at top or bottom
                    IDEPixelBorder = false;                     // do not show a one pixel border round control
                    break;
                case VisualAppearance.MultiDocument:
                    _shrinkPagesToFit = false;					// shrink tabs to fit width
                    _positionAtTop = true;						// draw tabs at bottom of control
                    _showClose = false;							// do not show the close button
                    _showDropDown = false;							// do not show the close button
                    _showCloseIndividual = true;							// do not show the close button
                    _showArrows = true;						    // do not show the scroll arrow buttons
                    _boldSelected = true;						// do not show selected pages in bold
                    _idePixelArea = true;                       // show a one pixel border at top or bottom
                    IDEPixelBorder = false;                     // do not show a one pixel border round control
                    break;
            }

            // These properties are the same whichever style is selected
            _hotTrack = false;							// do not hot track paes
            _dimUnselected = true;						// draw dimmed non selected pages

            // Define then starting page for drawing
            if (_tabPages.Count > 0)
                _startPage = 0;
            else
                _startPage = -1;

            _appearance = appearance;

            // Define the correct style indexer
            SetStyleIndex();
        }

        /// <summary>
        /// Updates the index into the position constants array based on the current
        /// appearance and style.
        /// </summary>
        protected virtual void SetStyleIndex()
        {
            switch (_appearance)
            {
                case VisualAppearance.MultiBox:
                    // Always pretend we are plain style
                    _styleIndex = 1;
                    break;
                case VisualAppearance.MultiForm:
                case VisualAppearance.MultiDocument:
                    _styleIndex = (int)_style;
                    break;
            }
        }

        /// <summary>
        /// Determines whether the tabs area should currently be hidden, based on
        /// <see cref="HideTabsMode"/>.
        /// </summary>
        /// <returns>True if the tabs area should be hidden.</returns>
        protected virtual bool HideTabsCalculation()
        {
            bool hideTabs = false;

            switch (_hideTabsMode)
            {
                case HideTabsModes.ShowAlways:
                    hideTabs = false;
                    break;
                case HideTabsModes.HideAlways:
                    hideTabs = true;
                    break;
                case HideTabsModes.HideUsingLogic:
                    hideTabs = (_tabPages.Count <= 1);
                    break;
                case HideTabsModes.HideWithoutMouse:
                    hideTabs = !_mouseOver;
                    break;
            }

            return hideTabs;
        }

        /// <summary>
        /// Recalculates the tabs area, page area, tab rectangles, and button positions for
        /// the current size, style, and page set.
        /// </summary>
        protected virtual void Recalculate()
        {
            // Reset the need for a recalculation
            _recalculate = false;

            SizeF maxtextsize = this.CreateGraphics().MeasureString("Mg", this.Font);

            // The height of a tab button is...
            int tabButtonHeight = _position[_styleIndex, (int)PositionIndex.ImageGapTop] +
                                  _imageGapTopExtra +
                                  _imageHeight + ImageMargin +
                                  _imageGapBottomExtra +
                                  _position[_styleIndex, (int)PositionIndex.ImageGapBottom] +
                                  _position[_styleIndex, (int)PositionIndex.BorderBottom];
            if ((_position[_styleIndex, (int)PositionIndex.ImageGapTop] +
                                  _imageGapTopExtra + maxtextsize.Height) > tabButtonHeight)
                tabButtonHeight = Convert.ToInt32(Math.Round(maxtextsize.Height));
            // The height of the tabs area is...
            int tabsAreaHeight = _position[_styleIndex, (int)PositionIndex.BorderTop] +
                                 tabButtonHeight + _position[_styleIndex, (int)PositionIndex.TabsBottomGap];

            bool hideTabsArea = HideTabsCalculation();

            // Should the tabs area be hidden?
            if (hideTabsArea)
            {
                // ... then do not show the tabs or button controls
                _pageAreaRect = new Rectangle(0, 0, this.Width, this.Height);
                _tabsAreaRect = new Rectangle(0, 0, 0, 0);
            }
            else
            {
                if (_positionAtTop)
                {
                    // Create rectangle that represents the entire tabs area
                    _pageAreaRect = new Rectangle(0, tabsAreaHeight, this.Width, this.Height - tabsAreaHeight);

                    // Create rectangle that represents the entire area for pages
                    _tabsAreaRect = new Rectangle(0, 0, this.Width, tabsAreaHeight);
                }
                else
                {
                    // Create rectangle that represents the entire tabs area
                    _tabsAreaRect = new Rectangle(0, this.Height - tabsAreaHeight, this.Width, tabsAreaHeight);

                    // Create rectangle that represents the entire area for pages
                    _pageAreaRect = new Rectangle(0, 0, this.Width, this.Height - tabsAreaHeight);
                }
            }

            int xEndPos = 0;

            if (!hideTabsArea && _tabPages.Count > 0)
            {
                // The minimum size of a button includes its left and right borders for width,
                // and then fixed height which is based on the size of the image and font
                Rectangle tabPosition;

                if (_positionAtTop)
                    tabPosition = new Rectangle(0,
                                                _tabsAreaRect.Bottom - tabButtonHeight -
                                                _position[_styleIndex, (int)PositionIndex.BorderTop],
                                                _position[_styleIndex, (int)PositionIndex.BorderLeft] +
                                                _position[_styleIndex, (int)PositionIndex.BorderRight],
                                                tabButtonHeight);
                else
                    tabPosition = new Rectangle(0,
                                                _tabsAreaRect.Top +
                                                _position[_styleIndex, (int)PositionIndex.BorderTop],
                                                _position[_styleIndex, (int)PositionIndex.BorderLeft] +
                                                _position[_styleIndex, (int)PositionIndex.BorderRight],
                                                tabButtonHeight);

                // Find starting and ending positons for drawing tabs
                int xStartPos = _tabsAreaRect.Left + _tabsAreaStartInset;
                xEndPos = GetMaximumDrawPos();

                // Available width for tabs is size between start and end positions
                int xWidth = xEndPos - xStartPos;

                if (_multiline)
                    RecalculateMultilineTabs(xStartPos, xEndPos, tabPosition, tabButtonHeight);
                else
                    RecalculateSinglelineTabs(xWidth, xStartPos, tabPosition);
            }

            // Position of Controls defaults to the entire page area
            _pageRect = _pageAreaRect;

            // Adjust child controls positions depending on style
            if ((_style == VisualStyle.Plain) && (_appearance != VisualAppearance.MultiBox))
            {
                _pageRect = _pageAreaRect;

                // Shrink by having a border on left,top and right borders
                _pageRect.X += _plainBorderDouble;
                _pageRect.Width -= (_plainBorderDouble * 2) - 1;

                if (!_positionAtTop)
                    _pageRect.Y += _plainBorderDouble;

                _pageRect.Height -= _plainBorderDouble - 1;

                // If hiding the tabs then need to adjust the controls positioning
                if (hideTabsArea)
                {
                    _pageRect.Height -= _plainBorderDouble;

                    if (_positionAtTop)
                        _pageRect.Y += _plainBorderDouble;
                }
            }

            // Calcualte positioning of the child controls/forms
            int leftOffset = _ctrlLeftOffset;
            int rightOffset = _ctrlRightOffset;
            int topOffset = _ctrlTopOffset;
            int bottomOffset = _ctrlBottomOffset;

            if (_idePixelBorder && (_style != VisualStyle.Plain))
            {
                leftOffset += 2;
                rightOffset += 2;

                if (_positionAtTop || hideTabsArea)
                    bottomOffset += 2;

                if (!_positionAtTop || hideTabsArea)
                    topOffset += 2;
            }

            Point pageLoc = new Point(_pageRect.Left + leftOffset,
                                      _pageRect.Top + topOffset);

            Size pageSize = new Size(_pageRect.Width - leftOffset - rightOffset,
                                     _pageRect.Height - topOffset - bottomOffset);

            // If in Plain style and requested to only show top or bottom border
            if ((_style == VisualStyle.Plain) && _insetBorderPagesOnly)
            {
                // Then need to increase width to occupy where borders would have been 
                pageLoc.X -= _plainBorderDouble;
                pageSize.Width += _plainBorderDouble * 2;

                if (hideTabsArea || _positionAtTop)
                {
                    // Draw into the bottom border area
                    pageSize.Height += _plainBorderDouble;
                }

                if (hideTabsArea || !_positionAtTop)
                {
                    // Draw into the top border area
                    pageLoc.Y -= _plainBorderDouble;
                    pageSize.Height += _plainBorderDouble;
                }
            }

            // Position the host panel appropriately
            _hostPanel.Size = pageSize;
            _hostPanel.Location = pageLoc;

            // If we have any tabs at all
            if (_tabPages.Count > 0)
            {
                Rectangle rect = (Rectangle)_tabRects[_tabPages.Count - 1];

                // Determine is the right scrolling button should be enabled
                _rightScroll = (rect.Right > xEndPos);
            }
            else
            {
                // No pages means there can be no right scrolling
                _rightScroll = false;
            }

            // Determine if left scrolling is possible
            _leftScroll = (_startPage > 0);

            // Handle then display and positioning of buttons
            RecalculateButtons();
        }

        /// <summary>
        /// Lays out tab rectangles across multiple lines, wrapping tabs that do not fit and
        /// keeping the selected line adjacent to the page area.
        /// </summary>
        /// <param name="xStartPos">The left position where tabs start.</param>
        /// <param name="xEndPos">The right position where tabs must end.</param>
        /// <param name="tabPosition">The starting position and minimum size of a tab.</param>
        /// <param name="tabButtonHeight">The height of a tab row.</param>
        protected virtual void RecalculateMultilineTabs(int xStartPos, int xEndPos,
                                                        Rectangle tabPosition, int tabButtonHeight)
        {
            using (Graphics g = this.CreateGraphics())
            {
                // MultiBox style needs a pixel extra drawing room on right
                if (_appearance == VisualAppearance.MultiBox)
                    xEndPos -= 2;

                // How many tabs on this line
                int lineCount = 0;

                // Remember which line is the first displayed
                _topYPos = tabPosition.Y;

                // Next tab starting position
                int xPos = xStartPos;
                int yPos = tabPosition.Y;

                // How many full lines were there
                int fullLines = 0;

                // Line increment value
                int lineIncrement = tabButtonHeight + 1;

                // Track which line has the selection on it                                
                int selectedLine = 0;

                // Vertical adjustment
                int yAdjust = 0;

                // Create array for holding lines of tabs
                ArrayList lineList = new ArrayList
                {

                    // Add the initial line
                    new ArrayList()
                };

                // Process each tag page in turn
                for (int i = 0; i < _tabPages.Count; i++)
                {
                    // Get the tab instance for this position
                    TabPageAdvanced page = _tabPages[i];

                    // Find out the tabs total width
                    int tabWidth = GetTabPageSpace(g, page);

                    // If not the first on the line, then check if newline should be started
                    if (lineCount > 0)
                    {
                        // Does this tab extend pass end of the lines
                        if ((xPos + tabWidth) > xEndPos)
                        {
                            // Next tab position is down a line and back to the start
                            xPos = xStartPos;
                            yPos += lineIncrement;

                            // Remember which line is the last displayed
                            _bottomYPos = tabPosition.Y;

                            // Increase height of the tabs area
                            _tabsAreaRect.Height += lineIncrement;

                            // Decrease height of the control area
                            _pageAreaRect.Height -= lineIncrement;

                            // Moving areas depends on drawing at top or bottom
                            if (_positionAtTop)
                                _pageAreaRect.Y += lineIncrement;
                            else
                            {
                                yAdjust -= lineIncrement;
                                _tabsAreaRect.Y -= lineIncrement;
                            }

                            // Start a new line 
                            lineList.Add(new ArrayList());

                            // Make sure the entries are aligned to fill entire line
                            fullLines++;
                        }
                    }

                    // Limit the width of a tab to the whole line
                    if (tabWidth > (xEndPos - xStartPos))
                        tabWidth = xEndPos - xStartPos;

                    // Construct rectangle for representing this tab
                    Rectangle tabRect = new Rectangle(xPos, yPos, tabWidth, tabButtonHeight);

                    // Add this tab to the current line array
                    ArrayList thisLine = lineList[lineList.Count - 1] as ArrayList;

                    // Create entry to represent the sizing of the given page index
                    MultiRect tabEntry = new MultiRect(tabRect, i);

                    thisLine.Add(tabEntry);

                    // Track which line has the selection on it
                    if (i == _pageSelected)
                        selectedLine = fullLines;

                    // Move position of next tab along
                    xPos += tabWidth + 1;

                    // Increment number of tabs on this line
                    lineCount++;
                }

                int line = 0;

                // Do we need all lines to extend full width
                if (_multilineFullWidth)
                    fullLines++;

                // Make each full line stretch the whole line width
                foreach (ArrayList lineArray in lineList)
                {
                    // Only right fill the full lines
                    if (line < fullLines)
                    {
                        // Number of items on this line
                        int numLines = lineArray.Count;

                        // Find ending position of last entry
                        MultiRect itemEntry = (MultiRect)lineArray[numLines - 1];

                        // Is there spare room between last entry and end of line?                            
                        if (itemEntry.Rect.Right < (xEndPos - 1))
                        {
                            // Work out how much extra to give each one
                            int extra = (int)((xEndPos - itemEntry.Rect.Right - 1) / numLines);

                            // Keep track of how much items need moving across
                            int totalMove = 0;

                            // Add into each entry
                            for (int i = 0; i < numLines; i++)
                            {
                                // Get the entry class instance
                                MultiRect expandEntry = (MultiRect)lineArray[i];

                                // Move across requried amount
                                expandEntry.X += totalMove;

                                // Add extra width
                                expandEntry.Width += (int)extra;

                                // All items after this needing moving
                                totalMove += extra;
                            }

                            // Extend the last position, in case rounding errors means its short
                            itemEntry.Width += (xEndPos - itemEntry.Rect.Right - 1);
                        }
                    }

                    line++;
                }

                if (_positionAtTop)
                {
                    // If the selected line is not the bottom line
                    if (selectedLine != (lineList.Count - 1))
                    {
                        ArrayList lastLine = (ArrayList)(lineList[lineList.Count - 1]);

                        // Find y offset of last line
                        int lastOffset = ((MultiRect)lastLine[0]).Rect.Y;

                        // Move all lines below it up one
                        for (int lineIndex = selectedLine + 1; lineIndex < lineList.Count; lineIndex++)
                        {
                            ArrayList al = (ArrayList)lineList[lineIndex];

                            for (int item = 0; item < al.Count; item++)
                            {
                                MultiRect itemEntry = (MultiRect)al[item];
                                itemEntry.Y -= lineIncrement;
                            }
                        }

                        // Move selected line to the bottom
                        ArrayList sl = (ArrayList)lineList[selectedLine];

                        for (int item = 0; item < sl.Count; item++)
                        {
                            MultiRect itemEntry = (MultiRect)sl[item];
                            itemEntry.Y = lastOffset;
                        }
                    }
                }
                else
                {
                    // If the selected line is not the top line
                    if (selectedLine != 0)
                    {
                        ArrayList topLine = (ArrayList)(lineList[0]);

                        // Find y offset of top line
                        int topOffset = ((MultiRect)topLine[0]).Rect.Y;

                        // Move all lines above it down one
                        for (int lineIndex = 0; lineIndex < selectedLine; lineIndex++)
                        {
                            ArrayList al = (ArrayList)lineList[lineIndex];

                            for (int item = 0; item < al.Count; item++)
                            {
                                MultiRect itemEntry = (MultiRect)al[item];
                                itemEntry.Y += lineIncrement;
                            }
                        }

                        // Move selected line to the top
                        ArrayList sl = (ArrayList)lineList[selectedLine];

                        for (int item = 0; item < sl.Count; item++)
                        {
                            MultiRect itemEntry = (MultiRect)sl[item];
                            itemEntry.Y = topOffset;
                        }
                    }
                }

                // Now assignt each lines rectangle to the corresponding structure
                foreach (ArrayList al in lineList)
                {
                    foreach (MultiRect multiEntry in al)
                    {
                        Rectangle newRect = multiEntry.Rect;

                        // Make the vertical adjustment
                        newRect.Y += yAdjust;

                        _tabRects[multiEntry.Index] = newRect;
                    }
                }
            }
        }

        /// <summary>
        /// Lays out tab rectangles on a single line, allocating available width and optionally
        /// shrinking pages so they fit.
        /// </summary>
        /// <param name="xWidth">The available width for tabs.</param>
        /// <param name="xStartPos">The left position where tabs start.</param>
        /// <param name="tabPosition">The starting position and minimum size of a tab.</param>
        protected virtual void RecalculateSinglelineTabs(int xWidth, int xStartPos, Rectangle tabPosition)
        {
            using (Graphics g = this.CreateGraphics())
            {
                int originalWidth = xWidth;

                // Remember which lines are then first and last displayed
                _topYPos = tabPosition.Y;
                _bottomYPos = _topYPos;

                // Set the minimum size for each tab page
                for (int i = 0; i < _tabPages.Count; i++)
                {
                    // Is this page before those displayed?
                    if (i < _startPage)
                        _tabRects[i] = (object)_nullPosition;  // Yes, position off screen
                    else
                        _tabRects[i] = (object)tabPosition;	 // No, create minimum size
                }

                // Subtract the minimum tab sizes already allocated
                xWidth -= _tabPages.Count * (tabPosition.Width + 1);

                // Is there any more space left to allocate
                if (xWidth > 0)
                {
                    ArrayList listNew = new ArrayList();
                    ArrayList listOld = new ArrayList();

                    // Add all pages to those that need space allocating
                    for (int i = _startPage; i < _tabPages.Count; i++)
                        listNew.Add(_tabPages[i]);

                    // Each tab can have an allowance
                    int xAllowance;

                    do
                    {
                        // The list generated in the last iteration becomes 
                        // the to be processed in this iteration
                        listOld = listNew;

                        // List of pages that still need more space allocating
                        listNew = new ArrayList();

                        if (_shrinkPagesToFit)
                        {
                            // Each page is allowed a maximum allowance of space
                            // during this iteration. 
                            xAllowance = xWidth / _tabPages.Count;
                        }
                        else
                        {
                            // Allow each page as much space as it wants
                            xAllowance = 999;
                        }

                        // Assign space to each page that is requesting space
                        foreach (TabPageAdvanced page in listOld)
                        {
                            int index = _tabPages.IndexOf(page);

                            Rectangle rectPos = (Rectangle)_tabRects[index];

                            // Find out how much extra space this page is requesting
                            int xSpace = GetTabPageSpace(g, page) - rectPos.Width;

                            // Does it want more space than its currently allowed to have?
                            if (xSpace > xAllowance)
                            {
                                // Restrict allowed space
                                xSpace = xAllowance;

                                // Add page to ensure it gets processed next time around
                                listNew.Add(page);
                            }

                            // Give space to tab
                            rectPos.Width += xSpace;

                            _tabRects[index] = (object)rectPos;

                            // Reduce extra left for remaining tabs
                            xWidth -= xSpace;
                        }
                    } while ((listNew.Count > 0) && (xAllowance > 0) && (xWidth > 0));
                }

                // Assign the final positions to each tab now we known their sizes
                for (int i = _startPage; i < _tabPages.Count; i++)
                {
                    Rectangle rectPos = (Rectangle)_tabRects[i];

                    // Define position of tab page
                    rectPos.X = xStartPos;

                    _tabRects[i] = (object)rectPos;

                    // Next button must be the width of this one across
                    xStartPos += rectPos.Width + 1;
                }
                if ((AutoShrinkPages) && (_tabPages.Count > 1))
                {
                    int totalWidth = 0;
                    for (int i = 0; i < _tabPages.Count; i++)
                    {
                        Rectangle tabrec = (Rectangle)_tabRects[i];
                        totalWidth += tabrec.Width;
                    }
                    if (totalWidth > (originalWidth))
                    {
                        // It does not fit so shring all pages
                        int availableWidth = originalWidth;
                        int totalpages = _tabPages.Count;
                        int fixedWidth = availableWidth / totalpages;
                        if (!AllowLastTabReordering)
                        {
                            totalpages--;
                            availableWidth -= ((Rectangle)_tabRects[_tabPages.Count - 1]).Width * 2;
                            fixedWidth = availableWidth / totalpages;
                        }
                        if (fixedWidth > AutoShrinkMinimum)
                        {
                            Rectangle previous = (Rectangle)_tabRects[0];
                            if (previous.Width > 0)
                            {
                                _tabRects[0] = new Rectangle(previous.Left, previous.Top, fixedWidth, previous.Height);
                                for (int i = 1; i < totalpages; i++)
                                {
                                    previous = (Rectangle)_tabRects[i - 1];
                                    Rectangle newrec = new Rectangle(previous.Right + 1, previous.Top, fixedWidth, previous.Height);
                                    _tabRects[i] = newrec;
                                }
                                if (!AllowLastTabReordering)
                                {
                                    Rectangle oldrec = (Rectangle)_tabRects[totalpages];
                                    previous = (Rectangle)_tabRects[totalpages - 1];
                                    Rectangle newrec = new Rectangle(previous.Right + 1, previous.Top, oldrec.Width, previous.Height);
                                    _tabRects[totalpages] = newrec;
                                }
                            }
                        }
                    }
                }

            }
        }

        /// <summary>
        /// Positions and shows or hides the close, drop-down, and scroll arrow buttons within
        /// the tabs area.
        /// </summary>
        protected virtual void RecalculateButtons()
        {
            int buttonTopGap = 0;

            if (_multiline)
            {
                // The height of a tab row is
                int tabButtonHeight = _position[_styleIndex, (int)PositionIndex.ImageGapTop] +
                                      _imageGapTopExtra +
                                      _imageHeight +
                                      _imageGapBottomExtra +
                                      _position[_styleIndex, (int)PositionIndex.ImageGapBottom] +
                                      _position[_styleIndex, (int)PositionIndex.BorderBottom];

                // The height of the tabs area is...
                int tabsAreaHeight = _position[_styleIndex, (int)PositionIndex.BorderTop] +
                                      tabButtonHeight + _position[_styleIndex, (int)PositionIndex.TabsBottomGap];

                // Find offset to place button halfway down the tabs area rectangle
                buttonTopGap = _position[_styleIndex, (int)PositionIndex.ButtonOffset] +
                               (tabsAreaHeight - _buttonHeight) / 2;

                // Invert gap position when at bottom
                if (!_positionAtTop)
                    buttonTopGap = _tabsAreaRect.Height - buttonTopGap - _buttonHeight;
            }
            else
            {
                // Find offset to place button halfway down the tabs area rectangle
                buttonTopGap = _position[_styleIndex, (int)PositionIndex.ButtonOffset] +
                                (_tabsAreaRect.Height - _buttonHeight) / 2;
            }
            // Position to place next button
            int xStart = _tabsAreaRect.Right - _buttonWidth - _buttonGap;

            // Close button should be shown?
            if (_showClose)
            {
                // Define the location
                _closeButton.Location = new Point(xStart, _tabsAreaRect.Top + buttonTopGap);

                if (xStart < 1)
                    _closeButton.Hide();
                else
                    _closeButton.Show();

                xStart -= _buttonWidth;
            }
            else
                _closeButton.Hide();

            // DropDown button should be shown?
            if (_showDropDown)
            {
                // Define the location
                _dropDownButton.Location = new Point(xStart, _tabsAreaRect.Top + buttonTopGap);

                if (xStart < 1)
                    _dropDownButton.Hide();
                else
                    _dropDownButton.Show();

                xStart -= _dropDownButton.Width;
            }
            else
                _dropDownButton.Hide();

            // Arrows should be shown?
            if (_showArrows)
            {
                // Position the right arrow first as its more the right hand side
                _rightArrow.Location = new Point(xStart, _tabsAreaRect.Top + buttonTopGap);

                if (xStart < 1)
                    _rightArrow.Hide();
                else
                    _rightArrow.Show();

                xStart -= _rightArrow.Width;

                _leftArrow.Location = new Point(xStart, _tabsAreaRect.Top + buttonTopGap);

                if (xStart < 1)
                    _leftArrow.Hide();
                else
                    _leftArrow.Show();

                xStart -= _leftArrow.Width;

                // Define then enabled state of buttons
                _leftArrow.Enabled = _leftScroll;
                _rightArrow.Enabled = _rightScroll;
            }
            else
            {
                _leftArrow.Hide();
                _rightArrow.Hide();
            }

            if ((_appearance == VisualAppearance.MultiBox) || (_style == VisualStyle.Plain))
                _closeButton.BackColor = _leftArrow.BackColor = _rightArrow.BackColor = _dropDownButton.BackColor = this.BackColor;
            else
                _closeButton.BackColor = _leftArrow.BackColor = _rightArrow.BackColor = _dropDownButton.BackColor = _backIDE;
        }

        /// <summary>
        /// Returns the maximum X position at which tabs may be drawn, accounting for the
        /// visible buttons.
        /// </summary>
        /// <returns>The rightmost drawing position for tabs.</returns>
        protected virtual int GetMaximumDrawPos()
        {
            int xEndPos = _tabsAreaRect.Right - _tabsAreaEndInset;

            // Showing the close button reduces available space
            if (_showClose)
                xEndPos -= _buttonWidth + _buttonGap;

            // If showing arrows then reduce space for both
            if (_showArrows)
                xEndPos -= _buttonWidth * 2;
            if (_showDropDown)
                xEndPos -= _buttonWidth;

            return xEndPos;
        }

        /// <summary>
        /// Calculates the total pixel width a tab needs to draw its border, image, and text.
        /// </summary>
        /// <param name="g">The graphics used to measure text.</param>
        /// <param name="page">The tab page being measured.</param>
        /// <returns>The required tab width in pixels.</returns>
        protected virtual int GetTabPageSpace(Graphics g, TabPageAdvanced page)
        {
            // Find the fixed elements of required space
            int width = _position[_styleIndex, (int)PositionIndex.BorderLeft] +
                        _position[_styleIndex, (int)PositionIndex.BorderRight];

            // Any icon or image provided?
            if ((((page.Icon != null) || (((_imageList != null) || (page.ImageList != null)) && (page.ImageIndex != -1))))
               || (page.TabWidth > 0))
            {
                width += _position[_styleIndex, (int)PositionIndex.ImageGapLeft] +
                         _imageWidth + ImageMargin +
                         _position[_styleIndex, (int)PositionIndex.ImageGapRight];
            }

            // Any text provided?
            if ((page.Title.Length > 0) || (_showCloseIndividual && page.CanClose))
            {
                if (!_selectedTextOnly || (_selectedTextOnly && (_pageSelected == _tabPages.IndexOf(page))))
                {
                    Font drawFont = base.Font;

                    if (_boldSelected && page.Selected)
                        drawFont = new Font(drawFont, FontStyle.Bold);

                    // Find width of the requested text
                    SizeF dimension = g.MeasureString(page.Title, drawFont);

                    // With of close icon
                    if (_showCloseIndividual)
                    {
                        dimension = new SizeF(dimension.Width + _buttonWidth + _buttonGap, dimension.Height);
                    }
                    if (page.TabWidth > 0)
                        dimension = new SizeF(page.TabWidth, dimension.Height);

                    // Convert to integral
                    width += _position[_styleIndex, (int)PositionIndex.TextGapLeft] +
                            (int)dimension.Width + 1;
                }
            }
            else
            {
                Font drawFont = base.Font;
                SizeF dimension = g.MeasureString(" ", drawFont);
                if (page.TabWidth > 0)
                    dimension = new SizeF(page.TabWidth, dimension.Height);
            }

            return width;
        }

        /// <summary>
        /// Suppresses the default background painting, which is handled during
        /// <see cref="OnPaint"/>.
        /// </summary>
        /// <param name="e">The paint event data.</param>
        protected override void OnPaintBackground(PaintEventArgs e)
        {
        }

        /// <summary>
        /// Paints the tabs area, borders, and each tab page.
        /// </summary>
        /// <param name="e">The paint event data.</param>
        protected override void OnPaint(PaintEventArgs e)
        {
            // Does the state need recalculating before paint can occur?
            if (_recalculate)
                Recalculate();

            using (SolidBrush pageAreaBrush = new SolidBrush(this.BackColor))
            {
                // Fill backgrounds of the page and tabs areas
                e.Graphics.FillRectangle(pageAreaBrush, _pageAreaRect);

                if ((_style == VisualStyle.Plain) || (_appearance == VisualAppearance.MultiBox))
                {
                    e.Graphics.FillRectangle(pageAreaBrush, _tabsAreaRect);
                }
                else
                {
                    using (SolidBrush tabsAreaBrush = new SolidBrush(_backIDE))
                        e.Graphics.FillRectangle(tabsAreaBrush, _tabsAreaRect);
                }
            }

            // MultiBox and Chrome appearance does not have any borders
            if (_appearance != VisualAppearance.MultiBox)
            {
                bool hiddenPages = HideTabsCalculation();

                // Draw the borders
                switch (_style)
                {
                    case VisualStyle.Plain:
                        // Height for drawing the border is size of the page area extended 
                        // down to draw the bottom border inside the tabs area
                        int pageHeight = _pageAreaRect.Height + _plainBorderDouble;

                        int xDraw = _pageAreaRect.Top;

                        // Should the tabs area be hidden?
                        if (hiddenPages)
                        {
                            // Then need to readjust pageHeight
                            pageHeight -= _plainBorderDouble;
                        }
                        else
                        {
                            // If drawing at top then overdraw upwards and not down
                            if (_positionAtTop)
                                xDraw -= _plainBorderDouble;
                        }

                        if (_insetBorderPagesOnly)
                        {
                            if (!hiddenPages)
                            {
                                // Draw the outer border around the page area			
                                DrawHelper.DrawPlainRaisedBorderTopOrBottom(e.Graphics, new Rectangle(0, xDraw, this.Width, pageHeight),
                                                                            _backLightLight, base.BackColor, _backDark, _backDarkDark, _positionAtTop);
                            }
                        }
                        else
                        {
                            // Draw the outer border around the page area			
                            DrawHelper.DrawPlainRaisedBorder(e.Graphics, new Rectangle(_pageAreaRect.Left, xDraw, _pageAreaRect.Width, pageHeight),
                                                             _backLightLight, base.BackColor, _backDark, _backDarkDark);
                        }

                        // Do we have any tabs?
                        if ((_tabPages.Count > 0) && _insetPlain)
                        {
                            // Draw the inner border around the page area
                            Rectangle inner = new Rectangle(_pageAreaRect.Left + _plainBorder,
                                                            xDraw + _plainBorder,
                                                            _pageAreaRect.Width - _plainBorderDouble,
                                                            pageHeight - _plainBorderDouble);

                            if (_insetBorderPagesOnly)
                            {
                                if (!hiddenPages)
                                {
                                    DrawHelper.DrawPlainSunkenBorderTopOrBottom(e.Graphics, new Rectangle(0, inner.Top, this.Width, inner.Height),
                                                                                _backLightLight, base.BackColor, _backDark, _backDarkDark, _positionAtTop);
                                }
                            }
                            else
                            {
                                DrawHelper.DrawPlainSunkenBorder(e.Graphics, new Rectangle(inner.Left, inner.Top, inner.Width, inner.Height),
                                                                 _backLightLight, base.BackColor, _backDark, _backDarkDark);
                            }

                        }
                        break;

                    case VisualStyle.IDE:
                        // Draw the top and bottom borders to the tabs area
                        using (Pen darkdark = new Pen(_backDarkDark),
                                   dark = new Pen(_backDark),
                                   lightlight = new Pen(_backLightLight),
                                   backColor = new Pen(base.BackColor))
                        {
                            int borderGap = _position[_styleIndex, (int)PositionIndex.BorderTop];

                            if (_positionAtTop)
                            {
                                // Fill the border between the tabs and the embedded controls
                                using (SolidBrush backBrush = new SolidBrush(base.BackColor))
                                    e.Graphics.FillRectangle(backBrush, 0, _tabsAreaRect.Bottom - borderGap, _tabsAreaRect.Width, borderGap);

                                int indent = 0;

                                // Is a single pixel border required around whole area?                            
                                if (_idePixelBorder)
                                {
                                    using (Pen llFore = new Pen(ControlPaint.LightLight(this.ForeColor)))
                                        e.Graphics.DrawRectangle(dark, 0, 0, this.Width - 1, this.Height - 1);

                                    indent++;
                                }
                                else
                                {
                                    if (_idePixelArea)
                                    {
                                        // Draw top border
                                        e.Graphics.DrawLine(dark, 0, _tabsAreaRect.Top, _tabsAreaRect.Width, _tabsAreaRect.Top);
                                    }
                                }

                                // Draw bottom border
                                if (!hiddenPages)
                                    e.Graphics.DrawLine(lightlight, indent,
                                                                    _tabsAreaRect.Bottom - borderGap,
                                                                    _tabsAreaRect.Width - (indent * 2),
                                                                    _tabsAreaRect.Bottom - borderGap);
                            }
                            else
                            {
                                // Fill the border between the tabs and the embedded controls
                                using (SolidBrush backBrush = new SolidBrush(base.BackColor))
                                    e.Graphics.FillRectangle(backBrush, 0, _tabsAreaRect.Top, _tabsAreaRect.Width, borderGap);

                                int indent = 0;

                                // Is a single pixel border required around whole area?                            
                                if (_idePixelBorder)
                                {
                                    using (Pen llFore = new Pen(ControlPaint.LightLight(this.ForeColor)))
                                        e.Graphics.DrawRectangle(dark, 0, 0, this.Width - 1, this.Height - 1);

                                    indent++;
                                }
                                else
                                {
                                    if (_idePixelArea)
                                    {
                                        // Draw bottom border
                                        e.Graphics.DrawLine(backColor, 0, _tabsAreaRect.Bottom - 1, _tabsAreaRect.Width, _tabsAreaRect.Bottom - 1);
                                    }
                                }

                                // Draw top border
                                if (!hiddenPages)
                                    e.Graphics.DrawLine(darkdark, indent,
                                                                _tabsAreaRect.Top + 2,
                                                                _tabsAreaRect.Width - (indent * 2),
                                                                _tabsAreaRect.Top + 2);
                            }
                        }
                        break;
                    case VisualStyle.Chrome:
                        // Draw the top and bottom borders to the tabs area
                        /*using (Pen darkdark = new Pen(_backDarkDark),
                                   dark = new Pen(_backDark),
                                   lightlight = new Pen(_backLightLight),
                                   backColor = new Pen(base.BackColor))
                        {
                            int borderGap = _position[_styleIndex, (int)PositionIndex.BorderTop];

                            if (_positionAtTop)
                            {
                                // Fill the border between the tabs and the embedded controls
                                using (SolidBrush backBrush = new SolidBrush(base.BackColor))
                                    e.Graphics.FillRectangle(backBrush, 0, _tabsAreaRect.Bottom - borderGap, _tabsAreaRect.Width, borderGap);

                                int indent = 0;

                                // Is a single pixel border required around whole area?                            
                                if (_idePixelBorder)
                                {
                                    using (Pen llFore = new Pen(ControlPaint.LightLight(this.ForeColor)))
                                        e.Graphics.DrawRectangle(dark, 0, 0, this.Width - 1, this.Height - 1);

                                    indent++;
                                }
                                else
                                {
                                    if (_idePixelArea)
                                    {
                                        // Draw top border
                                        e.Graphics.DrawLine(dark, 0, _tabsAreaRect.Top, _tabsAreaRect.Width, _tabsAreaRect.Top);
                                    }
                                }

                                // Draw bottom border
                                if (!hiddenPages)
                                    e.Graphics.DrawLine(lightlight, indent,
                                                                    _tabsAreaRect.Bottom - borderGap,
                                                                    _tabsAreaRect.Width - (indent * 2),
                                                                    _tabsAreaRect.Bottom - borderGap);
                            }
                            else
                            {
                                // Fill the border between the tabs and the embedded controls
                                using (SolidBrush backBrush = new SolidBrush(base.BackColor))
                                    e.Graphics.FillRectangle(backBrush, 0, _tabsAreaRect.Top, _tabsAreaRect.Width, borderGap);

                                int indent = 0;

                                // Is a single pixel border required around whole area?                            
                                if (_idePixelBorder)
                                {
                                    using (Pen llFore = new Pen(ControlPaint.LightLight(this.ForeColor)))
                                        e.Graphics.DrawRectangle(dark, 0, 0, this.Width - 1, this.Height - 1);

                                    indent++;
                                }
                                else
                                {
                                    if (_idePixelArea)
                                    {
                                        // Draw bottom border
                                        e.Graphics.DrawLine(backColor, 0, _tabsAreaRect.Bottom - 1, _tabsAreaRect.Width, _tabsAreaRect.Bottom - 1);
                                    }
                                }

                                // Draw top border
                                if (!hiddenPages)
                                    e.Graphics.DrawLine(darkdark, indent,
                                                                _tabsAreaRect.Top + 2,
                                                                _tabsAreaRect.Width - (indent * 2),
                                                                _tabsAreaRect.Top + 2);
                            }
                        }*/
                        break;
                }
            }

            // Clip the drawing to prevent drawing in unwanted areas
            ClipDrawingTabs(e.Graphics);

            // Paint each tab page
            /*foreach (TabPageAdvanced page in _tabPages)
            {
                Rectangle rectTab = (Rectangle)_tabRects[_tabPages.IndexOf(page)];
                //DrawTabBorder(ref rectTab,page,e.Graphics);
            }*/

            List<TabPageAdvanced> pagestodraw = new List<TabPageAdvanced>();
            for (int i = 0; i < _tabPages.Count; i++)
            {
                if ((i == _tabPages.Count - 1) && (_reorderingtab))
                {
                    if (AllowLastTabReordering)
                        pagestodraw.Add(_tabPages[i]);
                }
                else
                    pagestodraw.Add(_tabPages[i]);
            }
            // Paint each tab page
            foreach (TabPageAdvanced page in pagestodraw)
            {
                if (!page.Selected)
                {
                    bool highlighttext = false;
                    bool highlightclose = false;
                    GetHighLightStatus(page, ref highlighttext, ref highlightclose);
                    DrawTab(page, e.Graphics, highlighttext, highlightclose);
                }
            }
            // Paint each tab page
            foreach (TabPageAdvanced page in pagestodraw)
            {
                if (page.Selected)
                {
                    bool highlighttext = false;
                    bool highlightclose = false;
                    GetHighLightStatus(page, ref highlighttext, ref highlightclose);
                    DrawTab(page, e.Graphics, highlighttext, highlightclose);
                }
            }
        }


        /// <summary>
        /// Returns the rectangle to which tab drawing is clipped so tabs are not painted
        /// under the buttons.
        /// </summary>
        /// <returns>The clipping rectangle for tab drawing.</returns>
        protected virtual Rectangle ClippingRectangle()
        {
            // Calculate how much to reduce width by for clipping rectangle
            int xReduce = _tabsAreaRect.Width - GetMaximumDrawPos();

            // Create clipping rect
            return new Rectangle(_tabsAreaRect.Left,
                                 _tabsAreaRect.Top,
                                 _tabsAreaRect.Width - xReduce,
                                 _tabsAreaRect.Height);
        }

        /// <summary>
        /// Restricts drawing on the given graphics to the tab clipping rectangle.
        /// </summary>
        /// <param name="g">The graphics whose clip region is set.</param>
        protected virtual void ClipDrawingTabs(Graphics g)
        {
            Rectangle clipRect = ClippingRectangle();

            // Restrict drawing to this clipping rectangle
            g.Clip = new Region(clipRect);
        }

        /// <summary>
        /// Draws a single tab, including its border, image, and text.
        /// </summary>
        /// <param name="page">The tab page to draw.</param>
        /// <param name="g">The graphics to draw on.</param>
        /// <param name="highlightText">Whether the text should be drawn as hot.</param>
        /// <param name="highlightClose">Whether the close indicator should be highlighted.</param>
        protected virtual void DrawTab(TabPageAdvanced page, Graphics g, bool highlightText, bool highlightClose)
        {
            Rectangle rectTab = (Rectangle)_tabRects[_tabPages.IndexOf(page)];

            if (_reorderingtab)
            {
                if (page == SelectedTab)
                {
                    Point currentScreenPos = Cursor.Position;
                    Point currentPos = this.PointToClient(currentScreenPos);
                    int newx = rectTab.Left + currentPos.X - _leftMouseDownPos.X;
                    if (newx < 0)
                        newx = 0;
                    if (newx + rectTab.Width > Width)
                        newx = Width - rectTab.Width;
                    rectTab = new Rectangle(newx, rectTab.Top, rectTab.Width, rectTab.Height);
                }
            }

            DrawTabBorder(ref rectTab, page, g);

            int xDraw = rectTab.Left + _position[_styleIndex, (int)PositionIndex.BorderLeft];
            int xMax = rectTab.Right - _position[_styleIndex, (int)PositionIndex.BorderRight];

            DrawTabImage(rectTab, page, g, xMax, ref xDraw, highlightText);
            DrawTabText(rectTab, page, g, highlightText, highlightClose, xMax, xDraw);
        }

        /// <summary>
        /// Draws the icon or image for a tab, advancing the drawing position past it.
        /// </summary>
        /// <param name="rectTab">The tab rectangle.</param>
        /// <param name="page">The tab page being drawn.</param>
        /// <param name="g">The graphics to draw on.</param>
        /// <param name="xMax">The maximum X position available for drawing.</param>
        /// <param name="xDraw">The current X position; advanced past the drawn image.</param>
        /// <param name="highlightText">Whether the tab is currently highlighted.</param>
        protected virtual void DrawTabImage(Rectangle rectTab,
                                            TabPageAdvanced page,
                                            Graphics g,
                                            int xMax,
                                            ref int xDraw, bool highlightText)
        {
            // Default to using the Icon from the page
            Image drawIcon = page.Icon;
            Image drawImage = null;
            if (drawIcon != null)
            {
                if (page.DrawIconHightlight)
                    if (!highlightText)
                        drawIcon = null;
            }

            // If there is no valid Icon and the page is requested an image list index...
            if ((drawIcon == null) && (page.ImageIndex != -1))
            {
                try
                {
                    // Default to using an image from the TabPageAdvanced
                    ImageList imageList = page.ImageList;

                    // If page does not have an ImageList...
                    imageList ??= _imageList;   // ...then use the TabControlAdvanced one

                    // Do we have an ImageList to select from?
                    if (imageList != null)
                    {
                        // Grab the requested image
                        drawImage = imageList.Images[page.ImageIndex];
                    }
                }
                catch (Exception)
                {
                    // User supplied ImageList/ImageIndex are invalid, use an error image instead
                    drawImage = _internalImages.Images[(int)ImageStrip.Error];
                }
            }

            // Draw any image required
            if ((drawImage != null) || (drawIcon != null))
            {
                // Enough room to draw any of the image?
                if ((xDraw + _position[_styleIndex, (int)PositionIndex.ImageGapLeft]) <= xMax)
                {
                    // Move past the left image gap
                    xDraw += _position[_styleIndex, (int)PositionIndex.ImageGapLeft];

                    // Find down position for drawing the image
                    int yDraw = rectTab.Top +
                                _position[_styleIndex, (int)PositionIndex.ImageGapTop] +
                                _imageGapTopExtra;

                    int gaptop = _position[_styleIndex, (int)PositionIndex.ImageGapTop];
                    //yDraw = yDraw + ImageMargin;                
                    // Icono centrado en el rectangulo
                    yDraw = gaptop + ((rectTab.Height - gaptop) - _imageHeight) / 2;

                    // If there is enough room for all of the image?
                    if ((xDraw + _imageWidth - 1) <= xMax)
                    {
                        if (drawImage != null)
                            g.DrawImage(drawImage, new Rectangle(xDraw, yDraw, _imageWidth, _imageHeight));
                        else
                        {
                            //g.DrawIcon(drawIcon, new Rectangle(xDraw, yDraw, _imageWidth, _imageHeight));
                            System.Threading.Monitor.Enter(drawIcon);
                            try
                            {
                                g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                                g.DrawImage(drawIcon, new Rectangle(xDraw, yDraw, _imageWidth, _imageHeight));
                            }
                            finally
                            {
                                System.Threading.Monitor.Exit(drawIcon);
                            }
                        }

                        // Move past the image and the image gap to the right
                        xDraw += _imageWidth + ImageMargin + _position[_styleIndex, (int)PositionIndex.ImageGapRight];
                    }
                    else
                    {
                        // Calculate how much room there is
                        int xSpace = xMax - xDraw;

                        // Any room at all?
                        if (xSpace > 0)
                        {
                            if (drawImage != null)
                            {
                                // Draw only part of the image
                                g.DrawImage(drawImage,
                                            new Point[]{new Point(xDraw, yDraw),
                                                        new Point(xDraw + xSpace, yDraw),
                                                        new Point(xDraw, yDraw + _imageHeight)},
                                            new Rectangle(0, 0, xSpace,
                                            _imageHeight),
                                            GraphicsUnit.Pixel);
                            }
                            else
                            {
                                // Draw only part of the image
                                g.DrawImage(drawIcon,
                                            new Point[]{new Point(xDraw, yDraw),
                                                        new Point(xDraw + xSpace, yDraw),
                                                        new Point(xDraw, yDraw + _imageHeight)},
                                            new Rectangle(0, 0, xSpace,
                                            _imageHeight),
                                            GraphicsUnit.Pixel);
                            }
                            // All space has been used up, nothing left for text
                            xDraw = xMax;
                        }
                    }
                }
            }
        }

        /// <summary>
        /// Draws the text for a tab, along with the individual close indicator when enabled.
        /// </summary>
        /// <param name="rectTab">The tab rectangle.</param>
        /// <param name="page">The tab page being drawn.</param>
        /// <param name="g">The graphics to draw on.</param>
        /// <param name="highlightText">Whether the text should be drawn as hot.</param>
        /// <param name="highlightClose">Whether the close indicator should be highlighted.</param>
        /// <param name="xMax">The maximum X position available for drawing.</param>
        /// <param name="xDraw">The X position at which to start drawing text.</param>
        protected virtual void DrawTabText(Rectangle rectTab,
                                           TabPageAdvanced page,
                                           Graphics g,
                                           bool highlightText,
                                           bool highlightClose,
                                           int xMax,
                                           int xDraw)
        {
            if (!_selectedTextOnly || (_selectedTextOnly && page.Selected))
            {
                // Any space for drawing text?
                if (xDraw < xMax)
                {
                    Color drawColor;
                    SolidBrush drawBrush;
                    Font drawFont = base.Font;

                    // Decide which base color to use
                    if (highlightText)
                        drawColor = _hotTextColor;
                    else
                    {
                        // Do we modify base color depending on selection?
                        if (_dimUnselected && !page.Selected)
                        {
                            // Reduce the intensity of the color
                            drawColor = _textInactiveColor;
                        }
                        else
                            drawColor = _textColor;
                    }


                    // Should selected items be drawn in bold?
                    if (_boldSelected && page.Selected)
                        drawFont = new Font(drawFont, FontStyle.Bold);

                    Console.WriteLine("DrawText {0}", drawColor.ToString());

                    if (Math.Abs(drawColor.GetBrightness() - BackColor.GetBrightness()) < 0.5)
                        drawColor = Color.FromArgb(drawColor.R / 2, drawColor.G / 2, drawColor.B / 2);
                    // Now the color is determined, create solid brush
                    drawBrush = new SolidBrush(drawColor);

                    // Ensure only a single line is draw from then left hand side of the
                    // rectangle and if to large for line to shows ellipsis for us
                    StringFormat drawFormat = new StringFormat();
                    drawFormat.FormatFlags = StringFormatFlags.NoClip | StringFormatFlags.NoWrap;
                    drawFormat.Trimming = StringTrimming.EllipsisCharacter;
                    drawFormat.Alignment = page.TitleAlignment;
                    drawFormat.HotkeyPrefix = HotkeyPrefix.Show;

                    // Find the vertical drawing limits for text
                    int yStart = rectTab.Top + _position[_styleIndex, (int)PositionIndex.ImageGapTop];

                    int yEnd = rectTab.Bottom -
                            _position[_styleIndex, (int)PositionIndex.ImageGapBottom] -
                            _position[_styleIndex, (int)PositionIndex.BorderBottom];

                    // Use text offset to adjust position of text
                    yStart += _position[_styleIndex, (int)PositionIndex.TextOffset];

                    // Across the text left gap
                    xDraw += _position[_styleIndex, (int)PositionIndex.TextGapLeft];

                    // Need at least 1 pixel width before trying to draw
                    if (xDraw < xMax)
                    {
                        if ((_showCloseIndividual) && (page.CanClose))
                            xMax = xMax - _buttonGap - _buttonWidth;
                        // Find drawing rectangle
                        Rectangle drawRect = new Rectangle(xDraw, yStart, xMax - xDraw, yEnd - yStart);

                        // Finally....draw the string!
                        g.DrawString(page.Title, drawFont, drawBrush, drawRect, drawFormat);

                        //if ((_showCloseIndividual) && (page.Selected || highlightText) && (page.CanClose))
                        if ((_showCloseIndividual) && (page.CanClose))
                        {
                            g.SmoothingMode = SmoothingMode.HighQuality;
                            int cross_width = Convert.ToInt32(6 * Reportman.Drawing.Windows.GraphicUtils.DPIScale);
                            Pen pendraw;
                            if (highlightClose)
                            {
                                pendraw = new Pen(Brushes.White);
                            }
                            else
                            {
                                if (page.Selected)
                                    pendraw = new Pen(Brushes.Gray);
                                else
                                    pendraw = new Pen(Brushes.DarkGray);
                            }
                            pendraw.EndCap = LineCap.Round;
                            pendraw.StartCap = LineCap.Round;
                            pendraw.Width = 2f * Reportman.Drawing.Windows.GraphicUtils.DPIScale;
                            // g.DrawImage(_internalImages.Images[4], new Point(xMax + _buttonGap, yStart + (yEnd - yStart - _internalImages.Images[4].Height) / 2));
                            Rectangle newrec = new Rectangle(xMax + _buttonGap + cross_width / 2, yStart + (yEnd - yStart - cross_width) / 2, cross_width, cross_width);
                            if (highlightClose)
                            {
                                //g.ResetClip();
                                //g.SmoothingMode = SmoothingMode.HighQuality;
                                //g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                                //g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                                int circle_gap = Convert.ToInt32(8 * Reportman.Drawing.Windows.GraphicUtils.DPIScale);
                                Rectangle recellipse = new Rectangle(newrec.Left - circle_gap / 2, newrec.Top - circle_gap / 2, newrec.Width + circle_gap, newrec.Height + circle_gap);

                                GraphicsPath pathClip = new GraphicsPath();
                                pathClip.AddEllipse(recellipse);
                                g.FillPath(Brushes.Red, pathClip);


                                //Rectangle recellipse = new Rectangle(xMax + _buttonGap, yStart + (yEnd - yStart - _buttonHeight) / 2, _internalImages.Images[4].Width, _internalImages.Images[4].Height);
                                //g.FillEllipse(Brushes.Red, recellipse);
                            }
                            //g.DrawRectangle(pendraw, new Rectangle(xMax + _buttonGap, yStart + (yEnd - yStart - _buttonHeight) / 2, _internalImages.Images[4].Width, _internalImages.Images[4].Height));
                            g.DrawLine(pendraw, newrec.Left, newrec.Bottom, newrec.Right, newrec.Top);
                            g.DrawLine(pendraw, newrec.Left, newrec.Top, newrec.Right, newrec.Bottom);
                        }
                    }

                    // Cleanup resources!
                    drawBrush.Dispose();
                }
            }
        }

        /// <summary>
        /// Draws the border of a tab using the appropriate routine for the current
        /// appearance and style.
        /// </summary>
        /// <param name="rectTab">The tab rectangle, which may be adjusted.</param>
        /// <param name="page">The tab page being drawn.</param>
        /// <param name="g">The graphics to draw on.</param>
        protected virtual void DrawTabBorder(ref Rectangle rectTab, TabPageAdvanced page, Graphics g)
        {
            if (_appearance == VisualAppearance.MultiBox)
            {
                // Adjust the drawing upwards two pixels to 'look pretty'
                rectTab.Y -= _multiBoxAdjust;

                // Draw the same regardless of style
                DrawMultiBoxBorder(page, g, rectTab);
            }
            else
            {
                // Drawing the border is style specific
                switch (_style)
                {
                    case VisualStyle.Plain:
                        DrawPlainTabBorder(page, g, rectTab);
                        break;
                    case VisualStyle.IDE:
                        DrawIDETabBorder(page, g, rectTab);
                        break;
                    case VisualStyle.Chrome:
                        DrawChromeTabBorder(page, g, rectTab);
                        break;
                }
            }
        }

        /// <summary>
        /// Draws the tab border for the multi-box appearance.
        /// </summary>
        /// <param name="page">The tab page being drawn.</param>
        /// <param name="g">The graphics to draw on.</param>
        /// <param name="rectPage">The tab rectangle.</param>
        protected virtual void DrawMultiBoxBorder(TabPageAdvanced page, Graphics g, Rectangle rectPage)
        {
            if (page.Selected)
            {
                using (SolidBrush lightlight = new SolidBrush(_backLightLight))
                    g.FillRectangle(lightlight, rectPage);

                using (Pen darkdark = new Pen(_backDarkDark))
                    g.DrawRectangle(darkdark, rectPage);
            }
            else
            {
                using (SolidBrush backBrush = new SolidBrush(this.BackColor))
                    g.FillRectangle(backBrush, rectPage.X + 1, rectPage.Y, rectPage.Width - 1, rectPage.Height);

                // Find the index into TabPageAdvanced collection for this page
                int index = _tabPages.IndexOf(page);

                // Decide if the separator should be drawn
                bool drawSeparator = (index == _tabPages.Count - 1) ||
                    (index < (_tabPages.Count - 1)) &&
                    (_tabPages[index + 1].Selected != true);

                // MultiLine mode is slighty more complex
                if (_multiline && !drawSeparator)
                {
                    // By default always draw separator
                    drawSeparator = true;

                    // If we are not the last item
                    if (index < (_tabPages.Count - 1))
                    {
                        // If the next item is selected
                        if (_tabPages[index + 1].Selected == true)
                        {
                            Rectangle thisRect = (Rectangle)_tabRects[index];
                            Rectangle nextRect = (Rectangle)_tabRects[index + 1];

                            // If we are on the same drawing line then do not draw separator
                            if (thisRect.Y == nextRect.Y)
                                drawSeparator = false;
                        }
                    }
                }

                // Draw tab separator unless the next page after us is selected
                if (drawSeparator)
                {
                    using (Pen lightlight = new Pen(_backLightLight),
                              dark = new Pen(_backDark))
                    {
                        g.DrawLine(dark, rectPage.Right, rectPage.Top + 2, rectPage.Right,
                                   rectPage.Bottom - _position[_styleIndex, (int)PositionIndex.TabsBottomGap] - 1);
                        g.DrawLine(lightlight, rectPage.Right + 1, rectPage.Top + 2, rectPage.Right + 1,
                                   rectPage.Bottom - _position[_styleIndex, (int)PositionIndex.TabsBottomGap] - 1);
                    }
                }
            }
        }

        /// <summary>
        /// Draws the tab border for the Plain visual style.
        /// </summary>
        /// <param name="page">The tab page being drawn.</param>
        /// <param name="g">The graphics to draw on.</param>
        /// <param name="rectPage">The tab rectangle.</param>
        protected virtual void DrawPlainTabBorder(TabPageAdvanced page, Graphics g, Rectangle rectPage)
        {
            using (Pen light = new Pen(_backLightLight),
                      dark = new Pen(_backDark),
                      darkdark = new Pen(_backDarkDark))
            {
                int yLeftOffset = 0;
                int yRightOffset = 0;

                using (SolidBrush backBrush = new SolidBrush(base.BackColor))
                {
                    if (page.Selected)
                    {
                        // Calculate the rectangle that covers half the top border area
                        int yBorder;

                        if (_positionAtTop)
                            yBorder = rectPage.Top + (_position[_styleIndex, (int)PositionIndex.BorderTop] / 2);
                        else
                            yBorder = rectPage.Top - (_position[_styleIndex, (int)PositionIndex.BorderTop] / 2);

                        // Construct rectangle that covers the outer part of the border
                        Rectangle rectBorder = new Rectangle(rectPage.Left, yBorder, rectPage.Width - 1, rectPage.Height);

                        // Blank out area 
                        g.FillRectangle(backBrush, rectBorder);

                        // Make the left and right border lines extend higher up
                        yLeftOffset = -2;
                        yRightOffset = -1;
                    }
                }

                if (_positionAtTop)
                {
                    // Draw the left border
                    g.DrawLine(light, rectPage.Left, rectPage.Bottom, rectPage.Left, rectPage.Top + 2);
                    g.DrawLine(light, rectPage.Left + 1, rectPage.Top + 1, rectPage.Left + 1, rectPage.Top + 2);

                    // Draw the top border
                    g.DrawLine(light, rectPage.Left + 2, rectPage.Top + 1, rectPage.Right - 2, rectPage.Top + 1);

                    // Draw the right border
                    g.DrawLine(darkdark, rectPage.Right, rectPage.Bottom - yRightOffset, rectPage.Right, rectPage.Top + 2);
                    g.DrawLine(dark, rectPage.Right - 1, rectPage.Bottom - yRightOffset, rectPage.Right - 1, rectPage.Top + 2);
                    g.DrawLine(dark, rectPage.Right - 2, rectPage.Top + 1, rectPage.Right - 2, rectPage.Top + 2);
                    g.DrawLine(darkdark, rectPage.Right - 2, rectPage.Top, rectPage.Right, rectPage.Top + 2);
                }
                else
                {
                    // Draw the left border
                    g.DrawLine(light, rectPage.Left, rectPage.Top + yLeftOffset, rectPage.Left, rectPage.Bottom - 2);
                    g.DrawLine(dark, rectPage.Left + 1, rectPage.Bottom - 1, rectPage.Left + 1, rectPage.Bottom - 2);

                    // Draw the bottom border
                    g.DrawLine(dark, rectPage.Left + 2, rectPage.Bottom - 1, rectPage.Right - 2, rectPage.Bottom - 1);
                    g.DrawLine(darkdark, rectPage.Left + 2, rectPage.Bottom, rectPage.Right - 2, rectPage.Bottom);

                    // Draw the right border
                    g.DrawLine(darkdark, rectPage.Right, rectPage.Top, rectPage.Right, rectPage.Bottom - 2);
                    g.DrawLine(dark, rectPage.Right - 1, rectPage.Top + yRightOffset, rectPage.Right - 1, rectPage.Bottom - 2);
                    g.DrawLine(dark, rectPage.Right - 2, rectPage.Bottom - 1, rectPage.Right - 2, rectPage.Bottom - 2);
                    g.DrawLine(darkdark, rectPage.Right - 2, rectPage.Bottom, rectPage.Right, rectPage.Bottom - 2);
                }
            }
        }

        /// <summary>
        /// Draws the rounded tab border for the Chrome visual style.
        /// </summary>
        /// <param name="page">The tab page being drawn.</param>
        /// <param name="g">The graphics to draw on.</param>
        /// <param name="rectPage">The tab rectangle.</param>
        protected virtual void DrawChromeTabBorder(TabPageAdvanced page, Graphics g, Rectangle rectPage)
        {
            using (Pen lightlight = new Pen(_backLightLight),
                      backColor = new Pen(base.BackColor),
                      dark = new Pen(_backDark),
                      darkdark = new Pen(_backDarkDark))
            {

                // Draw background in unselected color
                //using(SolidBrush tabsAreaBrush = new SolidBrush(_backIDE))
                //    g.FillRectangle(tabsAreaBrush, rectPage);
                Color backbrushcolor = Color.FromArgb(220, 225, 231);
                if (page.Selected)
                    backbrushcolor = Color.White;
                else
                    if (page.Alerting)
                        backbrushcolor = AlertingColor;


                using (SolidBrush tabsAreaBrush = new SolidBrush(backbrushcolor), penbrush = new SolidBrush(Color.DarkGray))
                {
                    const int penwidth = 1;
                    //                    const int TABSEP = 2;
                    //                    const int CURVESEP = 7;
                    const int TABSEP = 4;
                    const int CURVESEP = 5;
                    const int CURVEMARGIN = 2;
                    using (Pen npen = new Pen(penbrush))
                    {
                        int tab_separation = Convert.ToInt32(TABSEP * Reportman.Drawing.Windows.GraphicUtils.DPIScale);
                        int curve_separation = Convert.ToInt32(CURVESEP * Reportman.Drawing.Windows.GraphicUtils.DPIScale);
                        int curve_margin = Convert.ToInt32(CURVEMARGIN * Reportman.Drawing.Windows.GraphicUtils.DPIScale);
                        //int curve_separation = CURVESEP;
                        //int curve_margin = CURVEMARGIN;
                        //g.SmoothingMode = SmoothingMode.AntiAlias;
                        g.SmoothingMode = SmoothingMode.HighQuality;
                        npen.Width = penwidth * (Reportman.Drawing.Windows.GraphicUtils.DPIScale);
                        Point bottomleft = new Point(rectPage.X - curve_separation, rectPage.Y + rectPage.Height);
                        Point topleft = new Point(rectPage.X + tab_separation, rectPage.Y);
                        Point topright = new Point(rectPage.X + rectPage.Width - tab_separation, rectPage.Y);
                        Point bottomright = new Point(rectPage.X + rectPage.Width + curve_separation, rectPage.Y + rectPage.Height);

                        Point bottomleftbegin = new Point(bottomleft.X - curve_margin, bottomleft.Y);
                        Point bottomleftbegin2 = new Point(bottomleft.X, bottomleft.Y - curve_margin / 2);
                        Point bottomleftcurve1 = new Point(bottomleft.X + (topleft.X - bottomleft.X) / 6, bottomleft.Y - (bottomleft.Y - topleft.Y) / 6);
                        Point bottomleftcurve2 = new Point(bottomleft.X + (topleft.X - bottomleft.X) / 4, bottomleft.Y - (bottomleft.Y - topleft.Y) / 4);
                        Point[] leftbottomcurve = new Point[4];
                        leftbottomcurve[0] = bottomleftbegin;
                        leftbottomcurve[1] = bottomleftbegin2;
                        leftbottomcurve[2] = bottomleftcurve1;
                        leftbottomcurve[3] = bottomleftcurve2;

                        Point topleftbegin = new Point(topleft.X - (topleft.X - bottomleft.X) / 6, topleft.Y + (bottomleft.Y - topleft.Y) / 6);
                        Point topleftbegin2 = new Point(topleft.X - (topleft.X - bottomleft.X) / 8, topleft.Y + (bottomleft.Y - topleft.Y) / 8);
                        Point topleftcurve1 = new Point(topleft.X, topleft.Y + curve_margin / 2);
                        Point topleftcurve2 = new Point(topleft.X + curve_margin, topleft.Y);
                        Point[] topleftcurve = new Point[4];
                        topleftcurve[0] = topleftbegin;
                        topleftcurve[1] = topleftbegin2;
                        topleftcurve[2] = topleftcurve1;
                        topleftcurve[3] = topleftcurve2;


                        Point toprightbegin = new Point(topright.X - curve_margin, topright.Y);
                        Point toprightbegin2 = new Point(topright.X, topright.Y + curve_margin / 2);
                        Point toprightcurve1 = new Point(topright.X + (bottomright.X - topright.X) / 8, topright.Y + (bottomright.Y - topright.Y) / 8);
                        Point toprightcurve2 = new Point(topright.X + (bottomright.X - topright.X) / 6, topright.Y + (bottomright.Y - topright.Y) / 6);
                        Point[] toprightcurve = new Point[4];
                        toprightcurve[0] = toprightbegin;
                        toprightcurve[1] = toprightbegin2;
                        toprightcurve[2] = toprightcurve1;
                        toprightcurve[3] = toprightcurve2;


                        Point bottomrightbegin = new Point(bottomright.X - (bottomright.X - topright.X) / 4, bottomright.Y - (bottomright.Y - topright.Y) / 4);
                        Point bottomrightbegin2 = new Point(bottomright.X - (bottomright.X - topright.X) / 6, bottomright.Y - (bottomright.Y - topright.Y) / 6);
                        Point bottomrightcurve1 = new Point(bottomright.X, bottomright.Y - curve_margin / 2);
                        Point bottomrightcurve2 = new Point(bottomright.X + curve_margin, bottomright.Y);
                        Point[] bottomrightcurve = new Point[4];
                        bottomrightcurve[0] = bottomrightbegin;
                        bottomrightcurve[1] = bottomrightbegin2;
                        bottomrightcurve[2] = bottomrightcurve1;
                        bottomrightcurve[3] = bottomrightcurve2;

                        float cornerradius = 2.5f * Reportman.Drawing.Windows.GraphicUtils.DPIScale;
                        PointF[] newpoints = new PointF[6];
                        newpoints[0] = bottomleftbegin;
                        newpoints[1] = bottomleft;
                        newpoints[2] = topleft;
                        newpoints[3] = topright;
                        newpoints[4] = bottomright;
                        newpoints[5] = bottomrightcurve2;
                        GraphicsPath npath = Windows.GraphicUtils.GetRoundedLine(newpoints, cornerradius);

                        /*GraphicsPath npath = new GraphicsPath();

                        npath.AddCurve(leftbottomcurve);
                        npath.AddLine(bottomleftcurve2, topleftbegin);
                        npath.AddCurve(topleftcurve);
                        npath.AddLine(topleftcurve2, toprightbegin);
                        npath.AddCurve(toprightcurve);
                        npath.AddLine(toprightcurve2, bottomrightbegin);
                        npath.AddCurve(bottomrightcurve);*/



                        npath.CloseFigure();
                        g.FillPath(tabsAreaBrush, npath);
                        if (!page.Selected)
                            g.DrawPath(npen, npath);
                        else
                        {
                            using (Pen penwhite = new Pen(backbrushcolor))
                            {
                                penwhite.Width = penwidth * (Reportman.Drawing.Windows.GraphicUtils.DPIScale);
                                g.DrawLine(penwhite, bottomleft, bottomright);
                                npath = Windows.GraphicUtils.GetRoundedLine(newpoints, cornerradius);
                                if (_reorderingtab)
                                {
                                    PointF firstpoint = newpoints[0];
                                    PointF lastpoint = newpoints[newpoints.Length - 1];
                                    PointF firstlinepoint = new PointF(0, firstpoint.Y);
                                    PointF lastlinepoint = new PointF(Width, firstpoint.Y);
                                    g.DrawLine(npen, firstlinepoint, firstpoint);
                                    g.DrawLine(npen, lastpoint, lastlinepoint);
                                }
                                /*npath = new GraphicsPath();
                                npath.AddCurve(leftbottomcurve);
                                npath.AddLine(bottomleftcurve2, topleftbegin);
                                npath.AddCurve(topleftcurve);
                                npath.AddLine(topleftcurve2, toprightbegin);
                                npath.AddCurve(toprightcurve);
                                npath.AddLine(toprightcurve2, bottomrightbegin);
                                npath.AddCurve(bottomrightcurve);*/
                                g.DrawPath(npen, npath);
                            }
                        }
                        // Ultima pagina dibuja hasta el final
                        if (page == TabPages[TabPages.Count - 1])
                        {
                            g.DrawLine(npen, bottomrightcurve2, new Point(Width, bottomright.Y));
                            //g.DrawLine(npen, bottomright, new Point(Width,bottomright.Y));
                        }


                    }
                }


                // Find the index into TabPageAdvanced collection for this page
                /*int index = _tabPages.IndexOf(page);

                // Decide if the separator should be drawn
                bool drawSeparator = (index == _tabPages.Count - 1) ||
                                     (index < (_tabPages.Count - 1)) && 
                                     (_tabPages[index+1].Selected != true);

                // MultiLine mode is slighty more complex
                if (_multiline && !drawSeparator)
                {
                    // By default always draw separator
                    drawSeparator = true;

                    // If we are not the last item
                    if (index < (_tabPages.Count - 1))
                    {
                        // If the next item is selected
                        if (_tabPages[index+1].Selected == true)
                        {
                            Rectangle thisRect = (Rectangle)_tabRects[index];
                            Rectangle nextRect = (Rectangle)_tabRects[index+1];

                            // If we are on the same drawing line then do not draw separator
                            if (thisRect.Y == nextRect.Y)
                                drawSeparator = false;
                        }
                    }
                }
                */
                // Draw tab separator unless the next page after us is selected
                /*if (drawSeparator)
                {
                    // Reduce the intensity of the color
                    using(Pen linePen = new Pen(_textInactiveColor))
                        g.DrawLine(linePen, rectPage.Right, rectPage.Top + 2, rectPage.Right, 
                            rectPage.Bottom - _position[_styleIndex, (int)PositionIndex.TabsBottomGap] - 1);
                }*/
            }
        }
        /// <summary>
        /// Draws the tab border for the IDE visual style, including the separator between
        /// unselected tabs.
        /// </summary>
        /// <param name="page">The tab page being drawn.</param>
        /// <param name="g">The graphics to draw on.</param>
        /// <param name="rectPage">The tab rectangle.</param>
        protected virtual void DrawIDETabBorder(TabPageAdvanced page, Graphics g, Rectangle rectPage)
        {
            using (Pen lightlight = new Pen(_backLightLight),
                      backColor = new Pen(base.BackColor),
                      dark = new Pen(_backDark),
                      darkdark = new Pen(_backDarkDark))
            {
                if (page.Selected)
                {
                    // Draw background in selected color
                    using (SolidBrush pageAreaBrush = new SolidBrush(this.BackColor))
                        g.FillRectangle(pageAreaBrush, rectPage);

                    if (_positionAtTop)
                    {
                        // Overdraw the bottom border
                        g.DrawLine(backColor, rectPage.Left, rectPage.Bottom, rectPage.Right - 1, rectPage.Bottom);

                        // Draw the right border
                        g.DrawLine(darkdark, rectPage.Right, rectPage.Top, rectPage.Right, rectPage.Bottom);
                    }
                    else
                    {
                        // Draw the left border
                        g.DrawLine(lightlight, rectPage.Left, rectPage.Top - 1, rectPage.Left, rectPage.Bottom);

                        // Draw the bottom border
                        g.DrawLine(darkdark, rectPage.Left + 1, rectPage.Bottom, rectPage.Right, rectPage.Bottom);

                        // Draw the right border
                        g.DrawLine(darkdark, rectPage.Right, rectPage.Top - 1, rectPage.Right, rectPage.Bottom);

                        // Overdraw the top border
                        g.DrawLine(backColor, rectPage.Left + 1, rectPage.Top - 1, rectPage.Right - 1, rectPage.Top - 1);
                    }
                }
                else
                {
                    // Draw background in unselected color
                    using (SolidBrush tabsAreaBrush = new SolidBrush(_backIDE))
                        g.FillRectangle(tabsAreaBrush, rectPage);

                    // Find the index into TabPageAdvanced collection for this page
                    int index = _tabPages.IndexOf(page);

                    // Decide if the separator should be drawn
                    bool drawSeparator = (index == _tabPages.Count - 1) ||
                                         (index < (_tabPages.Count - 1)) &&
                                         (_tabPages[index + 1].Selected != true);

                    // MultiLine mode is slighty more complex
                    if (_multiline && !drawSeparator)
                    {
                        // By default always draw separator
                        drawSeparator = true;

                        // If we are not the last item
                        if (index < (_tabPages.Count - 1))
                        {
                            // If the next item is selected
                            if (_tabPages[index + 1].Selected == true)
                            {
                                Rectangle thisRect = (Rectangle)_tabRects[index];
                                Rectangle nextRect = (Rectangle)_tabRects[index + 1];

                                // If we are on the same drawing line then do not draw separator
                                if (thisRect.Y == nextRect.Y)
                                    drawSeparator = false;
                            }
                        }
                    }

                    // Draw tab separator unless the next page after us is selected
                    if (drawSeparator)
                    {
                        // Reduce the intensity of the color
                        using (Pen linePen = new Pen(_textInactiveColor))
                            g.DrawLine(linePen, rectPage.Right, rectPage.Top + 2, rectPage.Right,
                                rectPage.Bottom - _position[_styleIndex, (int)PositionIndex.TabsBottomGap] - 1);
                    }
                }
            }
        }

        /// <summary>
        /// Handles the pages collection being cleared by deselecting and removing all pages.
        /// </summary>
        protected virtual void OnClearingPages()
        {
            // Is a page currently selected?
            if (_pageSelected != -1)
            {
                // Deselect the page
                DeselectPage(_tabPages[_pageSelected]);

                // Remember that nothing is selected
                _pageSelected = -1;
                _startPage = -1;
            }

            // Remove all the user controls 
            foreach (TabPageAdvanced page in _tabPages)
                RemoveTabPage(page);

            // Remove all rectangles associated with TabPageAdvanced's
            _tabRects.Clear();
        }

        /// <summary>
        /// Handles the pages collection having been cleared by recalculating and raising
        /// the selection events.
        /// </summary>
        protected virtual void OnClearedPages()
        {
            // Must recalculate after the pages have been removed and
            // not before as that would calculate based on pages still
            // being present in the list
            Recalculate();

            // Raise selection changing event
            OnSelectionChanging(this, new CancelArgs(null));

            // Must notify a change in selection
            OnSelectionChanged(EventArgs.Empty);

            Invalidate();
        }

        /// <summary>
        /// Handles a page being inserted by adjusting the selected index if needed.
        /// </summary>
        /// <param name="index">The index at which the page is being inserted.</param>
        /// <param name="value">The page being inserted.</param>
        protected virtual void OnInsertingPage(int index, object value)
        {
            // If a page currently selected?
            if (_pageSelected != -1)
            {
                // Is the selected page going to be after this new one in the list
                if (_pageSelected >= index)
                    _pageSelected++;  // then need to update selection index to reflect this
            }
        }

        /// <summary>
        /// Handles a page having been inserted by hosting its control, optionally selecting
        /// it, and recalculating.
        /// </summary>
        /// <param name="index">The index at which the page was inserted.</param>
        /// <param name="value">The page that was inserted.</param>
        protected virtual void OnInsertedPage(int index, object value)
        {
            bool selectPage = false;

            TabPageAdvanced page = value as TabPageAdvanced;

            // Hookup to receive TabPageAdvanced property changes
            page.PropertyChanged += new TabPageAdvanced.PropChangeHandler(OnPagePropertyChanged);

            // Add the appropriate Control/Form/TabPageAdvanced to the control
            AddTabPage(page);

            // Do we want to select this page?
            if ((_pageSelected == -1) || (page.Selected))
            {
                // Raise selection changing event
                OnSelectionChanging(this, new CancelArgs(page));

                // Any page currently selected
                if (_pageSelected != -1)
                    DeselectPage(_tabPages[_pageSelected]);

                // This becomes the newly selected page
                _pageSelected = _tabPages.IndexOf(page);

                // If no page is currently defined as the start page
                if (_startPage == -1)
                    _startPage = 0;	 // then must be added then first page

                // Request the page be selected
                selectPage = true;
            }

            // Add new rectangle to match new number of pages, this must be done before
            // the 'SelectPage' or 'OnSelectionChanged' to ensure the number of _tabRects 
            // entries matches the number of _tabPages entries.
            _tabRects.Add((object)new Rectangle());

            // Cause the new page to be the selected one
            if (selectPage)
            {
                // Must recalculate to ensure the new _tabRects entry above it correctly
                // filled in before the new page is selected, as a change in page selection
                // may cause the _tabRects values ot be interrogated.
                Recalculate();

                SelectPage(page);

                // Raise selection change event
                OnSelectionChanged(EventArgs.Empty);
            }

            Recalculate();
            Invalidate();
        }

        /// <summary>
        /// Handles a page being removed by unhosting its control and deselecting it when needed.
        /// </summary>
        /// <param name="index">The index of the page being removed.</param>
        /// <param name="value">The page being removed.</param>
        protected virtual void OnRemovingPage(int index, object value)
        {
            TabPageAdvanced page = value as TabPageAdvanced;

            page.PropertyChanged -= new TabPageAdvanced.PropChangeHandler(OnPagePropertyChanged);

            // Remove the appropriate Control/Form/TabPageAdvanced to the control
            RemoveTabPage(page);

            // Notice a change in selected page
            _changed = false;

            // Is this the currently selected page
            if (_pageSelected == index)
            {
                // Raise selection changing event
                OnSelectionChanging(this, new CancelArgs(page));

                _changed = true;
                DeselectPage(page);
            }
        }
        /// <summary>
        /// Requests that the given page be closed by raising <see cref="ClosePressed"/>.
        /// </summary>
        /// <param name="npage">The page to close.</param>
        /// <returns>True if the page was removed from the collection.</returns>
        public bool Close(TabPageAdvanced npage)
        {
            if (ClosePressed != null)
            {
                ClosePressed(this, new CancelArgs(npage));
            }
            return (this.TabPages.IndexOf(npage) < 0);
        }
        /// <summary>
        /// Handles a page having been removed by adjusting the start and selected indexes and
        /// recalculating.
        /// </summary>
        /// <param name="index">The index from which the page was removed.</param>
        /// <param name="value">The page that was removed.</param>
        protected virtual void OnRemovedPage(int index, object value)
        {
            if (_hotTrackPage == index)
            {
                _hotTrackPage = -1;
            }
            // Is first displayed page then one being removed?
            if (_startPage >= index)
            {
                // Decrement to use start displaying previous page
                _startPage--;

                // Have we tried to select off the left hand side?
                if (_startPage == -1)
                {
                    // Are there still some pages left?
                    if (_tabPages.Count > 0)
                        _startPage = 0;
                }
            }

            // Is the selected page equal to or after this new one in the list
            if (_pageSelected >= index)
            {
                // Decrement index to reflect this change
                _pageSelected--;

                // Have we tried to select off the left hand side?
                if (_pageSelected == -1)
                {
                    // Are there still some pages left?
                    if (_tabPages.Count > 0)
                        _pageSelected = 0;
                }

                // Is the new selection valid?
                if (_pageSelected != -1)
                    SelectPage(_tabPages[_pageSelected]);  // Select it
            }

            // Change in selection causes event generation
            if (_changed)
            {
                // Reset changed flag
                _changed = false;

                // Raise selection change event
                OnSelectionChanged(EventArgs.Empty);
            }

            // Remove a rectangle to match number of pages
            _tabRects.RemoveAt(0);

            Recalculate();
            Invalidate();
        }

        /// <summary>
        /// Hosts the page's control or form on the host panel and hooks up the events needed
        /// to track focus and mouse activity.
        /// </summary>
        /// <param name="page">The page to add.</param>
        protected virtual void AddTabPage(TabPageAdvanced page)
        {
            // Has not been shown for the first time yet
            page.Shown = false;

            // Add user supplied control 
            if (page.Control != null)
            {
                Form controlIsForm = page.Control as Form;

                page.Control.Hide();

                // Adding a Form takes extra effort
                if (controlIsForm == null)
                {
                    // Monitor focus changes on the Control
                    page.Control.GotFocus += new EventHandler(OnPageEnter);
                    page.Control.LostFocus += new EventHandler(OnPageLeave);
                    page.Control.MouseEnter += new EventHandler(OnPageMouseEnter);
                    page.Control.MouseLeave += new EventHandler(OnPageMouseLeave);

                    // Must fill the entire hosting panel it is on
                    page.Control.Dock = DockStyle.None;

                    // Set correct size
                    page.Control.Location = new Point(0, 0);
                    page.Control.Size = _hostPanel.Size;

                    _hostPanel.Controls.Add(page.Control);
                }
                else
                {
                    // Monitor activation changes on the TabPageAdvanced
                    controlIsForm.Activated += new EventHandler(OnPageEnter);
                    controlIsForm.Deactivate += new EventHandler(OnPageLeave);
                    controlIsForm.MouseEnter += new EventHandler(OnPageMouseEnter);
                    controlIsForm.MouseLeave += new EventHandler(OnPageMouseLeave);

                    // Have to ensure the Form is not a top level form
                    controlIsForm.TopLevel = false;

                    // We are the new parent of this form
                    controlIsForm.Parent = _hostPanel;

                    // To prevent user resizing the form manually and prevent
                    // the caption bar appearing, we use the 'None' border style.
                    controlIsForm.FormBorderStyle = FormBorderStyle.None;

                    // Must fill the entire hosting panel it is on
                    controlIsForm.Dock = DockStyle.None;

                    // Set correct size
                    controlIsForm.Location = new Point(0, 0);
                    controlIsForm.Size = _hostPanel.Size;
                }

                // Need to monitor when the Form/Panel is clicked
                if ((page.Control is Form) || (page.Control is Panel))
                    page.Control.MouseDown += new MouseEventHandler(OnPageMouseDown);

                RecursiveMonitor(page.Control, true);
            }
            else
            {
                page.Hide();

                // Monitor focus changes on the TabPageAdvanced
                page.GotFocus += new EventHandler(OnPageEnter);
                page.LostFocus += new EventHandler(OnPageLeave);
                page.MouseEnter += new EventHandler(OnPageMouseEnter);
                page.MouseLeave += new EventHandler(OnPageMouseLeave);

                // Must fill the entire hosting panel it is on
                page.Dock = DockStyle.None;

                // Need to monitor when the Panel is clicked
                page.MouseDown += new MouseEventHandler(OnPageMouseDown);

                RecursiveMonitor(page, true);

                // Set correct size
                page.Location = new Point(0, 0);
                page.Size = _hostPanel.Size;

                // Add the TabPageAdvanced itself instead
                _hostPanel.Controls.Add(page);
            }
        }

        /// <summary>
        /// Unhosts the page's control or form and unhooks the events hooked up in
        /// <see cref="AddTabPage"/>.
        /// </summary>
        /// <param name="page">The page to remove.</param>
        protected virtual void RemoveTabPage(TabPageAdvanced page)
        {
            // Remove user supplied control
            if (page.Control != null)
            {
                RecursiveMonitor(page.Control, false);

                Form controlIsForm = page.Control as Form;

                // Need to unhook hooked up event
                if ((page.Control is Form) || (page.Control is Panel))
                    page.Control.MouseDown -= new MouseEventHandler(OnPageMouseDown);

                if (controlIsForm == null)
                {
                    // Unhook event monitoring
                    page.Control.GotFocus -= new EventHandler(OnPageEnter);
                    page.Control.LostFocus -= new EventHandler(OnPageLeave);
                    page.Control.MouseEnter -= new EventHandler(OnPageMouseEnter);
                    page.Control.MouseLeave -= new EventHandler(OnPageMouseLeave);

                    // Use helper method to circumvent form Close bug
                    ControlHelper.Remove(_hostPanel.Controls, page.Control);
                }
                else
                {
                    // Unhook activation monitoring
                    controlIsForm.Activated -= new EventHandler(OnPageEnter);
                    controlIsForm.Deactivate -= new EventHandler(OnPageLeave);
                    controlIsForm.MouseEnter -= new EventHandler(OnPageMouseEnter);
                    controlIsForm.MouseLeave -= new EventHandler(OnPageMouseLeave);

                    // Remove Form but prevent the Form close bug
                    ControlHelper.RemoveForm(_hostPanel, controlIsForm);
                }
            }
            else
            {
                RecursiveMonitor(page, false);

                // Need to unhook hooked up event
                page.MouseDown -= new MouseEventHandler(OnPageMouseDown);

                // Unhook event monitoring
                page.GotFocus -= new EventHandler(OnPageEnter);
                page.LostFocus -= new EventHandler(OnPageLeave);
                page.MouseEnter -= new EventHandler(OnPageMouseEnter);
                page.MouseLeave -= new EventHandler(OnPageMouseLeave);

                // Use helper method to circumvent form Close bug
                ControlHelper.Remove(_hostPanel.Controls, page);
            }
        }

        /// <summary>
        /// Gives focus to a hosted control when it is clicked and does not already have focus.
        /// </summary>
        /// <param name="sender">The clicked control.</param>
        /// <param name="e">The mouse event data.</param>
        protected virtual void OnPageMouseDown(object sender, MouseEventArgs e)
        {
            Control c = sender as Control;

            // If the mouse has been clicked and it does not have 
            // focus then it should receive the focus immediately.
            if (!c.ContainsFocus)
                c.Focus();
        }

        /// <summary>
        /// Recursively hooks or unhooks focus and mouse event handlers on all descendants of
        /// the given control.
        /// </summary>
        /// <param name="top">The root control whose descendants are processed.</param>
        /// <param name="monitor">True to hook handlers, false to unhook them.</param>
        protected virtual void RecursiveMonitor(Control top, bool monitor)
        {
            foreach (Control c in top.Controls)
            {
                if (monitor)
                {
                    // Monitor focus changes on the Control
                    c.GotFocus += new EventHandler(OnPageEnter);
                    c.LostFocus += new EventHandler(OnPageLeave);
                    c.MouseEnter += new EventHandler(OnPageMouseEnter);
                    c.MouseLeave += new EventHandler(OnPageMouseLeave);
                }
                else
                {
                    // Unmonitor focus changes on the Control
                    c.GotFocus -= new EventHandler(OnPageEnter);
                    c.LostFocus -= new EventHandler(OnPageLeave);
                    c.MouseEnter -= new EventHandler(OnPageMouseEnter);
                    c.MouseLeave -= new EventHandler(OnPageMouseLeave);
                }

                RecursiveMonitor(c, monitor);
            }
        }

        /// <summary>
        /// Handles a hosted page gaining focus by raising <see cref="PageGotFocus"/>.
        /// </summary>
        /// <param name="sender">The source of the event.</param>
        /// <param name="e">The event data.</param>
        protected virtual void OnPageEnter(object sender, EventArgs e)
        {
            OnPageGotFocus(e);
        }

        /// <summary>
        /// Handles a hosted page losing focus by raising <see cref="PageLostFocus"/>.
        /// </summary>
        /// <param name="sender">The source of the event.</param>
        /// <param name="e">The event data.</param>
        protected virtual void OnPageLeave(object sender, EventArgs e)
        {
            OnPageLostFocus(e);
        }

        /// <summary>
        /// Handles the mouse entering a hosted page and updates the mouse-over state.
        /// </summary>
        /// <param name="sender">The source of the event.</param>
        /// <param name="e">The event data.</param>
        protected virtual void OnPageMouseEnter(object sender, EventArgs e)
        {
            _mouseOver = true;
            _overTimer.Stop();

            if (_hideTabsMode == HideTabsModes.HideWithoutMouse)
            {
                Recalculate();
                Invalidate();
            }
        }

        /// <summary>
        /// Handles the mouse leaving a hosted page by starting the leave timer.
        /// </summary>
        /// <param name="sender">The source of the event.</param>
        /// <param name="e">The event data.</param>
        protected virtual void OnPageMouseLeave(object sender, EventArgs e)
        {
            _overTimer.Start();
        }

        /// <summary>
        /// Handles the leave timer tick, clearing the mouse-over state and updating the display.
        /// </summary>
        /// <param name="sender">The source of the event.</param>
        /// <param name="e">The event data.</param>
        protected virtual void OnMouseTick(object sender, EventArgs e)
        {
            _mouseOver = false;
            _overTimer.Stop();

            if (_hideTabsMode == HideTabsModes.HideWithoutMouse)
            {
                Recalculate();
                Invalidate();
            }
        }

        /// <summary>
        /// Responds to a change in a tab page property, updating hosting, layout, or selection
        /// as appropriate.
        /// </summary>
        /// <param name="page">The page whose property changed.</param>
        /// <param name="prop">The property that changed.</param>
        /// <param name="oldValue">The previous value of the property.</param>
        protected virtual void OnPagePropertyChanged(TabPageAdvanced page, TabPageAdvanced.Property prop, object oldValue)
        {
            switch (prop)
            {
                case TabPageAdvanced.Property.Control:
                    Control pageControl = oldValue as Control;

                    // Is there a Control to be removed?
                    if (pageControl != null)
                    {
                        // Use helper method to circumvent form Close bug
                        ControlHelper.Remove(this.Controls, pageControl);
                    }
                    else
                    {
                        // Use helper method to circumvent form Close bug
                        ControlHelper.Remove(this.Controls, page); // remove the whole TabPageAdvanced instead
                    }

                    // Add the appropriate Control/Form/TabPageAdvanced to the control
                    AddTabPage(page);

                    // Is a page currently selected?
                    if (_pageSelected != -1)
                    {
                        // Is the change in Control for this page?
                        if (page == _tabPages[_pageSelected])
                            SelectPage(page);   // make Control visible
                    }

                    Recalculate();
                    Invalidate();
                    break;
                case TabPageAdvanced.Property.Title:
                case TabPageAdvanced.Property.ImageIndex:
                case TabPageAdvanced.Property.ImageList:
                case TabPageAdvanced.Property.Icon:
                case TabPageAdvanced.Property.TabWidth:

                    _recalculate = true;
                    Invalidate();
                    break;
                case TabPageAdvanced.Property.IconFrame:
                    Invalidate();
                    break;
                case TabPageAdvanced.Property.Selected:
                    // Becoming selected?
                    if (page.Selected)
                    {
                        // Move selection to the new page and update page properties
                        MovePageSelection(page);
                        MakePageVisible(page);
                    }
                    break;
            }
        }

        /// <summary>
        /// Recursively searches the given control tree for the control that currently has focus.
        /// </summary>
        /// <param name="root">The root control to search from.</param>
        /// <returns>The focused control, or null if none has focus.</returns>
        protected virtual Control FindFocus(Control root)
        {
            // Does the root control has focus?
            if (root.Focused)
                return root;

            // Check for focus at each child control
            foreach (Control c in root.Controls)
            {
                Control child = FindFocus(c);

                if (child != null)
                    return child;
            }

            return null;
        }

        /// <summary>
        /// Deselects and hides the given page, optionally recording which control had focus.
        /// </summary>
        /// <param name="page">The page to deselect.</param>
        protected virtual void DeselectPage(TabPageAdvanced page)
        {
            page.Selected = false;

            // Hide any associated control
            if (page.Control != null)
            {
                // Should we remember which control had focus when leaving?
                if (_recordFocus)
                {
                    // Record current focus location on Control
                    if (page.Control.ContainsFocus)
                        page.StartFocus = FindFocus(page.Control);
                    else
                        page.StartFocus = null;
                }

                page.Control.Hide();
            }
            else
            {
                // Should we remember which control had focus when leaving?
                if (_recordFocus)
                {
                    // Record current focus location on Control
                    if (page.ContainsFocus)
                        page.StartFocus = FindFocus(page);
                    else
                        page.StartFocus = null;
                }
                page.Hide();
            }
        }

        /// <summary>
        /// Selects the given page and brings its control or form to the front.
        /// </summary>
        /// <param name="page">The page to select.</param>
        protected virtual void SelectPage(TabPageAdvanced page)
        {
            page.Selected = true;

            // Bring the control for this page to the front
            if (page.Control != null)
                HandleShowingTabPage(page, page.Control);
            else
                HandleShowingTabPage(page, page);
        }

        /// <summary>
        /// Shows the control for a page, working around auto-scaling issues on first display
        /// and restoring focus.
        /// </summary>
        /// <param name="page">The page being shown.</param>
        /// <param name="c">The control or form to show.</param>
        protected virtual void HandleShowingTabPage(TabPageAdvanced page, Control c)
        {
            // First time this page has been displayed?
            if (!page.Shown)
            {
                // Special testing needed for Forms
                Form f = c as Form;

                // AutoScaling can cause the Control/Form to be
                if ((f != null) && (f.AutoScaleMode != System.Windows.Forms.AutoScaleMode.None))
                {
                    // Workaround the problem where a form has a defined 'AutoScaleBaseSize' value. The 
                    // first time it is shown it calculates the size of each contained control and scales 
                    // as needed. But if the contained control is Dock=DockStyle.Fill it scales up/down so 
                    // its not actually filling the space! Get around by hiding and showing to force correct 
                    // calculation.
                    c.Show();
                    c.Hide();
                }

                // Only need extra logic first time around
                page.Shown = true;
            }

            // Finally, show it!
            c.Show();

            // Restore focus to last know control to have it
            if (page.StartFocus != null)
                page.StartFocus.Focus();
            else
            {
                c.Focus();
            }
        }

        /// <summary>
        /// Moves the selection to the given page, raising the selection changing and changed
        /// events and updating the layout.
        /// </summary>
        /// <param name="page">The page to select.</param>
        protected virtual void MovePageSelection(TabPageAdvanced page)
        {
            int pageIndex = _tabPages.IndexOf(page);

            if (!AllowLastTabReordering)
            {
                if (pageIndex == _tabPages.Count - 1)
                    _leftMouseDown = false;
            }
            if (pageIndex != _pageSelected)
            {

                // Raise selection changing event
                OnSelectionChanging(this, new CancelArgs(page));

                // Any page currently selected?
                if (_pageSelected != -1)
                    DeselectPage(_tabPages[_pageSelected]);

                _pageSelected = pageIndex;

                if (_pageSelected != -1)
                    SelectPage(_tabPages[_pageSelected]);

                // Change in selection causes tab pages sizes to change
                if (_boldSelected || _selectedTextOnly || !_shrinkPagesToFit || _multiline)
                {
                    Recalculate();
                    Invalidate();
                }

                // Raise selection change event
                OnSelectionChanged(EventArgs.Empty);

                Invalidate();
            }
        }

        // Used by the TabControlDesigner
        internal bool WantDoubleClick(IntPtr hWnd, Point mousePos)
        {
            return ControlWantDoubleClick(hWnd, mousePos, _leftArrow) ||
                   ControlWantDoubleClick(hWnd, mousePos, _rightArrow) ||
                   ControlWantDoubleClick(hWnd, mousePos, _dropDownButton) ||
                   ControlWantDoubleClick(hWnd, mousePos, _closeButton);
        }

        // Used by the TabControlDesigner
        internal void ExternalMouseTest(IntPtr hWnd, Point mousePos)
        {
            if (!(ControlMouseTest(hWnd, mousePos, _leftArrow) ||
                  ControlMouseTest(hWnd, mousePos, _rightArrow) ||
                  ControlMouseTest(hWnd, mousePos, _dropDownButton) ||
                  ControlMouseTest(hWnd, mousePos, _closeButton)))
                InternalMouseDown(mousePos);
        }

        /// <summary>
        /// Determines whether a double-click at the given position belongs to the specified
        /// button, invoking its action when appropriate.
        /// </summary>
        /// <param name="hWnd">The window handle that received the double-click.</param>
        /// <param name="mousePos">The mouse position of the double-click.</param>
        /// <param name="check">The button control to test.</param>
        /// <returns>True if the double-click was over the button.</returns>
        protected virtual bool ControlWantDoubleClick(IntPtr hWnd, Point mousePos, Control check)
        {
            // Cannot have double click if control not visible
            if (check.Visible)
            {
                // Is double click for this control?
                if (check.Enabled && (hWnd == check.Handle))
                {
                    if (check == _leftArrow)
                        OnLeftArrow(null, EventArgs.Empty);

                    if (check == _rightArrow)
                        OnRightArrow(null, EventArgs.Empty);

                    return true;
                }
                else
                {
                    // Create rectangle for control position
                    Rectangle checkRect = new Rectangle(check.Location.X,
                                                        check.Location.Y,
                                                        check.Width,
                                                        check.Height);

                    // Was double click over a disabled button?
                    if (checkRect.Contains(mousePos))
                        return true;
                }
            }

            return false;
        }

        /// <summary>
        /// Determines whether a mouse click at the given position belongs to the specified
        /// button, invoking its action when appropriate.
        /// </summary>
        /// <param name="hWnd">The window handle that received the click.</param>
        /// <param name="mousePos">The mouse position of the click.</param>
        /// <param name="check">The button control to test.</param>
        /// <returns>True if the click was over the enabled button.</returns>
        protected virtual bool ControlMouseTest(IntPtr hWnd, Point mousePos, Control check)
        {
            // Is the mouse down for the left arrow window and is it valid to click?
            if ((hWnd == check.Handle) && check.Visible && check.Enabled)
            {
                // Check if the mouse click is over the left arrow
                if (check.ClientRectangle.Contains(mousePos))
                {
                    if (check == _leftArrow)
                        OnLeftArrow(null, EventArgs.Empty);

                    if (check == _rightArrow)
                        OnRightArrow(null, EventArgs.Empty);

                    return true;
                }
            }

            return false;
        }

        /// <summary>
        /// Handles a double-click on the control.
        /// </summary>
        /// <param name="e">The event data.</param>
        protected override void OnDoubleClick(EventArgs e)
        {
            /* Point pos = TabControlAdvanced.MousePosition;

             int count = _tabRects.Count;

             for (int index = 0; index < count; index++)
             {
                 // Get tab drawing rectangle
                 Rectangle local = (Rectangle)_tabRects[index];

                 // If drawing on the control
                 if (local != _nullPosition)
                 {
                     // Convert from Control to screen coordinates
                     Rectangle screen = this.RectangleToScreen(local);

                     if (screen.Contains(pos))
                     {
                         // Generate appropriate event
                         OnDoubleClickTab(_tabPages[index]);
                         break;
                     }
                 }
             }*/

            base.OnDoubleClick(e);
        }




        /// <summary>
        /// Handles the mouse button being released, completing page close, drag, reorder, or
        /// context menu actions.
        /// </summary>
        /// <param name="e">The mouse event data.</param>
        protected override void OnMouseUp(MouseEventArgs e)
        {
            Capture = false;
            _leftMouseDown = false;
            Point mousePos = new Point(e.X, e.Y);

            if (_reorderingtab)
            {
                _reorderingtab = false;
                ExecuteReOrdertab(mousePos);
                this.Update();
                this.Invalidate();
                OnMouseMove(e);
                return;
            }

            if (e.Button == MouseButtons.Left)
            {
                // Check for page close
                for (int i = 0; i < _tabPages.Count; i++)
                {
                    Rectangle rect = (Rectangle)_tabRects[i];

                    if (rect.Contains(mousePos))
                    {
                        if ((_showCloseIndividual) && (_tabPages[i].CanClose))
                        {
                            if (mousePos.X > (rect.Right - _buttonWidth))
                            {
                                _leftMouseDown = false;
                                OnClosePressed(new CancelArgs(_tabPages[i]));
                                _hotTrackPage = -1;
                                _hotTrackPageHightlightClose = false;
                                this.Update();
                                OnMouseMove(e);
                                return;
                            }
                        }
                    }
                }
            }


            if (_leftMouseDownDrag)
            {
                // Generate event for interested parties
                if (e.Button == MouseButtons.Left)
                    OnPageDragEnd(e);
                else
                    OnPageDragQuit(e);

                _leftMouseDownDrag = false;
                _ignoreDownDrag = true;
            }

            if (e.Button == MouseButtons.Left)
            {
                // Exit any page dragging attempt
                _leftMouseDown = false;
            }
            else
            {
                // Is it the button that causes context menu to show?
                if (e.Button == MouseButtons.Right)
                {

                    // Is the mouse in the tab area
                    if (_tabsAreaRect.Contains(mousePos))
                    {
                        CancelEventArgs ce = new CancelEventArgs();

                        // Generate event giving handlers cancel to update/cancel menu
                        OnPopupMenuDisplay(ce);

                        // Still want the popup?
                        if (!ce.Cancel)
                        {
                            // Is there any attached menu to show
                            if (_contextMenu != null)
                                _contextMenu.Show(this.PointToScreen(new Point(e.X, e.Y)));
                        }
                    }
                }
            }

            base.OnMouseUp(e);
        }

        /// <summary>
        /// Handles the mouse button being pressed on the control.
        /// </summary>
        /// <param name="e">The mouse event data.</param>
        protected override void OnMouseDown(MouseEventArgs e)
        {
            // Only select a button or page when using left mouse button
            InternalMouseDown(new Point(e.X, e.Y));

            base.OnMouseDown(e);
        }
        bool moving = false;
        Point toolbarorigin;
        /// <summary>
        /// Handles a mouse-down at the given position, selecting the clicked tab or beginning
        /// a form move on an empty area.
        /// </summary>
        /// <param name="mousePos">The mouse position in client coordinates.</param>
        protected virtual void InternalMouseDown(Point mousePos)
        {
            moving = false;
            if (Control.MouseButtons == MouseButtons.Left)
            {
                _reorderingtab = false;
            }
            bool clickedonbar = true;
            // Clicked on a tab page?
            for (int i = 0; i < _tabPages.Count; i++)
            {
                Rectangle rect = (Rectangle)_tabRects[i];

                if (rect.Contains(mousePos))
                {
                    clickedonbar = false;
                    if ((_showCloseIndividual) && (_tabPages[i].CanClose))
                    {
                        if (mousePos.X > rect.Left + rect.Width - _buttonWidth)
                            return;
                    }

                    // Are the scroll buttons being shown?
                    if (_leftArrow.Visible)
                    {
                        // Ignore mouse down over then buttons area
                        if (mousePos.X >= _leftArrow.Left)
                            break;
                    }
                    else
                    {
                        // No, is the close button visible?
                        if (_closeButton.Visible)
                        {
                            // Ignore mouse down over then close button area
                            if ((mousePos.X >= _closeButton.Left) && (_tabPages[i].CanClose))
                                break;
                        }
                        else
                        {
                            if (_dropDownButton.Visible)
                            {
                                // Ignore mouse down over then dropdown button area
                                if (mousePos.X >= _dropDownButton.Left)
                                    break;
                            }
                        }
                    }

                    // Remember where the left mouse was initially pressed
                    if (Control.MouseButtons == MouseButtons.Left)
                    {
                        _leftMouseDown = true;
                        _ignoreDownDrag = false;
                        _leftMouseDownDrag = false;
                        _leftMouseDownPos = mousePos;
                        Capture = true;
                    }

                    MovePageSelection(_tabPages[i]);
                    MakePageVisible(_tabPages[i]);
                    break;
                }
            }
            if (clickedonbar && EmptyMoveForm)
            {
                toolbarorigin = mousePos;
                Capture = true;
                moving = true;
            }
        }
        private void ExecuteReOrdertab(Point mousePos)
        {
            Rectangle? rectTabSelected = null;
            int selectedIndex = -1;
            for (int i = 0; i < TabPages.Count; i++)
            {
                TabPageAdvanced page = TabPages[i];
                if (SelectedTab == page)
                {
                    rectTabSelected = (Rectangle)_tabRects[i];
                    selectedIndex = i;
                    break;
                }
            }
            if (rectTabSelected == null)
                return;
            int replaceIndex = -1;
            for (int i = 0; i < TabPages.Count; i++)
            {
                bool checktab = true;
                if (i == TabPages.Count - 1)
                    if (!AllowLastTabReordering)
                        checktab = false;
                TabPageAdvanced page = TabPages[i];
                if (SelectedTab == page)
                    checktab = false;
                if (i == selectedIndex)
                    checktab = false;
                if (checktab)
                {
                    Rectangle rectTab = (Rectangle)_tabRects[i];
                    int newx = rectTabSelected.Value.Left + mousePos.X - _leftMouseDownPos.X + rectTabSelected.Value.Width / 2;
                    if (newx < 0)
                        newx = 0;
                    if (newx + rectTabSelected.Value.Width > Width)
                        newx = Width - rectTabSelected.Value.Width;
                    if ((newx > rectTab.Left + rectTab.Width / 3) && (newx < rectTab.Left + rectTab.Width * 2 / 3))
                    {
                        replaceIndex = i;
                        break;
                    }
                }
            }
            if (replaceIndex >= 0)
            {
                Rectangle rectTabreplaced = (Rectangle)_tabRects[replaceIndex];
                Rectangle rectTabsesected = (Rectangle)_tabRects[selectedIndex];
                _leftMouseDownPos = new Point(_leftMouseDownPos.X + rectTabreplaced.Left - rectTabsesected.Left
                    , _leftMouseDownPos.Y);

                _tabPages.Switch(selectedIndex, replaceIndex);
                _pageSelected = replaceIndex;
                Recalculate();
            }
        }
        private void GetHighLightStatus(TabPageAdvanced page, ref bool highlighttext, ref bool highlightclose)
        {
            Point mousePos = Cursor.Position;
            mousePos = this.PointToClient(mousePos);
            GetHighLightStatus(page, ref highlighttext, ref highlightclose, mousePos);
        }
        private void GetHighLightStatus(TabPageAdvanced page, ref bool highlighttext, ref bool highlightclose, Point mousePos)
        {
            Rectangle rect = new Rectangle();
            highlightclose = false;
            highlighttext = false;
            int mousePage = -1;
            // Find the page this mouse point is inside
            for (int pos = 0; pos < _tabPages.Count; pos++)
            {
                rect = (Rectangle)_tabRects[pos];

                if (rect.Contains(mousePos))
                {
                    mousePage = pos;
                    break;
                }
            }
            if (mousePage < 0)
                return;
            if (_tabPages[mousePage] != page)
                return;
            highlighttext = true;
            if (rect.Contains(mousePos))
            {

                if ((_showCloseIndividual) && (_tabPages[mousePage].CanClose))
                {
                    if (mousePos.X > (rect.Right - _buttonWidth))
                    {
                        highlightclose = true;
                        if (_leftArrow.Visible)
                        {
                            // Ignore mouse down over then buttons area
                            if (mousePos.X >= _leftArrow.Left)
                                highlightclose = false;
                        }
                        else
                        {
                            // No, is the close button visible?
                            if (_closeButton.Visible)
                            {
                                // Ignore mouse down over then close button area
                                if ((mousePos.X >= _closeButton.Left) && (_tabPages[mousePage].CanClose))
                                    highlightclose = false;
                            }
                            else
                            {
                                if (_dropDownButton.Visible)
                                {
                                    // Ignore mouse down over then dropdown button area
                                    if (mousePos.X >= _dropDownButton.Left)
                                        highlightclose = false;
                                }
                            }

                        }
                    }
                }
            }
        }
        /// <summary>
        /// Handles a double-click, raising <see cref="DoubleClickTab"/> for a tab or toggling
        /// the hosting title-less form's maximize state.
        /// </summary>
        /// <param name="e">The mouse event data.</param>
        protected override void OnMouseDoubleClick(MouseEventArgs e)
        {
            Point pos = this.PointToScreen(new Point(e.X, e.Y));

            bool insidetab = false;
            int count = _tabRects.Count;

            for (int index = 0; index < count; index++)
            {
                // Get tab drawing rectangle
                Rectangle local = (Rectangle)_tabRects[index];

                // If drawing on the control
                if (local != _nullPosition)
                {
                    // Convert from Control to screen coordinates
                    Rectangle screen = this.RectangleToScreen(local);

                    if (screen.Contains(pos))
                    {
                        // Generate appropriate event
                        OnDoubleClickTab(_tabPages[index]);
                        insidetab = true;
                        break;
                    }
                }
            }
            if (!insidetab)
            {
                Form nform = this.FindForm();
                if (nform != null)
                {
                    if (nform is NoTitleForm)
                    {
                        NoTitleForm notitleform = (NoTitleForm)nform;
                        if (!notitleform.ShowTitle)
                        {
                            // Check position
                            notitleform.SwitchMaximizeMinimize();
                        }
                    }
                }
            }
            base.OnMouseDoubleClick(e);
        }
        /// <summary>
        /// Windows message code for a non-client left mouse button down.
        /// </summary>
        public const int WM_NCLBUTTONDOWN = 0xA1;
        /// <summary>
        /// Windows message code for a non-client left mouse button up.
        /// </summary>
        public const int WM_NCLBUTTONUP = 0xA2;
        /// <summary>
        /// Hit-test code identifying the window caption area.
        /// </summary>
        public const int HT_CAPTION = 0x2;

        /// <summary>
        /// Sends the specified Windows message to the given window (P/Invoke to user32).
        /// </summary>
        /// <param name="hWnd">The target window handle.</param>
        /// <param name="Msg">The message identifier.</param>
        /// <param name="wParam">The first message parameter.</param>
        /// <param name="lParam">The second message parameter.</param>
        /// <returns>The message-dependent result.</returns>
        [DllImportAttribute("user32.dll")]
        public static extern int SendMessage(IntPtr hWnd, int Msg, int wParam, int lParam);
        /// <summary>
        /// Releases the mouse capture from the current window (P/Invoke to user32).
        /// </summary>
        /// <returns>True if the capture was released successfully.</returns>
        [DllImportAttribute("user32.dll")]
        public static extern bool ReleaseCapture();

        /// <summary>
        /// Handles mouse movement, driving form dragging, tab reordering, page dragging, and
        /// hot tracking.
        /// </summary>
        /// <param name="e">The mouse event data.</param>
        protected override void OnMouseMove(MouseEventArgs e)
        {

            if ((Capture) && (moving))
            {
                moving = false;
                ReleaseCapture();
                SendMessage(this.FindForm().Handle, WM_NCLBUTTONDOWN, HT_CAPTION, 0);
                /*Point newlocation = e.Location;
                int difx = newlocation.X - toolbarorigin.X;
                int dify = newlocation.Y - toolbarorigin.Y;
                SetBounds(Left + difx, Top + dify, Width, Height);*/
                //toolbarorigin = e.Location;
            }

            if (_leftMouseDown)
            {
                if (AllowTabReordering)
                {
                    if (!_reorderingtab)
                    {
                        if (Math.Abs(_leftMouseDownPos.X - e.X) > _MouseOffsetTriggerReorder)
                        {

                            _reorderingtab = true;
                        }
                    }
                    if (_reorderingtab)
                    {
                        ExecuteReOrdertab(new Point(e.X, e.Y));
                        _recalculate = true;
                        this.Invalidate();
                        return;
                    }
                }
                if (!_leftMouseDownDrag)
                {
                    Point thisPosition = new Point(e.X, e.Y);

                    bool startDrag = false;

                    if (_dragFromControl)
                        startDrag = !this.ClientRectangle.Contains(thisPosition);
                    else
                    {
                        // Create starting mouse down position
                        Rectangle dragRect = new Rectangle(_leftMouseDownPos, new Size(0, 0));

                        // Expand by size of the double click area
                        dragRect.Inflate(SystemInformation.DoubleClickSize);

                        // Drag when mouse moves outside the double click area
                        startDrag = !dragRect.Contains(thisPosition);
                    }

                    if (startDrag && !_ignoreDownDrag)
                    {
                        // Generate event for interested parties
                        OnPageDragStart(e);

                        // Enter dragging mode
                        _leftMouseDownDrag = true;
                    }
                }
                else
                {
                    // Generate event for interested parties
                    OnPageDragMove(e);
                }
            }
            else
            {
                if (_hotTrack || _hoverSelect)
                {
                    int mousePage = -1;
                    bool pageChanged = false;

                    // Create a point representing current mouse position
                    Point mousePos = new Point(e.X, e.Y);
                    Rectangle rect = new Rectangle();
                    // Find the page this mouse point is inside
                    for (int pos = 0; pos < _tabPages.Count; pos++)
                    {
                        rect = (Rectangle)_tabRects[pos];

                        if (rect.Contains(mousePos))
                        {
                            mousePage = pos;
                            break;
                        }
                    }

                    // Should moving over a tab cause selection changes?
                    if (_hoverSelect && !_multiline && (mousePage != -1))
                    {
                        // Has the selected page changed?
                        if (mousePage != _pageSelected)
                        {
                            // Move selection to new page
                            MovePageSelection(_tabPages[mousePage]);

                            pageChanged = true;
                        }
                    }
                    bool hightlightClose = false;
                    if (mousePage >= 0)
                    {
                        if (rect.Contains(mousePos))
                        {

                            if ((_showCloseIndividual) && (_tabPages[mousePage].CanClose))
                            {
                                if (mousePos.X > (rect.Right - _buttonWidth))
                                {
                                    hightlightClose = true;
                                    if (_leftArrow.Visible)
                                    {
                                        // Ignore mouse down over then buttons area
                                        if (mousePos.X >= _leftArrow.Left)
                                            hightlightClose = false;
                                    }
                                    else
                                    {
                                        // No, is the close button visible?
                                        if (_closeButton.Visible)
                                        {
                                            // Ignore mouse down over then close button area
                                            if ((mousePos.X >= _closeButton.Left) && (_tabPages[mousePage].CanClose))
                                                hightlightClose = false;
                                        }
                                        else
                                        {
                                            if (_dropDownButton.Visible)
                                            {
                                                // Ignore mouse down over then dropdown button area
                                                if (mousePos.X >= _dropDownButton.Left)
                                                    hightlightClose = false;
                                            }
                                        }

                                    }
                                }
                            }
                        }
                    }

                    if (_hotTrack)
                    {
                        if (_hotTrackPage >= _tabPages.Count)
                        {
                            _hotTrack = false;
                            _hotTrackPage = -1;
                        }
                    }


                    if (_hotTrack && !pageChanged && ((mousePage != _hotTrackPage) || (hightlightClose != _hotTrackPageHightlightClose)))
                    {
                        Graphics g = this.CreateGraphics();

                        // Clip the drawing to prevent drawing in unwanted areas
                        ClipDrawingTabs(g);

                        // Remove highlight of old page
                        if (_hotTrackPage != -1)
                        {
                            DrawTab(_tabPages[_hotTrackPage], g, false, false);
                            if ((!_tabPages[_hotTrackPage].Selected) && (mousePage == -1))
                            {
                                DrawTab(SelectedTab, g, false, false);
                            }
                        }

                        _hotTrackPage = mousePage;
                        _hotTrackPageHightlightClose = hightlightClose;

                        // Add highlight to new page
                        if (_hotTrackPage != -1)
                        {
                            DrawTab(_tabPages[_hotTrackPage], g, true, hightlightClose);




                            if (!_tabPages[_hotTrackPage].Selected)
                            {
                                DrawTab(this.SelectedTab, g, false, false);
                            }
                        }
                        // Must correctly release resource
                        g.Dispose();
                    }
                }
            }

            base.OnMouseMove(e);
        }

        /// <summary>
        /// Handles the mouse entering the control and updates the mouse-over state.
        /// </summary>
        /// <param name="e">The event data.</param>
        protected override void OnMouseEnter(EventArgs e)
        {
            _mouseOver = true;
            _overTimer.Stop();

            base.OnMouseEnter(e);
        }

        /// <summary>
        /// Handles the mouse leaving the control, clearing hot tracking and starting the
        /// leave timer.
        /// </summary>
        /// <param name="e">The event data.</param>
        protected override void OnMouseLeave(EventArgs e)
        {
            if (_hotTrack)
            {
                int newTrackPage = -1;

                if (newTrackPage != _hotTrackPage)
                {
                    Graphics g = this.CreateGraphics();

                    // Clip the drawing to prevent drawing in unwanted areas
                    ClipDrawingTabs(g);

                    // Remove highlight of old page
                    if (_hotTrackPage != -1)
                    {
                        DrawTab(_tabPages[_hotTrackPage], g, false, false);
                        if (!_tabPages[_hotTrackPage].Selected)
                        {
                            DrawTab(this.SelectedTab, g, false, false);
                        }
                    }
                    else
                        if (SelectedTab != null)
                            DrawTab(this.SelectedTab, g, false, false);

                    _hotTrackPage = newTrackPage;

                    // Must correctly release resource
                    g.Dispose();
                }
            }

            _overTimer.Start();

            base.OnMouseLeave(e);
        }

        /// <summary>
        /// Handles a system user-preference change by re-applying the default menu font when
        /// in use.
        /// </summary>
        /// <param name="sender">The source of the event.</param>
        /// <param name="e">The preference changed event data.</param>
        protected virtual void OnPreferenceChanged(object sender, UserPreferenceChangedEventArgs e)
        {
            // Are we using the default menu or a user defined value?
            if (_defaultFont)
            {
                DefineFont(SystemInformation.MenuFont);

                Recalculate();
                Invalidate();
            }
        }

        /// <summary>
        /// Handles a system color change by re-applying the default background color when
        /// in use.
        /// </summary>
        /// <param name="e">The event data.</param>
        protected override void OnSystemColorsChanged(EventArgs e)
        {
            // If still using the Default color when we were created
            if (_defaultColor)
            {
                DefineBackColor(TabControlAdvanced.DefaultBackColor);

                Recalculate();
                Invalidate();
            }

            base.OnSystemColorsChanged(e);
        }

    }
    /// <summary>
    /// A strongly typed, event-raising collection of <see cref="TabPageAdvanced"/> pages
    /// belonging to a <see cref="TabControlAdvanced"/>, with lookup by index or title.
    /// </summary>
    public class TabPageCollection : CollectionWithEvents
    {
        /// <summary>
        /// Adds a page to the collection.
        /// </summary>
        /// <param name="value">The page to add.</param>
        /// <returns>The added page.</returns>
        public TabPageAdvanced Add(TabPageAdvanced value)
        {
            // Use base class to process actual collection operation
            base.List.Add(value as object);

            return value;
        }

        /// <summary>
        /// Adds a range of pages to the collection.
        /// </summary>
        /// <param name="values">The pages to add.</param>
        public void AddRange(TabPageAdvanced[] values)
        {
            // Use existing method to add each array entry
            foreach (TabPageAdvanced page in values)
                Add(page);
        }


        /// <summary>
        /// Removes the given page from the collection.
        /// </summary>
        /// <param name="value">The page to remove.</param>
        public void Remove(TabPageAdvanced value)
        {
            // Use base class to process actual collection operation
            base.List.Remove(value as object);
        }

        /// <summary>
        /// Inserts a page into the collection at the given index.
        /// </summary>
        /// <param name="index">The zero-based index at which to insert.</param>
        /// <param name="value">The page to insert.</param>
        public void Insert(int index, TabPageAdvanced value)
        {
            // Use base class to process actual collection operation
            base.List.Insert(index, value as object);
        }

        /// <summary>
        /// Determines whether the collection contains the given page.
        /// </summary>
        /// <param name="value">The page to locate.</param>
        /// <returns>True if the page is present.</returns>
        public bool Contains(TabPageAdvanced value)
        {
            // Use base class to process actual collection operation
            return base.List.Contains(value as object);
        }

        /// <summary>
        /// Gets the page at the given index.
        /// </summary>
        /// <param name="index">The zero-based index of the page.</param>
        /// <returns>The page at that index.</returns>
        public TabPageAdvanced this[int index]
        {
            // Use base class to process actual collection operation
            get { return (base.List[index] as TabPageAdvanced); }
        }

        /// <summary>
        /// Gets the first page whose title matches the given value, or null if none matches.
        /// </summary>
        /// <param name="title">The title to search for.</param>
        /// <returns>The matching page, or null.</returns>
        public TabPageAdvanced this[string title]
        {
            get
            {
                // Search for a Page with a matching title
                foreach (TabPageAdvanced page in base.List)
                    if (page.Title == title)
                        return page;

                return null;
            }
        }

        /// <summary>
        /// Returns the zero-based index of the given page in the collection.
        /// </summary>
        /// <param name="value">The page to locate.</param>
        /// <returns>The index of the page, or -1 if not found.</returns>
        public int IndexOf(TabPageAdvanced value)
        {
            // Find the 0 based index of the requested entry
            return base.List.IndexOf(value);
        }
    }
    /// <summary>
    /// A lightweight, non-selectable image button drawn from an <see cref="ImageList"/>,
    /// supporting hot-track and pushed states with a flat/popup border, used for the tab
    /// control's close, drop-down, and scroll-arrow buttons.
    /// </summary>
    [ToolboxBitmap(typeof(InertButton))]
    [DefaultProperty("PopupStyle")]
    public class InertButton : Control
    {
        // Instance fields
        /// <summary>
        /// Width in pixels of the button border.
        /// </summary>
        protected int _borderWidth;
        /// <summary>
        /// Whether the mouse is currently over the button.
        /// </summary>
        protected bool _mouseOver;
        /// <summary>
        /// Whether the button currently has the mouse captured (is being pressed).
        /// </summary>
        protected bool _mouseCapture;
        /// <summary>
        /// Whether the button uses a popup-style (raised on hover) border.
        /// </summary>
        protected bool _popupStyle;
        /// <summary>
        /// Index into the image list of the image drawn when enabled.
        /// </summary>
        protected int _imageIndexEnabled;
        /// <summary>
        /// Index into the image list of the image drawn when disabled.
        /// </summary>
        protected int _imageIndexDisabled;
        /// <summary>
        /// Image list from which the button image is drawn.
        /// </summary>
        protected ImageList _imageList;
        /// <summary>
        /// Optional attributes used to modify the drawn image.
        /// </summary>
        protected ImageAttributes _imageAttr;
        /// <summary>
        /// The mouse button that initiated the current press.
        /// </summary>
        protected MouseButtons _mouseButton;

        /// <summary>
        /// Initializes a new instance with no image.
        /// </summary>
        public InertButton()
        {
            InternalConstruct(null, -1, -1, null);
        }

        /// <summary>
        /// Initializes a new instance with an enabled image from the given image list.
        /// </summary>
        /// <param name="imageList">The image list to draw from.</param>
        /// <param name="imageIndexEnabled">The index of the enabled image.</param>
        public InertButton(ImageList imageList, int imageIndexEnabled)
        {
            InternalConstruct(imageList, imageIndexEnabled, -1, null);
        }

        /// <summary>
        /// Initializes a new instance with enabled and disabled images from the given image list.
        /// </summary>
        /// <param name="imageList">The image list to draw from.</param>
        /// <param name="imageIndexEnabled">The index of the enabled image.</param>
        /// <param name="imageIndexDisabled">The index of the disabled image.</param>
        public InertButton(ImageList imageList, int imageIndexEnabled, int imageIndexDisabled)
        {
            InternalConstruct(imageList, imageIndexEnabled, imageIndexDisabled, null);
        }

        /// <summary>
        /// Initializes a new instance with enabled and disabled images and image attributes.
        /// </summary>
        /// <param name="imageList">The image list to draw from.</param>
        /// <param name="imageIndexEnabled">The index of the enabled image.</param>
        /// <param name="imageIndexDisabled">The index of the disabled image.</param>
        /// <param name="imageAttr">Attributes used to modify the drawn image.</param>
        public InertButton(ImageList imageList, int imageIndexEnabled, int imageIndexDisabled, ImageAttributes imageAttr)
        {
            InternalConstruct(imageList, imageIndexEnabled, imageIndexDisabled, imageAttr);
        }

        /// <summary>
        /// Applies the given image settings and configures the button's control styles.
        /// </summary>
        /// <param name="imageList">The image list to draw from.</param>
        /// <param name="imageIndexEnabled">The index of the enabled image.</param>
        /// <param name="imageIndexDisabled">The index of the disabled image.</param>
        /// <param name="imageAttr">Attributes used to modify the drawn image.</param>
        public void InternalConstruct(ImageList imageList,
                                      int imageIndexEnabled,
                                      int imageIndexDisabled,
                                      ImageAttributes imageAttr)
        {
            // Remember parameters
            _imageList = imageList;
            _imageIndexEnabled = imageIndexEnabled;
            _imageIndexDisabled = imageIndexDisabled;
            _imageAttr = imageAttr;

            // Set initial state
            _borderWidth = 2;
            _mouseOver = false;
            _mouseCapture = false;
            _popupStyle = true;
            _mouseButton = MouseButtons.None;

            // Prevent drawing flicker by blitting from memory in WM_PAINT
            SetStyle(ControlStyles.DoubleBuffer, true);
            SetStyle(ControlStyles.AllPaintingInWmPaint, true);

            // Prevent base class from trying to generate double click events and
            // so testing clicks against the double click time and rectangle. Getting
            // rid of this allows the user to press then button very quickly.
            SetStyle(ControlStyles.StandardDoubleClick, false);

            // Should not be allowed to select this control
            SetStyle(ControlStyles.Selectable, false);
        }

        /// <summary>
        /// Gets or sets the image list from which the button image is drawn.
        /// </summary>
        [Category("Appearance")]
        [DefaultValue(null)]
        public ImageList ImageList
        {
            get { return _imageList; }

            set
            {
                if (_imageList != value)
                {
                    _imageList = value;
                    Invalidate();
                }
            }
        }

        /// <summary>
        /// Gets or sets the index of the image drawn when the button is enabled.
        /// </summary>
        [Category("Appearance")]
        [DefaultValue(-1)]
        public int ImageIndexEnabled
        {
            get { return _imageIndexEnabled; }

            set
            {
                if (_imageIndexEnabled != value)
                {
                    _imageIndexEnabled = value;
                    Invalidate();
                }
            }
        }

        /// <summary>
        /// Gets or sets the index of the image drawn when the button is disabled.
        /// </summary>
        [Category("Appearance")]
        [DefaultValue(-1)]
        public int ImageIndexDisabled
        {
            get { return _imageIndexDisabled; }

            set
            {
                if (_imageIndexDisabled != value)
                {
                    _imageIndexDisabled = value;
                    Invalidate();
                }
            }
        }

        /// <summary>
        /// Gets or sets the attributes used to modify the drawn button image.
        /// </summary>
        [Category("Appearance")]
        [DefaultValue(null)]
        public ImageAttributes ImageAttributes
        {
            get { return _imageAttr; }

            set
            {
                if (_imageAttr != value)
                {
                    _imageAttr = value;
                    Invalidate();
                }
            }
        }

        /// <summary>
        /// Gets or sets the width in pixels of the button border.
        /// </summary>
        [Category("Appearance")]
        [DefaultValue(2)]
        public int BorderWidth
        {
            get { return _borderWidth; }

            set
            {
                if (_borderWidth != value)
                {
                    _borderWidth = value;
                    Invalidate();
                }
            }
        }

        /// <summary>
        /// Gets or sets whether the button uses a popup-style border that is raised on hover.
        /// </summary>
        [Category("Appearance")]
        [DefaultValue(true)]
        public bool PopupStyle
        {
            get { return _popupStyle; }

            set
            {
                if (_popupStyle != value)
                {
                    _popupStyle = value;
                    Invalidate();
                }
            }
        }

        /// <summary>
        /// Enters the pressed state and remembers the pressing button.
        /// </summary>
        /// <param name="e">The mouse event data.</param>
        protected override void OnMouseDown(MouseEventArgs e)
        {
            if (!_mouseCapture)
            {
                // Mouse is over the button and being pressed, so enter the button depressed 
                // state and also remember the original button that was pressed. As we only 
                // generate an event when the same button is released.
                _mouseOver = true;
                _mouseCapture = true;
                _mouseButton = e.Button;

                // Redraw to show button state
                Invalidate();
            }

            base.OnMouseDown(e);
        }

        /// <summary>
        /// Leaves the pressed state when the originally pressed button is released.
        /// </summary>
        /// <param name="e">The mouse event data.</param>
        protected override void OnMouseUp(MouseEventArgs e)
        {

            // Are we waiting for this button to go up?
            if (e.Button == _mouseButton)
            {
                // Set state back to become normal
                _mouseOver = false;
                _mouseCapture = false;

                // Redraw to show button state
                Invalidate();
            }
            else
            {
                // We don't want to lose capture of mouse
                Capture = true;
            }

            base.OnMouseUp(e);
        }

        /// <summary>
        /// Updates the mouse-over state as the pointer moves in or out of the button.
        /// </summary>
        /// <param name="e">The mouse event data.</param>
        protected override void OnMouseMove(MouseEventArgs e)
        {
            // Is mouse point inside our client rectangle
            bool over = this.ClientRectangle.Contains(new Point(e.X, e.Y));

            // If entering the button area or leaving the button area...
            if (over != _mouseOver)
            {
                // Update state
                _mouseOver = over;

                // Redraw to show button state
                Invalidate();
            }

            base.OnMouseMove(e);
        }

        /// <summary>
        /// Sets the mouse-over state when the pointer enters the button.
        /// </summary>
        /// <param name="e">The event data.</param>
        protected override void OnMouseEnter(EventArgs e)
        {
            // Update state to reflect mouse over the button area
            _mouseOver = true;

            // Redraw to show button state
            Invalidate();

            base.OnMouseEnter(e);
        }

        /// <summary>
        /// Clears the mouse-over state when the pointer leaves the button.
        /// </summary>
        /// <param name="e">The event data.</param>
        protected override void OnMouseLeave(EventArgs e)
        {
            // Update state to reflect mouse not over the button area
            _mouseOver = false;

            // Redraw to show button state
            Invalidate();

            base.OnMouseLeave(e);
        }

        /// <summary>
        /// Paints the button image (enabled, disabled, or grayed) and its border for the
        /// current state.
        /// </summary>
        /// <param name="e">The paint event data.</param>
        protected override void OnPaint(PaintEventArgs e)
        {
            // Do we have an image list for use?
            if (_imageList != null)
            {
                // Is the button disabled?
                if (!this.Enabled)
                {
                    // Do we have an image for showing when disabled?
                    if (_imageIndexDisabled != -1)
                    {
                        // Any caller supplied attributes to modify drawing?
                        if (null == _imageAttr)
                        {
                            // No, so use the simple DrawImage method
                            e.Graphics.DrawImage(_imageList.Images[_imageIndexDisabled], new Point(1, 1));
                        }
                        else
                        {
                            // Yes, need to use the more complex DrawImage method instead
                            Image image = _imageList.Images[_imageIndexDisabled];

                            // Three points provided are upper-left, upper-right and 
                            // lower-left of the destination parallelogram. 
                            Point[] pts = new Point[3];
                            pts[0].X = 1;
                            pts[0].Y = 1;
                            pts[1].X = pts[0].X + image.Width;
                            pts[1].Y = pts[0].Y;
                            pts[2].X = pts[0].X;
                            pts[2].Y = pts[1].Y + image.Height;

                            e.Graphics.DrawImage(_imageList.Images[_imageIndexDisabled],
                                                 pts,
                                                 new Rectangle(0, 0, image.Width, image.Height),
                                                 GraphicsUnit.Pixel, _imageAttr);
                        }
                    }
                    else
                    {
                        // No disbled image, how about an enabled image we can draw grayed?
                        if (_imageIndexEnabled != -1)
                        {
                            // Yes, draw the enabled image but with color drained away
                            ControlPaint.DrawImageDisabled(e.Graphics, _imageList.Images[_imageIndexEnabled], 1, 1, this.BackColor);
                        }
                        else
                        {
                            // No images at all. Do nothing.
                        }
                    }
                }
                else
                {
                    // Button is enabled, any caller supplied attributes to modify drawing?
                    if (null == _imageAttr)
                    {
                        // No, so use the simple DrawImage method
                        e.Graphics.DrawImage(_imageList.Images[_imageIndexEnabled],
                                             (_mouseOver && _mouseCapture ? new Point(2, 2) :
                                             new Point(1, 1)));
                    }
                    else
                    {
                        // Yes, need to use the more complex DrawImage method instead
                        Image image = _imageList.Images[_imageIndexEnabled];

                        // Three points provided are upper-left, upper-right and 
                        // lower-left of the destination parallelogram. 
                        Point[] pts = new Point[3];
                        pts[0].X = (_mouseOver && _mouseCapture) ? 2 : 1;
                        pts[0].Y = (_mouseOver && _mouseCapture) ? 2 : 1;
                        pts[1].X = pts[0].X + image.Width;
                        pts[1].Y = pts[0].Y;
                        pts[2].X = pts[0].X;
                        pts[2].Y = pts[1].Y + image.Height;

                        e.Graphics.DrawImage(_imageList.Images[_imageIndexEnabled],
                                             pts,
                                             new Rectangle(0, 0, image.Width, image.Height),
                                             GraphicsUnit.Pixel, _imageAttr);
                    }

                    ButtonBorderStyle bs;

                    // Decide on the type of border to draw around image
                    if (_popupStyle)
                    {
                        if (_mouseOver && this.Enabled)
                            bs = (_mouseCapture ? ButtonBorderStyle.Inset : ButtonBorderStyle.Outset);
                        else
                            bs = ButtonBorderStyle.Solid;
                    }
                    else
                    {
                        if (this.Enabled)
                            bs = ((_mouseOver && _mouseCapture) ? ButtonBorderStyle.Inset : ButtonBorderStyle.Outset);
                        else
                            bs = ButtonBorderStyle.Solid;
                    }

                    ControlPaint.DrawBorder(e.Graphics, this.ClientRectangle,
                                            this.BackColor, _borderWidth, bs,
                                            this.BackColor, _borderWidth, bs,
                                            this.BackColor, _borderWidth, bs,
                                            this.BackColor, _borderWidth, bs);
                }
            }

            base.OnPaint(e);
        }
        /// <summary>
        /// Sets the bounds of the button.
        /// </summary>
        /// <param name="x">The new left position.</param>
        /// <param name="y">The new top position.</param>
        /// <param name="width">The new width.</param>
        /// <param name="height">The new height.</param>
        /// <param name="specified">Which bounds values are being set.</param>
        protected override void SetBoundsCore(int x, int y, int width, int height, BoundsSpecified specified)
        {
            base.SetBoundsCore(x, y, width, height, specified);
        }
    }
    // Declare the event signatures
    /// <summary>
    /// Callback signaling that a collection is being or has been cleared of all items.
    /// </summary>
    public delegate void CollectionClear();
    /// <summary>
    /// Callback signaling that an item is being or has been inserted or removed,
    /// supplying the affected index and value.
    /// </summary>
    public delegate void CollectionChange(int index, object value);

    /// <summary>
    /// A <see cref="CollectionBase"/> that raises before/after events (Clearing/Cleared,
    /// Inserting/Inserted, Removing/Removed) as its contents change, and supports swapping
    /// two items by index.
    /// </summary>
    public class CollectionWithEvents : CollectionBase
    {
        // Collection change events
        /// <summary>
        /// Raised before the collection is cleared.
        /// </summary>
        public event CollectionClear Clearing;
        /// <summary>
        /// Raised after the collection has been cleared.
        /// </summary>
        public event CollectionClear Cleared;
        /// <summary>
        /// Raised before an item is inserted.
        /// </summary>
        public event CollectionChange Inserting;
        /// <summary>
        /// Raised after an item has been inserted.
        /// </summary>
        public event CollectionChange Inserted;
        /// <summary>
        /// Raised before an item is removed.
        /// </summary>
        public event CollectionChange Removing;
        /// <summary>
        /// Raised after an item has been removed.
        /// </summary>
        public event CollectionChange Removed;

        // Overrides for generating events
        /// <summary>
        /// Raises the <see cref="Clearing"/> event before the collection is cleared.
        /// </summary>
        protected override void OnClear()
        {
            // Any attached event handlers?
            if (Clearing != null)
                Clearing();
        }
        /// <summary>
        /// Swaps the two items at the given indexes.
        /// </summary>
        /// <param name="index1">The index of the first item.</param>
        /// <param name="index2">The index of the second item.</param>
        public void Switch(int index1, int index2)
        {
            // Use existing method to add each array entry
            object old = List[index1];
            List[index1] = List[index2];
            List[index2] = old;
        }
        /// <summary>
        /// Raises the <see cref="Cleared"/> event after the collection has been cleared.
        /// </summary>
        protected override void OnClearComplete()
        {
            // Any attached event handlers?
            if (Cleared != null)
                Cleared();
        }

        /// <summary>
        /// Raises the <see cref="Inserting"/> event before an item is inserted.
        /// </summary>
        /// <param name="index">The index at which the item is being inserted.</param>
        /// <param name="value">The item being inserted.</param>
        protected override void OnInsert(int index, object value)
        {
            // Any attached event handlers?
            if (Inserting != null)
                Inserting(index, value);
        }

        /// <summary>
        /// Raises the <see cref="Inserted"/> event after an item has been inserted.
        /// </summary>
        /// <param name="index">The index at which the item was inserted.</param>
        /// <param name="value">The item that was inserted.</param>
        protected override void OnInsertComplete(int index, object value)
        {
            // Any attached event handlers?
            if (Inserted != null)
                Inserted(index, value);
        }

        /// <summary>
        /// Raises the <see cref="Removing"/> event before an item is removed.
        /// </summary>
        /// <param name="index">The index from which the item is being removed.</param>
        /// <param name="value">The item being removed.</param>
        protected override void OnRemove(int index, object value)
        {
            // Any attached event handlers?
            if (Removing != null)
                Removing(index, value);
        }

        /// <summary>
        /// Raises the <see cref="Removed"/> event after an item has been removed.
        /// </summary>
        /// <param name="index">The index from which the item was removed.</param>
        /// <param name="value">The item that was removed.</param>
        protected override void OnRemoveComplete(int index, object value)
        {
            // Any attached event handlers?
            if (Removed != null)
                Removed(index, value);
        }

        /// <summary>
        /// Returns the zero-based index of the given item.
        /// </summary>
        /// <param name="value">The item to locate.</param>
        /// <returns>The index of the item, or -1 if not found.</returns>
        protected int IndexOf(object value)
        {
            // Find the 0 based index of the requested entry
            return base.List.IndexOf(value);
        }
    }
    /// <summary>
    /// Static drawing utilities for the tab control, providing helpers such as rendering
    /// reversed (rotated) text and painting raised plain-style borders.
    /// </summary>
    public class DrawHelper
    {
        /// <summary>
        /// Visual state of a command/button being drawn: normal, hot-tracked (mouse over),
        /// or pushed (pressed).
        /// </summary>
        public enum CommandState
        {
            /// <summary>
            /// The command is in its normal state.
            /// </summary>
            Normal,
            /// <summary>
            /// The command is hot-tracked (the mouse is over it).
            /// </summary>
            HotTrack,
            /// <summary>
            /// The command is pushed (pressed).
            /// </summary>
            Pushed
        }

        /// <summary>
        /// Cached handle to a halftone brush used for drawing.
        /// </summary>
        protected static IntPtr _halfToneBrush = IntPtr.Zero;

        /// <summary>
        /// Draws a string rotated 180 degrees within the given rectangle.
        /// </summary>
        /// <param name="g">The graphics to draw on.</param>
        /// <param name="drawText">The text to draw.</param>
        /// <param name="drawFont">The font to use.</param>
        /// <param name="drawRect">The rectangle to draw within.</param>
        /// <param name="drawBrush">The brush to draw with.</param>
        /// <param name="drawFormat">The string format to use.</param>
        public static void DrawReverseString(Graphics g,
                                             String drawText,
                                             Font drawFont,
                                             Rectangle drawRect,
                                             Brush drawBrush,
                                             StringFormat drawFormat)
        {
            GraphicsContainer container = g.BeginContainer();

            // The text will be rotated around the origin (0,0) and so needs moving
            // back into position by using a transform
            g.TranslateTransform(drawRect.Left * 2 + drawRect.Width,
                                 drawRect.Top * 2 + drawRect.Height);

            // Rotate the text by 180 degress to reverse the direction 
            g.RotateTransform(180);

            // Draw the string as normal and let then transforms do the work
            g.DrawString(drawText, drawFont, drawBrush, drawRect, drawFormat);

            g.EndContainer(container);
        }

        /// <summary>
        /// Draws a plain raised rectangle using light and dark shades of the base color.
        /// </summary>
        /// <param name="g">The graphics to draw on.</param>
        /// <param name="boxRect">The rectangle to draw.</param>
        /// <param name="baseColor">The base color from which shades are derived.</param>
        public static void DrawPlainRaised(Graphics g,
                                           Rectangle boxRect,
                                           Color baseColor)
        {
            using (Pen lighlight = new Pen(ControlPaint.LightLight(baseColor)),
                      dark = new Pen(ControlPaint.DarkDark(baseColor)))
            {
                g.DrawLine(lighlight, boxRect.Left, boxRect.Bottom, boxRect.Left, boxRect.Top);
                g.DrawLine(lighlight, boxRect.Left, boxRect.Top, boxRect.Right, boxRect.Top);
                g.DrawLine(dark, boxRect.Right, boxRect.Top, boxRect.Right, boxRect.Bottom);
                g.DrawLine(dark, boxRect.Right, boxRect.Bottom, boxRect.Left, boxRect.Bottom);
            }
        }

        /// <summary>
        /// Draws a plain sunken rectangle using light and dark shades of the base color.
        /// </summary>
        /// <param name="g">The graphics to draw on.</param>
        /// <param name="boxRect">The rectangle to draw.</param>
        /// <param name="baseColor">The base color from which shades are derived.</param>
        public static void DrawPlainSunken(Graphics g,
                                           Rectangle boxRect,
                                           Color baseColor)
        {
            using (Pen lighlight = new Pen(ControlPaint.LightLight(baseColor)),
                      dark = new Pen(ControlPaint.DarkDark(baseColor)))
            {
                g.DrawLine(dark, boxRect.Left, boxRect.Bottom, boxRect.Left, boxRect.Top);
                g.DrawLine(dark, boxRect.Left, boxRect.Top, boxRect.Right, boxRect.Top);
                g.DrawLine(lighlight, boxRect.Right, boxRect.Top, boxRect.Right, boxRect.Bottom);
                g.DrawLine(lighlight, boxRect.Right, boxRect.Bottom, boxRect.Left, boxRect.Bottom);
            }
        }

        /// <summary>
        /// Draws a plain raised border around the given rectangle using the supplied shades.
        /// </summary>
        /// <param name="g">The graphics to draw on.</param>
        /// <param name="rect">The rectangle to draw the border around.</param>
        /// <param name="lightLight">The lightest shade.</param>
        /// <param name="baseColor">The base color.</param>
        /// <param name="dark">The dark shade.</param>
        /// <param name="darkDark">The darkest shade.</param>
        public static void DrawPlainRaisedBorder(Graphics g,
                                                 Rectangle rect,
                                                 Color lightLight,
                                                 Color baseColor,
                                                 Color dark,
                                                 Color darkDark)
        {
            if ((rect.Width > 2) && (rect.Height > 2))
            {
                using (Pen ll = new Pen(lightLight),
                          b = new Pen(baseColor),
                          d = new Pen(dark),
                          dd = new Pen(darkDark))
                {
                    int left = rect.Left;
                    int top = rect.Top;
                    int right = rect.Right;
                    int bottom = rect.Bottom;

                    // Draw the top border
                    g.DrawLine(b, right - 1, top, left, top);
                    g.DrawLine(ll, right - 2, top + 1, left + 1, top + 1);
                    g.DrawLine(b, right - 3, top + 2, left + 2, top + 2);

                    // Draw the left border
                    g.DrawLine(b, left, top, left, bottom - 1);
                    g.DrawLine(ll, left + 1, top + 1, left + 1, bottom - 2);
                    g.DrawLine(b, left + 2, top + 2, left + 2, bottom - 3);

                    // Draw the right
                    g.DrawLine(dd, right - 1, top + 1, right - 1, bottom - 1);
                    g.DrawLine(d, right - 2, top + 2, right - 2, bottom - 2);
                    g.DrawLine(b, right - 3, top + 3, right - 3, bottom - 3);

                    // Draw the bottom
                    g.DrawLine(dd, right - 1, bottom - 1, left, bottom - 1);
                    g.DrawLine(d, right - 2, bottom - 2, left + 1, bottom - 2);
                    g.DrawLine(b, right - 3, bottom - 3, left + 2, bottom - 3);
                }
            }
        }

        /// <summary>
        /// Draws only the top or bottom of a plain raised border using the supplied shades.
        /// </summary>
        /// <param name="g">The graphics to draw on.</param>
        /// <param name="rect">The rectangle to draw the border on.</param>
        /// <param name="lightLight">The lightest shade.</param>
        /// <param name="baseColor">The base color.</param>
        /// <param name="dark">The dark shade.</param>
        /// <param name="darkDark">The darkest shade.</param>
        /// <param name="drawTop">True to draw the top border, false to draw the bottom.</param>
        public static void DrawPlainRaisedBorderTopOrBottom(Graphics g,
                                                            Rectangle rect,
                                                            Color lightLight,
                                                            Color baseColor,
                                                            Color dark,
                                                            Color darkDark,
                                                            bool drawTop)
        {
            if ((rect.Width > 2) && (rect.Height > 2))
            {
                using (Pen ll = new Pen(lightLight),
                          b = new Pen(baseColor),
                          d = new Pen(dark),
                          dd = new Pen(darkDark))
                {
                    int left = rect.Left;
                    int top = rect.Top;
                    int right = rect.Right;
                    int bottom = rect.Bottom;

                    if (drawTop)
                    {
                        // Draw the top border
                        g.DrawLine(b, right - 1, top, left, top);
                        g.DrawLine(ll, right - 1, top + 1, left, top + 1);
                        g.DrawLine(b, right - 1, top + 2, left, top + 2);
                    }
                    else
                    {
                        // Draw the bottom
                        g.DrawLine(dd, right - 1, bottom - 1, left, bottom - 1);
                        g.DrawLine(d, right - 1, bottom - 2, left, bottom - 2);
                        g.DrawLine(b, right - 1, bottom - 3, left, bottom - 3);
                    }
                }
            }
        }

        /// <summary>
        /// Draws a plain sunken border around the given rectangle using the supplied shades.
        /// </summary>
        /// <param name="g">The graphics to draw on.</param>
        /// <param name="rect">The rectangle to draw the border around.</param>
        /// <param name="lightLight">The lightest shade.</param>
        /// <param name="baseColor">The base color.</param>
        /// <param name="dark">The dark shade.</param>
        /// <param name="darkDark">The darkest shade.</param>
        public static void DrawPlainSunkenBorder(Graphics g,
                                                 Rectangle rect,
                                                 Color lightLight,
                                                 Color baseColor,
                                                 Color dark,
                                                 Color darkDark)
        {
            if ((rect.Width > 2) && (rect.Height > 2))
            {
                using (Pen ll = new Pen(lightLight),
                          b = new Pen(baseColor),
                          d = new Pen(dark),
                          dd = new Pen(darkDark))
                {
                    int left = rect.Left;
                    int top = rect.Top;
                    int right = rect.Right;
                    int bottom = rect.Bottom;

                    // Draw the top border
                    g.DrawLine(d, right - 1, top, left, top);
                    g.DrawLine(dd, right - 2, top + 1, left + 1, top + 1);
                    g.DrawLine(b, right - 3, top + 2, left + 2, top + 2);

                    // Draw the left border
                    g.DrawLine(d, left, top, left, bottom - 1);
                    g.DrawLine(dd, left + 1, top + 1, left + 1, bottom - 2);
                    g.DrawLine(b, left + 2, top + 2, left + 2, bottom - 3);

                    // Draw the right
                    g.DrawLine(ll, right - 1, top + 1, right - 1, bottom - 1);
                    g.DrawLine(b, right - 2, top + 2, right - 2, bottom - 2);
                    g.DrawLine(b, right - 3, top + 3, right - 3, bottom - 3);

                    // Draw the bottom
                    g.DrawLine(ll, right - 1, bottom - 1, left, bottom - 1);
                    g.DrawLine(b, right - 2, bottom - 2, left + 1, bottom - 2);
                    g.DrawLine(b, right - 3, bottom - 3, left + 2, bottom - 3);
                }
            }
        }

        /// <summary>
        /// Draws only the top or bottom of a plain sunken border using the supplied shades.
        /// </summary>
        /// <param name="g">The graphics to draw on.</param>
        /// <param name="rect">The rectangle to draw the border on.</param>
        /// <param name="lightLight">The lightest shade.</param>
        /// <param name="baseColor">The base color.</param>
        /// <param name="dark">The dark shade.</param>
        /// <param name="darkDark">The darkest shade.</param>
        /// <param name="drawTop">True to draw the top border, false to draw the bottom.</param>
        public static void DrawPlainSunkenBorderTopOrBottom(Graphics g,
                                                            Rectangle rect,
                                                            Color lightLight,
                                                            Color baseColor,
                                                            Color dark,
                                                            Color darkDark,
                                                            bool drawTop)
        {
            if ((rect.Width > 2) && (rect.Height > 2))
            {
                using (Pen ll = new Pen(lightLight),
                          b = new Pen(baseColor),
                          d = new Pen(dark),
                          dd = new Pen(darkDark))
                {
                    int left = rect.Left;
                    int top = rect.Top;
                    int right = rect.Right;
                    int bottom = rect.Bottom;

                    if (drawTop)
                    {
                        // Draw the top border
                        g.DrawLine(d, right - 1, top, left, top);
                        g.DrawLine(dd, right - 1, top + 1, left, top + 1);
                        g.DrawLine(b, right - 1, top + 2, left, top + 2);
                    }
                    else
                    {
                        // Draw the bottom
                        g.DrawLine(ll, right - 1, bottom - 1, left, bottom - 1);
                        g.DrawLine(b, right - 1, bottom - 2, left, bottom - 2);
                        g.DrawLine(b, right - 1, bottom - 3, left, bottom - 3);
                    }
                }
            }
        }

        /// <summary>
        /// Draws a command button background for the given style and command state.
        /// </summary>
        /// <param name="g">The graphics to draw on.</param>
        /// <param name="style">The visual style to draw in.</param>
        /// <param name="direction">The command orientation.</param>
        /// <param name="drawRect">The rectangle to draw within.</param>
        /// <param name="state">The command state.</param>
        /// <param name="baseColor">The base background color.</param>
        /// <param name="trackLight">The fill color used when hot-tracked.</param>
        /// <param name="trackBorder">The border color used when hot-tracked.</param>
        public static void DrawButtonCommand(Graphics g,
                                             VisualStyle style,
                                             Direction direction,
                                             Rectangle drawRect,
                                             CommandState state,
                                             Color baseColor,
                                             Color trackLight,
                                             Color trackBorder)
        {
            Rectangle rect = new Rectangle(drawRect.Left, drawRect.Top, drawRect.Width - 1, drawRect.Height - 1);

            // Draw background according to style
            switch (style)
            {
                case VisualStyle.Plain:
                    // Draw background with back color
                    using (SolidBrush backBrush = new SolidBrush(baseColor))
                        g.FillRectangle(backBrush, rect);

                    // Modify according to state
                    switch (state)
                    {
                        case CommandState.HotTrack:
                            DrawPlainRaised(g, rect, baseColor);
                            break;
                        case CommandState.Pushed:
                            DrawPlainSunken(g, rect, baseColor);
                            break;
                    }
                    break;
                case VisualStyle.IDE:
                    // Draw according to state
                    switch (state)
                    {
                        case CommandState.Normal:
                            // Draw background with back color
                            using (SolidBrush backBrush = new SolidBrush(baseColor))
                                g.FillRectangle(backBrush, rect);
                            break;
                        case CommandState.HotTrack:
                            g.FillRectangle(Brushes.White, rect);

                            using (SolidBrush trackBrush = new SolidBrush(trackLight))
                                g.FillRectangle(trackBrush, rect);

                            using (Pen trackPen = new Pen(trackBorder))
                                g.DrawRectangle(trackPen, rect);
                            break;
                        case CommandState.Pushed:
                            //TODO: draw in a darker background color
                            break;
                    }
                    break;
                case VisualStyle.Chrome:
                    // Draw according to state
                    switch (state)
                    {
                        case CommandState.Normal:
                            // Draw background with back color
                            using (SolidBrush backBrush = new SolidBrush(baseColor))
                                g.FillRectangle(backBrush, rect);
                            break;
                        case CommandState.HotTrack:
                            g.FillRectangle(Brushes.White, rect);

                            using (SolidBrush trackBrush = new SolidBrush(trackLight))
                                g.FillRectangle(trackBrush, rect);

                            using (Pen trackPen = new Pen(trackBorder))
                                g.DrawRectangle(trackPen, rect);
                            break;
                        case CommandState.Pushed:
                            //TODO: draw in a darker background color
                            break;
                    }
                    break;
            }
        }

        /// <summary>
        /// Draws a separator line for the given style and orientation.
        /// </summary>
        /// <param name="g">The graphics to draw on.</param>
        /// <param name="style">The visual style to draw in.</param>
        /// <param name="direction">The separator orientation.</param>
        /// <param name="drawRect">The rectangle to draw within.</param>
        /// <param name="baseColor">The base color from which the line color is derived.</param>
        public static void DrawSeparatorCommand(Graphics g,
                                                VisualStyle style,
                                                Direction direction,
                                                Rectangle drawRect,
                                                Color baseColor)
        {
            switch (style)
            {
                case VisualStyle.IDE:
                    // Draw a single separating line
                    using (Pen dPen = new Pen(ControlPaint.Dark(baseColor)))
                    {
                        if (direction == Direction.Horizontal)
                            g.DrawLine(dPen, drawRect.Left, drawRect.Top,
                                             drawRect.Left, drawRect.Bottom - 1);
                        else
                            g.DrawLine(dPen, drawRect.Left, drawRect.Top,
                                             drawRect.Right - 1, drawRect.Top);
                    }
                    break;
                case VisualStyle.Plain:
                    // Draw a dark/light combination of lines to give an indent
                    using (Pen lPen = new Pen(ControlPaint.Dark(baseColor)),
                              llPen = new Pen(ControlPaint.LightLight(baseColor)))
                    {
                        if (direction == Direction.Horizontal)
                        {
                            g.DrawLine(lPen, drawRect.Left, drawRect.Top, drawRect.Left, drawRect.Bottom - 1);
                            g.DrawLine(llPen, drawRect.Left + 1, drawRect.Top, drawRect.Left + 1, drawRect.Bottom - 1);
                        }
                        else
                        {
                            g.DrawLine(lPen, drawRect.Left, drawRect.Top, drawRect.Right - 1, drawRect.Top);
                            g.DrawLine(llPen, drawRect.Left, drawRect.Top + 1, drawRect.Right - 1, drawRect.Top + 1);
                        }
                    }
                    break;
                case VisualStyle.Chrome:
                    // Draw a single separating line
                    using (Pen dPen = new Pen(ControlPaint.Dark(baseColor)))
                    {
                        if (direction == Direction.Horizontal)
                            g.DrawLine(dPen, drawRect.Left, drawRect.Top,
                                             drawRect.Left, drawRect.Bottom - 1);
                        else
                            g.DrawLine(dPen, drawRect.Left, drawRect.Top,
                                             drawRect.Right - 1, drawRect.Top);
                    }
                    break;
            }
            // Drawing depends on the visual style required
            /*          if (style == VisualStyle.IDE)
                      {
                         // Draw a single separating line
                         using (Pen dPen = new Pen(ControlPaint.Dark(baseColor)))
                         {
                            if (direction == Direction.Horizontal)
                               g.DrawLine(dPen, drawRect.Left, drawRect.Top,
                                                drawRect.Left, drawRect.Bottom - 1);
                            else
                               g.DrawLine(dPen, drawRect.Left, drawRect.Top,
                                                drawRect.Right - 1, drawRect.Top);
                         }
                      }
                      else
                      {
                         // Draw a dark/light combination of lines to give an indent
                         using (Pen lPen = new Pen(ControlPaint.Dark(baseColor)),
                                   llPen = new Pen(ControlPaint.LightLight(baseColor)))
                         {
                            if (direction == Direction.Horizontal)
                            {
                               g.DrawLine(lPen, drawRect.Left, drawRect.Top, drawRect.Left, drawRect.Bottom - 1);
                               g.DrawLine(llPen, drawRect.Left + 1, drawRect.Top, drawRect.Left + 1, drawRect.Bottom - 1);
                            }
                            else
                            {
                               g.DrawLine(lPen, drawRect.Left, drawRect.Top, drawRect.Right - 1, drawRect.Top);
                               g.DrawLine(llPen, drawRect.Left, drawRect.Top + 1, drawRect.Right - 1, drawRect.Top + 1);
                            }
                         }
                      }*/
        }

    }
    /// <summary>
    /// Static helpers for safely removing child controls or detaching a hosted form from a
    /// container, using a temporary hidden button to preserve a valid active control.
    /// </summary>
    public class ControlHelper
    {
        /// <summary>
        /// Removes all child controls from the given control, using a temporary active button
        /// to avoid the form Close bug.
        /// </summary>
        /// <param name="control">The control whose children are removed.</param>
        public static void RemoveAll(Control control)
        {
            if ((control != null) && (control.Controls.Count > 0))
            {
                Button tempButton = null;
                Form parentForm = control.FindForm();

                if (parentForm != null)
                {
                    // Create a hidden, temporary button
                    tempButton = new Button();
                    tempButton.Visible = false;

                    // Add this temporary button to the parent form
                    parentForm.Controls.Add(tempButton);

                    // Must ensure that temp button is the active one
                    parentForm.ActiveControl = tempButton;
                }

                // Remove all entries from target
                control.Controls.Clear();

                if (parentForm != null)
                {
                    // Remove the temporary button
                    tempButton.Dispose();
                    parentForm.Controls.Remove(tempButton);
                }
            }
        }

        /// <summary>
        /// Removes the given control from a collection, using a temporary active button to
        /// avoid the form Close bug.
        /// </summary>
        /// <param name="coll">The collection to remove from.</param>
        /// <param name="item">The control to remove.</param>
        public static void Remove(Control.ControlCollection coll, Control item)
        {
            if ((coll != null) && (item != null))
            {
                Button tempButton = null;
                Form parentForm = item.FindForm();

                if (parentForm != null)
                {
                    // Create a hidden, temporary button
                    tempButton = new Button();
                    tempButton.Visible = false;

                    // Add this temporary button to the parent form
                    parentForm.Controls.Add(tempButton);

                    // Must ensure that temp button is the active one
                    parentForm.ActiveControl = tempButton;
                }

                // Remove our target control
                coll.Remove(item);

                if (parentForm != null)
                {
                    // Remove the temporary button
                    tempButton.Dispose();
                    parentForm.Controls.Remove(tempButton);
                }
            }
        }

        /// <summary>
        /// Removes the control at the given index from a collection.
        /// </summary>
        /// <param name="coll">The collection to remove from.</param>
        /// <param name="index">The index of the control to remove.</param>
        public static void RemoveAt(Control.ControlCollection coll, int index)
        {
            if (coll != null)
            {
                if ((index >= 0) && (index < coll.Count))
                {
                    Remove(coll, coll[index]);
                }
            }
        }

        /// <summary>
        /// Detaches a hosted form from its container, using a temporary active button to
        /// avoid the form Close bug.
        /// </summary>
        /// <param name="source">The control used to locate the container.</param>
        /// <param name="form">The form to detach.</param>
        public static void RemoveForm(Control source, Form form)
        {
            ContainerControl container = source.FindForm() as ContainerControl;

            container ??= source as ContainerControl;

            Button tempButton = new Button();
            tempButton.Visible = false;

            // Add this temporary button to the parent form
            container.Controls.Add(tempButton);

            // Must ensure that temp button is the active one
            container.ActiveControl = tempButton;

            // Remove Form parent
            form.Parent = null;

            // Remove the temporary button
            tempButton.Dispose();
            container.Controls.Remove(tempButton);
        }
    }
    /// <summary>
    /// Static color utilities for the tab control, deriving the IDE-style tab background
    /// color from a given base control color (with special cases for Classic and XP themes).
    /// </summary>
    public class ColorHelper
    {
        /// <summary>
        /// Derives the IDE-style tab background color from the given base control color,
        /// with special cases for the Classic and XP theme colors.
        /// </summary>
        /// <param name="backColor">The base control color.</param>
        /// <returns>The derived tab background color.</returns>
        public static Color TabBackgroundFromBaseColor(Color backColor)
        {
            Color backIDE;

            // Check for the 'Classic' control color
            if ((backColor.R == 212) &&
                (backColor.G == 208) &&
                (backColor.B == 200))
            {
                // Use the exact background for this color
                backIDE = Color.FromArgb(247, 243, 233);
            }
            else
            {
                // Check for the 'XP' control color
                if ((backColor.R == 236) &&
                    (backColor.G == 233) &&
                    (backColor.B == 216))
                {
                    // Use the exact background for this color
                    backIDE = Color.FromArgb(255, 251, 233);
                }
                else
                {
                    // Calculate the IDE background color as only half as dark as the control color
                    int red = 255 - ((255 - backColor.R) / 2);
                    int green = 255 - ((255 - backColor.G) / 2);
                    int blue = 255 - ((255 - backColor.B) / 2);
                    backIDE = Color.FromArgb(red, green, blue);
                }
            }

            return backIDE;
        }
    }
}


