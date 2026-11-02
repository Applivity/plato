using System;
using EnvDTE;
using Microsoft.VisualStudio.Shell;

namespace Plato.Vs.Native
{
    internal static class EditorService
    {
        public static void Open(IServiceProvider serviceProvider, string path)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            VsShellUtilities.OpenDocument(serviceProvider, path);
        }

        public static void CloseActive(IServiceProvider serviceProvider)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            var dte = ServiceProvider.GlobalProvider.GetService(typeof(DTE)) as DTE;
            dte?.ExecuteCommand("File.Close");
        }
    }
}
