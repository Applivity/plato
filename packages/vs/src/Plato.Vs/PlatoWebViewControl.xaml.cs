using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using Microsoft.VisualStudio.Shell;
using Microsoft.VisualStudio.Threading;
using Microsoft.Web.WebView2.Core;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Plato.Vs.Bridge;
using Plato.Vs.Native;

namespace Plato.Vs
{
    /// <summary>
    /// The chat page in a WebView2, and the bridge that makes the page believe
    /// it is running in a VS Code webview.
    /// </summary>
    public partial class PlatoWebViewControl : UserControl, IDisposable
    {
        private const string InjectedScript = @"
(function () {
  window.acquireVsCodeApi = function () {
    return {
      postMessage: function (m) { window.chrome.webview.postMessage(m); },
      getState: function () { return undefined; },
      setState: function () { }
    };
  };
  window.chrome.webview.addEventListener('message', function (e) {
    window.dispatchEvent(new MessageEvent('message', { data: e.data }));
  });
})();
";

        private readonly JoinableTaskFactory _jtf;
        private readonly Queue<string> _pendingPosts = new Queue<string>();
        private readonly TaskCompletionSource<bool> _loaded =
            new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);

        private Task? _initialize;
        private Task? _opening;
        private readonly SidecarHost _sidecar;
        private string? _pendingHtml;
        private bool _coreReady;
        private bool _navigated;
        private bool _disposed;

        internal PlatoWebViewControl(SidecarHost sidecar)
        {
            InitializeComponent();
            _sidecar = sidecar;
            _jtf = ThreadHelper.JoinableTaskFactory;
            Loaded += OnLoaded;
        }

        private void OnLoaded(object sender, RoutedEventArgs e)
        {
            _loaded.TrySetResult(true);
            _ = OpenChatGuardedAsync();
        }

        private async Task OpenChatGuardedAsync()
        {
            try
            {
                await OpenChatAsync();
            }
            catch (Exception error)
            {
                await _jtf.SwitchToMainThreadAsync();
                var package = PlatoPackage.Instance;
                if (package != null)
                {
                    MessageWindow.Show(package, "error", error.Message, Array.Empty<string>());
                }
            }
        }

        public Task InitializeAsync() => _initialize ??= InitializeCoreAsync();

        private async Task InitializeCoreAsync()
        {
            var package = PlatoPackage.Instance
                ?? throw new InvalidOperationException("The Plato package is not initialized.");

            await _jtf.SwitchToMainThreadAsync();
            var environment = await package.GetWebViewEnvironmentAsync();
            await WebView.EnsureCoreWebView2Async(environment);

            var core = WebView.CoreWebView2;
            await core.AddScriptToExecuteOnDocumentCreatedAsync(InjectedScript);
            core.WebMessageReceived += OnWebMessageReceived;
            core.NavigationCompleted += OnNavigationCompleted;
            core.NewWindowRequested += OnNewWindowRequested;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.AreDefaultContextMenusEnabled = true;
            core.Settings.AreDevToolsEnabled = true;

            ThemeService.Initialize();
            ThemeService.Changed += OnThemeChanged;
            if (package.Solutions != null)
            {
                package.Solutions.RootChanged += OnSolutionChanged;
            }

            _sidecar.WebviewHtml += OnWebviewHtml;
            _sidecar.WebviewPost += OnWebviewPost;
            _sidecar.PanelDisposed += OnPanelDisposed;
            _sidecar.Exited += OnSidecarExited;

            _coreReady = true;
            WebView.DefaultBackgroundColor = ThemeService.WebViewBackground();

            if (_pendingHtml != null)
            {
                Navigate(_pendingHtml);
                _pendingHtml = null;
            }
            else if (_sidecar.LastHtml != null)
            {
                Navigate(_sidecar.LastHtml);
            }
        }

        /// <summary>
        /// Shows the chat. Starts the sidecar when it is not running and lets
        /// the existing IDE host create or reveal its panel.
        /// </summary>
        public async Task OpenChatAsync()
        {
            var existing = _opening;
            if (existing != null)
            {
                await existing;
                return;
            }

            var task = OpenChatCoreAsync();
            _opening = task;
            try
            {
                await task;
            }
            finally
            {
                if (ReferenceEquals(_opening, task))
                {
                    _opening = null;
                }
            }
        }

        private async Task OpenChatCoreAsync()
        {
            await _loaded.Task;
            await InitializeAsync();

            var package = PlatoPackage.Instance
                ?? throw new InvalidOperationException("The Plato package is not initialized.");
            await _jtf.SwitchToMainThreadAsync();
            var root = package.Solutions?.GetRoot();
            if (string.IsNullOrEmpty(root))
            {
                await _jtf.SwitchToMainThreadAsync();
                MessageWindow.Show(
                    package,
                    "info",
                    "Open a solution or a folder before you open Plato.",
                    Array.Empty<string>());
                return;
            }

            await _sidecar.StartAsync(root!);
            await _sidecar.RequestAsync("command", new { command = "plato.openChat" }, TimeSpan.FromSeconds(30));
        }

        private void Navigate(string html)
        {
            if (!_coreReady)
            {
                _pendingHtml = html;
                return;
            }

            _navigated = false;
            WebView.NavigateToString(html);
        }

        private void OnWebviewHtml(string html)
        {
            _ = _jtf.RunAsync(async () =>
            {
                await _jtf.SwitchToMainThreadAsync();
                Navigate(html);
            });
        }

        private void OnWebviewPost(JToken message)
        {
            var json = message.ToString(Formatting.None);
            _ = _jtf.RunAsync(async () =>
            {
                await _jtf.SwitchToMainThreadAsync();
                if (_navigated && _coreReady)
                {
                    WebView.CoreWebView2.PostWebMessageAsJson(json);
                }
                else
                {
                    _pendingPosts.Enqueue(json);
                }
            });
        }

        private void OnNavigationCompleted(object? sender, CoreWebView2NavigationCompletedEventArgs e)
        {
            _navigated = true;
            _ = ApplyThemeAndFlushAsync();
        }

        private async Task ApplyThemeAndFlushAsync()
        {
            await _jtf.SwitchToMainThreadAsync();
            if (!_coreReady)
            {
                return;
            }

            WebView.DefaultBackgroundColor = ThemeService.WebViewBackground();
            var colors = ThemeService.Read();
            var json = JsonConvert.SerializeObject(colors);
            await WebView.CoreWebView2.ExecuteScriptAsync(
                "(function (c) { for (var k in c) { document.documentElement.style.setProperty(k, c[k]); } })(" +
                json +
                ");");

            while (_pendingPosts.Count > 0)
            {
                WebView.CoreWebView2.PostWebMessageAsJson(_pendingPosts.Dequeue());
            }
        }

        private void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            var sidecar = _sidecar;
            if (sidecar == null)
            {
                return;
            }

            JToken message;
            try
            {
                message = JToken.Parse(e.WebMessageAsJson);
            }
            catch (JsonException)
            {
                return;
            }

            _ = sidecar.NotifyAsync("webview.message", new { message });
        }

        private void OnNewWindowRequested(object? sender, CoreWebView2NewWindowRequestedEventArgs e)
        {
            // The page has no external windows, and a new window would bypass
            // the single-page lifecycle the host depends on.
            e.Handled = true;
        }

        private void OnThemeChanged()
        {
            _ = ApplyThemeAndFlushAsync();
            var sidecar = _sidecar;
            if (sidecar != null)
            {
                _ = sidecar.NotifyAsync("theme.changed", new { });
            }
        }

        private void OnSolutionChanged()
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            var root = PlatoPackage.Instance?.Solutions?.GetRoot();
            if (!string.IsNullOrEmpty(root))
            {
                _ = _sidecar.RequestAsync("solution.changed", new { root }, TimeSpan.FromSeconds(10));
            }
        }

        private void OnPanelDisposed()
        {
            // The host disposed the panel. A new Open Chat creates another one.
            _navigated = false;
        }

        private void OnSidecarExited(int code)
        {
            _ = _jtf.RunAsync(async () =>
            {
                await _jtf.SwitchToMainThreadAsync();
                if (_navigated && _coreReady)
                {
                    WebView.CoreWebView2.PostWebMessageAsJson(JsonConvert.SerializeObject(new
                    {
                        type = "error",
                        text = "Plato's agent process stopped. Use a Plato command to restart it.",
                    }));
                }
            });
        }

        public void Dispose()
        {
            if (_disposed)
            {
                return;
            }

            _disposed = true;
            ThemeService.Changed -= OnThemeChanged;
            var package = PlatoPackage.Instance;
            if (package?.Solutions != null)
            {
                package.Solutions.RootChanged -= OnSolutionChanged;
            }

            if (_sidecar != null)
            {
                _sidecar.WebviewHtml -= OnWebviewHtml;
                _sidecar.WebviewPost -= OnWebviewPost;
                _sidecar.PanelDisposed -= OnPanelDisposed;
                _sidecar.Exited -= OnSidecarExited;
            }

            WebView.Dispose();
        }
    }
}
