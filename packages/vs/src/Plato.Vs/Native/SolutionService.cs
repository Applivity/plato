using System;
using System.IO;
using EnvDTE;
using EnvDTE80;
using Microsoft.VisualStudio.Shell;
using Microsoft.VisualStudio.Shell.Interop;

namespace Plato.Vs.Native
{
    /// <summary>
    /// The workspace root: the solution directory, the open folder, or the
    /// active document's directory, in that order.
    /// </summary>
    internal sealed class SolutionService : IDisposable
    {
        private readonly DTE2? _dte;
        private readonly SolutionEvents? _events;
        private bool _disposed;

        public event Action? RootChanged;

        public SolutionService(IServiceProvider serviceProvider)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            _dte = ServiceProvider.GlobalProvider.GetService(typeof(DTE)) as DTE2
                ?? serviceProvider.GetService(typeof(DTE)) as DTE2;

            if (_dte?.Events is Events2 events)
            {
                _events = events.SolutionEvents;
                _events.Opened += OnChanged;
                _events.AfterClosing += OnChanged;
            }
        }

        public string? GetRoot()
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            var solution = ServiceProvider.GlobalProvider.GetService(typeof(SVsSolution)) as IVsSolution;
            if (solution != null)
            {
                solution.GetSolutionInfo(out var directory, out _, out _);
                if (!string.IsNullOrEmpty(directory) && Directory.Exists(directory))
                {
                    return directory.TrimEnd(Path.DirectorySeparatorChar);
                }
            }

            var document = _dte?.ActiveDocument;
            var path = document?.FullName;
            if (!string.IsNullOrEmpty(path) && File.Exists(path))
            {
                return Path.GetDirectoryName(path);
            }

            return null;
        }

        private void OnChanged()
        {
            RootChanged?.Invoke();
        }

        public void Dispose()
        {
            if (_disposed)
            {
                return;
            }

            _disposed = true;
            if (ThreadHelper.CheckAccess() && _events != null)
            {
                _events.Opened -= OnChanged;
                _events.AfterClosing -= OnChanged;
            }
        }
    }
}
