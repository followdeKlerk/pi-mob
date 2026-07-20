/// Reusable M10 Pi control widgets and their coordinator-free data types.
///
/// Each widget depends only on the immutable view-data + callbacks declared
/// in `control_view_data.dart`. They never reach into the connection
/// coordinator or domain state, so they can be unit-tested in isolation and
/// embedded in any surface.
library;

export 'compaction_controls.dart';
export 'context_stats_card.dart';
export 'control_view_data.dart';
export 'model_thinking_selector.dart';
export 'retry_controls.dart';
export 'supported_command_list.dart';
export 'unsupported_control_state.dart';
