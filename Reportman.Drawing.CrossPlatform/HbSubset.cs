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
 *     Software is distributed on an "AS IS" basis,
 *     WITHOUT WARRANTY OF ANY KIND, either
 *     express or implied.  See the License for the specific
 *     language  rights and limitations.
 *
 *  Copyright (c) 1994 - 2008 Toni Martir (toni@reportman.es)
 *  All Rights Reserved.
*/
#endregion

using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace Reportman.Drawing
{
    /// <summary>
    /// EL SUBSETTER DE HARFBUZZ, el mismo camino que el motor Delphi elige cuando la biblioteca
    /// lo trae (rpHarfBuzz.pas + rpinfoprovft.pas GetFontStreamHarfBuzz).
    ///
    /// El subsetter propio de esta casa sabe de `glyf` y `loca`: TrueType llano. hb-subset sabe
    /// ademas de CFF, de colecciones y de fuentes variables, y lo mantiene el propio proyecto
    /// HarfBuzz. Los simbolos ya vienen en el binario nativo que se distribuye con HarfBuzzSharp
    /// —26 `hb_subset_*` en libHarfBuzzSharp—, asi que esto es un enlace tardio, no una
    /// dependencia nueva.
    ///
    /// SE COMPRUEBA EN EJECUCION, como en Delphi: si la biblioteca no carga o su version no trae
    /// el subsetter, <see cref="Available"/> queda en false y el llamador usa el de siempre.
    /// </summary>
    public static class HbSubset
    {
        private static readonly string[] LibraryNames =
        {
            // El nativo que empaqueta HarfBuzzSharp. En Windows el nombre pelado basta; en Linux
            // hay que decir el fichero, que el cargador no prueba el sufijo por su cuenta cuando
            // la biblioteca vive junto al ejecutable publicado.
            "libHarfBuzzSharp",
            "libHarfBuzzSharp.so",
            "libHarfBuzzSharp.dylib",
            "HarfBuzzSharp",
            // Y si alguien trae la suya del sistema, tambien vale (es lo que enlaza el Delphi).
            "libharfbuzz-subset.so.0",
            "libharfbuzz.so.0",
        };

        private const uint HB_MEMORY_MODE_READONLY = 0;
        // Conserva los numeros de glifo originales. El PDF escribe en el contenido los indices
        // que devolvio la conformacion sobre la fuente ENTERA, y por omision hb-subset los
        // renumera de forma compacta: cada <gid> Tj acaba apuntando a otro glifo y la pagina
        // sale con letras que no son. Es el RESPALDO: se usa solo cuando la biblioteca no trae
        // la API de plan (abajo), que es la que permite el subset compacto Y saber a que
        // numero fue a parar cada glifo — el escritor de PDF traduce con un /CIDToGIDMap.
        private const uint HB_SUBSET_FLAGS_RETAIN_GIDS = 2;
        private const uint HB_MAP_VALUE_INVALID = 0xFFFFFFFF;

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate IntPtr BlobCreate(IntPtr data, uint length, uint mode, IntPtr userData, IntPtr destroy);
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate void PtrVoid(IntPtr p);
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate IntPtr FaceCreate(IntPtr blob, uint index);
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate IntPtr InputCreate();
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate IntPtr PtrToPtr(IntPtr p);
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate void SetAdd(IntPtr set, uint codepoint);
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate void InputSetFlags(IntPtr input, uint flags);
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate IntPtr SubsetOrFail(IntPtr face, IntPtr input);
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate IntPtr BlobGetData(IntPtr blob, out uint length);
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate IntPtr PlanCreate(IntPtr face, IntPtr input);
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate uint MapGet(IntPtr map, uint key);

        // La API de plan (HarfBuzz >= 4.0): el mismo subset en dos pasos, con el mapa de
        // glifos viejo -> nuevo a la vista entre uno y otro.
        private static PlanCreate hb_subset_plan_create_or_fail;
        private static PtrToPtr hb_subset_plan_execute_or_fail;
        private static PtrToPtr hb_subset_plan_old_to_new_glyph_mapping;
        private static PtrVoid hb_subset_plan_destroy;
        private static MapGet hb_map_get;

        private static BlobCreate hb_blob_create;
        private static PtrVoid hb_blob_destroy;
        private static FaceCreate hb_face_create;
        private static PtrVoid hb_face_destroy;
        private static PtrToPtr hb_face_reference_blob;
        private static InputCreate hb_subset_input_create_or_fail;
        private static PtrVoid hb_subset_input_destroy;
        private static PtrToPtr hb_subset_input_glyph_set;
        private static InputSetFlags hb_subset_input_set_flags;
        private static SetAdd hb_set_add;
        private static SubsetOrFail hb_subset_or_fail;
        private static BlobGetData hb_blob_get_data;

        private static readonly object InitLock = new object();
        private static bool initialized;
        private static IntPtr library;

        /// <summary>True when the HarfBuzz subsetter was found and bound.</summary>
        public static bool Available { get; private set; }

        /// <summary>
        /// Whether compact subsets (renumbered glyphs + /CIDToGIDMap in the PDF) are produced when
        /// the library allows it. True by default; a diagnostic switch to compare against the
        /// subset that keeps the original glyph indices.
        /// </summary>
        public static bool CompactSubsets = true;

        /// <summary>Name of the shared library that provided it, empty when none did.</summary>
        public static string LibraryName { get; private set; }

        /// <summary>Binds the subsetter once per process. Never throws.</summary>
        public static void Init()
        {
            lock (InitLock)
            {
                if (initialized)
                    return;
                initialized = true;
                LibraryName = "";
                try { Available = Bind(); }
                catch { Available = false; }
            }
        }

        /// <summary>
        /// Devuelve la fuente reducida a los glifos que se usan, o null si no se puede (entonces
        /// el llamador se queda con lo que ya tenia). Los indices de glifo se CONSERVAN.
        /// </summary>
        /// <param name="fuente">Los bytes de la fuente entera.</param>
        /// <param name="caraIndice">La cara dentro del fichero: importa en una coleccion.</param>
        /// <param name="glifos">Los indices de glifo que hay que conservar.</param>
        public static byte[] Subset(byte[] fuente, int caraIndice, IEnumerable<int> glifos)
        {
            SortedList<int, int> mapa;
            return Subset(fuente, caraIndice, glifos, false, out mapa);
        }

        /// <summary>
        /// La fuente reducida a los glifos que se usan. Con <paramref name="compacto"/> los glifos
        /// se RENUMERAN (el subset pesa lo que pesan sus glifos, no el hueco hasta el mayor) y
        /// <paramref name="mapa"/> dice a que numero nuevo fue cada uno de los pedidos — para que
        /// el escritor de PDF, que ya tiene el contenido con los numeros viejos, traduzca con un
        /// /CIDToGIDMap. Si la biblioteca no trae la API de plan, se cae al subset que conserva
        /// los indices y <paramref name="mapa"/> vuelve null (identidad): siempre correcto,
        /// solo mas gordo. Null si no se puede subsetear.
        /// </summary>
        public static byte[] Subset(byte[] fuente, int caraIndice, IEnumerable<int> glifos,
            bool compacto, out SortedList<int, int> mapa)
        {
            mapa = null;
            Init();
            if (!Available || fuente == null || fuente.Length == 0)
                return null;
            bool conPlan = compacto && CompactSubsets && hb_subset_plan_create_or_fail != null
                && hb_subset_plan_execute_or_fail != null
                && hb_subset_plan_old_to_new_glyph_mapping != null
                && hb_subset_plan_destroy != null && hb_map_get != null;

            IntPtr datos = IntPtr.Zero, blob = IntPtr.Zero, face = IntPtr.Zero;
            IntPtr input = IntPtr.Zero, subset = IntPtr.Zero, plan = IntPtr.Zero;
            try
            {
                datos = Marshal.AllocHGlobal(fuente.Length);
                Marshal.Copy(fuente, 0, datos, fuente.Length);
                blob = hb_blob_create(datos, (uint)fuente.Length, HB_MEMORY_MODE_READONLY,
                    IntPtr.Zero, IntPtr.Zero);
                if (blob == IntPtr.Zero) return null;
                face = hb_face_create(blob, (uint)caraIndice);
                if (face == IntPtr.Zero) return null;
                input = hb_subset_input_create_or_fail();
                if (input == IntPtr.Zero) return null;

                if (!conPlan && hb_subset_input_set_flags != null)
                    hb_subset_input_set_flags(input, HB_SUBSET_FLAGS_RETAIN_GIDS);
                IntPtr conjunto = hb_subset_input_glyph_set(input);
                if (conjunto == IntPtr.Zero) return null;
                List<int> pedidos = new List<int>();
                foreach (int g in glifos)
                {
                    hb_set_add(conjunto, (uint)g);
                    pedidos.Add(g);
                }

                if (conPlan)
                {
                    plan = hb_subset_plan_create_or_fail(face, input);
                    if (plan == IntPtr.Zero) return null;
                    // El mapa se lee ANTES de ejecutar: es del plan, y el plan es lo que se
                    // destruye al final. Solo los glifos pedidos: los que hb-subset anyade
                    // por su cuenta (componentes de un compuesto) no los nombra ningun Tj.
                    IntPtr hbmap = hb_subset_plan_old_to_new_glyph_mapping(plan);
                    if (hbmap == IntPtr.Zero) return null;
                    SortedList<int, int> traduccion = new SortedList<int, int>();
                    foreach (int g in pedidos)
                    {
                        uint nuevo = hb_map_get(hbmap, (uint)g);
                        if (nuevo == HB_MAP_VALUE_INVALID) return null;   // no deberia: se pidio
                        traduccion[g] = (int)nuevo;
                    }
                    subset = hb_subset_plan_execute_or_fail(plan);
                    if (subset == IntPtr.Zero) return null;
                    mapa = traduccion;
                }
                else
                {
                    subset = hb_subset_or_fail(face, input);
                    if (subset == IntPtr.Zero) return null;
                }

                IntPtr salida = hb_face_reference_blob(subset);
                if (salida == IntPtr.Zero) return null;
                try
                {
                    uint tam;
                    IntPtr p = hb_blob_get_data(salida, out tam);
                    if (p == IntPtr.Zero || tam == 0) return null;
                    byte[] resultado = new byte[tam];
                    Marshal.Copy(p, resultado, 0, (int)tam);
                    return resultado;
                }
                finally { hb_blob_destroy(salida); }
            }
            catch
            {
                mapa = null;
                return null;
            }
            finally
            {
                if (subset != IntPtr.Zero) hb_face_destroy(subset);
                if (plan != IntPtr.Zero) hb_subset_plan_destroy(plan);
                if (input != IntPtr.Zero) hb_subset_input_destroy(input);
                if (face != IntPtr.Zero) hb_face_destroy(face);
                if (blob != IntPtr.Zero) hb_blob_destroy(blob);
                if (datos != IntPtr.Zero) Marshal.FreeHGlobal(datos);
            }
        }

        private static bool Bind()
        {
            IntPtr handle = IntPtr.Zero;
            string cargada = "";
            foreach (string nombre in LibraryNames)
            {
                if (TryLoad(nombre, out handle) && handle != IntPtr.Zero) { cargada = nombre; break; }
                // Y con la ruta entera: en Linux `dlopen` con el nombre pelado busca en las rutas
                // del sistema, no junto al ejecutable, que es justo donde el publish la deja.
                try
                {
                    string junto = System.IO.Path.Combine(AppContext.BaseDirectory, nombre);
                    if (System.IO.File.Exists(junto) && TryLoad(junto, out handle) && handle != IntPtr.Zero)
                    {
                        cargada = junto;
                        break;
                    }
                }
                catch { }
            }
            if (handle == IntPtr.Zero) return false;
            library = handle;
            LibraryName = cargada;

            hb_blob_create = Bind<BlobCreate>("hb_blob_create");
            hb_blob_destroy = Bind<PtrVoid>("hb_blob_destroy");
            hb_blob_get_data = Bind<BlobGetData>("hb_blob_get_data");
            hb_face_create = Bind<FaceCreate>("hb_face_create");
            hb_face_destroy = Bind<PtrVoid>("hb_face_destroy");
            hb_face_reference_blob = Bind<PtrToPtr>("hb_face_reference_blob");
            hb_set_add = Bind<SetAdd>("hb_set_add");
            hb_subset_input_create_or_fail = Bind<InputCreate>("hb_subset_input_create_or_fail");
            hb_subset_input_destroy = Bind<PtrVoid>("hb_subset_input_destroy");
            hb_subset_input_glyph_set = Bind<PtrToPtr>("hb_subset_input_glyph_set");
            hb_subset_input_set_flags = Bind<InputSetFlags>("hb_subset_input_set_flags");
            hb_subset_or_fail = Bind<SubsetOrFail>("hb_subset_or_fail");
            // La API de plan es opcional: sin ella, subset con los indices conservados.
            hb_subset_plan_create_or_fail = Bind<PlanCreate>("hb_subset_plan_create_or_fail");
            hb_subset_plan_execute_or_fail = Bind<PtrToPtr>("hb_subset_plan_execute_or_fail");
            hb_subset_plan_old_to_new_glyph_mapping = Bind<PtrToPtr>("hb_subset_plan_old_to_new_glyph_mapping");
            hb_subset_plan_destroy = Bind<PtrVoid>("hb_subset_plan_destroy");
            hb_map_get = Bind<MapGet>("hb_map_get");

            // `set_flags` es opcional (no esta en las HarfBuzz mas viejas); el resto no.
            return hb_blob_create != null && hb_blob_destroy != null && hb_blob_get_data != null
                && hb_face_create != null && hb_face_destroy != null && hb_face_reference_blob != null
                && hb_set_add != null && hb_subset_input_create_or_fail != null
                && hb_subset_input_destroy != null && hb_subset_input_glyph_set != null
                && hb_subset_or_fail != null;
        }

        private static T Bind<T>(string name) where T : class
        {
            IntPtr address = TryGetExport(library, name);
            if (address == IntPtr.Zero) return null;
            return (T)(object)Marshal.GetDelegateForFunctionPointer(address, typeof(T));
        }

#if NETFRAMEWORK
        private static bool TryLoad(string name, out IntPtr handle) { handle = IntPtr.Zero; return false; }
        private static IntPtr TryGetExport(IntPtr lib, string name) { return IntPtr.Zero; }
#else
        private static bool TryLoad(string name, out IntPtr handle)
        {
            return NativeLibrary.TryLoad(name, out handle);
        }

        private static IntPtr TryGetExport(IntPtr lib, string name)
        {
            IntPtr address;
            if (NativeLibrary.TryGetExport(lib, name, out address))
                return address;
            return IntPtr.Zero;
        }
#endif
    }
}
