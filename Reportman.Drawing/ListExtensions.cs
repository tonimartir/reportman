using System.Collections.Generic;

namespace Reportman.Drawing
{
    public static class ListExtensions
    {
        public static void Swap<T>(this List<T> list, int index1, int index2)
        {
            if (list == null)
                throw new System.ArgumentNullException(nameof(list));

            if (index1 < 0 || index2 < 0 || index1 >= list.Count || index2 >= list.Count)
                throw new System.ArgumentOutOfRangeException("Índices fuera de rango");

            if (index1 == index2)
                return; // No tiene sentido intercambiar el mismo índice

            (list[index1], list[index2]) = (list[index2], list[index1]);
        }
    }
}
