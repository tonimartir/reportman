using Reportman.Drawing;
using System;
using System.Windows.Forms;

namespace Reportman.Reporting.Forms
{
    public partial class EmbeddedFileForm : Form
    {
        public EmbeddedFileForm()
        {
            InitializeComponent();
        }

        private void EmbeddedFileForm_Load(object sender, EventArgs e)
        {
        }
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
