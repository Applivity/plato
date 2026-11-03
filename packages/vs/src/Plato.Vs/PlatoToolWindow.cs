using System;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using Microsoft.VisualStudio;
using Microsoft.VisualStudio.Shell;
using Microsoft.VisualStudio.Shell.Interop;
using Plato.Vs.Bridge;

namespace Plato.Vs
{
    /// <summary>
    /// One dockable Plato window. Hiding keeps the page; closing disposes the
    /// panel, as closing a webview does in the VS Code host. The window owns
    /// its sidecar, so closing it stops only its own agent and archives only
    /// its own chat.
    /// </summary>
    [Guid("47671774-5F5A-46D9-B6BD-AA0236B8E959")]
    public sealed class PlatoToolWindow : ToolWindowPane, IVsWindowFrameNotify3
    {
        private readonly SidecarHost _sidecar;

        public PlatoToolWindow()
            : base(null)
        {
            var package = PlatoPackage.Instance
                ?? throw new InvalidOperationException("The Plato package is not initialized.");

            Slot = package.ClaimWindowSlot();
            Caption = "Plato " + Slot.Number;
            _sidecar = new SidecarHost(
                package,
                ThreadHelper.JoinableTaskFactory,
                package.ExtensionDirectory,
                Slot.StateId);
            WebViewControl = new PlatoWebViewControl(_sidecar);
            Content = WebViewControl;
            package.RegisterWindow(this);
        }

        internal WindowSlot Slot { get; }

        public PlatoWebViewControl WebViewControl { get; }

        internal SidecarHost Sidecar => _sidecar;

        public Task ShutdownAsync() => _sidecar.StopAsync();

        /// <summary>
        /// Activation is what makes a command act on the window the user is
        /// working in. Visual Studio calls this for tab and floating-window
        /// activation; the pane then moves itself to the end of the package's
        /// ordered list, which is where the command target is read from.
        /// </summary>
        public int OnShow(int fShow)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            if (fShow == (int)__FRAMESHOW.FRAMESHOW_WinShown ||
                fShow == (int)__FRAMESHOW.FRAMESHOW_TabActivated ||
                fShow == 12)
            {
                PlatoPackage.Instance?.NoteActive(this);
            }

            return VSConstants.S_OK;
        }

        public int OnClose(ref uint pgrfSaveOptions) => VSConstants.S_OK;

        public int OnMove(int x, int y, int w, int h) => VSConstants.S_OK;

        public int OnSize(int x, int y, int w, int h) => VSConstants.S_OK;

        public int OnDockableChange(int fDockable, int x, int y, int w, int h) =>
            VSConstants.S_OK;

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                PlatoPackage.Instance?.UnregisterWindow(this);
                WebViewControl.Dispose();
                _ = _sidecar.StopAsync();
            }

            base.Dispose(disposing);
        }
    }
}
