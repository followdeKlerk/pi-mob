import 'package:flutter/foundation.dart';

@immutable
class CommandCatalogueEntry {
  const CommandCatalogueEntry({
    required this.id,
    required this.title,
    required this.category,
    this.description,
    this.invocation,
    this.available = true,
    this.unavailableReason,
    this.reloadRequired = false,
  });

  final String id;
  final String title;
  final CommandCatalogueCategory category;
  final String? description;
  final String? invocation;
  final bool available;
  final String? unavailableReason;
  final bool reloadRequired;

  String get searchText => [
    title,
    description,
    invocation,
    category.label,
  ].whereType<String>().join('\n').toLowerCase();
}

enum CommandCatalogueCategory { skill, template, extension }

extension on CommandCatalogueCategory {
  String get label => switch (this) {
    CommandCatalogueCategory.skill => 'Skills',
    CommandCatalogueCategory.template => 'Templates',
    CommandCatalogueCategory.extension => 'Extensions',
  };
}

@immutable
class CommandCatalogueSection {
  const CommandCatalogueSection({
    required this.category,
    required this.entries,
  });

  final CommandCatalogueCategory category;
  final List<CommandCatalogueEntry> entries;

  String get label => category.label;
}

@immutable
class CommandCatalogue {
  const CommandCatalogue({
    required this.entries,
    this.unavailableReason,
    this.reloadRequired = false,
  });

  final List<CommandCatalogueEntry> entries;
  final String? unavailableReason;
  final bool reloadRequired;

  List<CommandCatalogueEntry> search(String query) {
    final needle = query.trim().toLowerCase();
    if (needle.isEmpty) return List.unmodifiable(entries);
    return List.unmodifiable(
      entries.where((entry) => entry.searchText.contains(needle)),
    );
  }

  List<CommandCatalogueSection> grouped([String query = '']) {
    final filtered = search(query);
    final grouped = <CommandCatalogueCategory, List<CommandCatalogueEntry>>{};
    for (final entry in filtered) {
      grouped
          .putIfAbsent(entry.category, () => <CommandCatalogueEntry>[])
          .add(entry);
    }
    return List.unmodifiable(
      CommandCatalogueCategory.values
          .where(grouped.containsKey)
          .map(
            (category) => CommandCatalogueSection(
              category: category,
              entries: List.unmodifiable(grouped[category]!),
            ),
          ),
    );
  }
}
