using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace Plato.Vs.Native
{
    /// <summary>
    /// One home for every path the Visual Studio host writes.
    /// </summary>
    internal static class PlatoPaths
    {
        /// <summary>%APPDATA%\Plato — settings and the per-project chat log.</summary>
        public static string RoamingRoot =>
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Plato");

        /// <summary>%LOCALAPPDATA%\Plato — logs and the WebView2 user data folder.</summary>
        public static string LocalRoot =>
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Plato");

        public static string SettingsFile => Path.Combine(RoamingRoot, "settings.json");

        /// <summary>
        /// The live conversation of one Plato window: its log, title and mode.
        /// Each window gets its own file, so two windows cannot overwrite each
        /// other's state.
        /// </summary>
        public static string WorkspaceStateFile(string root, string windowId) =>
            Path.Combine(RoamingRoot, "workspace-state", ProjectKey(root) + "-" + windowId + ".json");

        /// <summary>
        /// The archived-chat list. It is shared by every window of a project,
        /// because History is one list, not one list per window.
        /// </summary>
        public static string SharedChatsFile(string root) =>
            Path.Combine(RoamingRoot, "workspace-state", ProjectKey(root) + "-chats.json");

        public static string LogsDirectory => Path.Combine(LocalRoot, "logs");

        public static string WebView2UserData => Path.Combine(LocalRoot, "WebView2");

        public static string NewLogFile(string windowId)
        {
            Directory.CreateDirectory(LogsDirectory);
            var stamp = DateTime.Now.ToString("yyyyMMdd-HHmmss");
            return Path.Combine(LogsDirectory, "host-" + stamp + "-" + windowId + ".log");
        }

        /// <summary>
        /// The same key the extension and the CLI use: the first 8 hex digits of
        /// the SHA-1 of the workspace root.
        /// </summary>
        public static string ProjectKey(string root)
        {
            using (var sha1 = SHA1.Create())
            {
                var bytes = sha1.ComputeHash(Encoding.UTF8.GetBytes(root));
                var builder = new StringBuilder(8);
                for (var i = 0; i < 4; i++)
                {
                    builder.Append(bytes[i].ToString("x2"));
                }

                return builder.ToString();
            }
        }
    }
}
