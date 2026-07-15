using Reportman.Drawing;
using System;
using System.Windows.Forms;

namespace Reportman.Reporting.Forms
{
    /// <summary>
    /// Dialog for editing the metadata of a file embedded in a PDF/A document (description,
    /// file name, MIME type, creation/modification dates and AF relationship).
    /// </summary>
    public partial class EmbeddedFileForm : Form
    {
        /// <summary>
        /// Initializes a new instance of the <see cref="EmbeddedFileForm"/> class and its designer-generated components.
        /// </summary>
        public EmbeddedFileForm()
        {
            InitializeComponent();
        }

        private void EmbeddedFileForm_Load(object sender, EventArgs e)
        {
        }
        /// <summary>
        /// Initializes the form controls with translated label texts and populates the
        /// relationship combo box with all available <see cref="PDFAFRelationShip"/> values.
        /// </summary>
        public void Init()
        {
            Text = Translator.TranslateStr(1475);
            labelDescription.Text = Translator.TranslateStr(1462);
            labelMimeType.Text = Translator.TranslateStr(1460);
            labelRelationShip.Text = Translator.TranslateStr(1464);
            labelFileName.Text = Translator.TranslateStr(1463);
            labelCreationDate.Text = Translator.TranslateStr(1469);
            labelModificationDate.Text = Translator.TranslateStr(1470);
            bok.Text = Translator.TranslateStr(93);
            bcancel.Text = Translator.TranslateStr(271);
            comboRelationShip.Items.Clear();
            foreach (var relname in Enum.GetValues(typeof(PDFAFRelationShip)))
            {
                comboRelationShip.Items.Add(relname);
            }
            comboRelationShip.SelectedIndex = 0;
        }
        /// <summary>
        /// Displays a modal dialog that lets the user edit the metadata of the specified
        /// embedded file (description, file name, MIME type, dates and AF relationship).
        /// If the user confirms, the <paramref name="embedded"/> object is updated in place.
        /// </summary>
        /// <param name="embedded">The embedded file whose metadata will be edited.</param>
        /// <returns><c>true</c> if the user accepted the changes; <c>false</c> if cancelled.</returns>
        public static bool AskEmbeddedFileData(EmbeddedFile embedded)
        {
            bool resultado = false;
            using (var dia = new EmbeddedFileForm())
            {
                dia.Init();
                dia.textDescription.Text = embedded.Description;
                dia.textFilename.Text = embedded.FileName;
                dia.textMimeType.Text = embedded.MimeType;
                dia.textCreationDate.Text = embedded.CreationDate;
                dia.textModificationDate.Text = embedded.ModificationDate;
                dia.comboRelationShip.SelectedIndex = (int)embedded.AFRelationShip;
                if (dia.ShowDialog() == DialogResult.OK)
                {
                    embedded.Description = dia.textDescription.Text;
                    embedded.FileName = dia.textFilename.Text;
                    embedded.MimeType = dia.textMimeType.Text;
                    embedded.CreationDate = dia.textCreationDate.Text;
                    embedded.ModificationDate = dia.textModificationDate.Text;
                    embedded.AFRelationShip = (PDFAFRelationShip)dia.comboRelationShip.SelectedIndex;
                    resultado = true;
                }
            }
            return resultado;
        }
    }
}
