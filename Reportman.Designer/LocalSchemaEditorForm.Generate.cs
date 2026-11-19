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
 *  Copyright (c) 1994 - 2026 Toni Martir (toni@reportman.es)
 *  All Rights Reserved.
*/
#endregion

using Reportman.Reporting;
using System;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace Reportman.Designer
{
    // «Generate with AI» (docs/generar-esquema-con-ia-plan.md): a new subschema written by the AI from what it reads of
    // the database, imported as a file is (unsaved), and the AI of the screen ([SchemaAI]) shared with «Analyze with AI»
    public partial class LocalSchemaEditorForm
    {
        // While the AI selection is set from the saved choice: its change events must not save it again
        private bool _restoringAi;

        /// <summary>The AI of the schemas screen, as it was kept (Precision and Fast by default).</summary>
        private void RestoreSchemaAI(AISelectionControl selection)
        {
            _restoringAi = true;
            try
            {
                RpAuthManager auth = RpAuthManager.Instance;
                selection.RestoreProviderSelection(auth.SchemaAITier, auth.SchemaAgentAiId);
                selection.SelectedMode = auth.SchemaAIMode;
            }
            finally
            {
                _restoringAi = false;
            }
        }

        /// <summary>The user's Agents in the AI selection, keeping the AI of the schemas screen selected.</summary>
        private async Task LoadSchemaAIAgentsAsync(AISelectionControl selection)
        {
            _restoringAi = true;
            try
            {
                RpAuthManager auth = RpAuthManager.Instance;
                await selection.LoadUserAgentsAsync(auth.SchemaAITier, auth.SchemaAgentAiId);
            }
            catch (Exception)
            {
                // Without the user's Agents the cloud tiers stay
            }
            finally
            {
                _restoringAi = false;
            }
        }

        /// <summary>Keeps the AI the user chose in this screen, for the next time and for «Generate with AI».</summary>
        private void KeepSchemaAI(AISelectionControl selection)
        {
            if (_restoringAi)
                return;
            RpAuthManager.Instance.SaveSchemaAI(selection.SelectedTier, selection.SelectedMode, selection.AgentAiId);
        }

        /// <summary>
        /// Asks the domain and the AI (<see cref="GenerateSchemaForm"/>), and imports the schema it proposes as a new
        /// subschema, as Import does with a file: the tables read first in a large catalog, the descriptions and coded values
        /// in the dictionary where it has none (what is written there is kept), the subschema selected and unsaved. The summary of the AI and its warnings go to the Validation
        /// tab and to the message that says how it went.
        /// </summary>
        private async void GenerateWithAi()
        {
            if (_file == null || _busy || _createConnection == null)
                return;
            CommitEdits();
            string title = Caption(2058);
            SchemaGenerationOutcome outcome;
            string name;
            using (var form = new GenerateSchemaForm(_createConnection, _alias))
            {
                DialogResult answer = form.ShowDialog(this);
                outcome = form.Outcome;
                name = form.SubschemaName;
                // The dialog may have changed the AI of the screen
                RestoreSchemaAI(_aiSelection);
                if (answer != DialogResult.OK || outcome == null || IsDisposed)
                    return;
            }
            LocalSchemaImportResult result;
            try
            {
                if (!await ReadColumnsAsync(LocalSchemaEditing.ImportTables(_file, outcome.SchemaJson, null), true) || IsDisposed)
                    return;
                // What the dictionary has written is kept: the AI only fills what is empty
                result = LocalSchemaEditing.ImportGenerated(_file, outcome.SchemaJson, ReservedNames,
                    name.Length > 0 ? name : outcome.SchemaName);
            }
            catch (Exception ex)
            {
                MessageBox.Show(this, ex.Message, title, MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }
            if (result == null || result.Subschema == null)
            {
                MessageBox.Show(this, Tr(2069), title, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            _added = result.Subschema;
            StructureChanged();
            FillAll(result.Subschema);
            _tabs.SelectedTab = _tabTables;

            string done = TrFormat(2065, Number(result.Subschema.Tables.Count), Number(outcome.Relations));
            SetStatus(done);
            var message = new StringBuilder(done);
            if (outcome.Credits > 0)
                message.Append(Environment.NewLine).Append(TrFormat(2068, Number(outcome.Credits), Number(outcome.Turns)));
            string explanation = outcome.Explanation.Trim();
            if (explanation.Length > 0)
                message.Append(Environment.NewLine).Append(Environment.NewLine)
                    .Append(explanation.Length > 600 ? explanation.Substring(0, 600) + "…" : explanation);
            if (outcome.Warnings.Count > 0)
                message.Append(Environment.NewLine).Append(Environment.NewLine).Append(Tr(2067)).Append(':')
                    .Append(Environment.NewLine).Append("- ").Append(string.Join(Environment.NewLine + "- ", outcome.Warnings));
            if (result.Skipped.Count > 0)
                message.Append(Environment.NewLine).Append(Environment.NewLine).Append(TrFormat(1937, LocalSchemaEditing.ShortList(result.Skipped, 12)));

            // The summary of the AI and its warnings, where the analysis of a subschema is read
            var markdown = new StringBuilder();
            markdown.Append("### ").Append(result.Subschema.Name).Append("\n\n").Append(explanation);
            if (outcome.Warnings.Count > 0)
                markdown.Append("\n\n**").Append(Tr(2067)).Append("**\n\n- ").Append(string.Join("\n- ", outcome.Warnings));
            _markdown.ClearAll();
            _markdown.AppendMessage("assistant", markdown.ToString());

            MessageBox.Show(this, message.ToString(), title, MessageBoxButtons.OK,
                outcome.Warnings.Count > 0 || result.Skipped.Count > 0 ? MessageBoxIcon.Warning : MessageBoxIcon.Information);
        }
    }
}
