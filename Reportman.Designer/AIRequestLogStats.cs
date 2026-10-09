using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Text;
using System.Text.Json;

namespace Reportman.Designer
{
    /// <summary>
    /// Figures of an AI request for the AI log tab, as the web designer shows them: a line for each
    /// model call (progress id) when it ends, with what it read and wrote, its time (from its first
    /// frame to its last) and its speed; and a totals line for the whole request from the usage steps
    /// of the final answers (tokens, reasoning tokens, models, credits) with the time since the prompt.
    /// Progress frames are fed from the UI thread; answers can be added from any thread.
    /// </summary>
    internal sealed class AIRequestLogStats
    {
        private sealed class ModelCall
        {
            public long Started;
            public long Last;
            public int InputTokens;
            public int OutputTokens;
        }

        private readonly Dictionary<string, ModelCall> calls = new Dictionary<string, ModelCall>(StringComparer.Ordinal);
        private readonly object usageLock = new object();
        private readonly List<string> models = new List<string>();
        private long requestStarted;
        private bool started;
        private int steps;
        private long inputTokens;
        private long outputTokens;
        private long thinkingTokens;
        private long credits;
        private bool hasCredits;

        /// <summary>Starts a request: forgets the figures of the previous one.</summary>
        public void Begin()
        {
            calls.Clear();
            lock (usageLock)
            {
                models.Clear();
                steps = 0;
                inputTokens = 0;
                outputTokens = 0;
                thinkingTokens = 0;
                credits = 0;
                hasCredits = false;
            }
            requestStarted = Stopwatch.GetTimestamp();
            started = true;
        }

        /// <summary>
        /// Feeds a progress frame received at <paramref name="timestamp"/> (<see cref="Stopwatch.GetTimestamp"/>).
        /// Returns the line of the model call the frame ends, or null.
        /// </summary>
        public string Progress(string actor, string stage, string chunkType, int frameInputTokens, int frameOutputTokens,
            string progressId, long timestamp)
        {
            string id = (progressId ?? "").Trim();
            if (id.Length == 0 || !string.Equals(actor, "AI", StringComparison.OrdinalIgnoreCase))
                return null;
            // The wait in the provider's queue is not part of the call
            if (string.Equals(stage, "Queued", StringComparison.OrdinalIgnoreCase))
                return null;
            ModelCall call;
            if (!calls.TryGetValue(id, out call) || string.Equals(chunkType, "Start", StringComparison.OrdinalIgnoreCase))
            {
                call = new ModelCall { Started = timestamp };
                calls[id] = call;
            }
            call.Last = timestamp;
            // Each frame carries the totals so far: keep the largest (frames may come out of order)
            if (frameInputTokens > call.InputTokens)
                call.InputTokens = frameInputTokens;
            if (frameOutputTokens > call.OutputTokens)
                call.OutputTokens = frameOutputTokens;
            if (!string.Equals(chunkType, "End", StringComparison.OrdinalIgnoreCase) &&
                !string.Equals(chunkType, "Full", StringComparison.OrdinalIgnoreCase))
                return null;
            calls.Remove(id);
            return FormatCall(id, call);
        }

        // «#3 · 12,345 → 678 tok · 9.8 s · 69 tok/s»
        private static string FormatCall(string id, ModelCall call)
        {
            var line = new StringBuilder("#" + id);
            if (call.InputTokens > 0 || call.OutputTokens > 0)
                line.Append(" · ").Append(FormatTokens(call.InputTokens)).Append(" → ").Append(FormatTokens(call.OutputTokens)).Append(" tok");
            double seconds = (call.Last - call.Started) / (double)Stopwatch.Frequency;
            if (seconds > 0)
            {
                line.Append(" · ").Append(FormatSeconds(seconds));
                if (call.OutputTokens > 0)
                    line.Append(" · ").Append(FormatTokens((long)Math.Round(call.OutputTokens / seconds))).Append(" tok/s");
            }
            return line.ToString();
        }

        /// <summary>
        /// Adds the usage of an answer of the cloud (its final frame): the <c>steps</c> (one per model
        /// call, with input, output and reasoning tokens and the model) and the <c>creditsConsumed</c>.
        /// Read at once, the caller can dispose the answer afterwards. Never throws.
        /// </summary>
        public void AddAnswer(JsonDocument answer)
        {
            if (answer == null)
                return;
            try
            {
                JsonElement root = answer.RootElement;
                if (root.ValueKind != JsonValueKind.Object)
                    return;
                JsonElement stepList;
                JsonElement nested;
                if (!TryGet(root, "steps", out stepList) && TryGet(root, "result", out nested))
                    TryGet(nested, "steps", out stepList);
                lock (usageLock)
                {
                    if (stepList.ValueKind == JsonValueKind.Array)
                    {
                        foreach (JsonElement step in stepList.EnumerateArray())
                        {
                            if (step.ValueKind != JsonValueKind.Object)
                                continue;
                            steps++;
                            inputTokens += GetLong(step, "inputTokens");
                            outputTokens += GetLong(step, "outputTokens");
                            thinkingTokens += GetLong(step, "thinkingTokens");
                            JsonElement model;
                            if (TryGet(step, "modelName", out model) && model.ValueKind == JsonValueKind.String)
                            {
                                string name = (model.GetString() ?? "").Trim();
                                if (name.Length > 0 && !models.Contains(name))
                                    models.Add(name);
                            }
                        }
                    }
                    JsonElement consumed;
                    if (TryGet(root, "creditsConsumed", out consumed) && consumed.ValueKind == JsonValueKind.Number)
                    {
                        credits += GetLong(root, "creditsConsumed");
                        hasCredits = true;
                    }
                }
            }
            catch
            {
                // The figures are informative: a malformed answer is ignored
            }
        }

        /// <summary>
        /// Ends the request: returns its totals line («Σ 12,345 → 678 tok (120 reasoning) · model ·
        /// 5 credits · 14.2 s»), or null when no request was started.
        /// </summary>
        public string End()
        {
            if (!started)
                return null;
            started = false;
            calls.Clear();
            var parts = new List<string>();
            lock (usageLock)
            {
                if (steps > 0)
                {
                    string tokens = FormatTokens(inputTokens) + " → " + FormatTokens(outputTokens) + " tok";
                    if (thinkingTokens > 0)
                        tokens += " (" + FormatTokens(thinkingTokens) + " reasoning)";
                    parts.Add(tokens);
                    if (models.Count > 0)
                        parts.Add(string.Join(", ", models));
                }
                if (hasCredits && credits > 0)
                    parts.Add(FormatTokens(credits) + " credits");
            }
            parts.Add(FormatSeconds((Stopwatch.GetTimestamp() - requestStarted) / (double)Stopwatch.Frequency));
            return "Σ " + string.Join(" · ", parts);
        }

        private static string FormatTokens(long value)
        {
            return value.ToString("N0", CultureInfo.CurrentCulture);
        }

        private static string FormatSeconds(double seconds)
        {
            return seconds.ToString("0.0", CultureInfo.CurrentCulture) + " s";
        }

        private static bool TryGet(JsonElement element, string name, out JsonElement value)
        {
            value = default(JsonElement);
            if (element.ValueKind != JsonValueKind.Object)
                return false;
            if (element.TryGetProperty(name, out value))
                return true;
            foreach (JsonProperty property in element.EnumerateObject())
            {
                if (string.Equals(property.Name, name, StringComparison.OrdinalIgnoreCase))
                {
                    value = property.Value;
                    return true;
                }
            }
            return false;
        }

        private static long GetLong(JsonElement element, string name)
        {
            JsonElement value;
            if (!TryGet(element, name, out value) || value.ValueKind != JsonValueKind.Number)
                return 0;
            long number;
            if (value.TryGetInt64(out number))
                return number;
            double real;
            return value.TryGetDouble(out real) ? (long)Math.Round(real) : 0;
        }
    }
}
