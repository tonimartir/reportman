using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using System;
using System.Collections;

namespace Reportman.Reporting
{
    /// <summary>
    /// An ordered, self-growing collection of report <see cref="Param"/> objects, indexable by position
    /// or by alias, with add/insert/remove/swap operations and support for enumeration, cloning and JSON serialization.
    /// </summary>
    [JsonConverter(typeof(ParamsConverter))]
    public class Params : IEnumerable, ICloneable
    {
        Param[] FItems;
        const int FIRST_ALLOCATION_OBJECTS = 10;
        int FCount;
        /// <summary>
        /// Initializes a new, empty parameter collection with a default internal capacity.
        /// </summary>
        public Params()
        {
            FCount = 0;
            FItems = new Param[FIRST_ALLOCATION_OBJECTS];
        }
        /// <summary>
        /// Removes all parameters from the collection, leaving it empty.
        /// </summary>
        public void Clear()
        {
            for (int i = 0; i < FCount; i++)
                FItems[i] = null;
            FCount = 0;
        }
        private void CheckRange(int index)
        {
            if ((index < 0) || (index >= FCount))
                throw new Exception("Index out of range on Params collection");
        }
        /// <summary>
        /// Returns the index of the first parameter whose alias equals <paramref name="avalue"/>,
        /// or -1 if no parameter matches.
        /// </summary>
        /// <param name="avalue">The alias to search for.</param>
        /// <returns>The zero-based index of the matching parameter, or -1 if not found.</returns>
        public int IndexOf(string avalue)
        {
            int aresult = -1;
            for (int i = 0; i < Count; i++)
            {
                if (FItems[i].Alias == avalue)
                {
                    aresult = i;
                    break;
                }
            }
            return aresult;
        }
        /// <summary>
        /// Returns the index of the specified parameter instance, or -1 if it is not in the collection.
        /// </summary>
        /// <param name="avalue">The parameter instance to locate.</param>
        /// <returns>The zero-based index of the parameter, or -1 if not found.</returns>
        public int IndexOf(Param avalue)
        {
            int aresult = -1;
            for (int i = 0; i < Count; i++)
            {
                if (FItems[i] == avalue)
                {
                    aresult = i;
                    break;
                }
            }
            return aresult;
        }
        /// <summary>
        /// Gets or sets the parameter at the specified position in the collection.
        /// </summary>
        /// <param name="index">The zero-based position of the parameter.</param>
        /// <returns>The parameter at the given index.</returns>
        public Param this[int index]
        {
            get { CheckRange(index); return FItems[index]; }
            set { CheckRange(index); FItems[index] = value; }
        }
        /// <summary>
        /// Removes the specified parameter from the collection, shifting the following items down.
        /// Throws if the parameter is not present.
        /// </summary>
        /// <param name="nparam">The parameter to remove.</param>
        public void Remove(Param nparam)
        {
            int index = IndexOf(nparam);
            if (index < 0)
                throw new Exception("Parameter does not exists:" + nparam.Alias);
            for (int i = index; i < FCount - 1; i++)
            {
                FItems[i] = FItems[i + 1];
            }
            FCount--;
        }
        /// <summary>
        /// Removes the parameter at the specified index, shifting the following items down.
        /// </summary>
        /// <param name="index">The zero-based index of the parameter to remove.</param>
        public void RemoveAt(int index)
        {
            if ((index >= FCount) || (index < 0))
                throw new Exception("Parameter index out of range: " + index.ToString());
            for (int i = index; i < FCount - 1; i++)
            {
                FItems[i] = FItems[i + 1];
            }
            FCount--;
        }
        /// <summary>
        /// Gets the parameter whose alias matches <paramref name="paramname"/>, or null if none matches.
        /// </summary>
        /// <param name="paramname">The alias of the parameter to retrieve.</param>
        /// <returns>The matching parameter, or null if no parameter has the given alias.</returns>
        public Param this[string paramname]
        {
            get
            {
                int index = IndexOf(paramname);
                if (index >= 0)
                    return FItems[index];
                else
                    return null;
            }
        }
        /// <summary>
        /// Gets the number of parameters currently stored in the collection.
        /// </summary>
        public int Count { get { return FCount; } }
        /// <summary>
        /// Appends a parameter to the end of the collection, growing the internal storage when needed.
        /// </summary>
        /// <param name="obj">The parameter to add.</param>
        public void Add(Param obj)
        {
            if (FCount > (FItems.Length - 2))
            {
                Param[] nobjects = new Param[FCount];
                System.Array.Copy(FItems, 0, nobjects, 0, FCount);
                FItems = new Param[FItems.Length * 2];
                System.Array.Copy(nobjects, 0, FItems, 0, FCount);
            }
            FItems[FCount] = obj;
            FCount++;
        }
        /// <summary>
        /// Inserts a parameter at the specified index, shifting the existing items up to make room.
        /// </summary>
        /// <param name="insertIndex">The zero-based position at which to insert the parameter.</param>
        /// <param name="obj">The parameter to insert.</param>
        public void Insert(int insertIndex, Param obj)
        {
            if ((insertIndex < 0) || (insertIndex > FCount))
                throw new Exception("Parameter insert index out of range: " + insertIndex.ToString());
            if (FCount > (FItems.Length - 2))
            {
                Param[] nobjects = new Param[FItems.Length * 2];
                System.Array.Copy(FItems, 0, nobjects, 0, FCount);
                FItems = nobjects;
            }
            for (int i = FCount; i > insertIndex; i--)
            {
                FItems[i] = FItems[i - 1];
            }
            FItems[insertIndex] = obj;
            FCount++;
        }
        /// <summary>
        /// Exchanges the parameters stored at the two specified indexes.
        /// </summary>
        /// <param name="index1">The index of the first parameter.</param>
        /// <param name="index2">The index of the second parameter.</param>
        public void Swap(int index1, int index2)
        {
            if ((index1 < 0) || (index2 < 0))
                throw new Exception("Index out of bounds in Params.Swap");
            if ((index1 >= FCount) || (index2 >= FCount))
                throw new Exception("Index out of bounds in Params.Swap");
            Param buf = FItems[index1];
            FItems[index1] = FItems[index2];
            FItems[index2] = buf;
        }
        // IEnumerable Interface Implementation:
        //   Declaration of the GetEnumerator() method
        //   required by IEnumerable
        /// <summary>
        /// Returns an enumerator that iterates over the parameters in the collection.
        /// </summary>
        /// <returns>An enumerator for the contained <see cref="Param"/> items.</returns>
        public IEnumerator GetEnumerator()
        {
            return new ParamEnumerator(this);
        }
        // Inner class implements IEnumerator interface:
        /// <summary>
        /// Iterates over the <see cref="Param"/> items contained in a <see cref="Params"/> collection.
        /// </summary>
        public class ParamEnumerator : IEnumerator
        {
            private int position = -1;
            private Params t;

            /// <summary>
            /// Initializes a new enumerator positioned before the first item of the given collection.
            /// </summary>
            /// <param name="t">The collection to iterate over.</param>
            public ParamEnumerator(Params t)
            {
                this.t = t;
            }

            // Declare the MoveNext method required by IEnumerator:
            /// <summary>
            /// Advances the enumerator to the next parameter.
            /// </summary>
            /// <returns>True if there is a next parameter; false if the end of the collection was reached.</returns>
            public bool MoveNext()
            {
                if (position < t.Count - 1)
                {
                    position++;
                    return true;
                }
                else
                {
                    return false;
                }
            }

            // Declare the Reset method required by IEnumerator:
            /// <summary>
            /// Resets the enumerator to its initial position, before the first parameter.
            /// </summary>
            public void Reset()
            {
                position = -1;
            }

            // Declare the Current property required by IEnumerator:
            /// <summary>
            /// Gets the parameter at the enumerator's current position.
            /// </summary>
            public object Current
            {
                get
                {
                    return t[position];
                }
            }
        }
        /// <summary>
        /// Creates a deep copy of the collection and assigns the given report to every cloned parameter.
        /// </summary>
        /// <param name="rp">The report to associate with each cloned parameter.</param>
        /// <returns>A new collection of cloned parameters bound to <paramref name="rp"/>.</returns>
        public Params Clone(Report rp)
        {
            Params aparams = (Params)Clone();
            foreach (Param p in aparams)
            {
                p.Report = rp;
            }
            return aparams;
        }
        /// <summary>
        /// Creates a deep copy of the collection, cloning each contained parameter.
        /// </summary>
        /// <returns>A new <see cref="Params"/> collection containing clones of every parameter.</returns>
        public object Clone()
        {
            Params aparams = new();
            foreach (Param p in this)
            {
                aparams.Add((Param)p.Clone());
            }
            return aparams;
        }
        /// <summary>
        /// Exchanges the parameters stored at the two specified indexes.
        /// </summary>
        /// <param name="index1">The index of the first parameter.</param>
        /// <param name="index2">The index of the second parameter.</param>
        public void Switch(int index1, int index2)
        {
            if ((index1 < 0) || (index2 < 0))
                throw new Exception("Index out of bounds in Params.Switch");
            if ((index1 >= FCount) || (index2 >= FCount))
                throw new Exception("Index out of bounds in Params.Switch");
            Param buf = FItems[index1];
            FItems[index1] = FItems[index2];
            FItems[index2] = buf;
        }
    }

    /// <summary>
    /// Newtonsoft.Json converter that serializes a <see cref="Params"/> collection as a plain JSON array
    /// of parameters and reconstructs it when reading.
    /// </summary>
    public class ParamsConverter : JsonConverter
    {
        /// <summary>
        /// Determines whether this converter can handle the given type, i.e. whether it is <see cref="Params"/>.
        /// </summary>
        /// <param name="objectType">The type being (de)serialized.</param>
        /// <returns>True if <paramref name="objectType"/> is <see cref="Params"/>; otherwise false.</returns>
        public override bool CanConvert(Type objectType) => objectType == typeof(Params);

        /// <summary>
        /// Writes a <see cref="Params"/> collection as a plain JSON array of its parameters.
        /// </summary>
        /// <param name="writer">The writer to emit JSON to.</param>
        /// <param name="value">The <see cref="Params"/> collection to serialize.</param>
        /// <param name="serializer">The serializer used for the individual parameters.</param>
        public override void WriteJson(JsonWriter writer, object value, JsonSerializer serializer)
        {
            var p = (Params)value;
            writer.WriteStartArray();       // ⬅️ Directamente un array
            foreach (Param item in p)
            {
                serializer.Serialize(writer, item);
            }
            writer.WriteEndArray();
        }

        /*public override object ReadJson(JsonReader reader, Type objectType, object existingValue, JsonSerializer serializer)
        {
            var array = JArray.Load(reader);  // ⬅️ Cargar directamente el array
            var result = new Params();
            foreach (var token in array)
            {
                var param = token.ToObject<Param>(serializer);
                result.Add(param);
            }
            return result;
        }*/
        /// <summary>
        /// Reads a JSON array and reconstructs a <see cref="Params"/> collection from it,
        /// returning null when the JSON token is not an array.
        /// </summary>
        /// <param name="reader">The reader to read JSON from.</param>
        /// <param name="objectType">The target type being deserialized.</param>
        /// <param name="existingValue">The existing value, if any (unused).</param>
        /// <param name="serializer">The serializer used for the individual parameters.</param>
        /// <returns>The reconstructed <see cref="Params"/> collection, or null if the token is not an array.</returns>
        public override object ReadJson(JsonReader reader, Type objectType, object existingValue, JsonSerializer serializer)
        {
            var token = JToken.Load(reader);

            if (token.Type != JTokenType.Array)
                return null;

            var result = new Params();
            foreach (var item in token)
            {
                var param = item.ToObject<Param>(serializer);
                result.Add(param);
            }
            return result;
        }
    }
}
