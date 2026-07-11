using System;
using System.Collections;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace Reportman.Drawing.Forms
{

    /// <summary>
    /// An extender provider that adds a CueBannerText property to TextBox controls,
    /// displaying placeholder (cue banner) text via the EM_SETCUEBANNER Windows message.
    /// </summary>
    [ProvideProperty("CueBannerText", typeof(TextBox))]
    public class CueHelper : Component, IExtenderProvider
    {
        /// <summary>
        /// Initializes a new instance of the CueHelper class.
        /// </summary>
        public CueHelper()
        {
        }
        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = false)]
        private static extern IntPtr SendMessage(IntPtr hWnd, Int32 Msg, IntPtr wParam, IntPtr lParam);
        private const int ECM_FIRST = 0x1500;
        private const int EM_SETCUEBANNER = ECM_FIRST + 1;
        private readonly IntPtr TRUE = (IntPtr)1;

        private Hashtable cueBannerTable = new Hashtable();
        /// <summary>
        /// Specifies whether this object can provide its extender properties to the specified target object.
        /// </summary>
        /// <param name="extendee">The target object to receive the extender properties.</param>
        /// <returns>True if the object can be extended; otherwise, false.</returns>
        public bool CanExtend(object extendee)
        {
            if (extendee is Control)
                return true;
            return false;
        }

        /// <summary>
        /// Gets the cue banner (placeholder) text associated with a text box.
        /// </summary>
        /// <param name="control">The text box control.</param>
        /// <returns>The cue banner text value, or an empty string if none is set.</returns>
        [DefaultValue("")]
        [DisplayName("CueBannerText")]
        public string GetCueBannerText(TextBox control)
        {
            if (control is TextBox)
            {
                string cueText = (string)this.cueBannerTable[control];
                return cueText == null ? string.Empty : cueText;
            }
            return string.Empty;
        }
        /// <summary>
        /// Sets the cue banner (placeholder) text associated with a text box.
        /// </summary>
        /// <param name="control">The text box control.</param>
        /// <param name="cueText">The cue banner text to display when the control is empty and unfocused.</param>
        public void SetCueBannerText(TextBox control, string cueText)
        {
            if (control is TextBox)
            {
                this.cueBannerTable[control] = cueText;
                SendMessage(control.Handle, EM_SETCUEBANNER, TRUE, Marshal.StringToBSTR(cueText));
            }
        }
    }
}
