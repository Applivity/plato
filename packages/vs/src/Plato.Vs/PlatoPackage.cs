using System;
using System.Collections.Generic;
using System.ComponentModel.Design;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.VisualStudio.Shell;
using Microsoft.Web.WebView2.Core;
using Plato.Vs.Native;

namespace Plato.Vs
{
    /// <summary>
    /// The in-process Visual Studio package: commands and the tool window
    /// registry. Each window owns its own sidecar; the package owns the
    /// WebView2 environment they share.
    /// </summary>
    [PackageRegistration(UseManagedResourcesOnly = true, AllowsBackgroundLoading = true)]
    [InstalledProductRegistration("Plato by Applivity", "AI coding agent for Visual Studio", "0.1.5")]
    [ProvideMenuResource("Menus.ctmenu", 1)]
    [ProvideToolWindow(
        typeof(PlatoToolWindow),
        Style = VsDockStyle.Tabbed,
        Window = "3ae79031-e1bc-11d0-8f78-00a0c9110057",
        MultiInstances = true,
        Transient = true)]
    [Guid(PackageGuidString)]
    public sealed class PlatoPackage : AsyncPackage
    {
        public const string PackageGuidString = "F847572D-4D51-4FFA-BEA4-8D41ABA11C98";

        public static readonly Guid CommandSet = new Guid("63D248E4-AF07-4A5F-B5A3-86F13D404ECD");

        private readonly List<PlatoToolWindow> _windows = new List<PlatoToolWindow>();

        private WindowSlot? _pendingSlot;
        private Task<CoreWebView2Environment>? _webViewEnvironment;
        private int _windowNumber;

        public static PlatoPackage? Instance { get; private set; }

        internal SolutionService? Solutions { get; private set; }

        internal string ExtensionDirectory { get; private set; } = AppDomain.CurrentDomain.BaseDirectory;

        /// <summary>
        /// The window the user last interacted with. The list is kept in
        /// activation order: a new window is appended, so it is active until
        /// another is focused, and an activation moves its window to the end.
        /// A closed window is removed before this is read, so the target falls
        /// back to the window that was active before it.
        /// </summary>
        private PlatoToolWindow? LastActive =>
            _windows.Count == 0 ? null : _windows[_windows.Count - 1];

        protected override async Task InitializeAsync(
            CancellationToken cancellationToken,
            IProgress<ServiceProgressData> progress)
        {
            await base.InitializeAsync(cancellationToken, progress);

            Instance = this;
            await JoinableTaskFactory.SwitchToMainThreadAsync(cancellationToken);

            ExtensionDirectory =
                Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location)
                ?? AppDomain.CurrentDomain.BaseDirectory;
            Solutions = new SolutionService(this);

            if (await GetServiceAsync(typeof(IMenuCommandService)) is OleMenuCommandService commands)
            {
                commands.AddCommand(new MenuCommand(
                    (_, __) => _ = RunGuardedAsync(() => OpenChatAsync()),
                    new CommandID(CommandSet, PackageIds.OpenChat)));
                commands.AddCommand(new MenuCommand(
                    (_, __) => _ = RunGuardedAsync(() => OpenNewWindowAsync()),
                    new CommandID(CommandSet, PackageIds.NewWindow)));
                commands.AddCommand(new MenuCommand(
                    (_, __) => _ = RunGuardedAsync(() => ExecutePlatoCommandAsync("plato.newChat")),
                    new CommandID(CommandSet, PackageIds.NewChat)));
                commands.AddCommand(new MenuCommand(
                    (_, __) => _ = RunGuardedAsync(() => ExecutePlatoCommandAsync("plato.setApiKey")),
                    new CommandID(CommandSet, PackageIds.SetApiKey)));
                commands.AddCommand(new MenuCommand(
                    (_, __) => _ = RunGuardedAsync(() => ExecutePlatoCommandAsync("plato.manageKeys")),
                    new CommandID(CommandSet, PackageIds.ManageKeys)));
            }
        }

        /// <summary>
        /// The one WebView2 environment every window uses. Environments with
        /// the same user data folder share their browser process, and creating
        /// one per control is the documented way to get intermittent
        /// initialization failures.
        /// </summary>
        internal Task<CoreWebView2Environment> GetWebViewEnvironmentAsync() =>
            _webViewEnvironment ??= CreateWebViewEnvironmentAsync();

        private static async Task<CoreWebView2Environment> CreateWebViewEnvironmentAsync()
        {
            Directory.CreateDirectory(PlatoPaths.WebView2UserData);
            return await CoreWebView2Environment.CreateAsync(null, PlatoPaths.WebView2UserData);
        }

        /// <summary>
        /// Takes the slot the package prepared for the pane that is being
        /// constructed. Visual Studio can also construct a pane on its own; in
        /// that case a fresh slot is issued so the window still has its own
        /// state.
        /// </summary>
        internal WindowSlot ClaimWindowSlot()
        {
            // Do not call FindToolWindow here: this runs inside the pane
            // constructor, which Visual Studio is already creating. A pane
            // that appears without a prepared slot gets a private slot; it
            // still works, but OpenChat reveals it by its own frame.
            var slot = _pendingSlot ?? new WindowSlot(-1, NewStateId(), ++_windowNumber);
            _pendingSlot = null;
            return slot;
        }

        private WindowSlot AllocateSlot(int instanceId) =>
            new WindowSlot(instanceId, NewStateId(), ++_windowNumber);

        private static string NewStateId() =>
            Guid.NewGuid().ToString("N").Substring(0, 8);

        private int FirstFreeInstanceId()
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            var id = 0;
            while (FindToolWindow(typeof(PlatoToolWindow), id, false) != null)
            {
                id++;
            }

            return id;
        }

        internal void RegisterWindow(PlatoToolWindow window)
        {
            if (!_windows.Contains(window))
            {
                _windows.Add(window);
            }
        }

        internal void UnregisterWindow(PlatoToolWindow window)
        {
            _windows.Remove(window);
        }

        /// <summary>
        /// Moves an activated window to the end of the activation order. The
        /// frame notification is the primary signal; a message from the page
        /// also counts, because a click can land before the frame reports it.
        /// </summary>
        internal void NoteActive(PlatoToolWindow window)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            if (!_windows.Contains(window))
            {
                return;
            }

            _windows.Remove(window);
            _windows.Add(window);
        }

        internal void NoteActive(PlatoWebViewControl control)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            var window = _windows.FirstOrDefault(
                candidate => ReferenceEquals(candidate.WebViewControl, control));
            if (window != null)
            {
                NoteActive(window);
            }
        }

        /// <summary>
        /// Shows the last window the user worked in, or creates the first one.
        /// Commands act on that window, so a command never points at a window
        /// the user cannot see.
        /// </summary>
        public async Task<PlatoToolWindow?> OpenChatAsync()
        {
            await JoinableTaskFactory.SwitchToMainThreadAsync(DisposalToken);
            var pane = LastActive;
            if (pane == null)
            {
                return await CreateWindowAsync();
            }

            if (pane.Slot.InstanceId >= 0)
            {
                await ShowToolWindowAsync(
                    typeof(PlatoToolWindow),
                    pane.Slot.InstanceId,
                    true,
                    DisposalToken);
            }

            await pane.WebViewControl.OpenChatAsync();
            return pane;
        }

        /// <summary>
        /// Creates another independent window. The instance id is the first
        /// free one; the window's state id is new and is never reused.
        /// </summary>
        public async Task<PlatoToolWindow?> OpenNewWindowAsync()
        {
            var pane = await CreateWindowAsync();
            if (pane != null)
            {
                await pane.WebViewControl.OpenChatAsync();
            }

            return pane;
        }

        private async Task<PlatoToolWindow?> CreateWindowAsync()
        {
            await JoinableTaskFactory.SwitchToMainThreadAsync(DisposalToken);
            var slot = AllocateSlot(FirstFreeInstanceId());
            _pendingSlot = slot;
            try
            {
                return await ShowToolWindowAsync(
                    typeof(PlatoToolWindow),
                    slot.InstanceId,
                    true,
                    DisposalToken) as PlatoToolWindow;
            }
            finally
            {
                _pendingSlot = null;
            }
        }

        /// <summary>
        /// Opens the active window and then runs one of the extension's own
        /// commands, so the sidecar stays the only place a command is defined.
        /// </summary>
        public async Task ExecutePlatoCommandAsync(string command)
        {
            var pane = await OpenChatAsync();
            if (pane != null)
            {
                // A command such as New Chat or Set API Key waits for a person,
                // so this must not give up while its dialog is still open.
                await pane.Sidecar.RequestAsync(
                    "command",
                    new { command },
                    TimeSpan.FromMinutes(10));
            }
        }

        private async Task RunGuardedAsync(Func<Task> action)
        {
            try
            {
                await action();
            }
            catch (Exception error)
            {
                await JoinableTaskFactory.SwitchToMainThreadAsync();
                MessageWindow.Show(this, "error", error.Message, Array.Empty<string>());
            }
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                var windows = _windows.ToArray();
                try
                {
                    Task.WhenAll(windows.Select(window => window.ShutdownAsync()))
                        .Wait(TimeSpan.FromSeconds(5));
                }
                catch (Exception)
                {
                    // A sidecar that is already gone needs no further stop.
                }

                Solutions?.Dispose();
                Instance = null;
            }

            base.Dispose(disposing);
        }
    }
}
