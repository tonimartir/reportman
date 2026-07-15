using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Drawing;
using System.Text;
using System.Windows.Forms;

namespace Reportman.Drawing.Forms
{
    /// <summary>
    /// On-screen calculator UserControl that renders a 5x5 grid of buttons and an edit line,
    /// used to enter or compute decimal/password values via mouse or keyboard.
    /// </summary>
    public partial class ScreenKeyboard : UserControl
    {
        /// <summary>
        /// The dialog form hosting this control; its <see cref="Form.DialogResult"/> is set and the
        /// form is closed when the user confirms with the OK/Enter button.
        /// </summary>
        public Form CustomParentForm;
        private ButtonCalc[] buttons;
        private int buttonCount;
        private ButtonCalc capturedButton;

        private String[] buttonCaptions =
        {
            "M+",   "MR",   "MC",   "1/x",  "/",
            "+/-",  "7",    "8",    "9",    "x",
            "%",    "4",    "5",    "6",    "-",
            "CE",   "1",    "2",    "3",    "+",
            "C",    "0",    ".",    "=",    "OK"
        };

        private Color[] buttonColors =
        {
            Color.DarkRed,  Color.DarkRed,  Color.DarkRed,  Color.DarkBlue,
            Color.DarkRed,  Color.DarkBlue, Color.DarkBlue, Color.DarkBlue,
            Color.DarkBlue, Color.DarkRed,  Color.DarkBlue, Color.DarkBlue,
            Color.DarkBlue, Color.DarkBlue, Color.DarkRed,  Color.DarkRed,
            Color.DarkBlue, Color.DarkBlue, Color.DarkBlue, Color.DarkRed,
            Color.DarkRed,  Color.DarkBlue, Color.DarkBlue, Color.DarkRed,
            Color.DarkRed
        };

        /// <summary>
        /// Identifies each calculator button action, including digits, operators, memory
        /// functions and the OK/Enter command; values are ordered to match the button layout.
        /// </summary>
        public enum Command
        {
            /// <summary>Stores the current value in the calculator memory (M+).</summary>
            MemorySet = 0,
            /// <summary>Recalls the value held in the calculator memory (MR).</summary>
            MemoryRecall,
            /// <summary>Clears the calculator memory (MC).</summary>
            MemoryClear,
            /// <summary>Replaces the current value with its reciprocal (1/x).</summary>
            OneOver,
            /// <summary>Division operator (/).</summary>
            Div,
            /// <summary>Toggles the sign of the current value (+/-).</summary>
            Minus,
            /// <summary>Digit 7.</summary>
            Seven,
            /// <summary>Digit 8.</summary>
            Eight,
            /// <summary>Digit 9.</summary>
            Nine,
            /// <summary>Multiplication operator (x).</summary>
            Multiply,
            /// <summary>Converts the current value to a percentage (%).</summary>
            Percent,
            /// <summary>Digit 4.</summary>
            Four,
            /// <summary>Digit 5.</summary>
            Five,
            /// <summary>Digit 6.</summary>
            Six,
            /// <summary>Subtraction operator (-).</summary>
            Sub,
            /// <summary>Clears the current entry (CE).</summary>
            ClearEntry,
            /// <summary>Digit 1.</summary>
            One,
            /// <summary>Digit 2.</summary>
            Two,
            /// <summary>Digit 3.</summary>
            Three,
            /// <summary>Addition operator (+).</summary>
            Add,
            /// <summary>Clears the whole calculation (C).</summary>
            ClearAll,
            /// <summary>Digit 0.</summary>
            Zero,
            /// <summary>Decimal separator (.).</summary>
            Dot,
            /// <summary>Evaluates the current expression (=).</summary>
            Equal,
            /// <summary>Confirms the result and closes the calculator dialog (OK).</summary>
            Enter
        };

        private int windowWidth;
        private int windowHeight;
        private int SizeMargin;
        private int buttonWidth;
        private int buttonHeight;
        private int buttonTopRow;
        /// <summary>
        /// The owner-drawn display line that shows the value currently held by the calculator.
        /// </summary>
        public EditCalc editBox;
        /// <summary>
        /// The calculator engine that stores the tokens and performs the arithmetic behind this control.
        /// </summary>
        public Calculator calc;
        private Font windowFont;



        /// <summary>
        /// Recomputes the button and edit-line geometry for the current control size, rebuilds the
        /// 5x5 button matrix and the edit box, and refreshes them with the calculator's current value.
        /// </summary>
        public void RedrawCalc()
        {

            // Calculate button size based on window size (button matrix is 5x5)
            float nfontsize = 11.0f;
            bool recreatefont = false;
            int ncomp = windowWidth;
            if (ncomp > windowHeight)
                ncomp = windowHeight;
            if (ncomp < 100)
            {
                nfontsize = 7;
            }
            else
                if (ncomp < 200)
                {
                    nfontsize = 8;
                }
                else
                    if (ncomp > 350)
                        nfontsize = 18;
                    else if (ncomp > 800)
                        nfontsize = 24;
            if (windowFont == null)
                recreatefont = true;
            else
                recreatefont = windowFont.Size != nfontsize;
            if (recreatefont)
                windowFont = new Font(
                    FontFamily.GenericSansSerif,
                    nfontsize,
                    FontStyle.Bold);

            buttonCount = 0;
            int x, y;
            int editX;
            int editY;
            int editWidth;
            int editHeight;
            int row, col;

            buttonWidth = windowWidth / 5;
            buttonHeight = windowHeight / 6;

            SizeMargin = Math.Min(buttonWidth / 8, buttonHeight / 8);

            buttonWidth -= SizeMargin * 2;
            buttonHeight -= SizeMargin * 2;

            // Calculate edit size

            editX = SizeMargin;
            editY = SizeMargin;
            editWidth = windowWidth - (SizeMargin * 2);
            editHeight = buttonHeight;

            // Create buttons

            buttonTopRow = SizeMargin + editHeight + SizeMargin;

            buttons = new ButtonCalc[(int)Command.Enter + 1];

            y = buttonTopRow;

            for (row = 0; row < 5; row++)
            {
                x = SizeMargin;

                for (col = 0; col < 5; col++)
                {
                    if (buttonCount <= (int)Command.Enter)
                    {
                        buttons[buttonCount] = new ButtonCalc(
                            this,
                            windowFont,
                            x,
                            y,
                            buttonWidth,
                            buttonHeight,
                            SizeMargin,
                            buttonCaptions[buttonCount],
                            buttonColors[buttonCount],
                            (ScreenKeyboard.Command)buttonCount);

                        buttonCount++;
                    }

                    x += SizeMargin + buttonWidth + SizeMargin;
                }

                y += SizeMargin + buttonHeight + SizeMargin;
            }

            // Adjust + button

            //            buttons[(int)Command.Add].IsTall = true;

            // Create edit
            editBox = new EditCalc(this, windowFont, new Rectangle(editX, editY, editWidth, editHeight));
            editBox.IsPassword = IsPassword;
            if (calc != null)
                editBox.EditString = calc.Render();

            this.BackColor = Color.SlateGray;
            this.Text = "Calculator";

        }
        /// <summary>
        /// Initializes a new <see cref="ScreenKeyboard"/> with a fresh calculator engine and lays
        /// out the buttons and edit line at the default size.
        /// </summary>
        public ScreenKeyboard()
        {
            InitializeComponent();
            calc = new Calculator();

            //windowWidth = Screen.PrimaryScreen.WorkingArea.Width-10;
            //windowHeight = Screen.PrimaryScreen.WorkingArea.Height - 20;
            windowWidth = 400;
            windowHeight = 400;


            RedrawCalc();

            //this.ClientSize = new Size(windowWidth, windowHeight);
            //this.MaximizeBox = false;
        }
        private bool FIsPassword;
        /// <summary>
        /// Gets or sets whether the edit line masks its contents as a password; changing it rebuilds
        /// the layout so the mask takes effect.
        /// </summary>
        [DesignerSerializationVisibility(DesignerSerializationVisibility.Visible)]
        public bool IsPassword
        {
            get
            {
                return FIsPassword;
            }
            set
            {
                FIsPassword = value;
                RedrawCalc();
            }
        }
        private void DoOK()
        {
            if (CustomParentForm != null)
            {
                CustomParentForm.DialogResult = DialogResult.OK;
                CustomParentForm.Close();
            }
        }

        private void DoCommand(Command cmd)
        {
            switch (cmd)
            {
                case Command.MemorySet:
                    calc.DoMemorySet();
                    break;

                case Command.MemoryClear:
                    calc.DoMemoryClear();
                    break;

                case Command.MemoryRecall:
                    calc.DoMemoryRecall();
                    break;

                case Command.ClearAll:
                    calc.DoClearAll();
                    break;

                case Command.ClearEntry:
                    calc.DoClearCurrentToken();
                    break;

                case Command.Percent:
                    calc.DoPercent();
                    break;

                case Command.OneOver:
                    calc.DoOneOver();
                    break;

                case Command.Sub:
                    calc.DoOperator(TokenCalc.TokenType.Subtract);
                    break;

                case Command.Add:
                    calc.DoOperator(TokenCalc.TokenType.Add);
                    break;

                case Command.Div:
                    calc.DoOperator(TokenCalc.TokenType.Divide);
                    break;

                case Command.Multiply:
                    calc.DoOperator(TokenCalc.TokenType.Multiply);
                    break;

                case Command.Minus:
                    calc.DoNegative();
                    break;

                case Command.Dot:
                    calc.DoDecimal();
                    break;

                case Command.Zero:
                    calc.DoDigit(0);
                    break;

                case Command.One:
                    calc.DoDigit(1);
                    break;

                case Command.Two:
                    calc.DoDigit(2);
                    break;

                case Command.Three:
                    calc.DoDigit(3);
                    break;

                case Command.Four:
                    calc.DoDigit(4);
                    break;

                case Command.Five:
                    calc.DoDigit(5);
                    break;

                case Command.Six:
                    calc.DoDigit(6);
                    break;

                case Command.Seven:
                    calc.DoDigit(7);
                    break;

                case Command.Eight:
                    calc.DoDigit(8);
                    break;

                case Command.Nine:
                    calc.DoDigit(9);
                    break;

                case Command.Equal:
                    calc.DoEvaluate();
                    break;
                case Command.Enter:
                    DoOK();
                    break;
            }
            if (cmd != ScreenKeyboard.Command.Enter)
                editBox.EditString = calc.Render();
        }

        /// <summary>
        /// Paints the edit line and every calculator button onto the control surface.
        /// </summary>
        /// <param name="paintArgs">Paint data supplying the target <see cref="Graphics"/>.</param>
        protected override void OnPaint(PaintEventArgs paintArgs)
        {
            Graphics graphics;

            graphics = paintArgs.Graphics;

            // Edit line

            editBox.Render(graphics);

            // Buttons

            foreach (ButtonCalc button in buttons)
            {
                if (button != null)
                    button.Render(graphics);
            }
        }

        /// <summary>
        /// Paints the control background using the default <see cref="UserControl"/> behavior.
        /// </summary>
        /// <param name="paintArgs">Paint data supplying the target <see cref="Graphics"/>.</param>
        protected override void OnPaintBackground(PaintEventArgs paintArgs)
        {
            base.OnPaintBackground(paintArgs);
        }

        /// <summary>
        /// Selects and captures the button under the pointer so it can be activated on mouse up.
        /// </summary>
        /// <param name="mouseArgs">Mouse data carrying the pointer position.</param>
        protected override void OnMouseDown(MouseEventArgs mouseArgs)
        {
            foreach (ButtonCalc button in buttons)
            {
                if (button.IsHit(mouseArgs.X, mouseArgs.Y))
                {
                    button.IsSelected = true;
                    capturedButton = button;

                    break;
                }
            }
        }

        /// <summary>
        /// Updates the captured button's selected state depending on whether the pointer is still over it.
        /// </summary>
        /// <param name="mouseArgs">Mouse data carrying the pointer position.</param>
        protected override void OnMouseMove(MouseEventArgs mouseArgs)
        {
            if (capturedButton != null)
            {
                capturedButton.IsSelected = capturedButton.IsHit(mouseArgs.X, mouseArgs.Y);
            }
        }

        /// <summary>
        /// Runs the captured button's command when the pointer is released over it, then clears the capture.
        /// </summary>
        /// <param name="mouseArgs">Mouse data carrying the pointer position.</param>
        protected override void OnMouseUp(MouseEventArgs mouseArgs)
        {
            if (capturedButton != null)
            {
                if (capturedButton.IsHit(mouseArgs.X, mouseArgs.Y))
                    DoCommand(capturedButton.Cmd);

                capturedButton.IsSelected = false;
                capturedButton = null;
            }
        }

        /// <summary>
        /// Maps digit, operator, decimal, backspace and enter key presses to the matching calculator commands.
        /// </summary>
        /// <param name="keyArgs">Key data carrying the pressed character.</param>
        protected override void OnKeyPress(KeyPressEventArgs keyArgs)
        {
            switch (keyArgs.KeyChar)
            {
                case '1':
                    this.DoCommand(Command.One);
                    break;

                case '2':
                    this.DoCommand(Command.Two);
                    break;

                case '3':
                    this.DoCommand(Command.Three);
                    break;

                case '4':
                    this.DoCommand(Command.Four);
                    break;

                case '5':
                    this.DoCommand(Command.Five);
                    break;

                case '6':
                    this.DoCommand(Command.Six);
                    break;

                case '7':
                    this.DoCommand(Command.Seven);
                    break;

                case '8':
                    this.DoCommand(Command.Eight);
                    break;

                case '9':
                    this.DoCommand(Command.Nine);
                    break;

                case '0':
                    this.DoCommand(Command.Zero);
                    break;

                case (char)(int)Keys.Back:
                    this.DoCommand(Command.ClearEntry);
                    break;

                case '.':
                    this.DoCommand(Command.Dot);
                    break;

                case '+':
                    this.DoCommand(Command.Add);
                    break;

                case '-':
                    this.DoCommand(Command.Sub);
                    break;

                case '*':
                    this.DoCommand(Command.Multiply);
                    break;

                case '/':
                    this.DoCommand(Command.Div);
                    break;

                case '=':
                case (char)13:
                    this.DoCommand(Command.Enter);
                    break;
            }
        }

        private void ScreenKeyboard_Resize(object sender, EventArgs e)
        {
            windowWidth = this.Width;
            windowHeight = this.Height;
            RedrawCalc();
            Invalidate();
        }

    }

    // 
    // The following structure describes a number and the operations 
    // that can be performed on it. Its value is stored internally 
    // as a double.
    //
    /// <summary>
    /// Value type wrapping a double and the basic arithmetic operations the calculator
    /// performs on it (add, subtract, multiply, divide, equality).
    /// </summary>
    public struct Number
    {
        double numValue;

        /// <summary>
        /// Initializes a new <see cref="Number"/> wrapping the given double value.
        /// </summary>
        /// <param name="n">The value to store.</param>
        public Number(double n)
        {
            numValue = n;
        }

        /// <summary>
        /// Returns the sum of two numbers.
        /// </summary>
        /// <param name="a">First operand.</param>
        /// <param name="b">Second operand.</param>
        /// <returns>A new <see cref="Number"/> equal to <paramref name="a"/> + <paramref name="b"/>.</returns>
        public static Number Add(Number a, Number b)
        {
            return (new Number(a.numValue + b.numValue));
        }

        /// <summary>
        /// Returns the difference of two numbers.
        /// </summary>
        /// <param name="a">Number to subtract from.</param>
        /// <param name="b">Number to subtract.</param>
        /// <returns>A new <see cref="Number"/> equal to <paramref name="a"/> - <paramref name="b"/>.</returns>
        public static Number Subtract(Number a, Number b)
        {
            return (new Number(a.numValue - b.numValue));
        }

        /// <summary>
        /// Returns the product of two numbers.
        /// </summary>
        /// <param name="a">First operand.</param>
        /// <param name="b">Second operand.</param>
        /// <returns>A new <see cref="Number"/> equal to <paramref name="a"/> * <paramref name="b"/>.</returns>
        public static Number Multiply(Number a, Number b)
        {
            return (new Number(a.numValue * b.numValue));
        }

        /// <summary>
        /// Returns the quotient of two numbers, yielding zero when the divisor is zero.
        /// </summary>
        /// <param name="a">Dividend.</param>
        /// <param name="b">Divisor.</param>
        /// <returns>A new <see cref="Number"/> equal to <paramref name="a"/> / <paramref name="b"/>, or zero if <paramref name="b"/> is zero.</returns>
        public static Number Divide(Number a, Number b)
        {
            if (b.numValue == 0)
                return (new Number(0));
            else
                return (new Number(a.numValue / b.numValue));
        }

        /// <summary>
        /// Determines whether two numbers hold the same value.
        /// </summary>
        /// <param name="a">First operand.</param>
        /// <param name="b">Second operand.</param>
        /// <returns><c>true</c> if the two values are equal; otherwise <c>false</c>.</returns>
        public static bool operator ==(Number a, Number b)
        {
            return (a.numValue == b.numValue);
        }

        /// <summary>
        /// Determines whether two numbers hold different values.
        /// </summary>
        /// <param name="a">First operand.</param>
        /// <param name="b">Second operand.</param>
        /// <returns><c>true</c> if the two values differ; otherwise <c>false</c>.</returns>
        public static bool operator !=(Number a, Number b)
        {
            return (a.numValue != b.numValue);
        }

        /// <summary>
        /// Determines whether the given object is a <see cref="Number"/> with the same value.
        /// </summary>
        /// <param name="b">The object to compare with.</param>
        /// <returns><c>true</c> if <paramref name="b"/> is an equal <see cref="Number"/>; otherwise <c>false</c>.</returns>
        public override bool Equals(Object b)
        {
            if (b is Number)
                return (this.numValue == ((Number)b).numValue);
            else
                return (false);
        }

        /// <summary>
        /// Returns a hash code for this number.
        /// </summary>
        /// <returns>The integer part of the value, used as the hash code.</returns>
        public override int GetHashCode()
        {
            return ((int)numValue);
        }

        /// <summary>
        /// Returns the textual representation of the wrapped value.
        /// </summary>
        /// <returns>The value formatted as a string.</returns>
        public override String ToString()
        {
            return (numValue.ToString());
        }
    }

    // 
    // The following class implements a button control for the calculator
    //
    /// <summary>
    /// Owner-drawn calculator button: paints itself as a labelled ellipse, tracks selection
    /// state and hit-testing, and carries the <see cref="ScreenKeyboard.Command"/> it triggers.
    /// </summary>
    public class ButtonCalc
    {
        private Control MainControl;
        private int PositionLeftX;
        private int PositionTopY;
        private int SizeWidth;
        private int SizeHeight;
        private int SizeMargin;
        private String CaptionName;
        private Color CaptionColor;
        private Font CaptionFont;
        private bool IsTallValue;
        private bool IsSelectedValue;
        private ScreenKeyboard.Command ButtonCommand;

        /// <summary>
        /// Initializes a new calculator button with its host control, font, position, size, caption and command.
        /// </summary>
        /// <param name="MControl">Control the button is drawn on and repaints through.</param>
        /// <param name="font">Font used to draw the caption.</param>
        /// <param name="x">Left position of the button, in pixels.</param>
        /// <param name="y">Top position of the button, in pixels.</param>
        /// <param name="width">Button width, in pixels.</param>
        /// <param name="height">Button height, in pixels.</param>
        /// <param name="margin">Spacing margin used when the button is grown to double height.</param>
        /// <param name="capString">Caption text shown on the button.</param>
        /// <param name="capColor">Caption and selected-background color.</param>
        /// <param name="cmd">Command triggered when the button is activated.</param>
        public ButtonCalc(Control MControl, Font font, int x, int y, int width, int height,
            int margin, String capString, Color capColor, ScreenKeyboard.Command cmd)
        {
            MainControl = MControl;
            CaptionFont = font;
            PositionLeftX = x;
            PositionTopY = y;
            SizeWidth = width;
            SizeHeight = height;
            SizeMargin = margin;
            CaptionName = capString;
            CaptionColor = capColor;
            ButtonCommand = cmd;
        }

        /// <summary>
        /// Draws the button as a labelled ellipse, inverting caption and fill colors when it is selected.
        /// </summary>
        /// <param name="graphics">Surface to draw the button on.</param>
        public void Render(Graphics graphics)
        {
            Pen pen;
            Brush brush;
            int x, y;
            int textWidth, textHeight;

            brush = new SolidBrush(IsSelectedValue ?
                CaptionColor : Color.White);
            pen = new Pen(Color.Black);

            graphics.FillEllipse(brush, PositionLeftX, PositionTopY,
                SizeWidth, SizeHeight);
            graphics.DrawEllipse(pen, PositionLeftX, PositionTopY,
                SizeWidth, SizeHeight);

            textWidth = (int)graphics.MeasureString(CaptionName,
                            CaptionFont).Width;
            textHeight = (int)graphics.MeasureString(CaptionName,
                            CaptionFont).Height;

            x = PositionLeftX + (SizeWidth - textWidth) / 2;
            y = PositionTopY + (SizeHeight - textHeight) / 2;
            graphics.DrawString(CaptionName, CaptionFont,
                new SolidBrush(IsSelectedValue ? Color.White : CaptionColor),
                x, y);
            brush.Dispose();
        }

        /// <summary>
        /// Determines whether the given point falls within the button's bounding rectangle.
        /// </summary>
        /// <param name="x">X coordinate to test, in pixels.</param>
        /// <param name="y">Y coordinate to test, in pixels.</param>
        /// <returns><c>true</c> if the point is inside the button; otherwise <c>false</c>.</returns>
        public bool IsHit(int x, int y)
        {
            return (x >= PositionLeftX &&
                    x < PositionLeftX + SizeWidth &&
                    y >= PositionTopY &&
                    y < PositionTopY + SizeHeight);
        }

        /// <summary>
        /// Gets or sets whether the button spans two rows; setting it to <c>true</c> doubles the button height.
        /// </summary>
        public bool IsTall
        {
            get
            {
                return IsTallValue;
            }
            set
            {
                IsTallValue = value;
                if (value) SizeHeight = (SizeHeight * 2 + SizeMargin * 2);
            }
        }

        /// <summary>
        /// Gets or sets whether the button is pressed; changing the value repaints the button immediately.
        /// </summary>
        public bool IsSelected
        {
            get
            {
                return IsSelectedValue;
            }
            set
            {
                Graphics graphics;

                if (value != IsSelectedValue)
                {
                    IsSelectedValue = value;

                    // Redraw right away
                    graphics = MainControl.CreateGraphics();
                    this.Render(graphics);
                    graphics.Dispose();

                }
            }
        }

        /// <summary>
        /// Gets the <see cref="ScreenKeyboard.Command"/> this button triggers when activated.
        /// </summary>
        public ScreenKeyboard.Command Cmd
        {
            get
            {
                return (ButtonCommand);
            }
        }
    }

    //
    // The following class implements an Edit control.
    //
    /// <summary>
    /// Owner-drawn display line for the calculator that renders the current value, optionally
    /// masking it as a password, and repaints itself when the text changes.
    /// </summary>
    public class EditCalc
    {
        private Control MainControl;
        private Rectangle AreaBounds;
        private String EditStringValue;
        private Font EditFont;
        /// <summary>
        /// When <c>true</c>, the displayed text is masked with asterisks instead of shown in clear.
        /// </summary>
        public bool IsPassword;

        /// <summary>
        /// Initializes a new display line bound to a host control, font and drawing area.
        /// </summary>
        /// <param name="MControl">Control the edit line is drawn on and repaints through.</param>
        /// <param name="font">Font used to draw the text.</param>
        /// <param name="rcBounds">Rectangle occupied by the edit line, in pixels.</param>
        public EditCalc(Control MControl, Font font, Rectangle rcBounds)
        {
            MainControl = MControl;
            EditFont = font;
            AreaBounds = rcBounds;
        }

        /// <summary>
        /// Draws the edit line, right-aligning the current text (masked when <see cref="IsPassword"/> is set)
        /// inside its clipped rectangle.
        /// </summary>
        /// <param name="graphics">Surface to draw the edit line on.</param>
        public void Render(Graphics graphics)
        {
            String str;
            int x, y;
            int textWidth, textHeight;
            SolidBrush brush = new SolidBrush(Color.Black);

            brush.Color = Color.White;
            graphics.FillRectangle(brush, AreaBounds);
            graphics.DrawRectangle(new Pen(Color.Black), AreaBounds);

            str = EditStringValue;
            if (IsPassword)
            {
                int nlen = str.Length;
                StringBuilder sbuild = new StringBuilder();
                for (int i = 0; i < nlen; i++)
                {
                    sbuild.Append("*");
                }
                str = sbuild.ToString();
            }
            textWidth = (int)graphics.MeasureString(str, EditFont).Width;
            textHeight = (int)graphics.MeasureString(str, EditFont).Height;

            x = AreaBounds.Left + AreaBounds.Width - textWidth;
            y = AreaBounds.Top + (AreaBounds.Height - textHeight) / 2;

            graphics.Clip = new Region(AreaBounds);
            brush.Color = Color.Black;
            graphics.DrawString(str, EditFont, brush,
                                x, y);
            graphics.ResetClip();
            brush.Dispose();
        }

        /// <summary>
        /// Gets or sets the text shown in the edit line; assigning a new value repaints it immediately.
        /// </summary>
        public String EditString
        {
            get
            {
                return (EditStringValue);
            }

            set
            {
                Graphics graphics;
                EditStringValue = value;

                // Redraw right away
                graphics = MainControl.CreateGraphics();
                this.Render(graphics);
                graphics.Dispose();
            }
        }
    }

    // The following class describes a mathematical operation token.
    // 
    //
    /// <summary>
    /// A single element of the calculator's expression: either a numeric operand or an
    /// arithmetic operator, tracking its decimal-entry factor and whether it has been sealed.
    /// </summary>
    public class TokenCalc
    {
        private TokenCalc.TokenType TypeValue;
        private Number TokenNumberValue;
        private int DecimalFactorValue;
        private bool IsSealedValue;
        static private char[] Symbols = { '+', '-', 'x', '/' };

        /// <summary>
        /// Kind of a <see cref="TokenCalc"/>: one of the four arithmetic operators, a numeric
        /// value, or Nil to mark the absence of a token.
        /// </summary>
        public enum TokenType
        {
            /// <summary>Absence of a token.</summary>
            Nil = -1,
            /// <summary>Addition operator; also the lowest operator precedence.</summary>
            Add = 0,
            /// <summary>Subtraction operator.</summary>
            Subtract,
            /// <summary>Multiplication operator.</summary>
            Multiply,
            /// <summary>Division operator; the highest operator precedence.</summary>
            Divide,
            /// <summary>A numeric operand rather than an operator.</summary>
            TokenNumber
        };

        /// <summary>
        /// Initializes a new token of the given kind with its decimal-entry factor reset to zero.
        /// </summary>
        /// <param name="type">Kind of token to create.</param>
        public TokenCalc(TokenCalc.TokenType type)
        {
            DecimalFactor = 0;
            this.Type = type;
        }

        /// <summary>
        /// Gets or sets the kind of this token (an operator, a number, or Nil).
        /// </summary>
        public TokenCalc.TokenType Type
        {
            get
            {
                return (TypeValue);
            }
            set
            {
                TypeValue = value;
            }
        }

        /// <summary>
        /// Gets or sets the numeric value carried by this token when it is a number token.
        /// </summary>
        public Number TokenNumber
        {
            get
            {
                return (TokenNumberValue);
            }
            set
            {
                TokenNumberValue = value;
            }
        }

        /// <summary>
        /// Gets or sets the current decimal place weight used while typing digits after the decimal point;
        /// zero means digits are still being entered before the decimal separator.
        /// </summary>
        public int DecimalFactor
        {
            get
            {
                return (DecimalFactorValue);
            }
            set
            {
                DecimalFactorValue = value;
            }
        }

        /// <summary>
        /// Gets or sets whether this token is sealed, meaning the next digit starts a new number
        /// rather than appending to it.
        /// </summary>
        public bool IsSealed
        {
            get
            {
                return (IsSealedValue);
            }

            set
            {
                IsSealedValue = value;
            }
        }

        /// <summary>
        /// Determines whether this token is one of the four arithmetic operators.
        /// </summary>
        /// <returns><c>true</c> if the token is an operator; otherwise <c>false</c>.</returns>
        public bool IsOperator()
        {
            return (this.Type >= TokenCalc.TokenType.Add &&
                    this.Type <= TokenCalc.TokenType.Divide);
        }

        /// <summary>
        /// Determines whether this token is a numeric operand.
        /// </summary>
        /// <returns><c>true</c> if the token is a number; otherwise <c>false</c>.</returns>
        public bool IsNumber()
        {
            return (this.Type == TokenCalc.TokenType.TokenNumber);
        }

        /// <summary>
        /// Determines whether this token has precedence less than or equal to another token,
        /// using the ordering of <see cref="TokenType"/>.
        /// </summary>
        /// <param name="tokenCompare">Token to compare precedence against.</param>
        /// <returns><c>true</c> if this token's precedence is not greater than <paramref name="tokenCompare"/>.</returns>
        public bool IsLessThanOrEqualTo(TokenCalc tokenCompare)
        {
            return (this.Type <= tokenCompare.Type);
        }

        /// <summary>
        /// Returns the operator symbol for an operator token, or the formatted value for a number token.
        /// </summary>
        /// <returns>The token rendered as a string.</returns>
        public override String ToString()
        {
            String resultString;

            if (IsOperator())
                resultString = new String(Symbols[(int)this.Type], 1);
            else
                resultString = TokenNumberValue.ToString();

            return (resultString);
        }
    }

    // TODO: Add description for class Calculator
    //
    /// <summary>
    /// Stack-based calculator engine that holds a list of operator/number tokens, applies digit,
    /// operator and memory commands, evaluates the expression with operator precedence, and can
    /// display a modal calculator dialog through <see cref="ShowCalc(decimal, ref bool, bool)"/>.
    /// </summary>
    public class Calculator
    {
        private List<TokenCalc> TokenList = new List<TokenCalc>();
        private TokenCalc MemoryToken = new TokenCalc(TokenCalc.TokenType.TokenNumber);

        /// <summary>
        /// Initializes a new calculator engine seeded with a single zero token.
        /// </summary>
        public Calculator()
        {
            Reset();
        }

        private void Reset()
        {
            TokenList.Clear();
            AddNumberToken(new Number(0));
        }

        private void AddNumberToken(Number number)
        {
            TokenCalc tok;
            tok = new TokenCalc(TokenCalc.TokenType.TokenNumber);
            tok.TokenNumber = number;
            TokenList.Add(tok);
        }

        private void AddOperatorToken(TokenCalc.TokenType type)
        {
            TokenCalc tok;
            tok = new TokenCalc(type);
            TokenList.Add(tok);
        }

        private void RemoveCurrentToken()
        {
            if (TokenList != null && TokenList.Count > 0)
            {
                TokenList.RemoveAt(TokenList.Count - 1);
            }
        }

        private TokenCalc FetchToken()
        {
            if (TokenList != null && TokenList.Count > 0)
            {
                TokenCalc tok;
                tok = TokenList[0];
                TokenList.RemoveAt(0);
                return (tok);
            }
            else
            {
                return (new TokenCalc(TokenCalc.TokenType.Nil));
            }
        }


        private TokenCalc CurrentToken()
        {
            if (TokenList != null && TokenList.Count > 0)
                return (TokenList[TokenList.Count - 1]);
            else
                return (new TokenCalc(TokenCalc.TokenType.Nil));
        }

        /// <summary>
        /// Stores the current value into memory (M+) when the current token is a number.
        /// </summary>
        public void DoMemorySet()
        {
            if (CurrentToken().IsNumber())
            {
                MemoryToken.TokenNumber = CurrentToken().TokenNumber;
            }
        }

        /// <summary>
        /// Clears the memory (MC) by marking the memory token as empty.
        /// </summary>
        public void DoMemoryClear()
        {
            MemoryToken.Type = TokenCalc.TokenType.Nil;
        }

        /// <summary>
        /// Recalls the memory value (MR), replacing the current number token with the stored value.
        /// </summary>
        public void DoMemoryRecall()
        {
            if (MemoryToken.IsNumber())
            {
                if (CurrentToken().IsNumber())
                    RemoveCurrentToken();

                AddNumberToken(MemoryToken.TokenNumber);
                CurrentToken().IsSealed = true;
            }
        }

        /// <summary>
        /// Begins decimal-fraction entry (.), starting a new zero token first if the current token is not a number.
        /// </summary>
        public void DoDecimal()
        {
            if (!CurrentToken().IsNumber())
                AddNumberToken(new Number(0));

            if (CurrentToken().DecimalFactor == 0)
                CurrentToken().DecimalFactor = 10;
        }

        /// <summary>
        /// Appends a digit to the current number, honoring decimal-fraction position and starting a new
        /// number when the current one is sealed.
        /// </summary>
        /// <param name="n">Digit value from 0 to 9.</param>
        public void DoDigit(int n)
        {
            TokenCalc tok;

            if (CurrentToken().Type == TokenCalc.TokenType.TokenNumber &&
                CurrentToken().IsSealed)
            {
                RemoveCurrentToken();
                AddNumberToken(new Number(0));
            }

            if (CurrentToken().Type == TokenCalc.TokenType.TokenNumber)
            {
                tok = CurrentToken();

                if (tok.DecimalFactor == 0)
                {
                    tok.TokenNumber = Number.Add(
                        Number.Multiply(
                            tok.TokenNumber,
                            new Number(10)
                        ),
                        new Number(n)
                    );
                }
                else
                {
                    tok.TokenNumber = Number.Add(
                        tok.TokenNumber,
                        Number.Divide(
                            new Number(n),
                            new Number(tok.DecimalFactor)
                        )
                    );
                    tok.DecimalFactor *= 10;
                }
            }
            else
            {
                AddNumberToken(new Number(n));
            }
        }

        /// <summary>
        /// Appends an arithmetic operator, sealing the current number or replacing a pending operator.
        /// </summary>
        /// <param name="type">Operator token to append.</param>
        public void DoOperator(TokenCalc.TokenType type)
        {
            if (CurrentToken().IsOperator())
            {
                RemoveCurrentToken();
            }
            else if (CurrentToken().IsNumber())
            {
                CurrentToken().IsSealed = true;
            }

            AddOperatorToken(type);
        }

        /// <summary>
        /// Toggles the sign of the current number (+/-).
        /// </summary>
        public void DoNegative()
        {
            if (CurrentToken().IsNumber())
            {
                CurrentToken().TokenNumber = Number.Multiply(
                    CurrentToken().TokenNumber, new Number(-1));
            }
        }

        /// <summary>
        /// Replaces the current number with its reciprocal (1/x), leaving zero unchanged.
        /// </summary>
        public void DoOneOver()
        {
            if (CurrentToken().IsNumber())
            {
                if (CurrentToken().TokenNumber == new Number(0))
                    CurrentToken().TokenNumber = new Number(0);
                else
                    CurrentToken().TokenNumber = Number.Divide(
                        new Number(1), CurrentToken().TokenNumber);
            }
        }

        /// <summary>
        /// Clears the entire calculation (C), resetting the token list to a single zero.
        /// </summary>
        public void DoClearAll()
        {
            Reset();
        }

        /// <summary>
        /// Clears the current entry (CE): removes the current number or operator, restoring a zero token
        /// when appropriate.
        /// </summary>
        public void DoClearCurrentToken()
        {
            if (CurrentToken().IsNumber())
            {
                if ((CurrentToken().TokenNumber == new Number(0)) &&
                    (TokenList.Count > 1))
                    RemoveCurrentToken();
                else
                {
                    RemoveCurrentToken();
                    AddNumberToken(new Number(0));
                }
            }
            else if (CurrentToken().IsOperator())
            {
                RemoveCurrentToken();
            }
        }

        /// <summary>
        /// Converts the current number to a percentage (%) by dividing it by 100.
        /// </summary>
        public void DoPercent()
        {
            if (CurrentToken().IsNumber())
            {
                CurrentToken().TokenNumber = Number.Divide(
                    CurrentToken().TokenNumber, new Number(100));
            }
        }

        private static TokenCalc TokenEvalBinOp(TokenCalc tokOp, TokenCalc aToken, TokenCalc bToken)
        {
            TokenCalc result;

            result = new TokenCalc(TokenCalc.TokenType.TokenNumber);

            switch (tokOp.Type)
            {
                case TokenCalc.TokenType.Add:
                    result.TokenNumber = Number.Add(
                        aToken.TokenNumber, bToken.TokenNumber);
                    break;

                case TokenCalc.TokenType.Subtract:
                    result.TokenNumber = Number.Subtract(
                        aToken.TokenNumber, bToken.TokenNumber);
                    break;

                case TokenCalc.TokenType.Multiply:
                    result.TokenNumber = Number.Multiply(
                        aToken.TokenNumber, bToken.TokenNumber);
                    break;

                case TokenCalc.TokenType.Divide:
                    result.TokenNumber = Number.Divide(
                        aToken.TokenNumber, bToken.TokenNumber);
                    break;
            }

            return (result);
        }

        private static void DoBinaryEval(Stack<TokenCalc> operatorStack, Stack<TokenCalc> numberStack)
        {
            TokenCalc topOperatorToken;
            TokenCalc aToken, bToken;

            topOperatorToken = operatorStack.Pop();

            bToken = numberStack.Pop();
            aToken = numberStack.Pop();

            numberStack.Push(
                TokenEvalBinOp(topOperatorToken, aToken, bToken));
        }

        /// <summary>
        /// Evaluates the current expression (=) using operator-precedence stacks and replaces the token
        /// list with the sealed result.
        /// </summary>
        public void DoEvaluate()
        {
            Stack<TokenCalc> operatorStack = new Stack<TokenCalc>();
            Stack<TokenCalc> numberStack = new Stack<TokenCalc>();
            TokenCalc currentToken, topOperatorTok;

            if (CurrentToken().IsOperator())
            {
                RemoveCurrentToken();
            }

            // Eval

            while ((currentToken = FetchToken()).Type != TokenCalc.TokenType.Nil)
            {
                if (currentToken.IsNumber())
                {
                    numberStack.Push(currentToken);
                }
                else if (currentToken.IsOperator())
                {
                    if (operatorStack.Count > 0)
                    {
                        topOperatorTok = operatorStack.Peek();

                        if (currentToken.IsLessThanOrEqualTo(topOperatorTok))
                        {
                            DoBinaryEval(operatorStack, numberStack);
                        }
                    }

                    operatorStack.Push(currentToken);
                }
            }

            // Empty the stack

            while (operatorStack.Count > 0)
            {
                DoBinaryEval(operatorStack, numberStack);
            }

            // Update token list

            currentToken = numberStack.Pop();
            Reset();
            RemoveCurrentToken();
            AddNumberToken(currentToken.TokenNumber);
            CurrentToken().IsSealed = true;

            // We're done
        }

        /// <summary>
        /// Builds a spaced textual representation of the current token list.
        /// </summary>
        /// <returns>The expression rendered as a string.</returns>
        public String Render()
        {
            String resultString = "";

            foreach (TokenCalc tok in TokenList)
                resultString += " " + tok.ToString() + " ";

            return (resultString);
        }
        /// <summary>
        /// Shows a modal calculator dialog seeded with a value and returns the value entered by the user.
        /// </summary>
        /// <param name="currentvalue">Initial value shown in the calculator.</param>
        /// <param name="aceptado">Set to <c>true</c> when the user confirms with OK, otherwise <c>false</c>.</param>
        /// <param name="IsPassword">When <c>true</c>, the edit line masks its contents.</param>
        /// <param name="titulo">Caption shown in the dialog title bar.</param>
        /// <param name="nwindow">Owner window for the modal dialog, or <c>null</c>.</param>
        /// <returns>The confirmed value, or the original value when the dialog is cancelled.</returns>
        public static decimal ShowCalc(decimal currentvalue, ref bool aceptado, bool IsPassword, string titulo, IWin32Window nwindow)
        {
            aceptado = false;
            decimal resultat = currentvalue;
            using (Form nform = new Form())
            {
                nform.ShowInTaskbar = false;
                nform.ShowIcon = false;
                nform.StartPosition = FormStartPosition.CenterScreen;
                nform.Width = Convert.ToInt32(750 * Reportman.Drawing.Windows.GraphicUtils.DPIScale);
                nform.Height = Convert.ToInt32(540 * Reportman.Drawing.Windows.GraphicUtils.DPIScale);
                nform.MinimizeBox = false;
                nform.MaximizeBox = false;
                nform.Text = titulo;

                using (ScreenKeyboard dcalc = new ScreenKeyboard())
                {
                    dcalc.Dock = DockStyle.Fill;
                    dcalc.CustomParentForm = nform;
                    nform.Controls.Add(dcalc);
                    dcalc.IsPassword = IsPassword;
                    dcalc.calc.AddNumberToken(new Number(System.Convert.ToDouble(currentvalue)));
                    dcalc.calc.DoEvaluate();
                    dcalc.editBox.EditString = currentvalue.ToString();
                    if (nform.ShowDialog(nwindow) == DialogResult.OK)
                    {
                        resultat = System.Convert.ToDecimal(dcalc.calc.Render());
                        aceptado = true;
                    }

                }
            }
            return resultat;
        }

        /// <summary>
        /// Shows a modal calculator dialog seeded with a value, using an empty title and no owner window.
        /// </summary>
        /// <param name="currentvalue">Initial value shown in the calculator.</param>
        /// <param name="aceptado">Set to <c>true</c> when the user confirms with OK, otherwise <c>false</c>.</param>
        /// <param name="IsPassword">When <c>true</c>, the edit line masks its contents.</param>
        /// <returns>The confirmed value, or the original value when the dialog is cancelled.</returns>
        public static decimal ShowCalc(decimal currentvalue, ref bool aceptado, bool IsPassword)
        {
            return ShowCalc(currentvalue, ref aceptado, IsPassword, "", null);
        }

    }
}
