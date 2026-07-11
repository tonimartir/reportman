using System;
using System.Collections;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Reflection;


namespace Reportman.Drawing
{
    /// <summary>
    /// A tree node that exposes an arbitrary object's public fields (and enumerable items) for
    /// display in a hierarchical, lazily expanded property browser, with selection and expansion state.
    /// </summary>
    public class ObjectViewModel : INotifyPropertyChanged
    {
        ReadOnlyCollection<ObjectViewModel> _children;
        readonly ObjectViewModel _parent;
        readonly object _object;
        readonly FieldInfo _info;
        readonly Type _type;

        bool _isExpanded;
        bool _isSelected;

        /// <summary>
        /// Initializes a new root node that wraps the given object for hierarchical display.
        /// </summary>
        /// <param name="obj">The object whose public fields and enumerable items are exposed.</param>
        public ObjectViewModel(object obj)
            : this(obj, null, null)
        {
        }
        /// <summary>
        /// Gets the underlying object instance represented by this node.
        /// </summary>
        public object ObjectInstance
        {
            get
            {
                return _object;
            }
        }
        ObjectViewModel(object obj, FieldInfo info, ObjectViewModel parent)
        {
            _object = obj;
            _info = info;
            if (_object != null)
            {
                _type = obj.GetType();
                if (!IsPrintableType(_type))
                {
                    // load the _children object with an empty collection to allow the + expander to be shown
                    _children = new ReadOnlyCollection<ObjectViewModel>(new ObjectViewModel[] { new ObjectViewModel(null) });
                }
            }
            _parent = parent;
        }

        /// <summary>
        /// Populates the child nodes by enumerating the object's public instance fields and, when the
        /// object is a collection, its contained items. Called lazily when the node is expanded.
        /// </summary>
        public void LoadChildren()
        {
            _children = new ReadOnlyCollection<ObjectViewModel>(new List<ObjectViewModel>());
            if (_object != null)
            {
                // exclude value types and strings from listing child members
                if (!IsPrintableType(_type))
                {
                    // the public properties of this object are its children
                    /*var children = _type.GetProperties()
                        .Where(p => !p.GetIndexParameters().Any()) // exclude indexed parameters for now
                        .Select(p => new ObjectViewModel(p.GetValue(_object, null), p, this))
                        .ToList()*/
                    List<ObjectViewModel> children = new List<ObjectViewModel>();
                    foreach (FieldInfo ninfo in _type.GetFields())
                    {
                        if ((ninfo.IsPublic) && (!ninfo.IsStatic))
                            children.Add(new ObjectViewModel(ninfo.GetValue(_object), ninfo, this));
                    }
                    /*var children = _type.GetFields()
                        .Select(p => new ObjectViewModel(p.GetValue(_object), p, this))
                        .ToList();*/



                    // if this is a collection type, add the contained items to the children

                    var collection = _object as IEnumerable;
                    if (collection != null)
                    {
                        foreach (var item in collection)
                        {
                            children.Add(new ObjectViewModel(item, null, this)); // todo: add something to view the index value
                        }
                    }

                    _children = new ReadOnlyCollection<ObjectViewModel>(children);
                    this.OnPropertyChanged("Children");
                }
            }
        }

        /// <summary>
        /// Gets a value indicating if the object graph can display this type without enumerating its children
        /// </summary>
        static bool IsPrintableType(Type type)
        {
            return type != null && (
                type.IsPrimitive ||
                type.IsAssignableFrom(typeof(string)) ||
                type.IsEnum || IsBasicType(type));
        }
        static bool IsBasicType(Type type)
        {
            switch (type.ToString())
            {
                case "System.Decimal":
                case "System.Int64":
                case "System.Int32":
                case "System.String":
                case "System.Double":
                case "System.Single":
                case "System.Int16":
                case "System.Char":
                case "System.Byte":
                case "System.DateTime":
                case "System.TimeSpan":
                    return true;
            }
            return false;
        }
        /// <summary>
        /// Gets the parent node in the tree, or null for the root node.
        /// </summary>
        public ObjectViewModel Parent
        {
            get { return _parent; }
        }

        /// <summary>
        /// Gets the reflection field this node was created from, or null for root and collection-item nodes.
        /// </summary>
        public FieldInfo Info
        {
            get { return _info; }
        }

        /// <summary>
        /// Gets the child nodes of this node. The collection is populated lazily by <see cref="LoadChildren"/>.
        /// </summary>
        public ReadOnlyCollection<ObjectViewModel> Children
        {
            get { return _children; }
        }

        /// <summary>
        /// Gets the object's type name formatted for display, in parentheses, or an empty string when unavailable.
        /// </summary>
        public string Type
        {
            get
            {
                var type = string.Empty;
                if (_object != null)
                {
                    type = string.Format("({0})", _type.Name);
                }
                else
                {
                    if (_info != null)
                    {
                        type = string.Format("({0})", _info.GetType().Name);
                    }
                }
                return type;
            }
        }

        /// <summary>
        /// Gets the field name this node represents, or an empty string for root and collection-item nodes.
        /// </summary>
        public string Name
        {
            get
            {
                var name = string.Empty;
                if (_info != null)
                {
                    name = _info.Name;
                }
                return name;
            }
        }

        /// <summary>
        /// Gets the object's value as a string for printable types, "&lt;null&gt;" when the object is null,
        /// or an empty string otherwise.
        /// </summary>
        public string Value
        {
            get
            {
                var value = string.Empty;
                if (_object != null)
                {
                    if (IsPrintableType(_type))
                    {
                        value = _object.ToString();
                    }
                }
                else
                {
                    value = "<null>";
                }
                return value;
            }
        }

        #region Presentation Members

        /// <summary>
        /// Gets or sets whether the node is expanded in the tree. Setting it to true loads the children
        /// and expands all ancestor nodes up to the root.
        /// </summary>
        public bool IsExpanded
        {
            get { return _isExpanded; }
            set
            {
                if (_isExpanded != value)
                {
                    _isExpanded = value;
                    if (_isExpanded)
                    {
                        LoadChildren();
                    }
                    this.OnPropertyChanged("IsExpanded");
                }

                // Expand all the way up to the root.
                if (_isExpanded && _parent != null)
                {
                    _parent.IsExpanded = true;
                }
            }
        }

        /// <summary>
        /// Gets or sets whether the node is selected in the tree.
        /// </summary>
        public bool IsSelected
        {
            get { return _isSelected; }
            set
            {
                if (_isSelected != value)
                {
                    _isSelected = value;
                    this.OnPropertyChanged("IsSelected");
                }
            }
        }

        /// <summary>
        /// Determines whether the node's name contains the given text, using a case-insensitive comparison.
        /// </summary>
        /// <param name="text">The text to search for.</param>
        /// <returns>true if the name contains the text; otherwise false.</returns>
        public bool NameContains(string text)
        {
            if (String.IsNullOrEmpty(text) || String.IsNullOrEmpty(Name))
            {
                return false;
            }

            return Name.IndexOf(text, StringComparison.InvariantCultureIgnoreCase) > -1;
        }

        /// <summary>
        /// Determines whether the node's value contains the given text, using a case-insensitive comparison.
        /// </summary>
        /// <param name="text">The text to search for.</param>
        /// <returns>true if the value contains the text; otherwise false.</returns>
        public bool ValueContains(string text)
        {
            if (String.IsNullOrEmpty(text) || String.IsNullOrEmpty(Value))
            {
                return false;
            }

            return Value.IndexOf(text, StringComparison.InvariantCultureIgnoreCase) > -1;
        }

        #endregion

        #region INotifyPropertyChanged Members

        /// <summary>
        /// Occurs when a property value changes.
        /// </summary>
        public event PropertyChangedEventHandler PropertyChanged;

        /// <summary>
        /// Raises the <see cref="PropertyChanged"/> event for the given property name.
        /// </summary>
        /// <param name="propertyName">The name of the property that changed.</param>
        protected virtual void OnPropertyChanged(string propertyName)
        {
            if (this.PropertyChanged != null)
            {
                this.PropertyChanged(this, new PropertyChangedEventArgs(propertyName));
            }
        }

        #endregion
    }
    /// <summary>
    /// Wraps a root object as the top of an <see cref="ObjectViewModel"/> tree, exposing the
    /// first generation of nodes for binding to a tree view.
    /// </summary>
    public class ObjectViewModelHierarchy
    {
        readonly ReadOnlyCollection<ObjectViewModel> _firstGeneration;
        readonly ObjectViewModel _rootObject;

        /// <summary>
        /// Initializes a new hierarchy by wrapping the given root object as the top of an
        /// <see cref="ObjectViewModel"/> tree.
        /// </summary>
        /// <param name="rootObject">The object to place at the root of the tree.</param>
        public ObjectViewModelHierarchy(object rootObject)
        {
            _rootObject = new ObjectViewModel(rootObject);
            _firstGeneration = new ReadOnlyCollection<ObjectViewModel>(new ObjectViewModel[] { _rootObject });
        }

        /// <summary>
        /// Gets the first generation of nodes, containing the single root node, for binding to a tree view.
        /// </summary>
        public ReadOnlyCollection<ObjectViewModel> FirstGeneration
        {
            get { return _firstGeneration; }
        }
    }
}
