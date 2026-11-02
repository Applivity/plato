using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.VisualStudio.Shell;
using Microsoft.VisualStudio.Threading;
using Newtonsoft.Json.Linq;
using Plato.Vs.Native;
using Task = System.Threading.Tasks.Task;

namespace Plato.Vs.Bridge
{
    /// <summary>
    /// The Node sidecar: start, stop, restart, and the stdio JSON protocol.
    /// A sidecar crash must not stop Visual Studio.
    /// </summary>
    internal sealed class SidecarHost : IDisposable
    {
        private sealed class PendingRequest
        {
            public TaskCompletionSource<JObject> Completion { get; } =
                new TaskCompletionSource<JObject>(TaskCreationOptions.RunContinuationsAsynchronously);
        }

        private readonly IServiceProvider _serviceProvider;
        private readonly JoinableTaskFactory _jtf;
        private readonly string _nodePath;
        private readonly string _entryPath;
        private readonly string _workingDirectory;
        private readonly string _logPath;
        private readonly SemaphoreSlim _writeGate = new SemaphoreSlim(1, 1);
        private readonly Dictionary<long, PendingRequest> _pending = new Dictionary<long, PendingRequest>();
        private readonly object _logGate = new object();

        private Process? _process;
        private long _nextId;
        private bool _disposed;

        public SidecarHost(IServiceProvider serviceProvider, JoinableTaskFactory jtf, string extensionDirectory)
        {
            _serviceProvider = serviceProvider;
            _jtf = jtf;
            _workingDirectory = extensionDirectory;
            _nodePath = Path.Combine(extensionDirectory, "sidecar", "node.exe");
            _entryPath = Path.Combine(extensionDirectory, "sidecar", "plato-host.cjs");
            _logPath = PlatoPaths.NewLogFile();
        }

        public string? Root { get; private set; }

        public string? LastHtml { get; private set; }

        public bool IsRunning => _process != null && SafeHasExited(_process) == false;

        public event Action<string>? WebviewHtml;
        public event Action<JToken>? WebviewPost;
        public event Action? PanelReveal;
        public event Action? PanelDisposed;
        public event Action<int>? Exited;

        public async Task StartAsync(string root)
        {
            if (IsRunning)
            {
                if (!string.Equals(Root, root, StringComparison.OrdinalIgnoreCase))
                {
                    Root = root;
                    await RequestAsync("solution.changed", new { root }, TimeSpan.FromSeconds(10)).ConfigureAwait(false);
                }

                return;
            }

            if (!File.Exists(_nodePath))
            {
                throw new FileNotFoundException("The Plato sidecar runtime is missing. Reinstall the extension.", _nodePath);
            }

            if (!File.Exists(_entryPath))
            {
                throw new FileNotFoundException("The Plato sidecar bundle is missing. Reinstall the extension.", _entryPath);
            }

            Root = root;

            var startInfo = new ProcessStartInfo
            {
                FileName = _nodePath,
                Arguments = Quote(_entryPath),
                WorkingDirectory = _workingDirectory,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
            };
            startInfo.EnvironmentVariables["PLATO_VS"] = "1";
            startInfo.EnvironmentVariables["PLATO_VS_LOG"] = _logPath;

            var process = new Process { StartInfo = startInfo, EnableRaisingEvents = true };
            process.Exited += (_, __) => OnProcessExited(process);
            process.Start();
            _process = process;
            Log("sidecar started: pid " + process.Id + " runtime " + ProcessImagePath(process));

            _ = Task.Run(() => ReadStdoutAsync(process));
            _ = Task.Run(() => ReadStderrAsync(process));

            await RequestAsync(
                "init",
                new
                {
                    root,
                    settingsPath = PlatoPaths.SettingsFile,
                    stateDir = PlatoPaths.RoamingRoot,
                    workspaceStateFile = PlatoPaths.WorkspaceStateFile(root),
                    version = "0.1.4",
                },
                TimeSpan.FromSeconds(20)).ConfigureAwait(false);

            Log("sidecar initialized for " + root);
        }

        public async Task<JToken?> RequestAsync(string method, object parameters, TimeSpan timeout)
        {
            var process = _process;
            if (process == null || SafeHasExited(process))
            {
                throw new InvalidOperationException("The Plato agent process is not running.");
            }

            var id = Interlocked.Increment(ref _nextId);
            var pending = new PendingRequest();
            lock (_pending)
            {
                _pending[id] = pending;
            }

            await WriteLineAsync(Protocol.Request(id, method, parameters)).ConfigureAwait(false);

            var completed = await Task.WhenAny(pending.Completion.Task, Task.Delay(timeout)).ConfigureAwait(false);
            if (completed != pending.Completion.Task)
            {
                lock (_pending)
                {
                    _pending.Remove(id);
                }

                throw new TimeoutException(method + " timed out after " + timeout.TotalSeconds.ToString("0") + " s");
            }

            var response = await pending.Completion.Task.ConfigureAwait(false);
            var error = response["error"];
            if (error != null)
            {
                throw new InvalidOperationException(error.Value<string>("message") ?? "The Plato agent returned an error.");
            }

            return response["result"];
        }

        public Task NotifyAsync(string method, object parameters) =>
            WriteLineAsync(Protocol.Notification(method, parameters));

        public Task SendCommandAsync(string command) =>
            RequestAsync("command", new { command }, TimeSpan.FromSeconds(30));

        private async Task WriteLineAsync(string line)
        {
            var process = _process;
            if (process == null || SafeHasExited(process))
            {
                throw new InvalidOperationException("The Plato agent process is not running.");
            }

            await _writeGate.WaitAsync().ConfigureAwait(false);
            try
            {
                // D49ch: the protocol is UTF-8, and `StandardInput` is a
                // StreamWriter whose encoding is the system ANSI codepage on
                // .NET Framework (StandardInputEncoding does not exist there).
                // An en dash typed into a Settings field was written as 0x97,
                // which Node's UTF-8 reader reported as U+FFFD and the host then
                // saved that way — so every non-ASCII character the user sent
                // arrived corrupted. Write the bytes ourselves.
                var bytes = Encoding.UTF8.GetBytes(line + "\n");
                var stream = process.StandardInput.BaseStream;
                await stream.WriteAsync(bytes, 0, bytes.Length).ConfigureAwait(false);
                await stream.FlushAsync().ConfigureAwait(false);
            }
            finally
            {
                _writeGate.Release();
            }
        }

        private async Task ReadStdoutAsync(Process process)
        {
            try
            {
                while (true)
                {
                    var line = await process.StandardOutput.ReadLineAsync().ConfigureAwait(false);
                    if (line == null)
                    {
                        break;
                    }

                    if (line.Length > 0)
                    {
                        HandleLine(line);
                    }
                }
            }
            catch (Exception error)
            {
                if (!_disposed)
                {
                    Log("stdout reader stopped: " + error.Message);
                }
            }
        }

        private async Task ReadStderrAsync(Process process)
        {
            try
            {
                while (true)
                {
                    var line = await process.StandardError.ReadLineAsync().ConfigureAwait(false);
                    if (line == null)
                    {
                        break;
                    }

                    Log("stderr: " + line);
                }
            }
            catch (Exception)
            {
                // The process left; nothing to read.
            }
        }

        private void HandleLine(string line)
        {
            var message = Protocol.Parse(line);
            if (message == null)
            {
                Log("protocol: a line was not JSON: " + Truncate(line));
                return;
            }

            var id = Protocol.IdOf(message);
            var method = message.Value<string>("method");
            if (method == null)
            {
                if (id == null)
                {
                    return;
                }

                PendingRequest? pending = null;
                lock (_pending)
                {
                    if (_pending.TryGetValue(id.Value, out pending))
                    {
                        _pending.Remove(id.Value);
                    }
                }

                pending?.Completion.TrySetResult(message);
                return;
            }

            var parameters = message["params"] as JObject ?? new JObject();
            switch (method)
            {
                case "webview.html":
                    LastHtml = parameters.Value<string>("html") ?? string.Empty;
                    WebviewHtml?.Invoke(LastHtml);
                    break;
                case "webview.post":
                    WebviewPost?.Invoke(parameters["message"] ?? JValue.CreateNull());
                    break;
                case "panel.reveal":
                    PanelReveal?.Invoke();
                    break;
                case "panel.disposed":
                    PanelDisposed?.Invoke();
                    break;
                case "log":
                    Log("[sidecar] " + parameters.Value<string>("level") + ": " + parameters.Value<string>("message"));
                    break;
                case "secrets.get":
                case "secrets.store":
                case "secrets.delete":
                    if (HandleSecrets(id, method, parameters))
                    {
                        return;
                    }

                    break;
                case "ui.quickPick":
                case "ui.inputBox":
                case "ui.openDialog":
                case "ui.message":
                    HandleUi(id, method, parameters);
                    return;
                case "editor.open":
                case "editor.closeActive":
                    HandleEditor(id, method, parameters);
                    return;
                default:
                    if (id != null)
                    {
                        _ = RespondErrorAsync(id.Value, -32601, "unknown method: " + method);
                    }

                    break;
            }
        }

        private bool HandleSecrets(long? id, string method, JObject parameters)
        {
            if (id == null)
            {
                return true;
            }

            var requestId = id.Value;
            _ = Task.Run(async () =>
            {
                try
                {
                    var key = parameters.Value<string>("key");
                    if (key == null || key.Length == 0)
                    {
                        await RespondErrorAsync(requestId, -32602, "secrets: key is required").ConfigureAwait(false);
                        return;
                    }

                    switch (method)
                    {
                        case "secrets.get":
                            var value = CredentialStore.Get(key);
                            await RespondAsync(requestId, value != null ? new { value } : (object)new { }).ConfigureAwait(false);
                            break;
                        case "secrets.store":
                            CredentialStore.Store(key, parameters.Value<string>("value") ?? string.Empty);
                            await RespondAsync(requestId, new { ok = true }).ConfigureAwait(false);
                            break;
                        case "secrets.delete":
                            CredentialStore.Delete(key);
                            await RespondAsync(requestId, new { ok = true }).ConfigureAwait(false);
                            break;
                    }
                }
                catch (Exception error)
                {
                    Log("secrets." + method + ": " + error.Message);
                    await RespondErrorAsync(requestId, -32000, error.Message).ConfigureAwait(false);
                }
            });
            return true;
        }

        private void HandleUi(long? id, string method, JObject parameters)
        {
            if (id == null)
            {
                return;
            }

            var requestId = id.Value;
            _ = _jtf.RunAsync(async () =>
            {
                try
                {
                    await _jtf.SwitchToMainThreadAsync();
                    switch (method)
                    {
                        case "ui.quickPick":
                        {
                            var items = parameters["items"]?.ToObject<List<QuickPickEntry>>() ?? new List<QuickPickEntry>();
                            var index = QuickPickWindow.Show(_serviceProvider, parameters.Value<string>("placeHolder"), items);
                            await RespondAsync(requestId, index.HasValue ? new { index = index.Value } : (object)new { }).ConfigureAwait(false);
                            break;
                        }

                        case "ui.inputBox":
                        {
                            var value = InputBoxWindow.Show(
                                _serviceProvider,
                                parameters.Value<string>("prompt"),
                                parameters.Value<bool>("password"),
                                parameters.Value<string>("value"));
                            await RespondAsync(requestId, value != null ? new { value } : (object)new { }).ConfigureAwait(false);
                            break;
                        }

                        case "ui.openDialog":
                        {
                            var paths = FileDialogService.Show(
                                parameters.Value<string>("openLabel"),
                                parameters.Value<string>("defaultPath"),
                                parameters.Value<bool>("canSelectMany"));
                            await RespondAsync(
                                requestId,
                                paths == null ? (object)new { } : new { paths }).ConfigureAwait(false);
                            break;
                        }

                        case "ui.message":
                        {
                            var actions = parameters["actions"]?.ToObject<List<string>>() ?? new List<string>();
                            var action = MessageWindow.Show(
                                _serviceProvider,
                                parameters.Value<string>("kind") ?? "info",
                                parameters.Value<string>("message") ?? string.Empty,
                                actions);
                            await RespondAsync(requestId, action != null ? new { action } : (object)new { }).ConfigureAwait(false);
                            break;
                        }
                    }
                }
                catch (Exception error)
                {
                    Log(method + ": " + error.Message);
                    await RespondErrorAsync(requestId, -32000, error.Message).ConfigureAwait(false);
                }
            });
        }

        private void HandleEditor(long? id, string method, JObject parameters)
        {
            var requestId = id;
            _ = _jtf.RunAsync(async () =>
            {
                try
                {
                    await _jtf.SwitchToMainThreadAsync();
                    if (method == "editor.open")
                    {
                        var path = parameters.Value<string>("path");
                        if (path != null && path.Length > 0)
                        {
                            EditorService.Open(_serviceProvider, path);
                        }
                    }
                    else
                    {
                        EditorService.CloseActive(_serviceProvider);
                    }

                    if (requestId != null)
                    {
                        await RespondAsync(requestId.Value, new { ok = true }).ConfigureAwait(false);
                    }
                }
                catch (Exception error)
                {
                    Log(method + ": " + error.Message);
                    if (requestId != null)
                    {
                        await RespondErrorAsync(requestId.Value, -32000, error.Message).ConfigureAwait(false);
                    }
                }
            });
        }

        private Task RespondAsync(long id, object result) => WriteLineAsync(Protocol.Success(id, result));

        private Task RespondErrorAsync(long id, long code, string message) =>
            WriteLineAsync(Protocol.Failure(id, code, message));

        private void OnProcessExited(Process process)
        {
            Log("sidecar exited with " + SafeExitCode(process));
            FailPending("The Plato agent process stopped.");

            if (!_disposed)
            {
                Exited?.Invoke(SafeExitCode(process));
            }
        }

        private void FailPending(string reason)
        {
            List<PendingRequest> pending;
            lock (_pending)
            {
                pending = new List<PendingRequest>(_pending.Values);
                _pending.Clear();
            }

            foreach (var request in pending)
            {
                request.Completion.TrySetException(new InvalidOperationException(reason));
            }
        }

        public void Dispose()
        {
            if (_disposed)
            {
                return;
            }

            _disposed = true;
            var process = _process;
            _process = null;
            if (process == null)
            {
                return;
            }

            try
            {
                if (!SafeHasExited(process))
                {
                    var shutdown = Protocol.Request(Interlocked.Increment(ref _nextId), "shutdown", new { });
                    if (_writeGate.Wait(500))
                    {
                        try
                        {
                            process.StandardInput.WriteLine(shutdown);
                            process.StandardInput.Flush();
                        }
                        finally
                        {
                            _writeGate.Release();
                        }
                    }

                    process.WaitForExit(2000);
                }
            }
            catch (Exception error)
            {
                Log("shutdown: " + error.Message);
            }

            if (!SafeHasExited(process))
            {
                KillTree(process);
            }

            process.Dispose();
            Log("sidecar stopped");
        }

        private static void KillTree(Process process)
        {
            try
            {
                var startInfo = new ProcessStartInfo("taskkill", "/PID " + process.Id + " /T /F")
                {
                    UseShellExecute = false,
                    CreateNoWindow = true,
                };
                using (var killer = Process.Start(startInfo))
                {
                    killer?.WaitForExit(5000);
                }
            }
            catch (Exception)
            {
                try
                {
                    process.Kill();
                }
                catch (Exception)
                {
                    // Already gone.
                }
            }
        }

        private void Log(string message)
        {
            try
            {
                lock (_logGate)
                {
                    File.AppendAllText(
                        _logPath,
                        DateTime.Now.ToString("O") + " " + message + Environment.NewLine);
                }
            }
            catch (Exception)
            {
                // A log failure must not break a run.
            }
        }

        /// <summary>
        /// The image the sidecar process actually started from. This is the
        /// witness that a run used the bundled runtime and not a Node found on
        /// PATH, so it is logged at start.
        /// <see cref="Process.MainModule"/> is not reliable here: inside
        /// devenv.exe it returned the process's first loaded module
        /// (ntdll.dll) instead of the executable, so it named the wrong image
        /// in a field run. QueryFullProcessImageName asks the kernel for the
        /// image path directly.
        /// </summary>
        private static string ProcessImagePath(Process process)
        {
            var handle = IntPtr.Zero;
            try
            {
                handle = OpenProcess(ProcessQueryLimitedInformation, false, process.Id);
                if (handle == IntPtr.Zero)
                {
                    return "(unavailable)";
                }

                var length = 1024;
                var buffer = new StringBuilder(length);
                if (!QueryFullProcessImageName(handle, 0, buffer, ref length))
                {
                    return "(unavailable)";
                }

                return buffer.ToString();
            }
            catch (Exception)
            {
                return "(unavailable)";
            }
            finally
            {
                if (handle != IntPtr.Zero)
                {
                    CloseHandle(handle);
                }
            }
        }

        private const uint ProcessQueryLimitedInformation = 0x1000;

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr OpenProcess(
            uint desiredAccess,
            bool inheritHandle,
            int processId);

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern bool QueryFullProcessImageName(
            IntPtr process,
            uint flags,
            StringBuilder exeName,
            ref int size);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool CloseHandle(IntPtr handle);

        private static bool SafeHasExited(Process process)
        {
            try
            {
                return process.HasExited;
            }
            catch (InvalidOperationException)
            {
                return true;
            }
        }

        private static int SafeExitCode(Process process)
        {
            try
            {
                return process.ExitCode;
            }
            catch (InvalidOperationException)
            {
                return -1;
            }
        }

        private static string Quote(string value) => "\"" + value + "\"";

        private static string Truncate(string value) =>
            value.Length <= 200 ? value : value.Substring(0, 200) + "…";
    }
}
