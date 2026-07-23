/// Stable, locally persisted source classes for global search.
enum SearchSource { chat, userPrompt, assistant, reasoning, tool }

String searchSourceWire(SearchSource source) => switch (source) {
  SearchSource.chat => 'chat',
  SearchSource.userPrompt => 'user_prompt',
  SearchSource.assistant => 'assistant',
  SearchSource.reasoning => 'reasoning',
  SearchSource.tool => 'tool',
};

SearchSource? searchSourceFromWire(String value) => switch (value) {
  'chat' => SearchSource.chat,
  'user_prompt' => SearchSource.userPrompt,
  'assistant' => SearchSource.assistant,
  'reasoning' => SearchSource.reasoning,
  'tool' => SearchSource.tool,
  _ => null,
};

String searchSourceLabel(SearchSource source) => switch (source) {
  SearchSource.chat => 'Chat name',
  SearchSource.userPrompt => 'Your prompt',
  SearchSource.assistant => 'Assistant',
  SearchSource.reasoning => 'Reasoning summary',
  SearchSource.tool => 'Tool',
};

String searchSourceGlyph(SearchSource source) => switch (source) {
  SearchSource.chat => '💬',
  SearchSource.userPrompt => '👤',
  SearchSource.assistant => '🤖',
  SearchSource.reasoning => '💭',
  SearchSource.tool => '🛠',
};

/// Synthetic source identity, never a transport event ID.
const String kChatNameEventId = 'chat-name';
const String kChatNameCursor = '0';
