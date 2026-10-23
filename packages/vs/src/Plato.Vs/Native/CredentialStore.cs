using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

namespace Plato.Vs.Native
{
    /// <summary>
    /// Windows Credential Manager, generic credentials for the current user.
    /// API keys never touch settings, logs, transcripts, or the .vs folder.
    /// </summary>
    internal static class CredentialStore
    {
        private const uint CredTypeGeneric = 1;
        private const uint CredPersistLocalMachine = 2;
        private const int ErrorNotFound = 1168;

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct Credential
        {
            public uint Flags;
            public uint Type;
            public IntPtr TargetName;
            public IntPtr Comment;
            public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
            public uint CredentialBlobSize;
            public IntPtr CredentialBlob;
            public uint Persist;
            public uint AttributeCount;
            public IntPtr Attributes;
            public IntPtr TargetAlias;
            public IntPtr UserName;
        }

        [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool CredRead(string target, uint type, uint flags, out IntPtr credential);

        [DllImport("advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool CredWrite(ref Credential credential, uint flags);

        [DllImport("advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool CredDelete(string target, uint type, uint flags);

        [DllImport("advapi32.dll", SetLastError = true)]
        private static extern void CredFree(IntPtr buffer);

        public static string? Get(string target)
        {
            if (!CredRead(target, CredTypeGeneric, 0, out var handle))
            {
                var error = Marshal.GetLastWin32Error();
                if (error == ErrorNotFound)
                {
                    return null;
                }

                throw new Win32Exception(error);
            }

            try
            {
                var credential = Marshal.PtrToStructure<Credential>(handle);
                if (credential.CredentialBlob == IntPtr.Zero || credential.CredentialBlobSize == 0)
                {
                    return string.Empty;
                }

                return Marshal.PtrToStringUni(
                    credential.CredentialBlob,
                    (int)(credential.CredentialBlobSize / sizeof(char)));
            }
            finally
            {
                CredFree(handle);
            }
        }

        public static void Store(string target, string value)
        {
            var blob = Encoding.Unicode.GetBytes(value);
            var blobPointer = Marshal.AllocHGlobal(blob.Length);
            var targetPointer = Marshal.StringToCoTaskMemUni(target);
            var userPointer = Marshal.StringToCoTaskMemUni(Environment.UserName);
            try
            {
                Marshal.Copy(blob, 0, blobPointer, blob.Length);
                var credential = new Credential
                {
                    Type = CredTypeGeneric,
                    TargetName = targetPointer,
                    CredentialBlob = blobPointer,
                    CredentialBlobSize = (uint)blob.Length,
                    Persist = CredPersistLocalMachine,
                    UserName = userPointer,
                };

                if (!CredWrite(ref credential, 0))
                {
                    throw new Win32Exception(Marshal.GetLastWin32Error());
                }
            }
            finally
            {
                Marshal.FreeHGlobal(blobPointer);
                Marshal.FreeCoTaskMem(targetPointer);
                Marshal.FreeCoTaskMem(userPointer);
            }
        }

        public static void Delete(string target)
        {
            if (CredDelete(target, CredTypeGeneric, 0))
            {
                return;
            }

            var error = Marshal.GetLastWin32Error();
            if (error != ErrorNotFound)
            {
                throw new Win32Exception(error);
            }
        }
    }
}
