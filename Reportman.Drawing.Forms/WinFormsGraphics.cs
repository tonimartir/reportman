using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

namespace Reportman.Drawing.Forms
{
    /// <summary>
    /// Windows Forms helpers for resolving the screen DPI, the corresponding DPI scale factor,
    /// and whether the current process is DPI-aware.
    /// </summary>
    public static class WinFormsGraphics
    {
        static object flag = 2;
        private static int intdpi;
        /// <summary>
        /// Gets the current screen DPI resolution value, caching it on first lookup.
        /// </summary>
        /// <returns>The screen DPI resolution.</returns>
        public static int ScreenDPI()
        {
            Monitor.Enter(flag);
            try
            {
                //#if REPMAN_COMPACT
                //		 	intdpi = PrintOutNet.DEFAULT_RESOLUTION;
                //		  	intdpiy=PrintOutNet.DEFAULT_RESOLUTION;
                //#else
                if (intdpi == 0)
                {
                    using (Control ncontrol = new Control())
                    {
                        using (Graphics gr = ncontrol.CreateGraphics())
                        {
                            intdpi = System.Convert.ToInt32(gr.DpiX);
                        }
                    }
                }
                //#endif
                return intdpi;

            }
            finally
            {
                Monitor.Exit(flag);
            }
        }
        static float fDPIScale = 0f;
        /// <summary>
        /// Gets the DPI scale factor ratio relative to standard 96 DPI.
        /// </summary>
        public static float DPIScale
        {
            get
            {
                if (fDPIScale == 0)
                {
                    float ndpi = ScreenDPI();
                    fDPIScale = ndpi / 96.0f;
                }
                return fDPIScale;
            }
        }
        /// <summary>
        /// Native Windows API lookup to query DPI awareness.
        /// </summary>
        /// <param name="hprocess">The target process handle pointer.</param>
        /// <param name="dpiAwareness">Output argument: receives the DPI awareness enum flag.</param>
        /// <returns>Zero if successful; otherwise, a non-zero HRESULT error code.</returns>
        [DllImport("shcore.dll", SetLastError = true)]
        public static extern int GetProcessDpiAwareness(IntPtr hprocess, out DpiAwareness dpiAwareness);

        /// <summary>
        /// The DPI-awareness level of a process as reported by the Windows shell:
        /// unaware, system-aware, or per-monitor-aware.
        /// </summary>
        public enum DpiAwareness
        {
            /// <summary>The process is not DPI-aware.</summary>
            Unaware = 0,
            /// <summary>The process is system DPI-aware (scaled by OS once).</summary>
            SystemAware = 1,
            /// <summary>The process is per-monitor DPI-aware (scaled dynamically per monitor).</summary>
            PerMonitorAware = 2
        }
        /// <summary>
        /// Checks whether the running Windows Forms process has enabled high-DPI scaling awareness.
        /// </summary>
        /// <returns>True if DPI-aware; otherwise, false.</returns>
        public static bool IsWindowsFormsDPIAware()

        {
            Version osVersion = Environment.OSVersion.Version;
            if (osVersion.Major > 6 || (osVersion.Major == 6 && osVersion.Minor >= 3))
            {
                DpiAwareness dpiStatus;
                GetProcessDpiAwareness(System.Diagnostics.Process.GetCurrentProcess().Handle, out dpiStatus);
                // Verificar el tipo de DPI-awareness y mostrar un mensaje
                switch (dpiStatus)
                {
                    case DpiAwareness.Unaware:
                        return false;
                    case DpiAwareness.SystemAware:
                        return true;
                    case DpiAwareness.PerMonitorAware:
                        return true;
                }
                return false;
            }
            else
                return false;
        }

    }


}
