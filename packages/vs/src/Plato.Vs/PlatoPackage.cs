using System;
using System.ComponentModel.Design;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.VisualStudio.Shell;
using Microsoft.VisualStudio.Shell.Interop;
using Plato.Vs.Bridge;
using Plato.Vs.Native;

namespace Plato.Vs
{
    /// <summary>
    /// The in-process Visual Studio package: commands, the tool window, and the
    /// sidecar's lifetime.
    /// </summary>
    [PackageRegistration(UseManagedResourcesOnly = true, AllowsBackgroundLoading = true)]
    [InstalledProductRegistration("Plato by Applivity", "AI coding agent for Visual Studio", "0.1.0")]
    [ProvideMenuResource("Menus.ctmenu", 1)]
    [ProvideToolWindow(typeof(PlatoToolWindow), Style = VsDockStyle.Tabbed, Window = "3ae79031-e1bc-11d0-8f78-00a0c9110057")]
    [Guid(PackageGuidString)]
    public sealed class PlatoPackage : AsyncPackage
    {
        public const string PackageGuidString = "F847572D-4D51-4FFA-BEA4-8D41ABA11C98";

        public static readonly Guid CommandSet = new Guid("63D248E4-AF07-4A5F-B5A3-86F13D404ECD");

        public static PlatoPackage? Instance { get; private set; }

        internal SidecarHost? Sidecar { get; private set; }

        internal SolutionService? Solutions { get; private set; }

        protected override async Task InitializeAsync(
            CancellationToken cancellationToken,
            IProgress<ServiceProgressData> progress)
        {
            await base.InitializeAsync(cancellationToken, progress);

            Instance = this;
            await JoinableTaskFactory.SwitchToMainThreadAsync(cancellationToken);

            var extensionDirectory =
                Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location)
                ?? AppDomain.CurrentDomain.BaseDirectory;
            Sidecar = new SidecarHost(this, JoinableTaskFactory, extensionDirectory);
            Solutions = new SolutionService(this);

            if (await GetServiceAsync(typeof(IMenuCommandService)) is OleMenuCommandService commands)
            {
                commands.AddCommand(new MenuCommand(
                    (_, __) => _ = RunGuardedAsync(OpenChatAsync),
                    new CommandID(CommandSet, PackageIds.OpenChat)));
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

        public async Task OpenChatAsync()
        {
            var pane = await ShowToolWindowAsync(
                typeof(PlatoToolWindow),
                0,
                true,
                DisposalToken) as PlatoToolWindow;
            if (pane?.WebViewControl != null)
            {
                await pane.WebViewControl.OpenChatAsync();
            }
        }

        /// <summary>
        /// Opens the tool window and then runs one of the extension's own
        /// commands, so the sidecar stays the only place a command is defined.
        /// </summary>
        public async Task ExecutePlatoCommandAsync(string command)
        {
            await OpenChatAsync();
            if (Sidecar != null)
            {
                await Sidecar.RequestAsync("command", new { command }, TimeSpan.FromSeconds(30));
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
                VsShellUtilities.ShowMessageBox(
                    this,
                    error.Message,
                    "Plato",
                    OLEMSGICON.OLEMSGICON_WARNING,
                    OLEMSGBUTTON.OLEMSGBUTTON_OK,
                    OLEMSGDEFBUTTON.OLEMSGDEFBUTTON_FIRST);
            }
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                Solutions?.Dispose();
                Sidecar?.Dispose();
                Instance = null;
            }

            base.Dispose(disposing);
        }
    }
}
