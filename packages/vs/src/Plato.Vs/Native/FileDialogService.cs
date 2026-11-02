using System.IO;
using Microsoft.VisualStudio.Shell;

namespace Plato.Vs.Native
{
    internal static class FileDialogService
    {
        /// <summary>Returns the chosen paths, or null when the user cancels.</summary>
        public static string[]? Show(string? openLabel, string? defaultPath, bool canSelectMany)
        {
            ThreadHelper.ThrowIfNotOnUIThread();

            var dialog = new Microsoft.Win32.OpenFileDialog
            {
                Title = string.IsNullOrEmpty(openLabel) ? "Plato" : openLabel,
                Multiselect = canSelectMany,
                CheckFileExists = true,
                CheckPathExists = true,
            };

            if (!string.IsNullOrEmpty(defaultPath))
            {
                if (Directory.Exists(defaultPath))
                {
                    dialog.InitialDirectory = defaultPath;
                }
                else if (File.Exists(defaultPath))
                {
                    dialog.InitialDirectory = Path.GetDirectoryName(defaultPath);
                }
            }

            return dialog.ShowDialog() == true ? dialog.FileNames : null;
        }
    }
}
