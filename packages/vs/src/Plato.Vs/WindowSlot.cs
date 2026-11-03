namespace Plato.Vs
{
    /// <summary>
    /// What one Plato window needs before its pane exists. The instance id
    /// addresses the Visual Studio frame; the state id names the window's own
    /// live-state file and is never reused, so a new window cannot inherit a
    /// closed window's conversation.
    /// </summary>
    internal sealed class WindowSlot
    {
        public WindowSlot(int instanceId, string stateId, int number)
        {
            InstanceId = instanceId;
            StateId = stateId;
            Number = number;
        }

        public int InstanceId { get; }

        public string StateId { get; }

        /// <summary>The number the user sees in the caption; 1 for the first.</summary>
        public int Number { get; }
    }
}
