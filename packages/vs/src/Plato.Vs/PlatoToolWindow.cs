using System;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using Microsoft.VisualStudio.Shell;
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
    public sealed class PlatoToolWindow : ToolWindowPane
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

        public Task ShutdownAsync() => _sidecar.StopAsync();

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
