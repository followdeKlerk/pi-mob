/// Identifies the durable source a search entry was extracted from.
///
/// New sources land as additional cases; existing values are frozen so
/// persisted rows remain meaningful across app upgrades.
enum SearchSource {
  /// Search hit is the chat name itself. One entry per (host, session).
  chat,

  /// Search hit came from the user's prompt message.
  userPrompt,

  /// Search hit came from a final assistant answer / answer deltas.
  assistant,

  /// Search hit came from a provider reasoning summary.
  reasoning,

  /// Search hit came from a tool name, arguments, or output preview.
  tool,
  workspace,
  file,
  git,
}

/// Wire-stable identifier used both in the database and across the bridge.
String searchSourceWire(SearchSource source) => switch (source) {
  SearchSource.chat => 'chat',
  SearchSource.userPrompt => 'user_prompt',
  SearchSource.assistant => 'assistant',
  SearchSource.reasoning => 'reasoning',
  SearchSource.tool => 'tool',
  SearchSource.workspace => 'workspace',
  SearchSource.file => 'file',
  SearchSource.git => 'git',
};

SearchSource? searchSourceFromWire(Object? value) {
  if (value is! String) return null;
  switch (value) {
    case 'chat':
      return SearchSource.chat;
    case 'user_prompt':
      return SearchSource.userPrompt;
    case 'assistant':
      return SearchSource.assistant;
    case 'reasoning':
      return SearchSource.reasoning;
    case 'tool':
      return SearchSource.tool;
    case 'workspace':
      return SearchSource.workspace;
    case 'file':
      return SearchSource.file;
    case 'git':
      return SearchSource.git;
  }
  return null;
}

/// Display labels for [SearchSource]. Kept local so a later file/git source
/// does not require renaming a shared utility.
String searchSourceLabel(SearchSource source) => switch (source) {
  SearchSource.chat => 'Chat name',
  SearchSource.userPrompt => 'Your prompt',
  SearchSource.assistant => 'Assistant',
  SearchSource.reasoning => 'Reasoning',
  SearchSource.tool => 'Tool',
  SearchSource.workspace => 'Workspace',
  SearchSource.file => 'File',
  SearchSource.git => 'Git/CI',
};

/// Short icon glyph for the chip on each result row. Chosen to mirror the
/// existing transcript affordances so muscle memory transfers between the
/// per-chat sheet and the global sheet.
String searchSourceGlyph(SearchSource source) => switch (source) {
  SearchSource.chat => '💬',
  SearchSource.userPrompt => '👤',
  SearchSource.assistant => '🤖',
  SearchSource.reasoning => '💭',
  SearchSource.tool => '🛠',
  SearchSource.workspace => '◫',
  SearchSource.file => '▤',
  SearchSource.git => '⑂',
};
