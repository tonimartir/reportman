using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

namespace Reportman.Drawing.Forms
{
    public static class WinFormsGraphics
    {
        static object flag = 2;
        private static int intdpi;
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
        [DllImport("shcore.dll", SetLastError = true)]
        public static extern int GetProcessDpiAwareness(IntPtr hprocess, out DpiAwareness dpiAwareness);

        public enum DpiAwareness
        {
            Unaware = 0,
            SystemAware = 1,
            PerMonitorAware = 2
        }
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
