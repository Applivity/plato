using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Threading;
using Microsoft.VisualStudio.Shell;
using Microsoft.VisualStudio.Threading;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Plato.Vs.Bridge;
using Plato.Vs.Native;

namespace Plato.Vs
{
    /// <summary>
    /// The chat page in a WebView2, and the bridge that makes the page believe
    /// it is running in a VS Code webview.
    ///
    /// The browser element is created only when this control has a real
    /// surface: loaded, visible, with a non-zero size. Visual Studio can place a
    /// new tool window in more than one host while it docks it, and a WebView2
    /// created early can stay attached to a host that the finished layout
    /// replaces, which leaves a pane that is drawn but empty. If the surface is
    /// ever lost, the control notices and rebuilds the browser element on the
    /// same sidecar, so the conversation survives.
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

        private const string HealTestVariable = "PLATO_VS_HEAL_TEST";
        private const string BrowserChildClass = "Chrome_WidgetWin_0";
        private static readonly TimeSpan HealthInterval = TimeSpan.FromSeconds(2);

        private readonly JoinableTaskFactory _jtf;
        private readonly Queue<string> _pendingPosts = new Queue<string>();
        private readonly TaskCompletionSource<bool> _surface =
            new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);

        private Task? _initialize;
        private Task? _opening;
        private readonly SidecarHost _sidecar;
        private WebView2? _webView;
        private DispatcherTimer? _health;
        private string? _pendingHtml;
        private string? _lastHtml;
        private bool _coreReady;
        private bool _navigated;
        private bool _disposed;
        private bool _rebuilding;
        private bool _rebuildRequested;
        private string _rebuildReason = "";
        private int _misses;
        private int _faultsInjected;

        internal PlatoWebViewControl(SidecarHost sidecar)
        {
            InitializeComponent();
            _sidecar = sidecar;
            _jtf = ThreadHelper.JoinableTaskFactory;
            Loaded += OnLoaded;
            Unloaded += OnUnloaded;
            SizeChanged += OnSurfaceChanged;
            IsVisibleChanged += OnVisibilityChanged;
        }

        /// <summary>
        /// Loaded, visible and big enough to draw. A pane that is a hidden tab
        /// is deliberately not ready: its browser is created when it is shown.
        /// </summary>
        private bool SurfaceReady =>
            IsLoaded && IsVisible && ActualWidth > 0 && ActualHeight > 0;

        private void OnLoaded(object sender, RoutedEventArgs e)
        {
            NoteSurface();
            if (!SurfaceReady)
            {
                _ = WaitForSurfaceAsync();
            }

            if (_rebuildRequested && _coreReady)
            {
                _rebuildRequested = false;
                _ = RebuildAsync(_rebuildReason);
                return;
            }

            _ = OpenChatGuardedAsync();
        }

        private void OnUnloaded(object sender, RoutedEventArgs e)
        {
            if (_coreReady)
            {
                _rebuildRequested = true;
                _rebuildReason = "the control was unloaded and loaded again";
            }
        }

        private void OnSurfaceChanged(object sender, SizeChangedEventArgs e) => NoteSurface();

        private void OnVisibilityChanged(object sender, DependencyPropertyChangedEventArgs e) => NoteSurface();

        private void NoteSurface()
        {
            if (SurfaceReady)
            {
                _surface.TrySetResult(true);
            }
        }

        private async Task WaitForSurfaceAsync()
        {
            while (!_disposed && !SurfaceReady)
            {
                await Task.Delay(100);
            }

            _surface.TrySetResult(true);
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
            await _surface.Task;
            var package = PlatoPackage.Instance
                ?? throw new InvalidOperationException("The Plato package is not initialized.");

            await _jtf.SwitchToMainThreadAsync();
            var environment = await package.GetWebViewEnvironmentAsync();
            ThemeService.Initialize();
            await CreateViewAsync(environment);

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
            StartHealthCheck();
            InjectFaultIfAsked();

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
        /// Creates the browser element and binds the page events. Called once at
        /// startup and again on every rebuild; everything it sets up belongs to
        /// that one element.
        /// </summary>
        private async Task CreateViewAsync(CoreWebView2Environment environment)
        {
            await _jtf.SwitchToMainThreadAsync();
            var view = new WebView2
            {
                HorizontalAlignment = HorizontalAlignment.Stretch,
                VerticalAlignment = VerticalAlignment.Stretch,
            };
            view.DefaultBackgroundColor = ThemeService.WebViewBackground();
            _webView = view;
            Host.Children.Add(view);

            await view.EnsureCoreWebView2Async(environment);

            var core = view.CoreWebView2;
            await core.AddScriptToExecuteOnDocumentCreatedAsync(InjectedScript);
            core.WebMessageReceived += OnWebMessageReceived;
            core.NavigationCompleted += OnNavigationCompleted;
            core.NewWindowRequested += OnNewWindowRequested;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.AreDefaultContextMenusEnabled = true;
            core.Settings.AreDevToolsEnabled = true;
            _navigated = false;
        }

        /// <summary>
        /// Replaces the browser element on the same sidecar. The conversation
        /// lives in the sidecar, so a rebuild redraws it; it does not restart
        /// the agent or archive the chat.
        /// </summary>
        private async Task RebuildAsync(string reason)
        {
            if (_disposed || _rebuilding || !_coreReady)
            {
                return;
            }

            _rebuilding = true;
            try
            {
                var package = PlatoPackage.Instance;
                if (package == null)
                {
                    return;
                }

                var environment = await package.GetWebViewEnvironmentAsync();
                await _jtf.SwitchToMainThreadAsync();
                _sidecar.LogNote("view rebuilt: " + reason);
                DetachView();
                await CreateViewAsync(environment);
                InjectFaultIfAsked();
                if (_lastHtml != null)
                {
                    Navigate(_lastHtml);
                }
                else if (_sidecar.LastHtml != null)
                {
                    Navigate(_sidecar.LastHtml);
                }
            }
            catch (Exception error)
            {
                _sidecar.LogNote(
                    "view rebuild failed (" + reason + "): " +
                    error.GetType().FullName + ": " + error.Message);
            }
            finally
            {
                _rebuilding = false;
            }
        }

        private void DetachView()
        {
            var view = _webView;
            _webView = null;
            _navigated = false;
            _misses = 0;
            if (view == null)
            {
                return;
            }

            try
            {
                var core = view.CoreWebView2;
                if (core != null)
                {
                    core.WebMessageReceived -= OnWebMessageReceived;
                    core.NavigationCompleted -= OnNavigationCompleted;
                    core.NewWindowRequested -= OnNewWindowRequested;
                }
            }
            catch (Exception)
            {
                // The element is being thrown away; a missing core is expected.
            }

            Host.Children.Remove(view);
            try
            {
                view.Dispose();
            }
            catch (Exception)
            {
                // Same: disposal of a broken element must not stop the rebuild.
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
            await _surface.Task;
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
            _lastHtml = html;
            var view = _webView;
            if (!_coreReady || view == null)
            {
                _pendingHtml = html;
                return;
            }

            _navigated = false;
            view.NavigateToString(html);
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
                var view = _webView;
                if (_navigated && _coreReady && view != null)
                {
                    view.CoreWebView2.PostWebMessageAsJson(json);
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
            var view = _webView;
            if (!_coreReady || view?.CoreWebView2 == null)
            {
                return;
            }

            view.DefaultBackgroundColor = ThemeService.WebViewBackground();
            var colors = ThemeService.Read();
            var json = JsonConvert.SerializeObject(colors);
            await view.CoreWebView2.ExecuteScriptAsync(
                "(function (c) { for (var k in c) { document.documentElement.style.setProperty(k, c[k]); } })(" +
                json +
                ");");

            while (_pendingPosts.Count > 0)
            {
                view.CoreWebView2.PostWebMessageAsJson(_pendingPosts.Dequeue());
            }
        }

        private void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            // A page message is proof the user is working in this window, even
            // if the frame notification has not arrived yet.
            _ = _jtf.RunAsync(async () =>
            {
                await _jtf.SwitchToMainThreadAsync();
                PlatoPackage.Instance?.NoteActive(this);
            });

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
                var view = _webView;
                if (_navigated && _coreReady && view?.CoreWebView2 != null)
                {
                    view.CoreWebView2.PostWebMessageAsJson(JsonConvert.SerializeObject(new
                    {
                        type = "error",
                        text = "Plato's agent process stopped. Use a Plato command to restart it.",
                    }));
                }
            });
        }

        /* ------------------------------------------------------------ health */

        private void StartHealthCheck()
        {
            if (_health != null || _disposed)
            {
                return;
            }

            _health = new DispatcherTimer { Interval = HealthInterval };
            _health.Tick += (_, __) => HealthTick();
            _health.Start();
        }

        /// <summary>
        /// A drawn pane whose browser child is gone cannot recover by itself:
        /// the core object still answers, so navigation and posts succeed and
        /// nothing is drawn. Two consecutive misses rebuild the element.
        /// </summary>
        private void HealthTick()
        {
            if (_disposed || _rebuilding || !_coreReady)
            {
                return;
            }

            if (!SurfaceReady)
            {
                return;
            }

            if (HasBrowserChild())
            {
                _misses = 0;
                return;
            }

            _misses += 1;
            if (_misses < 2)
            {
                return;
            }

            _misses = 0;
            _ = RebuildAsync("no browser child under the pane");
        }

        private bool HasBrowserChild()
        {
            var source = PresentationSource.FromVisual(this) as HwndSource;
            if (source == null || source.Handle == IntPtr.Zero)
            {
                return false;
            }

            var topLeft = PointToScreen(new Point(0, 0));
            var bottomRight = PointToScreen(new Point(ActualWidth, ActualHeight));
            var mine = new RECT
            {
                Left = (int)topLeft.X,
                Top = (int)topLeft.Y,
                Right = (int)bottomRight.X,
                Bottom = (int)bottomRight.Y,
            };

            var found = false;
            EnumChildWindows(source.Handle, (child, _) =>
            {
                if (ClassOf(child) != BrowserChildClass)
                {
                    return true;
                }

                if (!GetWindowRect(child, out var rect))
                {
                    return true;
                }

                if (rect.Right <= mine.Left || rect.Left >= mine.Right ||
                    rect.Bottom <= mine.Top || rect.Top >= mine.Bottom)
                {
                    return true;
                }

                found = true;
                return false;
            }, IntPtr.Zero);
            return found;
        }

        /// <summary>
        /// Fault injection for the self-heal path. Read only when the variable
        /// is set, and never set by the product: the value is how many times to
        /// tear the browser child out of a live pane after it draws.
        /// </summary>
        private void InjectFaultIfAsked()
        {
            var asked = Environment.GetEnvironmentVariable(HealTestVariable);
            if (string.IsNullOrEmpty(asked))
            {
                return;
            }

            if (!int.TryParse(asked, out var times) || times <= 0)
            {
                times = 1;
            }

            if (_faultsInjected >= times)
            {
                return;
            }

            _faultsInjected += 1;
            var timer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(3) };
            timer.Tick += (_, __) =>
            {
                timer.Stop();
                if (_disposed)
                {
                    return;
                }

                var source = PresentationSource.FromVisual(this) as HwndSource;
                if (source == null)
                {
                    return;
                }

                var target = IntPtr.Zero;
                EnumChildWindows(source.Handle, (child, _) =>
                {
                    if (ClassOf(child) == BrowserChildClass)
                    {
                        target = child;
                        return false;
                    }

                    return true;
                }, IntPtr.Zero);

                if (target != IntPtr.Zero)
                {
                    _sidecar.LogNote("heal test: browser child torn out");
                    DestroyWindow(target);
                }
            };
            timer.Start();
        }

        /* -------------------------------------------------------------- win32 */

        private delegate bool EnumChildProc(IntPtr hWnd, IntPtr lParam);

        [StructLayout(LayoutKind.Sequential)]
        private struct RECT
        {
            public int Left;
            public int Top;
            public int Right;
            public int Bottom;
        }

        [DllImport("user32.dll")]
        private static extern bool EnumChildWindows(IntPtr parent, EnumChildProc callback, IntPtr lParam);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern int GetClassName(IntPtr hWnd, StringBuilder buffer, int max);

        [DllImport("user32.dll")]
        private static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

        [DllImport("user32.dll")]
        private static extern bool DestroyWindow(IntPtr hWnd);

        private static string ClassOf(IntPtr hWnd)
        {
            var buffer = new StringBuilder(128);
            GetClassName(hWnd, buffer, buffer.Capacity);
            return buffer.ToString();
        }

        public void Dispose()
        {
            if (_disposed)
            {
                return;
            }

            _disposed = true;
            if (_health != null)
            {
                _health.Stop();
                _health = null;
            }

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

            DetachView();
        }
    }
}
