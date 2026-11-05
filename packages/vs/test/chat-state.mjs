/**
 * Chat values from a workspace-state object.
 *
 * Chats are stored per tab: `plato.chat.<id>.<field>`, with the tab list in
 * `plato.chat.tabIndex`. The legacy single-chat keys (`plato.chatLog`,
 * `plato.chatTitle`, `plato.chatMode`) are still read as a fallback, so a test
 * that seeds them to exercise the migration, and a test that reads after the
 * migration, both work.
 */
const LEGACY = {
  log: 'plato.chatLog',
  title: 'plato.chatTitle',
  mode: 'plato.chatMode',
};

export function chatValue(state, field) {
  const index = state['plato.chat.tabIndex'];
  if (Array.isArray(index)) {
    for (const tab of index) {
      const value = state[`plato.chat.${tab.id}.${field}`];
      if (value !== undefined) return value;
    }
  }
  return state[LEGACY[field]];
}
