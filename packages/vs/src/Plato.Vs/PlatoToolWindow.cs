using System;
using System.Runtime.InteropServices;
using Microsoft.VisualStudio.Shell;

namespace Plato.Vs
{
    /// <summary>
    /// The dockable tool window. Hiding keeps the page; closing disposes the
    /// panel, as closing a webview does in the VS Code host.
    /// </summary>
    [Guid("47671774-5F5A-46D9-B6BD-AA0236B8E959")]
    public sealed class PlatoToolWindow : ToolWindowPane
    {
        public PlatoToolWindow()
            : base(null)
        {
            Caption = "Plato";
            WebViewControl = new PlatoWebViewControl();
            Content = WebViewControl;
        }

        public PlatoWebViewControl WebViewControl { get; }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                WebViewControl.Dispose();
                _ = PlatoPackage.Instance?.Sidecar?.NotifyAsync("panel.close", new { });
            }

            base.Dispose(disposing);
        }
    }
}
