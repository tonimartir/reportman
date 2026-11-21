#region Copyright
/*
 *  Report Manager:  Database Reporting tool for .Net and Mono
 *
 *     This Source Code Form is subject to the terms of the Mozilla
 *     Public License, v. 2.0. If a copy of the MPL was not distributed
 *     with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
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
        // hb_subset_sets_t: the set of the tables the subset leaves out
        private const int HB_SUBSET_SETS_DROP_TABLE_TAG = 3;

        // ONLY THE TABLES A PDF READS (18-11-2026, as rpHarfBuzz.pas RpHBDropTablesForPDF). hb-subset
        // keeps every table of the font it knows how to subset: GSUB, GPOS, GDEF, name, post, OS/2,
        // cmap, hdmx, VDMX, vhea/vmtx, MATH... A PDF shapes nothing and reads none of them, and they
        // took a quarter to a half of every embedded font (Arial: hdmx alone, 83 KB of 160 KB). A
        // TrueType font program keeps the tables of ISO 32000-1, 9.9, the ones TrueTypeFontSubSet
        // writes, plus cmap for a simple font, which selects its glyphs through it. A font with CFF
        // outlines keeps the CFF and the tables every OpenType font has.
        private static readonly uint[] TablasTrueType =
        {
            0x676C7966, // glyf
            0x6C6F6361, // loca
            0x68656164, // head
            0x68686561, // hhea
            0x686D7478, // hmtx
            0x6D617870, // maxp
            0x63767420, // 'cvt '
            0x6670676D, // fpgm
            0x70726570, // prep
        };
        private static readonly uint[] TablasCFF =
        {
            0x43464620, // 'CFF '
            0x68656164, // head
            0x68686561, // hhea
            0x686D7478, // hmtx
            0x6D617870, // maxp
            0x636D6170, // cmap
            0x6E616D65, // name
            0x4F532F32, // OS/2
            0x706F7374, // post
        };
        private const uint TAG_CFF = 0x43464620;
        private const uint TAG_CMAP = 0x636D6170;

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
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate IntPtr InputSet(IntPtr input, int setType);
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate uint GetTableTags(IntPtr face, uint startOffset, ref uint tableCount, [Out] uint[] tags);

        // Optional (HarfBuzz 2.9.1): without them every table is kept, as before
        private static InputSet hb_subset_input_set;
        private static GetTableTags hb_face_get_table_tags;

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

        // The static instance of a variable font (HarfBuzz >= 6.0), all optional: without them a
        // variable font goes whole, as before.
        [StructLayout(LayoutKind.Sequential)]
        private struct AxisInfo
        {
            public uint AxisIndex, Tag, NameId, Flags;
            public float MinValue, DefaultValue, MaxValue;
            public uint Reserved;
        }
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate uint GetAxisInfos(IntPtr face, uint startOffset, ref uint axesCount, [Out] AxisInfo[] axes);
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate uint GetInstanceCoords(IntPtr face, uint instanceIndex, ref uint coordsLength, [Out] float[] coords);
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate bool PinAxisLocation(IntPtr input, IntPtr face, uint axisTag, float axisValue);
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate IntPtr FaceReferenceTable(IntPtr face, uint tag);
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate uint BlobGetLength(IntPtr blob);
        private static GetAxisInfos hb_ot_var_get_axis_infos;
        private static GetInstanceCoords hb_ot_var_named_instance_get_design_coords;
        private static PinAxisLocation hb_subset_input_pin_axis_location;
        private static FaceReferenceTable hb_face_reference_table;
        private static BlobGetLength hb_blob_get_length;

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
            return Subset(fuente, caraIndice, glifos, compacto, false, false, out mapa);
        }

        /// <summary>
        /// The same, with two more choices. <paramref name="renumeraConservandoCids"/>: a CID-keyed
        /// CFF font whose CIDs are its glyph numbers (Noto Sans CJK, Source Han) is renumbered with no
        /// map at all (18-11-2026): its subset keeps every glyph's CID in the charset, and a
        /// CIDFontType0 selects glyphs by CID, so the content stream still draws the right ones — and
        /// keeping the numbers took the whole CharStrings INDEX and hmtx (Noto Sans CJK JP with 34
        /// glyphs: 155 KB compressed instead of 7 KB). <paramref name="conservaCmap"/>: a simple font
        /// selects its glyphs through the cmap; a CID font does not need it.
        /// </summary>
        public static byte[] Subset(byte[] fuente, int caraIndice, IEnumerable<int> glifos,
            bool compacto, bool renumeraConservandoCids, bool conservaCmap, out SortedList<int, int> mapa)
        {
            mapa = null;
            Init();
            if (!Available || fuente == null || fuente.Length == 0)
                return null;
            if (renumeraConservandoCids)
                compacto = false;
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
                // The face inside a collection is the lower 16 bits; the upper ones name the
                // instance of a variable font (fontconfig, FreeType), pinned below
                face = hb_face_create(blob, (uint)caraIndice & 0xFFFF);
                if (face == IntPtr.Zero) return null;
                input = hb_subset_input_create_or_fail();
                if (input == IntPtr.Zero) return null;
                PinVariableAxes(input, face, (uint)caraIndice >> 16);
                QuitaTablasQueElPdfNoLee(input, face, conservaCmap);

                if (!conPlan && !renumeraConservandoCids && hb_subset_input_set_flags != null)
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

        /// <summary>
        /// A VARIABLE FONT AS A STATIC ONE (12-10-2026, as rpHarfBuzz.pas RpHBVariableInstance). PDF
        /// has no variable fonts: a variable font embedded with its variations draws its default
        /// instance whatever weight the text was laid out with, and the bold of Noto Sans Arabic came
        /// out regular, with the advances of the bold. Every axis is pinned at the coordinates of the
        /// named instance (1-based, 0 for the default instance), which also drops the variation
        /// tables. Only TrueType outlines (glyf, no CFF2), and only when the library can do it:
        /// otherwise the font goes whole, as before.
        /// </summary>
        private static void PinVariableAxes(IntPtr input, IntPtr face, uint instance)
        {
            if (hb_ot_var_get_axis_infos == null || hb_ot_var_named_instance_get_design_coords == null
                || hb_subset_input_pin_axis_location == null || hb_face_reference_table == null
                || hb_blob_get_length == null)
                return;
            if (TableLength(face, 0x66766172) == 0          // 'fvar'
                || TableLength(face, 0x676C7966) == 0       // 'glyf'
                || TableLength(face, 0x43464632) != 0)      // 'CFF2'
                return;
            uint count = 0;
            uint total = hb_ot_var_get_axis_infos(face, 0, ref count, null);
            if (total == 0)
                return;
            AxisInfo[] axes = new AxisInfo[total];
            count = total;
            hb_ot_var_get_axis_infos(face, 0, ref count, axes);
            float[] coords = new float[total];
            for (int i = 0; i < total; i++)
                coords[i] = axes[i].DefaultValue;
            if (instance > 0)
            {
                uint ncoords = total;
                hb_ot_var_named_instance_get_design_coords(face, instance - 1, ref ncoords, coords);
            }
            for (int i = 0; i < count; i++)
                hb_subset_input_pin_axis_location(input, face, axes[i].Tag, coords[i]);
        }

        /// <summary>Adds to the subset's drop set every table of the face a PDF does not read.</summary>
        private static void QuitaTablasQueElPdfNoLee(IntPtr input, IntPtr face, bool conservaCmap)
        {
            if (hb_subset_input_set == null || hb_face_get_table_tags == null)
                return;
            uint cuantas = 256;
            uint[] tags = new uint[cuantas];
            hb_face_get_table_tags(face, 0, ref cuantas, tags);
            if (cuantas == 0)
                return;
            IntPtr fuera = hb_subset_input_set(input, HB_SUBSET_SETS_DROP_TABLE_TAG);
            if (fuera == IntPtr.Zero)
                return;
            bool cff = false;
            for (int i = 0; i < cuantas; i++)
                if (tags[i] == TAG_CFF)
                    cff = true;
            uint[] seQuedan = cff ? TablasCFF : TablasTrueType;
            for (int i = 0; i < cuantas; i++)
            {
                if (conservaCmap && tags[i] == TAG_CMAP)
                    continue;
                if (Array.IndexOf(seQuedan, tags[i]) < 0)
                    hb_set_add(fuera, tags[i]);
            }
        }

        private static uint TableLength(IntPtr face, uint tag)
        {
            IntPtr table = hb_face_reference_table(face, tag);
            if (table == IntPtr.Zero)
                return 0;
            try { return hb_blob_get_length(table); }
            finally { hb_blob_destroy(table); }
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
            // Variable fonts as static instances: optional, as the plan API
            hb_ot_var_get_axis_infos = Bind<GetAxisInfos>("hb_ot_var_get_axis_infos");
            hb_ot_var_named_instance_get_design_coords = Bind<GetInstanceCoords>("hb_ot_var_named_instance_get_design_coords");
            hb_subset_input_pin_axis_location = Bind<PinAxisLocation>("hb_subset_input_pin_axis_location");
            hb_face_reference_table = Bind<FaceReferenceTable>("hb_face_reference_table");
            hb_blob_get_length = Bind<BlobGetLength>("hb_blob_get_length");
            // Only the tables a PDF reads: optional, as the plan API
            hb_subset_input_set = Bind<InputSet>("hb_subset_input_set");
            hb_face_get_table_tags = Bind<GetTableTags>("hb_face_get_table_tags");

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
