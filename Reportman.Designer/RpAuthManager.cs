using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace Reportman.Designer
{
    /// <summary>
    /// Port of Delphi's TRpAuthManager: singleton managing authentication,
    /// profile, tiers, OAuth flows (Google/Microsoft), email OTP, and config persistence.
    /// Config is saved to %LOCALAPPDATA%\Reportman\reportman_auth.ini (shared with Delphi).
    /// </summary>
    public class RpAuthManager
    {
        // Hub API endpoints
        /// <summary>
        /// Base URL of the Reportman Hub API. The debug and release endpoints are
        /// selected at compile time.
        /// </summary>
#if DEBUG
        public const string HUB_API_URL = "https://api.reportman.es:7006";
#else
        public const string HUB_API_URL = "https://api.reportman.es:44568";
#endif
        // OAuth client IDs (same as Delphi)
        private const string GOOGLE_CLIENT_ID = "446365228848-pn415lkvsetqa7v7fi7ftg96m61ccl5p.apps.googleusercontent.com";
        private const string MS_CLIENT_ID = "bc88d289-ded3-4389-a62b-2f12ad635dac";

        // Singleton
        private static RpAuthManager _instance;
        private static readonly object _lock = new object();

        // State
        /// <summary>
        /// Gets the current bearer authentication token, or an empty string when not logged in.
        /// </summary>
        public string Token { get; private set; } = "";
        /// <summary>
        /// Gets the per-installation identifier sent to the Hub to associate this client with a login.
        /// </summary>
        public string InstallId { get; private set; } = "";
        /// <summary>
        /// Gets the profile of the currently authenticated user.
        /// </summary>
        public RpProfile Profile { get; private set; } = new RpProfile();
        /// <summary>
        /// Gets a value indicating whether a valid session token is present.
        /// </summary>
        public bool IsLoggedIn { get; private set; }
        /// <summary>
        /// Gets or sets a value indicating whether the designer's AI-assisted features are enabled.
        /// </summary>
        public bool AIEnabled { get; set; } = true;
        /// <summary>
        /// Gets or sets the language used for AI-generated content (for example, "English").
        /// </summary>
        public string AILanguage { get; set; } = "English";

        // Events
        /// <summary>
        /// Raised when the authentication state changes; the argument is true when logged in, false when logged out.
        /// </summary>
        public event Action<bool> AuthChanged;
        /// <summary>
        /// Raised for diagnostic log messages produced by the manager.
        /// </summary>
        public event Action<string> LogMessage;

        private RpAuthManager()
        {
            InstallId = GenerateInstallId();
            LoadConfig();
        }

        /// <summary>
        /// Gets the lazily-created singleton instance of the authentication manager.
        /// </summary>
        public static RpAuthManager Instance
        {
            get
            {
                if (_instance == null)
                {
                    lock (_lock)
                    {
                        if (_instance == null)
                            _instance = new RpAuthManager();
                    }
                }
                return _instance;
            }
        }

        // ===== Install ID (matches Delphi's GenerateInstallId) =====

        private static string GenerateInstallId()
        {
            string computerName = Environment.MachineName ?? "UNKNOWN";
            // Simplified version — Delphi uses volume serial + computer name
            return "repman-net-" + computerName.ToLowerInvariant();
        }

        // ===== Logging =====

        /// <summary>
        /// Writes a diagnostic message to the debugger output and raises the <see cref="LogMessage"/> event.
        /// </summary>
        /// <param name="msg">The message to log.</param>
        public void Log(string msg)
        {
            System.Diagnostics.Debug.WriteLine("RpAuth: " + msg);
            LogMessage?.Invoke(msg);
        }

        // ===== Email OTP Login =====

        /// <summary>
        /// POST /api/LoginResend/send { email }
        /// </summary>
        public async Task<bool> RequestLoginCodeAsync(string email)
        {
            try
            {
                using (var client = CreateHttpClient())
                {
                    var body = JsonSerializer.Serialize(new { email = email });
                    var content = new StringContent(body, Encoding.UTF8, "application/json");
                    var response = await client.PostAsync(HUB_API_URL + "/api/LoginResend/send", content);
                    Log("RequestLoginCode: " + (int)response.StatusCode);
                    return response.IsSuccessStatusCode;
                }
            }
            catch (Exception ex)
            {
                Log("RequestLoginCode Error: " + ex.Message);
                return false;
            }
        }

        /// <summary>
        /// POST /api/Login/email { email, emailCode, installId }
        /// </summary>
        public async Task<bool> LoginWithCodeAsync(string email, string code)
        {
            try
            {
                using (var client = CreateHttpClient())
                {
                    var body = JsonSerializer.Serialize(new { email = email, emailCode = code, installId = InstallId });
                    var content = new StringContent(body, Encoding.UTF8, "application/json");
                    var response = await client.PostAsync(HUB_API_URL + "/api/Login/email", content);
                    Log("LoginWithCode: " + (int)response.StatusCode);
                    if (response.IsSuccessStatusCode)
                    {
                        var json = await response.Content.ReadAsStringAsync();
                        return ParseLoginResponse(json);
                    }
                }
            }
            catch (Exception ex)
            {
                Log("LoginWithCode Error: " + ex.Message);
            }
            return false;
        }

        // ===== Google OAuth =====

        /// <summary>
        /// Opens browser for Google OAuth, listens on localhost for callback,
        /// exchanges code via POST /api/Login/google.
        /// </summary>
        public async Task<bool> LoginGoogleAsync()
        {
            int port = 49152 + new Random().Next(16384);
            string redirectUri = "http://localhost:" + port + "/";
            string state = Guid.NewGuid().ToString("N").Substring(0, 8);
            string authUrl =
                "https://accounts.google.com/o/oauth2/v2/auth" +
                "?response_type=code" +
                "&scope=openid%20profile%20email" +
                "&redirect_uri=" + Uri.EscapeDataString(redirectUri) +
                "&client_id=" + GOOGLE_CLIENT_ID +
                "&state=" + state;

            Log("Google OAuth: port=" + port);
            Process.Start(new ProcessStartInfo { FileName = authUrl, UseShellExecute = true });

            string code = await WaitForOAuthCallbackAsync(port);
            if (string.IsNullOrEmpty(code)) return false;

            return await ExchangeGoogleCodeAsync(code, redirectUri);
        }

        private async Task<bool> ExchangeGoogleCodeAsync(string code, string redirectUri)
        {
            try
            {
                using (var client = CreateHttpClient())
                {
                    var body = JsonSerializer.Serialize(new { code = code, redirectUri = redirectUri, installId = InstallId });
                    var content = new StringContent(body, Encoding.UTF8, "application/json");
                    Log("Exchanging Google code with Hub API...");
                    var response = await client.PostAsync(HUB_API_URL + "/api/Login/google", content);
                    Log("Google Exchange: " + (int)response.StatusCode);
                    if (response.IsSuccessStatusCode)
                    {
                        var json = await response.Content.ReadAsStringAsync();
                        bool result = ParseLoginResponse(json);
                        if (result) await CheckStatusAsync();
                        return result;
                    }
                }
            }
            catch (Exception ex)
            {
                Log("ExchangeGoogleCode Error: " + ex.Message);
            }
            return false;
        }

        // ===== Microsoft OAuth =====

        /// <summary>
        /// Opens a browser for Microsoft OAuth, listens on localhost for the callback,
        /// then exchanges the code (and the resulting access token) via POST /api/Login/microsoft.
        /// Returns true when authentication succeeds.
        /// </summary>
        public async Task<bool> LoginMicrosoftAsync()
        {
            int port = 49152 + new Random().Next(16384);
            string redirectUri = "http://localhost:" + port + "/";
            string state = Guid.NewGuid().ToString("N").Substring(0, 8);
            string authUrl =
                "https://login.microsoftonline.com/common/oauth2/v2.0/authorize" +
                "?response_type=code" +
                "&scope=openid%20profile%20email%20user.read" +
                "&redirect_uri=" + Uri.EscapeDataString(redirectUri) +
                "&client_id=" + MS_CLIENT_ID +
                "&state=" + state;

            Log("Microsoft OAuth: port=" + port);
            Process.Start(new ProcessStartInfo { FileName = authUrl, UseShellExecute = true });

            string code = await WaitForOAuthCallbackAsync(port);
            if (string.IsNullOrEmpty(code)) return false;

            return await ExchangeMicrosoftCodeAsync(code, redirectUri);
        }

        private async Task<bool> ExchangeMicrosoftCodeAsync(string code, string redirectUri)
        {
            try
            {
                using (var client = CreateHttpClient())
                {
                    // Step 1: Exchange code for MS access token
                    var tokenContent = new FormUrlEncodedContent(new Dictionary<string, string>
                    {
                        { "client_id", MS_CLIENT_ID },
                        { "code", code },
                        { "redirect_uri", redirectUri },
                        { "grant_type", "authorization_code" }
                    });
                    Log("Step 1: Requesting Microsoft Access Token...");
                    var tokenResponse = await client.PostAsync(
                        "https://login.microsoftonline.com/common/oauth2/v2.0/token", tokenContent);

                    string accessToken = "";
                    if (tokenResponse.IsSuccessStatusCode)
                    {
                        var tokenJson = await tokenResponse.Content.ReadAsStringAsync();
                        using (var doc = JsonDocument.Parse(tokenJson))
                        {
                            if (doc.RootElement.TryGetProperty("access_token", out var at))
                                accessToken = at.GetString();
                        }
                        Log("Microsoft token received.");
                    }

                    if (string.IsNullOrEmpty(accessToken)) return false;

                    // Step 2: Send access token to Hub API
                    var body = JsonSerializer.Serialize(new { microsoftCode = accessToken, installId = InstallId });
                    var content = new StringContent(body, Encoding.UTF8, "application/json");
                    Log("Step 2: Sending Microsoft Access Token to Hub API...");
                    var response = await client.PostAsync(HUB_API_URL + "/api/Login/microsoft", content);
                    Log("Microsoft Hub Exchange: " + (int)response.StatusCode);
                    if (response.IsSuccessStatusCode)
                    {
                        var json = await response.Content.ReadAsStringAsync();
                        bool result = ParseLoginResponse(json);
                        if (result) await CheckStatusAsync();
                        return result;
                    }
                }
            }
            catch (Exception ex)
            {
                Log("ExchangeMicrosoftCode Error: " + ex.Message);
            }
            return false;
        }

        // ===== OAuth Loopback Callback Listener =====

        private async Task<string> WaitForOAuthCallbackAsync(int port)
        {
            var listener = new HttpListener();
            listener.Prefixes.Add("http://localhost:" + port + "/");
            try
            {
                listener.Start();
                Log("OAuth listener started on port " + port);

                using (var cts = new CancellationTokenSource(TimeSpan.FromMinutes(5)))
                {
                    var contextTask = listener.GetContextAsync();
                    var completed = await Task.WhenAny(contextTask, Task.Delay(300000, cts.Token));

                    if (completed != contextTask)
                    {
                        Log("OAuth callback timeout.");
                        return null;
                    }

                    var context = await contextTask;
                    string code = context.Request.QueryString["code"];
                    string error = context.Request.QueryString["error"];

                    // Send response to browser
                    string html;
                    if (!string.IsNullOrEmpty(error))
                    {
                        html = "<html><body><h1>Login failed</h1><p>" + error + "</p></body></html>";
                    }
                    else
                    {
                        html = "<html><body><h1>Login successful!</h1><p>You can close this window.</p><script>window.close();</script></body></html>";
                    }
                    byte[] buffer = Encoding.UTF8.GetBytes(html);
                    context.Response.ContentType = "text/html; charset=utf-8";
                    context.Response.ContentLength64 = buffer.Length;
                    await context.Response.OutputStream.WriteAsync(buffer, 0, buffer.Length);
                    context.Response.Close();

                    if (!string.IsNullOrEmpty(error))
                    {
                        Log("OAuth error: " + error);
                        return null;
                    }

                    return code;
                }
            }
            catch (Exception ex)
            {
                Log("OAuth listener error: " + ex.Message);
                return null;
            }
            finally
            {
                try { listener.Stop(); } catch { }
            }
        }

        // ===== Check Status =====

        /// <summary>
        /// Queries the Hub via POST /api/userprofile/status to refresh the user profile and
        /// persist it, raising <see cref="AuthChanged"/>. Logs out automatically if the token has expired.
        /// </summary>
        public async Task CheckStatusAsync()
        {
            try
            {
                using (var client = CreateHttpClient())
                {
                    if (!string.IsNullOrEmpty(Token))
                        client.DefaultRequestHeaders.TryAddWithoutValidation("Authorization", "Bearer " + Token);

                    var response = await client.PostAsync(HUB_API_URL + "/api/userprofile/status", null);
                    Log("CheckStatus: " + (int)response.StatusCode);

                    if (response.IsSuccessStatusCode)
                    {
                        var json = await response.Content.ReadAsStringAsync();
                        using (var doc = JsonDocument.Parse(json))
                        {
                            if (doc.RootElement.TryGetProperty("profile", out var profileEl) ||
                                doc.RootElement.TryGetProperty("Profile", out profileEl))
                            {
                                ParseProfileJson(profileEl);
                            }
                        }
                        SaveConfig();
                        AuthChanged?.Invoke(true);
                    }
                    else if ((int)response.StatusCode == 401 && !string.IsNullOrEmpty(Token))
                    {
                        Log("CheckStatus: Token expired. Logging out.");
                        Logout();
                    }
                }
            }
            catch (Exception ex)
            {
                Log("CheckStatus Error: " + ex.Message);
            }
        }

        // ===== Logout =====

        /// <summary>
        /// Clears the current session and persisted credentials, then raises <see cref="AuthChanged"/> with false.
        /// </summary>
        public void Logout()
        {
            Token = "";
            Profile = new RpProfile();
            IsLoggedIn = false;
            ClearConfig();
            AuthChanged?.Invoke(false);
        }

        // ===== Credits =====

        /// <summary>
        /// Gets a value indicating whether the user draws from the free credit pool
        /// rather than a daily tier allowance.
        /// </summary>
        public bool UsesFreeCredits
        {
            get { return string.IsNullOrEmpty(Profile.Email) || Profile.TierId <= 2; }
        }

        /// <summary>
        /// Returns the fraction of the applicable credit allowance that has been consumed,
        /// in the range 0 to 1 (0 when no allowance is defined).
        /// </summary>
        public double GetCreditsRatio()
        {
            long max, consumed;
            if (UsesFreeCredits)
            {
                max = Profile.FreeInitial;
                consumed = Profile.FreeInitial - Profile.FreeRemaining;
            }
            else
            {
                max = Profile.DailyMax;
                consumed = Profile.DailyConsumed;
            }
            return max > 0 ? (double)consumed / max : 0.0;
        }

        // ===== Internal Helpers =====

        private HttpClient CreateHttpClient()
        {
            var handler = new HttpClientHandler();
#if DEBUG
            handler.ServerCertificateCustomValidationCallback = (msg, cert, chain, errors) => true;
#endif
            var client = new HttpClient(handler);
            client.Timeout = TimeSpan.FromSeconds(30);
            if (!string.IsNullOrEmpty(InstallId))
                client.DefaultRequestHeaders.TryAddWithoutValidation("X-Reportman-WebInstallId", InstallId);
            return client;
        }

        private bool ParseLoginResponse(string json)
        {
            try
            {
                using (var doc = JsonDocument.Parse(json))
                {
                    string token = "";
                    if (doc.RootElement.TryGetProperty("token", out var t) ||
                        doc.RootElement.TryGetProperty("Token", out t))
                        token = t.GetString();

                    if (doc.RootElement.TryGetProperty("profile", out var profileEl) ||
                        doc.RootElement.TryGetProperty("Profile", out profileEl))
                        ParseProfileJson(profileEl);

                    if (!string.IsNullOrEmpty(token))
                    {
                        Token = token;
                        IsLoggedIn = true;
                        SaveConfig();
                        AuthChanged?.Invoke(true);
                        return true;
                    }
                }
            }
            catch (Exception ex)
            {
                Log("ParseLoginResponse Error: " + ex.Message);
            }
            return false;
        }

        private void ParseProfileJson(JsonElement profileEl)
        {
            var p = new RpProfile();
            if (TryGetString(profileEl, "userId", out var s)) p.UserId = long.TryParse(s, out var uid) ? uid : 0;
            if (TryGetString(profileEl, "email", out s)) p.Email = s;
            if (TryGetString(profileEl, "userName", out s)) p.UserName = s;
            if (TryGetString(profileEl, "profileImageUrl", out s)) p.AvatarUrl = s;
            if (TryGetString(profileEl, "accountType", out s)) p.AccountType = int.TryParse(s, out var at) ? at : 0;
            if (TryGetString(profileEl, "tierId", out s)) p.TierId = long.TryParse(s, out var tid) ? tid : 1;
            if (TryGetString(profileEl, "tierName", out s)) p.TierName = s;
            if (TryGetString(profileEl, "dailyMax", out s)) p.DailyMax = long.TryParse(s, out var dm) ? dm : 0;
            if (TryGetString(profileEl, "dailyConsumed", out s)) p.DailyConsumed = long.TryParse(s, out var dc) ? dc : 0;
            if (TryGetString(profileEl, "freeInitial", out s)) p.FreeInitial = long.TryParse(s, out var fi) ? fi : 0;
            if (TryGetString(profileEl, "freeRemaining", out s)) p.FreeRemaining = long.TryParse(s, out var fr) ? fr : 0;
            Profile = p;
            Log("Profile: " + p.Email + " Tier=" + p.TierName + " (" + p.DailyConsumed + "/" + p.DailyMax + ")");
        }

        private static bool TryGetString(JsonElement el, string propName, out string value)
        {
            value = null;
            // Try camelCase, PascalCase, and lowercase
            if (el.TryGetProperty(propName, out var v) ||
                el.TryGetProperty(char.ToUpperInvariant(propName[0]) + propName.Substring(1), out v) ||
                el.TryGetProperty(propName.ToLowerInvariant(), out v))
            {
                value = v.ValueKind == JsonValueKind.Number ? v.GetRawText() : v.GetString();
                return value != null;
            }
            return false;
        }

        // ===== Config Persistence (INI file, same path as Delphi) =====

        private string GetConfigFilePath()
        {
            string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            string dir = Path.Combine(localAppData, "Reportman");
            if (!Directory.Exists(dir))
                Directory.CreateDirectory(dir);
            return Path.Combine(dir, "reportman_auth.ini");
        }

        private void SaveConfig()
        {
            try
            {
                var lines = new List<string>
                {
                    "[Auth]",
                    "Token=" + Token,
                    "InstallId=" + InstallId,
                    "",
                    "[Profile]",
                    "UserId=" + Profile.UserId,
                    "Email=" + Profile.Email,
                    "UserName=" + Profile.UserName,
                    "AvatarUrl=" + Profile.AvatarUrl,
                    "AccountType=" + Profile.AccountType,
                    "TierId=" + Profile.TierId,
                    "TierName=" + Profile.TierName,
                    "DailyMax=" + Profile.DailyMax,
                    "DailyConsumed=" + Profile.DailyConsumed,
                    "FreeInitial=" + Profile.FreeInitial,
                    "FreeRemaining=" + Profile.FreeRemaining,
                    "Credits=" + Profile.Credits,
                    "",
                    "[Preferences]",
                    "AIEnabled=" + (AIEnabled ? "1" : "0"),
                    "AILanguage=" + AILanguage
                };
                // Write without BOM — Delphi's TIniFile uses ANSI/no-BOM
                File.WriteAllLines(GetConfigFilePath(), lines, new UTF8Encoding(false));
            }
            catch (Exception ex)
            {
                Log("SaveConfig Error: " + ex.Message);
            }
        }

        private void LoadConfig()
        {
            string path = GetConfigFilePath();
            if (!File.Exists(path)) return;

            try
            {
                var values = ParseIniFile(path);
                Token = GetIniValue(values, "Auth", "Token", "");
                InstallId = GetIniValue(values, "Auth", "InstallId", InstallId);

                var p = new RpProfile();
                p.UserId = long.TryParse(GetIniValue(values, "Profile", "UserId", "0"), out var uid) ? uid : 0;
                p.Email = GetIniValue(values, "Profile", "Email", "");
                p.UserName = GetIniValue(values, "Profile", "UserName", "");
                p.AvatarUrl = GetIniValue(values, "Profile", "AvatarUrl", "");
                p.AccountType = int.TryParse(GetIniValue(values, "Profile", "AccountType", "0"), out var at) ? at : 0;
                p.TierId = long.TryParse(GetIniValue(values, "Profile", "TierId", "1"), out var tid) ? tid : 1;
                p.TierName = GetIniValue(values, "Profile", "TierName", "Guest");
                p.DailyMax = long.TryParse(GetIniValue(values, "Profile", "DailyMax", "0"), out var dm) ? dm : 0;
                p.DailyConsumed = long.TryParse(GetIniValue(values, "Profile", "DailyConsumed", "0"), out var dc) ? dc : 0;
                p.FreeInitial = long.TryParse(GetIniValue(values, "Profile", "FreeInitial", "0"), out var fi) ? fi : 0;
                p.FreeRemaining = long.TryParse(GetIniValue(values, "Profile", "FreeRemaining", "0"), out var fr) ? fr : 0;
                p.Credits = long.TryParse(GetIniValue(values, "Profile", "Credits", "0"), out var cr) ? cr : 0;
                Profile = p;

                AIEnabled = GetIniValue(values, "Preferences", "AIEnabled", "1") != "0";
                AILanguage = GetIniValue(values, "Preferences", "AILanguage", AILanguage);

                IsLoggedIn = !string.IsNullOrEmpty(Token);
                if (IsLoggedIn)
                    Log("LoadConfig: Restored session for " + p.Email);
            }
            catch (Exception ex)
            {
                Log("LoadConfig Error: " + ex.Message);
            }
        }

        private void ClearConfig()
        {
            try
            {
                var lines = new List<string>
                {
                    "[Auth]",
                    "Token=",
                    "InstallId=" + InstallId,
                    "",
                    "[Profile]",
                    "",
                    "[Preferences]",
                    "AIEnabled=" + (AIEnabled ? "1" : "0"),
                    "AILanguage=" + AILanguage
                };
                File.WriteAllLines(GetConfigFilePath(), lines, new UTF8Encoding(false));
            }
            catch (Exception ex)
            {
                Log("ClearConfig Error: " + ex.Message);
            }
        }

        // Simple INI parser
        private static Dictionary<string, Dictionary<string, string>> ParseIniFile(string path)
        {
            var result = new Dictionary<string, Dictionary<string, string>>(StringComparer.OrdinalIgnoreCase);
            string currentSection = "";
            foreach (var rawLine in File.ReadAllLines(path))
            {
                string line = rawLine.Trim();
                if (line.StartsWith("[") && line.EndsWith("]"))
                {
                    currentSection = line.Substring(1, line.Length - 2);
                    if (!result.ContainsKey(currentSection))
                        result[currentSection] = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                }
                else
                {
                    int eq = line.IndexOf('=');
                    if (eq > 0 && !string.IsNullOrEmpty(currentSection))
                    {
                        string key = line.Substring(0, eq).Trim();
                        string val = line.Substring(eq + 1).Trim();
                        if (!result.ContainsKey(currentSection))
                            result[currentSection] = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                        result[currentSection][key] = val;
                    }
                }
            }
            return result;
        }

        private static string GetIniValue(Dictionary<string, Dictionary<string, string>> data,
            string section, string key, string defaultValue)
        {
            if (data.ContainsKey(section) && data[section].ContainsKey(key))
                return data[section][key];
            return defaultValue;
        }

        // ===== API: Schemas & Agents =====

        /// <summary>
        /// GET /api/agent/databases → { databases: [...], aiEndpoints: [...] }
        /// Returns schemas as list of "DisplayName=hubDatabaseId|hubSchemaId"
        /// </summary>
        public Task<List<string>> GetUserSchemasAsync()
        {
            return GetSchemasAsync("");
        }

        /// <summary>
        /// GET /api/agent/databases using a Reportman Agent ApiKey.
        /// Returns schemas as list of "DisplayName=hubDatabaseId|hubSchemaId"
        /// </summary>
        public Task<List<string>> GetApiKeySchemasAsync(string apiKey)
        {
            return GetSchemasAsync(apiKey);
        }

        private async Task<List<string>> GetSchemasAsync(string apiKey)
        {
            var result = new List<string>();
            try
            {
                using (var client = CreateHttpClient())
                {
                    if (!string.IsNullOrEmpty(Token))
                        client.DefaultRequestHeaders.TryAddWithoutValidation("Authorization", "Bearer " + Token);
                    if (!string.IsNullOrWhiteSpace(apiKey))
                        client.DefaultRequestHeaders.TryAddWithoutValidation("X-Reportman-ApiKey", apiKey.Trim());

                    var response = await client.GetAsync(HUB_API_URL + "/api/agent/databases");
                    Log((string.IsNullOrWhiteSpace(apiKey) ? "GetUserSchemas" : "GetApiKeySchemas") + ": " + (int)response.StatusCode);
                    if (response.IsSuccessStatusCode)
                    {
                        var json = await response.Content.ReadAsStringAsync();
                        using (var doc = JsonDocument.Parse(json))
                        {
                            JsonElement databases;
                            if (doc.RootElement.TryGetProperty("databases", out databases) && databases.ValueKind == JsonValueKind.Array)
                            {
                                foreach (var item in databases.EnumerateArray())
                                {
                                    string displayName = "";
                                    string hubDbId = "0";
                                    string hubSchemaId = "0";
                                    if (item.TryGetProperty("displayName", out var dn)) displayName = dn.GetString() ?? "";
                                    if (string.IsNullOrEmpty(displayName) && item.TryGetProperty("name", out var nm)) displayName = nm.GetString() ?? "";
                                    if (item.TryGetProperty("hubDatabaseId", out var hdb)) hubDbId = hdb.GetRawText().Trim('"');
                                    if (item.TryGetProperty("hubSchemaId", out var hs)) hubSchemaId = hs.GetRawText().Trim('"');
                                    displayName = displayName.Replace(" - ", " / ");
                                    result.Add(displayName + "=" + hubDbId + "|" + hubSchemaId);
                                }
                            }
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                Log((string.IsNullOrWhiteSpace(apiKey) ? "GetUserSchemas" : "GetApiKeySchemas") + " Error: " + ex.Message);
            }
            return result;
        }

        /// <summary>
        /// GET /api/agent/databases → { aiEndpoints: [...] }
        /// Returns agents as list of "Name (AgentName)=id|secret|isOnline"
        /// </summary>
        public async Task<List<string>> GetUserAgentsAsync()
        {
            var result = new List<string>();
            try
            {
                using (var client = CreateHttpClient())
                {
                    if (!string.IsNullOrEmpty(Token))
                        client.DefaultRequestHeaders.TryAddWithoutValidation("Authorization", "Bearer " + Token);

                    var response = await client.GetAsync(HUB_API_URL + "/api/agent/databases");
                    Log("GetUserAgents: " + (int)response.StatusCode);
                    if (response.IsSuccessStatusCode)
                    {
                        var json = await response.Content.ReadAsStringAsync();
                        using (var doc = JsonDocument.Parse(json))
                        {
                            JsonElement endpoints;
                            if (doc.RootElement.TryGetProperty("aiEndpoints", out endpoints) && endpoints.ValueKind == JsonValueKind.Array)
                            {
                                foreach (var item in endpoints.EnumerateArray())
                                {
                                    string name = "Agent";
                                    string agentName = "Agent";
                                    string id = "0";
                                    string secret = "";
                                    bool isOnline = false;
                                    if (item.TryGetProperty("name", out var n)) name = n.GetString() ?? "Agent";
                                    if (item.TryGetProperty("agentName", out var an)) agentName = an.GetString() ?? "Agent";
                                    if (item.TryGetProperty("id", out var idv)) id = idv.GetRawText().Trim('"');
                                    if (item.TryGetProperty("agentSecret", out var sec)) secret = sec.GetString() ?? "";
                                    if (item.TryGetProperty("isOnline", out var ol))
                                    {
                                        if (ol.ValueKind == JsonValueKind.True) isOnline = true;
                                        else if (ol.ValueKind == JsonValueKind.String) isOnline = string.Equals(ol.GetString(), "true", StringComparison.OrdinalIgnoreCase);
                                    }
                                    result.Add(name + " (" + agentName + ")=" + id + "|" + secret + "|" + (isOnline ? "1" : "0"));
                                }
                            }
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                Log("GetUserAgents Error: " + ex.Message);
            }
            return result;
        }

        /// <summary>
        /// Runs CheckStatusAsync on a background thread, then fires AuthChanged on completion.
        /// </summary>
        public void RefreshStatusInBackground()
        {
            Task.Run(async () =>
            {
                try
                {
                    await CheckStatusAsync();
                }
                catch (Exception ex)
                {
                    Log("RefreshStatusInBackground Error: " + ex.Message);
                }
            });
        }
    }

    /// <summary>
    /// Profile data from the Hub API. Matches Delphi's TRpProfile record.
    /// </summary>
    public class RpProfile
    {
        /// <summary>
        /// Gets or sets the Hub user identifier.
        /// </summary>
        public long UserId { get; set; }
        /// <summary>
        /// Gets or sets the user's email address.
        /// </summary>
        public string Email { get; set; } = "";
        /// <summary>
        /// Gets or sets the display name of the user.
        /// </summary>
        public string UserName { get; set; } = "";
        /// <summary>
        /// Gets or sets the URL of the user's profile image.
        /// </summary>
        public string AvatarUrl { get; set; } = "";
        /// <summary>
        /// Gets or sets the account type code returned by the Hub.
        /// </summary>
        public int AccountType { get; set; }
        /// <summary>
        /// Gets or sets the identifier of the user's subscription tier.
        /// </summary>
        public long TierId { get; set; } = 1;
        /// <summary>
        /// Gets or sets the display name of the user's subscription tier.
        /// </summary>
        public string TierName { get; set; } = "Guest";
        /// <summary>
        /// Gets or sets the maximum number of credits allowed per day for the tier.
        /// </summary>
        public long DailyMax { get; set; }
        /// <summary>
        /// Gets or sets the number of daily credits consumed so far.
        /// </summary>
        public long DailyConsumed { get; set; }
        /// <summary>
        /// Gets or sets the initial number of free credits granted to the user.
        /// </summary>
        public long FreeInitial { get; set; }
        /// <summary>
        /// Gets or sets the number of free credits still available.
        /// </summary>
        public long FreeRemaining { get; set; }
        /// <summary>
        /// Gets or sets the user's remaining purchased credit balance.
        /// </summary>
        public long Credits { get; set; }
    }
}
