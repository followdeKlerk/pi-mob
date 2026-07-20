// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'app_database.dart';

// ignore_for_file: type=lint
class $MetadataEntriesTable extends MetadataEntries
    with TableInfo<$MetadataEntriesTable, MetadataEntry> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $MetadataEntriesTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _installationIdMeta = const VerificationMeta(
    'installationId',
  );
  @override
  late final GeneratedColumn<String> installationId = GeneratedColumn<String>(
    'installation_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _platformMeta = const VerificationMeta(
    'platform',
  );
  @override
  late final GeneratedColumn<String> platform = GeneratedColumn<String>(
    'platform',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _appVersionMeta = const VerificationMeta(
    'appVersion',
  );
  @override
  late final GeneratedColumn<String> appVersion = GeneratedColumn<String>(
    'app_version',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _protocolMajorMeta = const VerificationMeta(
    'protocolMajor',
  );
  @override
  late final GeneratedColumn<int> protocolMajor = GeneratedColumn<int>(
    'protocol_major',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _protocolMinorMeta = const VerificationMeta(
    'protocolMinor',
  );
  @override
  late final GeneratedColumn<int> protocolMinor = GeneratedColumn<int>(
    'protocol_minor',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _firstSeenAtMeta = const VerificationMeta(
    'firstSeenAt',
  );
  @override
  late final GeneratedColumn<DateTime> firstSeenAt = GeneratedColumn<DateTime>(
    'first_seen_at',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _lastSeenAtMeta = const VerificationMeta(
    'lastSeenAt',
  );
  @override
  late final GeneratedColumn<DateTime> lastSeenAt = GeneratedColumn<DateTime>(
    'last_seen_at',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: true,
  );
  @override
  List<GeneratedColumn> get $columns => [
    installationId,
    platform,
    appVersion,
    protocolMajor,
    protocolMinor,
    firstSeenAt,
    lastSeenAt,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'metadata_entries';
  @override
  VerificationContext validateIntegrity(
    Insertable<MetadataEntry> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('installation_id')) {
      context.handle(
        _installationIdMeta,
        installationId.isAcceptableOrUnknown(
          data['installation_id']!,
          _installationIdMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_installationIdMeta);
    }
    if (data.containsKey('platform')) {
      context.handle(
        _platformMeta,
        platform.isAcceptableOrUnknown(data['platform']!, _platformMeta),
      );
    } else if (isInserting) {
      context.missing(_platformMeta);
    }
    if (data.containsKey('app_version')) {
      context.handle(
        _appVersionMeta,
        appVersion.isAcceptableOrUnknown(data['app_version']!, _appVersionMeta),
      );
    } else if (isInserting) {
      context.missing(_appVersionMeta);
    }
    if (data.containsKey('protocol_major')) {
      context.handle(
        _protocolMajorMeta,
        protocolMajor.isAcceptableOrUnknown(
          data['protocol_major']!,
          _protocolMajorMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_protocolMajorMeta);
    }
    if (data.containsKey('protocol_minor')) {
      context.handle(
        _protocolMinorMeta,
        protocolMinor.isAcceptableOrUnknown(
          data['protocol_minor']!,
          _protocolMinorMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_protocolMinorMeta);
    }
    if (data.containsKey('first_seen_at')) {
      context.handle(
        _firstSeenAtMeta,
        firstSeenAt.isAcceptableOrUnknown(
          data['first_seen_at']!,
          _firstSeenAtMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_firstSeenAtMeta);
    }
    if (data.containsKey('last_seen_at')) {
      context.handle(
        _lastSeenAtMeta,
        lastSeenAt.isAcceptableOrUnknown(
          data['last_seen_at']!,
          _lastSeenAtMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_lastSeenAtMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {installationId};
  @override
  MetadataEntry map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return MetadataEntry(
      installationId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}installation_id'],
      )!,
      platform: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}platform'],
      )!,
      appVersion: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}app_version'],
      )!,
      protocolMajor: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}protocol_major'],
      )!,
      protocolMinor: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}protocol_minor'],
      )!,
      firstSeenAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}first_seen_at'],
      )!,
      lastSeenAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}last_seen_at'],
      )!,
    );
  }

  @override
  $MetadataEntriesTable createAlias(String alias) {
    return $MetadataEntriesTable(attachedDatabase, alias);
  }
}

class MetadataEntry extends DataClass implements Insertable<MetadataEntry> {
  final String installationId;
  final String platform;
  final String appVersion;
  final int protocolMajor;
  final int protocolMinor;
  final DateTime firstSeenAt;
  final DateTime lastSeenAt;
  const MetadataEntry({
    required this.installationId,
    required this.platform,
    required this.appVersion,
    required this.protocolMajor,
    required this.protocolMinor,
    required this.firstSeenAt,
    required this.lastSeenAt,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['installation_id'] = Variable<String>(installationId);
    map['platform'] = Variable<String>(platform);
    map['app_version'] = Variable<String>(appVersion);
    map['protocol_major'] = Variable<int>(protocolMajor);
    map['protocol_minor'] = Variable<int>(protocolMinor);
    map['first_seen_at'] = Variable<DateTime>(firstSeenAt);
    map['last_seen_at'] = Variable<DateTime>(lastSeenAt);
    return map;
  }

  MetadataEntriesCompanion toCompanion(bool nullToAbsent) {
    return MetadataEntriesCompanion(
      installationId: Value(installationId),
      platform: Value(platform),
      appVersion: Value(appVersion),
      protocolMajor: Value(protocolMajor),
      protocolMinor: Value(protocolMinor),
      firstSeenAt: Value(firstSeenAt),
      lastSeenAt: Value(lastSeenAt),
    );
  }

  factory MetadataEntry.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return MetadataEntry(
      installationId: serializer.fromJson<String>(json['installationId']),
      platform: serializer.fromJson<String>(json['platform']),
      appVersion: serializer.fromJson<String>(json['appVersion']),
      protocolMajor: serializer.fromJson<int>(json['protocolMajor']),
      protocolMinor: serializer.fromJson<int>(json['protocolMinor']),
      firstSeenAt: serializer.fromJson<DateTime>(json['firstSeenAt']),
      lastSeenAt: serializer.fromJson<DateTime>(json['lastSeenAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'installationId': serializer.toJson<String>(installationId),
      'platform': serializer.toJson<String>(platform),
      'appVersion': serializer.toJson<String>(appVersion),
      'protocolMajor': serializer.toJson<int>(protocolMajor),
      'protocolMinor': serializer.toJson<int>(protocolMinor),
      'firstSeenAt': serializer.toJson<DateTime>(firstSeenAt),
      'lastSeenAt': serializer.toJson<DateTime>(lastSeenAt),
    };
  }

  MetadataEntry copyWith({
    String? installationId,
    String? platform,
    String? appVersion,
    int? protocolMajor,
    int? protocolMinor,
    DateTime? firstSeenAt,
    DateTime? lastSeenAt,
  }) => MetadataEntry(
    installationId: installationId ?? this.installationId,
    platform: platform ?? this.platform,
    appVersion: appVersion ?? this.appVersion,
    protocolMajor: protocolMajor ?? this.protocolMajor,
    protocolMinor: protocolMinor ?? this.protocolMinor,
    firstSeenAt: firstSeenAt ?? this.firstSeenAt,
    lastSeenAt: lastSeenAt ?? this.lastSeenAt,
  );
  MetadataEntry copyWithCompanion(MetadataEntriesCompanion data) {
    return MetadataEntry(
      installationId: data.installationId.present
          ? data.installationId.value
          : this.installationId,
      platform: data.platform.present ? data.platform.value : this.platform,
      appVersion: data.appVersion.present
          ? data.appVersion.value
          : this.appVersion,
      protocolMajor: data.protocolMajor.present
          ? data.protocolMajor.value
          : this.protocolMajor,
      protocolMinor: data.protocolMinor.present
          ? data.protocolMinor.value
          : this.protocolMinor,
      firstSeenAt: data.firstSeenAt.present
          ? data.firstSeenAt.value
          : this.firstSeenAt,
      lastSeenAt: data.lastSeenAt.present
          ? data.lastSeenAt.value
          : this.lastSeenAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('MetadataEntry(')
          ..write('installationId: $installationId, ')
          ..write('platform: $platform, ')
          ..write('appVersion: $appVersion, ')
          ..write('protocolMajor: $protocolMajor, ')
          ..write('protocolMinor: $protocolMinor, ')
          ..write('firstSeenAt: $firstSeenAt, ')
          ..write('lastSeenAt: $lastSeenAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
    installationId,
    platform,
    appVersion,
    protocolMajor,
    protocolMinor,
    firstSeenAt,
    lastSeenAt,
  );
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is MetadataEntry &&
          other.installationId == this.installationId &&
          other.platform == this.platform &&
          other.appVersion == this.appVersion &&
          other.protocolMajor == this.protocolMajor &&
          other.protocolMinor == this.protocolMinor &&
          other.firstSeenAt == this.firstSeenAt &&
          other.lastSeenAt == this.lastSeenAt);
}

class MetadataEntriesCompanion extends UpdateCompanion<MetadataEntry> {
  final Value<String> installationId;
  final Value<String> platform;
  final Value<String> appVersion;
  final Value<int> protocolMajor;
  final Value<int> protocolMinor;
  final Value<DateTime> firstSeenAt;
  final Value<DateTime> lastSeenAt;
  final Value<int> rowid;
  const MetadataEntriesCompanion({
    this.installationId = const Value.absent(),
    this.platform = const Value.absent(),
    this.appVersion = const Value.absent(),
    this.protocolMajor = const Value.absent(),
    this.protocolMinor = const Value.absent(),
    this.firstSeenAt = const Value.absent(),
    this.lastSeenAt = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  MetadataEntriesCompanion.insert({
    required String installationId,
    required String platform,
    required String appVersion,
    required int protocolMajor,
    required int protocolMinor,
    required DateTime firstSeenAt,
    required DateTime lastSeenAt,
    this.rowid = const Value.absent(),
  }) : installationId = Value(installationId),
       platform = Value(platform),
       appVersion = Value(appVersion),
       protocolMajor = Value(protocolMajor),
       protocolMinor = Value(protocolMinor),
       firstSeenAt = Value(firstSeenAt),
       lastSeenAt = Value(lastSeenAt);
  static Insertable<MetadataEntry> custom({
    Expression<String>? installationId,
    Expression<String>? platform,
    Expression<String>? appVersion,
    Expression<int>? protocolMajor,
    Expression<int>? protocolMinor,
    Expression<DateTime>? firstSeenAt,
    Expression<DateTime>? lastSeenAt,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (installationId != null) 'installation_id': installationId,
      if (platform != null) 'platform': platform,
      if (appVersion != null) 'app_version': appVersion,
      if (protocolMajor != null) 'protocol_major': protocolMajor,
      if (protocolMinor != null) 'protocol_minor': protocolMinor,
      if (firstSeenAt != null) 'first_seen_at': firstSeenAt,
      if (lastSeenAt != null) 'last_seen_at': lastSeenAt,
      if (rowid != null) 'rowid': rowid,
    });
  }

  MetadataEntriesCompanion copyWith({
    Value<String>? installationId,
    Value<String>? platform,
    Value<String>? appVersion,
    Value<int>? protocolMajor,
    Value<int>? protocolMinor,
    Value<DateTime>? firstSeenAt,
    Value<DateTime>? lastSeenAt,
    Value<int>? rowid,
  }) {
    return MetadataEntriesCompanion(
      installationId: installationId ?? this.installationId,
      platform: platform ?? this.platform,
      appVersion: appVersion ?? this.appVersion,
      protocolMajor: protocolMajor ?? this.protocolMajor,
      protocolMinor: protocolMinor ?? this.protocolMinor,
      firstSeenAt: firstSeenAt ?? this.firstSeenAt,
      lastSeenAt: lastSeenAt ?? this.lastSeenAt,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (installationId.present) {
      map['installation_id'] = Variable<String>(installationId.value);
    }
    if (platform.present) {
      map['platform'] = Variable<String>(platform.value);
    }
    if (appVersion.present) {
      map['app_version'] = Variable<String>(appVersion.value);
    }
    if (protocolMajor.present) {
      map['protocol_major'] = Variable<int>(protocolMajor.value);
    }
    if (protocolMinor.present) {
      map['protocol_minor'] = Variable<int>(protocolMinor.value);
    }
    if (firstSeenAt.present) {
      map['first_seen_at'] = Variable<DateTime>(firstSeenAt.value);
    }
    if (lastSeenAt.present) {
      map['last_seen_at'] = Variable<DateTime>(lastSeenAt.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('MetadataEntriesCompanion(')
          ..write('installationId: $installationId, ')
          ..write('platform: $platform, ')
          ..write('appVersion: $appVersion, ')
          ..write('protocolMajor: $protocolMajor, ')
          ..write('protocolMinor: $protocolMinor, ')
          ..write('firstSeenAt: $firstSeenAt, ')
          ..write('lastSeenAt: $lastSeenAt, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $HostEntriesTable extends HostEntries
    with TableInfo<$HostEntriesTable, HostEntry> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $HostEntriesTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _hostIdMeta = const VerificationMeta('hostId');
  @override
  late final GeneratedColumn<String> hostId = GeneratedColumn<String>(
    'host_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _endpointMeta = const VerificationMeta(
    'endpoint',
  );
  @override
  late final GeneratedColumn<String> endpoint = GeneratedColumn<String>(
    'endpoint',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _displayNameMeta = const VerificationMeta(
    'displayName',
  );
  @override
  late final GeneratedColumn<String> displayName = GeneratedColumn<String>(
    'display_name',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _generationMeta = const VerificationMeta(
    'generation',
  );
  @override
  late final GeneratedColumn<String> generation = GeneratedColumn<String>(
    'generation',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _connectionStateMeta = const VerificationMeta(
    'connectionState',
  );
  @override
  late final GeneratedColumn<String> connectionState = GeneratedColumn<String>(
    'connection_state',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _bridgeVersionMeta = const VerificationMeta(
    'bridgeVersion',
  );
  @override
  late final GeneratedColumn<String> bridgeVersion = GeneratedColumn<String>(
    'bridge_version',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _piVersionMeta = const VerificationMeta(
    'piVersion',
  );
  @override
  late final GeneratedColumn<String> piVersion = GeneratedColumn<String>(
    'pi_version',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _protocolVersionMeta = const VerificationMeta(
    'protocolVersion',
  );
  @override
  late final GeneratedColumn<String> protocolVersion = GeneratedColumn<String>(
    'protocol_version',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _capabilitiesJsonMeta = const VerificationMeta(
    'capabilitiesJson',
  );
  @override
  late final GeneratedColumn<String> capabilitiesJson = GeneratedColumn<String>(
    'capabilities_json',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _lastSeenAtMeta = const VerificationMeta(
    'lastSeenAt',
  );
  @override
  late final GeneratedColumn<DateTime> lastSeenAt = GeneratedColumn<DateTime>(
    'last_seen_at',
    aliasedName,
    true,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: false,
  );
  @override
  List<GeneratedColumn> get $columns => [
    hostId,
    endpoint,
    displayName,
    generation,
    connectionState,
    bridgeVersion,
    piVersion,
    protocolVersion,
    capabilitiesJson,
    lastSeenAt,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'host_entries';
  @override
  VerificationContext validateIntegrity(
    Insertable<HostEntry> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('host_id')) {
      context.handle(
        _hostIdMeta,
        hostId.isAcceptableOrUnknown(data['host_id']!, _hostIdMeta),
      );
    } else if (isInserting) {
      context.missing(_hostIdMeta);
    }
    if (data.containsKey('endpoint')) {
      context.handle(
        _endpointMeta,
        endpoint.isAcceptableOrUnknown(data['endpoint']!, _endpointMeta),
      );
    } else if (isInserting) {
      context.missing(_endpointMeta);
    }
    if (data.containsKey('display_name')) {
      context.handle(
        _displayNameMeta,
        displayName.isAcceptableOrUnknown(
          data['display_name']!,
          _displayNameMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_displayNameMeta);
    }
    if (data.containsKey('generation')) {
      context.handle(
        _generationMeta,
        generation.isAcceptableOrUnknown(data['generation']!, _generationMeta),
      );
    } else if (isInserting) {
      context.missing(_generationMeta);
    }
    if (data.containsKey('connection_state')) {
      context.handle(
        _connectionStateMeta,
        connectionState.isAcceptableOrUnknown(
          data['connection_state']!,
          _connectionStateMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_connectionStateMeta);
    }
    if (data.containsKey('bridge_version')) {
      context.handle(
        _bridgeVersionMeta,
        bridgeVersion.isAcceptableOrUnknown(
          data['bridge_version']!,
          _bridgeVersionMeta,
        ),
      );
    }
    if (data.containsKey('pi_version')) {
      context.handle(
        _piVersionMeta,
        piVersion.isAcceptableOrUnknown(data['pi_version']!, _piVersionMeta),
      );
    }
    if (data.containsKey('protocol_version')) {
      context.handle(
        _protocolVersionMeta,
        protocolVersion.isAcceptableOrUnknown(
          data['protocol_version']!,
          _protocolVersionMeta,
        ),
      );
    }
    if (data.containsKey('capabilities_json')) {
      context.handle(
        _capabilitiesJsonMeta,
        capabilitiesJson.isAcceptableOrUnknown(
          data['capabilities_json']!,
          _capabilitiesJsonMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_capabilitiesJsonMeta);
    }
    if (data.containsKey('last_seen_at')) {
      context.handle(
        _lastSeenAtMeta,
        lastSeenAt.isAcceptableOrUnknown(
          data['last_seen_at']!,
          _lastSeenAtMeta,
        ),
      );
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {hostId};
  @override
  HostEntry map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return HostEntry(
      hostId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}host_id'],
      )!,
      endpoint: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}endpoint'],
      )!,
      displayName: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}display_name'],
      )!,
      generation: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}generation'],
      )!,
      connectionState: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}connection_state'],
      )!,
      bridgeVersion: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}bridge_version'],
      ),
      piVersion: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}pi_version'],
      ),
      protocolVersion: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}protocol_version'],
      ),
      capabilitiesJson: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}capabilities_json'],
      )!,
      lastSeenAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}last_seen_at'],
      ),
    );
  }

  @override
  $HostEntriesTable createAlias(String alias) {
    return $HostEntriesTable(attachedDatabase, alias);
  }
}

class HostEntry extends DataClass implements Insertable<HostEntry> {
  final String hostId;
  final String endpoint;
  final String displayName;
  final String generation;
  final String connectionState;
  final String? bridgeVersion;
  final String? piVersion;
  final String? protocolVersion;
  final String capabilitiesJson;
  final DateTime? lastSeenAt;
  const HostEntry({
    required this.hostId,
    required this.endpoint,
    required this.displayName,
    required this.generation,
    required this.connectionState,
    this.bridgeVersion,
    this.piVersion,
    this.protocolVersion,
    required this.capabilitiesJson,
    this.lastSeenAt,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['host_id'] = Variable<String>(hostId);
    map['endpoint'] = Variable<String>(endpoint);
    map['display_name'] = Variable<String>(displayName);
    map['generation'] = Variable<String>(generation);
    map['connection_state'] = Variable<String>(connectionState);
    if (!nullToAbsent || bridgeVersion != null) {
      map['bridge_version'] = Variable<String>(bridgeVersion);
    }
    if (!nullToAbsent || piVersion != null) {
      map['pi_version'] = Variable<String>(piVersion);
    }
    if (!nullToAbsent || protocolVersion != null) {
      map['protocol_version'] = Variable<String>(protocolVersion);
    }
    map['capabilities_json'] = Variable<String>(capabilitiesJson);
    if (!nullToAbsent || lastSeenAt != null) {
      map['last_seen_at'] = Variable<DateTime>(lastSeenAt);
    }
    return map;
  }

  HostEntriesCompanion toCompanion(bool nullToAbsent) {
    return HostEntriesCompanion(
      hostId: Value(hostId),
      endpoint: Value(endpoint),
      displayName: Value(displayName),
      generation: Value(generation),
      connectionState: Value(connectionState),
      bridgeVersion: bridgeVersion == null && nullToAbsent
          ? const Value.absent()
          : Value(bridgeVersion),
      piVersion: piVersion == null && nullToAbsent
          ? const Value.absent()
          : Value(piVersion),
      protocolVersion: protocolVersion == null && nullToAbsent
          ? const Value.absent()
          : Value(protocolVersion),
      capabilitiesJson: Value(capabilitiesJson),
      lastSeenAt: lastSeenAt == null && nullToAbsent
          ? const Value.absent()
          : Value(lastSeenAt),
    );
  }

  factory HostEntry.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return HostEntry(
      hostId: serializer.fromJson<String>(json['hostId']),
      endpoint: serializer.fromJson<String>(json['endpoint']),
      displayName: serializer.fromJson<String>(json['displayName']),
      generation: serializer.fromJson<String>(json['generation']),
      connectionState: serializer.fromJson<String>(json['connectionState']),
      bridgeVersion: serializer.fromJson<String?>(json['bridgeVersion']),
      piVersion: serializer.fromJson<String?>(json['piVersion']),
      protocolVersion: serializer.fromJson<String?>(json['protocolVersion']),
      capabilitiesJson: serializer.fromJson<String>(json['capabilitiesJson']),
      lastSeenAt: serializer.fromJson<DateTime?>(json['lastSeenAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'hostId': serializer.toJson<String>(hostId),
      'endpoint': serializer.toJson<String>(endpoint),
      'displayName': serializer.toJson<String>(displayName),
      'generation': serializer.toJson<String>(generation),
      'connectionState': serializer.toJson<String>(connectionState),
      'bridgeVersion': serializer.toJson<String?>(bridgeVersion),
      'piVersion': serializer.toJson<String?>(piVersion),
      'protocolVersion': serializer.toJson<String?>(protocolVersion),
      'capabilitiesJson': serializer.toJson<String>(capabilitiesJson),
      'lastSeenAt': serializer.toJson<DateTime?>(lastSeenAt),
    };
  }

  HostEntry copyWith({
    String? hostId,
    String? endpoint,
    String? displayName,
    String? generation,
    String? connectionState,
    Value<String?> bridgeVersion = const Value.absent(),
    Value<String?> piVersion = const Value.absent(),
    Value<String?> protocolVersion = const Value.absent(),
    String? capabilitiesJson,
    Value<DateTime?> lastSeenAt = const Value.absent(),
  }) => HostEntry(
    hostId: hostId ?? this.hostId,
    endpoint: endpoint ?? this.endpoint,
    displayName: displayName ?? this.displayName,
    generation: generation ?? this.generation,
    connectionState: connectionState ?? this.connectionState,
    bridgeVersion: bridgeVersion.present
        ? bridgeVersion.value
        : this.bridgeVersion,
    piVersion: piVersion.present ? piVersion.value : this.piVersion,
    protocolVersion: protocolVersion.present
        ? protocolVersion.value
        : this.protocolVersion,
    capabilitiesJson: capabilitiesJson ?? this.capabilitiesJson,
    lastSeenAt: lastSeenAt.present ? lastSeenAt.value : this.lastSeenAt,
  );
  HostEntry copyWithCompanion(HostEntriesCompanion data) {
    return HostEntry(
      hostId: data.hostId.present ? data.hostId.value : this.hostId,
      endpoint: data.endpoint.present ? data.endpoint.value : this.endpoint,
      displayName: data.displayName.present
          ? data.displayName.value
          : this.displayName,
      generation: data.generation.present
          ? data.generation.value
          : this.generation,
      connectionState: data.connectionState.present
          ? data.connectionState.value
          : this.connectionState,
      bridgeVersion: data.bridgeVersion.present
          ? data.bridgeVersion.value
          : this.bridgeVersion,
      piVersion: data.piVersion.present ? data.piVersion.value : this.piVersion,
      protocolVersion: data.protocolVersion.present
          ? data.protocolVersion.value
          : this.protocolVersion,
      capabilitiesJson: data.capabilitiesJson.present
          ? data.capabilitiesJson.value
          : this.capabilitiesJson,
      lastSeenAt: data.lastSeenAt.present
          ? data.lastSeenAt.value
          : this.lastSeenAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('HostEntry(')
          ..write('hostId: $hostId, ')
          ..write('endpoint: $endpoint, ')
          ..write('displayName: $displayName, ')
          ..write('generation: $generation, ')
          ..write('connectionState: $connectionState, ')
          ..write('bridgeVersion: $bridgeVersion, ')
          ..write('piVersion: $piVersion, ')
          ..write('protocolVersion: $protocolVersion, ')
          ..write('capabilitiesJson: $capabilitiesJson, ')
          ..write('lastSeenAt: $lastSeenAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
    hostId,
    endpoint,
    displayName,
    generation,
    connectionState,
    bridgeVersion,
    piVersion,
    protocolVersion,
    capabilitiesJson,
    lastSeenAt,
  );
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is HostEntry &&
          other.hostId == this.hostId &&
          other.endpoint == this.endpoint &&
          other.displayName == this.displayName &&
          other.generation == this.generation &&
          other.connectionState == this.connectionState &&
          other.bridgeVersion == this.bridgeVersion &&
          other.piVersion == this.piVersion &&
          other.protocolVersion == this.protocolVersion &&
          other.capabilitiesJson == this.capabilitiesJson &&
          other.lastSeenAt == this.lastSeenAt);
}

class HostEntriesCompanion extends UpdateCompanion<HostEntry> {
  final Value<String> hostId;
  final Value<String> endpoint;
  final Value<String> displayName;
  final Value<String> generation;
  final Value<String> connectionState;
  final Value<String?> bridgeVersion;
  final Value<String?> piVersion;
  final Value<String?> protocolVersion;
  final Value<String> capabilitiesJson;
  final Value<DateTime?> lastSeenAt;
  final Value<int> rowid;
  const HostEntriesCompanion({
    this.hostId = const Value.absent(),
    this.endpoint = const Value.absent(),
    this.displayName = const Value.absent(),
    this.generation = const Value.absent(),
    this.connectionState = const Value.absent(),
    this.bridgeVersion = const Value.absent(),
    this.piVersion = const Value.absent(),
    this.protocolVersion = const Value.absent(),
    this.capabilitiesJson = const Value.absent(),
    this.lastSeenAt = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  HostEntriesCompanion.insert({
    required String hostId,
    required String endpoint,
    required String displayName,
    required String generation,
    required String connectionState,
    this.bridgeVersion = const Value.absent(),
    this.piVersion = const Value.absent(),
    this.protocolVersion = const Value.absent(),
    required String capabilitiesJson,
    this.lastSeenAt = const Value.absent(),
    this.rowid = const Value.absent(),
  }) : hostId = Value(hostId),
       endpoint = Value(endpoint),
       displayName = Value(displayName),
       generation = Value(generation),
       connectionState = Value(connectionState),
       capabilitiesJson = Value(capabilitiesJson);
  static Insertable<HostEntry> custom({
    Expression<String>? hostId,
    Expression<String>? endpoint,
    Expression<String>? displayName,
    Expression<String>? generation,
    Expression<String>? connectionState,
    Expression<String>? bridgeVersion,
    Expression<String>? piVersion,
    Expression<String>? protocolVersion,
    Expression<String>? capabilitiesJson,
    Expression<DateTime>? lastSeenAt,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (hostId != null) 'host_id': hostId,
      if (endpoint != null) 'endpoint': endpoint,
      if (displayName != null) 'display_name': displayName,
      if (generation != null) 'generation': generation,
      if (connectionState != null) 'connection_state': connectionState,
      if (bridgeVersion != null) 'bridge_version': bridgeVersion,
      if (piVersion != null) 'pi_version': piVersion,
      if (protocolVersion != null) 'protocol_version': protocolVersion,
      if (capabilitiesJson != null) 'capabilities_json': capabilitiesJson,
      if (lastSeenAt != null) 'last_seen_at': lastSeenAt,
      if (rowid != null) 'rowid': rowid,
    });
  }

  HostEntriesCompanion copyWith({
    Value<String>? hostId,
    Value<String>? endpoint,
    Value<String>? displayName,
    Value<String>? generation,
    Value<String>? connectionState,
    Value<String?>? bridgeVersion,
    Value<String?>? piVersion,
    Value<String?>? protocolVersion,
    Value<String>? capabilitiesJson,
    Value<DateTime?>? lastSeenAt,
    Value<int>? rowid,
  }) {
    return HostEntriesCompanion(
      hostId: hostId ?? this.hostId,
      endpoint: endpoint ?? this.endpoint,
      displayName: displayName ?? this.displayName,
      generation: generation ?? this.generation,
      connectionState: connectionState ?? this.connectionState,
      bridgeVersion: bridgeVersion ?? this.bridgeVersion,
      piVersion: piVersion ?? this.piVersion,
      protocolVersion: protocolVersion ?? this.protocolVersion,
      capabilitiesJson: capabilitiesJson ?? this.capabilitiesJson,
      lastSeenAt: lastSeenAt ?? this.lastSeenAt,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (hostId.present) {
      map['host_id'] = Variable<String>(hostId.value);
    }
    if (endpoint.present) {
      map['endpoint'] = Variable<String>(endpoint.value);
    }
    if (displayName.present) {
      map['display_name'] = Variable<String>(displayName.value);
    }
    if (generation.present) {
      map['generation'] = Variable<String>(generation.value);
    }
    if (connectionState.present) {
      map['connection_state'] = Variable<String>(connectionState.value);
    }
    if (bridgeVersion.present) {
      map['bridge_version'] = Variable<String>(bridgeVersion.value);
    }
    if (piVersion.present) {
      map['pi_version'] = Variable<String>(piVersion.value);
    }
    if (protocolVersion.present) {
      map['protocol_version'] = Variable<String>(protocolVersion.value);
    }
    if (capabilitiesJson.present) {
      map['capabilities_json'] = Variable<String>(capabilitiesJson.value);
    }
    if (lastSeenAt.present) {
      map['last_seen_at'] = Variable<DateTime>(lastSeenAt.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('HostEntriesCompanion(')
          ..write('hostId: $hostId, ')
          ..write('endpoint: $endpoint, ')
          ..write('displayName: $displayName, ')
          ..write('generation: $generation, ')
          ..write('connectionState: $connectionState, ')
          ..write('bridgeVersion: $bridgeVersion, ')
          ..write('piVersion: $piVersion, ')
          ..write('protocolVersion: $protocolVersion, ')
          ..write('capabilitiesJson: $capabilitiesJson, ')
          ..write('lastSeenAt: $lastSeenAt, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $StreamCursorsTable extends StreamCursors
    with TableInfo<$StreamCursorsTable, StreamCursor> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $StreamCursorsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _streamIdMeta = const VerificationMeta(
    'streamId',
  );
  @override
  late final GeneratedColumn<String> streamId = GeneratedColumn<String>(
    'stream_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _hostIdMeta = const VerificationMeta('hostId');
  @override
  late final GeneratedColumn<String> hostId = GeneratedColumn<String>(
    'host_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _lastContiguousCursorMeta =
      const VerificationMeta('lastContiguousCursor');
  @override
  late final GeneratedColumn<String> lastContiguousCursor =
      GeneratedColumn<String>(
        'last_contiguous_cursor',
        aliasedName,
        false,
        type: DriftSqlType.string,
        requiredDuringInsert: true,
      );
  static const VerificationMeta _updatedAtMeta = const VerificationMeta(
    'updatedAt',
  );
  @override
  late final GeneratedColumn<DateTime> updatedAt = GeneratedColumn<DateTime>(
    'updated_at',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: true,
  );
  @override
  List<GeneratedColumn> get $columns => [
    streamId,
    hostId,
    lastContiguousCursor,
    updatedAt,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'stream_cursors';
  @override
  VerificationContext validateIntegrity(
    Insertable<StreamCursor> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('stream_id')) {
      context.handle(
        _streamIdMeta,
        streamId.isAcceptableOrUnknown(data['stream_id']!, _streamIdMeta),
      );
    } else if (isInserting) {
      context.missing(_streamIdMeta);
    }
    if (data.containsKey('host_id')) {
      context.handle(
        _hostIdMeta,
        hostId.isAcceptableOrUnknown(data['host_id']!, _hostIdMeta),
      );
    } else if (isInserting) {
      context.missing(_hostIdMeta);
    }
    if (data.containsKey('last_contiguous_cursor')) {
      context.handle(
        _lastContiguousCursorMeta,
        lastContiguousCursor.isAcceptableOrUnknown(
          data['last_contiguous_cursor']!,
          _lastContiguousCursorMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_lastContiguousCursorMeta);
    }
    if (data.containsKey('updated_at')) {
      context.handle(
        _updatedAtMeta,
        updatedAt.isAcceptableOrUnknown(data['updated_at']!, _updatedAtMeta),
      );
    } else if (isInserting) {
      context.missing(_updatedAtMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {streamId};
  @override
  StreamCursor map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return StreamCursor(
      streamId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}stream_id'],
      )!,
      hostId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}host_id'],
      )!,
      lastContiguousCursor: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}last_contiguous_cursor'],
      )!,
      updatedAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}updated_at'],
      )!,
    );
  }

  @override
  $StreamCursorsTable createAlias(String alias) {
    return $StreamCursorsTable(attachedDatabase, alias);
  }
}

class StreamCursor extends DataClass implements Insertable<StreamCursor> {
  final String streamId;
  final String hostId;
  final String lastContiguousCursor;
  final DateTime updatedAt;
  const StreamCursor({
    required this.streamId,
    required this.hostId,
    required this.lastContiguousCursor,
    required this.updatedAt,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['stream_id'] = Variable<String>(streamId);
    map['host_id'] = Variable<String>(hostId);
    map['last_contiguous_cursor'] = Variable<String>(lastContiguousCursor);
    map['updated_at'] = Variable<DateTime>(updatedAt);
    return map;
  }

  StreamCursorsCompanion toCompanion(bool nullToAbsent) {
    return StreamCursorsCompanion(
      streamId: Value(streamId),
      hostId: Value(hostId),
      lastContiguousCursor: Value(lastContiguousCursor),
      updatedAt: Value(updatedAt),
    );
  }

  factory StreamCursor.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return StreamCursor(
      streamId: serializer.fromJson<String>(json['streamId']),
      hostId: serializer.fromJson<String>(json['hostId']),
      lastContiguousCursor: serializer.fromJson<String>(
        json['lastContiguousCursor'],
      ),
      updatedAt: serializer.fromJson<DateTime>(json['updatedAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'streamId': serializer.toJson<String>(streamId),
      'hostId': serializer.toJson<String>(hostId),
      'lastContiguousCursor': serializer.toJson<String>(lastContiguousCursor),
      'updatedAt': serializer.toJson<DateTime>(updatedAt),
    };
  }

  StreamCursor copyWith({
    String? streamId,
    String? hostId,
    String? lastContiguousCursor,
    DateTime? updatedAt,
  }) => StreamCursor(
    streamId: streamId ?? this.streamId,
    hostId: hostId ?? this.hostId,
    lastContiguousCursor: lastContiguousCursor ?? this.lastContiguousCursor,
    updatedAt: updatedAt ?? this.updatedAt,
  );
  StreamCursor copyWithCompanion(StreamCursorsCompanion data) {
    return StreamCursor(
      streamId: data.streamId.present ? data.streamId.value : this.streamId,
      hostId: data.hostId.present ? data.hostId.value : this.hostId,
      lastContiguousCursor: data.lastContiguousCursor.present
          ? data.lastContiguousCursor.value
          : this.lastContiguousCursor,
      updatedAt: data.updatedAt.present ? data.updatedAt.value : this.updatedAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('StreamCursor(')
          ..write('streamId: $streamId, ')
          ..write('hostId: $hostId, ')
          ..write('lastContiguousCursor: $lastContiguousCursor, ')
          ..write('updatedAt: $updatedAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode =>
      Object.hash(streamId, hostId, lastContiguousCursor, updatedAt);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is StreamCursor &&
          other.streamId == this.streamId &&
          other.hostId == this.hostId &&
          other.lastContiguousCursor == this.lastContiguousCursor &&
          other.updatedAt == this.updatedAt);
}

class StreamCursorsCompanion extends UpdateCompanion<StreamCursor> {
  final Value<String> streamId;
  final Value<String> hostId;
  final Value<String> lastContiguousCursor;
  final Value<DateTime> updatedAt;
  final Value<int> rowid;
  const StreamCursorsCompanion({
    this.streamId = const Value.absent(),
    this.hostId = const Value.absent(),
    this.lastContiguousCursor = const Value.absent(),
    this.updatedAt = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  StreamCursorsCompanion.insert({
    required String streamId,
    required String hostId,
    required String lastContiguousCursor,
    required DateTime updatedAt,
    this.rowid = const Value.absent(),
  }) : streamId = Value(streamId),
       hostId = Value(hostId),
       lastContiguousCursor = Value(lastContiguousCursor),
       updatedAt = Value(updatedAt);
  static Insertable<StreamCursor> custom({
    Expression<String>? streamId,
    Expression<String>? hostId,
    Expression<String>? lastContiguousCursor,
    Expression<DateTime>? updatedAt,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (streamId != null) 'stream_id': streamId,
      if (hostId != null) 'host_id': hostId,
      if (lastContiguousCursor != null)
        'last_contiguous_cursor': lastContiguousCursor,
      if (updatedAt != null) 'updated_at': updatedAt,
      if (rowid != null) 'rowid': rowid,
    });
  }

  StreamCursorsCompanion copyWith({
    Value<String>? streamId,
    Value<String>? hostId,
    Value<String>? lastContiguousCursor,
    Value<DateTime>? updatedAt,
    Value<int>? rowid,
  }) {
    return StreamCursorsCompanion(
      streamId: streamId ?? this.streamId,
      hostId: hostId ?? this.hostId,
      lastContiguousCursor: lastContiguousCursor ?? this.lastContiguousCursor,
      updatedAt: updatedAt ?? this.updatedAt,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (streamId.present) {
      map['stream_id'] = Variable<String>(streamId.value);
    }
    if (hostId.present) {
      map['host_id'] = Variable<String>(hostId.value);
    }
    if (lastContiguousCursor.present) {
      map['last_contiguous_cursor'] = Variable<String>(
        lastContiguousCursor.value,
      );
    }
    if (updatedAt.present) {
      map['updated_at'] = Variable<DateTime>(updatedAt.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('StreamCursorsCompanion(')
          ..write('streamId: $streamId, ')
          ..write('hostId: $hostId, ')
          ..write('lastContiguousCursor: $lastContiguousCursor, ')
          ..write('updatedAt: $updatedAt, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $SessionEntriesTable extends SessionEntries
    with TableInfo<$SessionEntriesTable, SessionEntry> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $SessionEntriesTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _sessionIdMeta = const VerificationMeta(
    'sessionId',
  );
  @override
  late final GeneratedColumn<String> sessionId = GeneratedColumn<String>(
    'session_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _hostIdMeta = const VerificationMeta('hostId');
  @override
  late final GeneratedColumn<String> hostId = GeneratedColumn<String>(
    'host_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _workspaceIdMeta = const VerificationMeta(
    'workspaceId',
  );
  @override
  late final GeneratedColumn<String> workspaceId = GeneratedColumn<String>(
    'workspace_id',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _nameMeta = const VerificationMeta('name');
  @override
  late final GeneratedColumn<String> name = GeneratedColumn<String>(
    'name',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _runtimeStateMeta = const VerificationMeta(
    'runtimeState',
  );
  @override
  late final GeneratedColumn<String> runtimeState = GeneratedColumn<String>(
    'runtime_state',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _policyModeMeta = const VerificationMeta(
    'policyMode',
  );
  @override
  late final GeneratedColumn<String> policyMode = GeneratedColumn<String>(
    'policy_mode',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _modelSummaryMeta = const VerificationMeta(
    'modelSummary',
  );
  @override
  late final GeneratedColumn<String> modelSummary = GeneratedColumn<String>(
    'model_summary',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _thinkingLevelMeta = const VerificationMeta(
    'thinkingLevel',
  );
  @override
  late final GeneratedColumn<String> thinkingLevel = GeneratedColumn<String>(
    'thinking_level',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _queueCountMeta = const VerificationMeta(
    'queueCount',
  );
  @override
  late final GeneratedColumn<int> queueCount = GeneratedColumn<int>(
    'queue_count',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
    defaultValue: const Constant(0),
  );
  static const VerificationMeta _lastActivityAtMeta = const VerificationMeta(
    'lastActivityAt',
  );
  @override
  late final GeneratedColumn<DateTime> lastActivityAt =
      GeneratedColumn<DateTime>(
        'last_activity_at',
        aliasedName,
        true,
        type: DriftSqlType.dateTime,
        requiredDuringInsert: false,
      );
  static const VerificationMeta _unreadStateMeta = const VerificationMeta(
    'unreadState',
  );
  @override
  late final GeneratedColumn<String> unreadState = GeneratedColumn<String>(
    'unread_state',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _controllerStateMeta = const VerificationMeta(
    'controllerState',
  );
  @override
  late final GeneratedColumn<String> controllerState = GeneratedColumn<String>(
    'controller_state',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  @override
  List<GeneratedColumn> get $columns => [
    sessionId,
    hostId,
    workspaceId,
    name,
    runtimeState,
    policyMode,
    modelSummary,
    thinkingLevel,
    queueCount,
    lastActivityAt,
    unreadState,
    controllerState,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'session_entries';
  @override
  VerificationContext validateIntegrity(
    Insertable<SessionEntry> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('session_id')) {
      context.handle(
        _sessionIdMeta,
        sessionId.isAcceptableOrUnknown(data['session_id']!, _sessionIdMeta),
      );
    } else if (isInserting) {
      context.missing(_sessionIdMeta);
    }
    if (data.containsKey('host_id')) {
      context.handle(
        _hostIdMeta,
        hostId.isAcceptableOrUnknown(data['host_id']!, _hostIdMeta),
      );
    } else if (isInserting) {
      context.missing(_hostIdMeta);
    }
    if (data.containsKey('workspace_id')) {
      context.handle(
        _workspaceIdMeta,
        workspaceId.isAcceptableOrUnknown(
          data['workspace_id']!,
          _workspaceIdMeta,
        ),
      );
    }
    if (data.containsKey('name')) {
      context.handle(
        _nameMeta,
        name.isAcceptableOrUnknown(data['name']!, _nameMeta),
      );
    } else if (isInserting) {
      context.missing(_nameMeta);
    }
    if (data.containsKey('runtime_state')) {
      context.handle(
        _runtimeStateMeta,
        runtimeState.isAcceptableOrUnknown(
          data['runtime_state']!,
          _runtimeStateMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_runtimeStateMeta);
    }
    if (data.containsKey('policy_mode')) {
      context.handle(
        _policyModeMeta,
        policyMode.isAcceptableOrUnknown(data['policy_mode']!, _policyModeMeta),
      );
    }
    if (data.containsKey('model_summary')) {
      context.handle(
        _modelSummaryMeta,
        modelSummary.isAcceptableOrUnknown(
          data['model_summary']!,
          _modelSummaryMeta,
        ),
      );
    }
    if (data.containsKey('thinking_level')) {
      context.handle(
        _thinkingLevelMeta,
        thinkingLevel.isAcceptableOrUnknown(
          data['thinking_level']!,
          _thinkingLevelMeta,
        ),
      );
    }
    if (data.containsKey('queue_count')) {
      context.handle(
        _queueCountMeta,
        queueCount.isAcceptableOrUnknown(data['queue_count']!, _queueCountMeta),
      );
    }
    if (data.containsKey('last_activity_at')) {
      context.handle(
        _lastActivityAtMeta,
        lastActivityAt.isAcceptableOrUnknown(
          data['last_activity_at']!,
          _lastActivityAtMeta,
        ),
      );
    }
    if (data.containsKey('unread_state')) {
      context.handle(
        _unreadStateMeta,
        unreadState.isAcceptableOrUnknown(
          data['unread_state']!,
          _unreadStateMeta,
        ),
      );
    }
    if (data.containsKey('controller_state')) {
      context.handle(
        _controllerStateMeta,
        controllerState.isAcceptableOrUnknown(
          data['controller_state']!,
          _controllerStateMeta,
        ),
      );
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {sessionId};
  @override
  SessionEntry map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return SessionEntry(
      sessionId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}session_id'],
      )!,
      hostId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}host_id'],
      )!,
      workspaceId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}workspace_id'],
      ),
      name: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}name'],
      )!,
      runtimeState: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}runtime_state'],
      )!,
      policyMode: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}policy_mode'],
      ),
      modelSummary: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}model_summary'],
      ),
      thinkingLevel: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}thinking_level'],
      ),
      queueCount: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}queue_count'],
      )!,
      lastActivityAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}last_activity_at'],
      ),
      unreadState: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}unread_state'],
      ),
      controllerState: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}controller_state'],
      ),
    );
  }

  @override
  $SessionEntriesTable createAlias(String alias) {
    return $SessionEntriesTable(attachedDatabase, alias);
  }
}

class SessionEntry extends DataClass implements Insertable<SessionEntry> {
  final String sessionId;
  final String hostId;
  final String? workspaceId;
  final String name;
  final String runtimeState;
  final String? policyMode;
  final String? modelSummary;
  final String? thinkingLevel;
  final int queueCount;
  final DateTime? lastActivityAt;
  final String? unreadState;
  final String? controllerState;
  const SessionEntry({
    required this.sessionId,
    required this.hostId,
    this.workspaceId,
    required this.name,
    required this.runtimeState,
    this.policyMode,
    this.modelSummary,
    this.thinkingLevel,
    required this.queueCount,
    this.lastActivityAt,
    this.unreadState,
    this.controllerState,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['session_id'] = Variable<String>(sessionId);
    map['host_id'] = Variable<String>(hostId);
    if (!nullToAbsent || workspaceId != null) {
      map['workspace_id'] = Variable<String>(workspaceId);
    }
    map['name'] = Variable<String>(name);
    map['runtime_state'] = Variable<String>(runtimeState);
    if (!nullToAbsent || policyMode != null) {
      map['policy_mode'] = Variable<String>(policyMode);
    }
    if (!nullToAbsent || modelSummary != null) {
      map['model_summary'] = Variable<String>(modelSummary);
    }
    if (!nullToAbsent || thinkingLevel != null) {
      map['thinking_level'] = Variable<String>(thinkingLevel);
    }
    map['queue_count'] = Variable<int>(queueCount);
    if (!nullToAbsent || lastActivityAt != null) {
      map['last_activity_at'] = Variable<DateTime>(lastActivityAt);
    }
    if (!nullToAbsent || unreadState != null) {
      map['unread_state'] = Variable<String>(unreadState);
    }
    if (!nullToAbsent || controllerState != null) {
      map['controller_state'] = Variable<String>(controllerState);
    }
    return map;
  }

  SessionEntriesCompanion toCompanion(bool nullToAbsent) {
    return SessionEntriesCompanion(
      sessionId: Value(sessionId),
      hostId: Value(hostId),
      workspaceId: workspaceId == null && nullToAbsent
          ? const Value.absent()
          : Value(workspaceId),
      name: Value(name),
      runtimeState: Value(runtimeState),
      policyMode: policyMode == null && nullToAbsent
          ? const Value.absent()
          : Value(policyMode),
      modelSummary: modelSummary == null && nullToAbsent
          ? const Value.absent()
          : Value(modelSummary),
      thinkingLevel: thinkingLevel == null && nullToAbsent
          ? const Value.absent()
          : Value(thinkingLevel),
      queueCount: Value(queueCount),
      lastActivityAt: lastActivityAt == null && nullToAbsent
          ? const Value.absent()
          : Value(lastActivityAt),
      unreadState: unreadState == null && nullToAbsent
          ? const Value.absent()
          : Value(unreadState),
      controllerState: controllerState == null && nullToAbsent
          ? const Value.absent()
          : Value(controllerState),
    );
  }

  factory SessionEntry.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return SessionEntry(
      sessionId: serializer.fromJson<String>(json['sessionId']),
      hostId: serializer.fromJson<String>(json['hostId']),
      workspaceId: serializer.fromJson<String?>(json['workspaceId']),
      name: serializer.fromJson<String>(json['name']),
      runtimeState: serializer.fromJson<String>(json['runtimeState']),
      policyMode: serializer.fromJson<String?>(json['policyMode']),
      modelSummary: serializer.fromJson<String?>(json['modelSummary']),
      thinkingLevel: serializer.fromJson<String?>(json['thinkingLevel']),
      queueCount: serializer.fromJson<int>(json['queueCount']),
      lastActivityAt: serializer.fromJson<DateTime?>(json['lastActivityAt']),
      unreadState: serializer.fromJson<String?>(json['unreadState']),
      controllerState: serializer.fromJson<String?>(json['controllerState']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'sessionId': serializer.toJson<String>(sessionId),
      'hostId': serializer.toJson<String>(hostId),
      'workspaceId': serializer.toJson<String?>(workspaceId),
      'name': serializer.toJson<String>(name),
      'runtimeState': serializer.toJson<String>(runtimeState),
      'policyMode': serializer.toJson<String?>(policyMode),
      'modelSummary': serializer.toJson<String?>(modelSummary),
      'thinkingLevel': serializer.toJson<String?>(thinkingLevel),
      'queueCount': serializer.toJson<int>(queueCount),
      'lastActivityAt': serializer.toJson<DateTime?>(lastActivityAt),
      'unreadState': serializer.toJson<String?>(unreadState),
      'controllerState': serializer.toJson<String?>(controllerState),
    };
  }

  SessionEntry copyWith({
    String? sessionId,
    String? hostId,
    Value<String?> workspaceId = const Value.absent(),
    String? name,
    String? runtimeState,
    Value<String?> policyMode = const Value.absent(),
    Value<String?> modelSummary = const Value.absent(),
    Value<String?> thinkingLevel = const Value.absent(),
    int? queueCount,
    Value<DateTime?> lastActivityAt = const Value.absent(),
    Value<String?> unreadState = const Value.absent(),
    Value<String?> controllerState = const Value.absent(),
  }) => SessionEntry(
    sessionId: sessionId ?? this.sessionId,
    hostId: hostId ?? this.hostId,
    workspaceId: workspaceId.present ? workspaceId.value : this.workspaceId,
    name: name ?? this.name,
    runtimeState: runtimeState ?? this.runtimeState,
    policyMode: policyMode.present ? policyMode.value : this.policyMode,
    modelSummary: modelSummary.present ? modelSummary.value : this.modelSummary,
    thinkingLevel: thinkingLevel.present
        ? thinkingLevel.value
        : this.thinkingLevel,
    queueCount: queueCount ?? this.queueCount,
    lastActivityAt: lastActivityAt.present
        ? lastActivityAt.value
        : this.lastActivityAt,
    unreadState: unreadState.present ? unreadState.value : this.unreadState,
    controllerState: controllerState.present
        ? controllerState.value
        : this.controllerState,
  );
  SessionEntry copyWithCompanion(SessionEntriesCompanion data) {
    return SessionEntry(
      sessionId: data.sessionId.present ? data.sessionId.value : this.sessionId,
      hostId: data.hostId.present ? data.hostId.value : this.hostId,
      workspaceId: data.workspaceId.present
          ? data.workspaceId.value
          : this.workspaceId,
      name: data.name.present ? data.name.value : this.name,
      runtimeState: data.runtimeState.present
          ? data.runtimeState.value
          : this.runtimeState,
      policyMode: data.policyMode.present
          ? data.policyMode.value
          : this.policyMode,
      modelSummary: data.modelSummary.present
          ? data.modelSummary.value
          : this.modelSummary,
      thinkingLevel: data.thinkingLevel.present
          ? data.thinkingLevel.value
          : this.thinkingLevel,
      queueCount: data.queueCount.present
          ? data.queueCount.value
          : this.queueCount,
      lastActivityAt: data.lastActivityAt.present
          ? data.lastActivityAt.value
          : this.lastActivityAt,
      unreadState: data.unreadState.present
          ? data.unreadState.value
          : this.unreadState,
      controllerState: data.controllerState.present
          ? data.controllerState.value
          : this.controllerState,
    );
  }

  @override
  String toString() {
    return (StringBuffer('SessionEntry(')
          ..write('sessionId: $sessionId, ')
          ..write('hostId: $hostId, ')
          ..write('workspaceId: $workspaceId, ')
          ..write('name: $name, ')
          ..write('runtimeState: $runtimeState, ')
          ..write('policyMode: $policyMode, ')
          ..write('modelSummary: $modelSummary, ')
          ..write('thinkingLevel: $thinkingLevel, ')
          ..write('queueCount: $queueCount, ')
          ..write('lastActivityAt: $lastActivityAt, ')
          ..write('unreadState: $unreadState, ')
          ..write('controllerState: $controllerState')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
    sessionId,
    hostId,
    workspaceId,
    name,
    runtimeState,
    policyMode,
    modelSummary,
    thinkingLevel,
    queueCount,
    lastActivityAt,
    unreadState,
    controllerState,
  );
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is SessionEntry &&
          other.sessionId == this.sessionId &&
          other.hostId == this.hostId &&
          other.workspaceId == this.workspaceId &&
          other.name == this.name &&
          other.runtimeState == this.runtimeState &&
          other.policyMode == this.policyMode &&
          other.modelSummary == this.modelSummary &&
          other.thinkingLevel == this.thinkingLevel &&
          other.queueCount == this.queueCount &&
          other.lastActivityAt == this.lastActivityAt &&
          other.unreadState == this.unreadState &&
          other.controllerState == this.controllerState);
}

class SessionEntriesCompanion extends UpdateCompanion<SessionEntry> {
  final Value<String> sessionId;
  final Value<String> hostId;
  final Value<String?> workspaceId;
  final Value<String> name;
  final Value<String> runtimeState;
  final Value<String?> policyMode;
  final Value<String?> modelSummary;
  final Value<String?> thinkingLevel;
  final Value<int> queueCount;
  final Value<DateTime?> lastActivityAt;
  final Value<String?> unreadState;
  final Value<String?> controllerState;
  final Value<int> rowid;
  const SessionEntriesCompanion({
    this.sessionId = const Value.absent(),
    this.hostId = const Value.absent(),
    this.workspaceId = const Value.absent(),
    this.name = const Value.absent(),
    this.runtimeState = const Value.absent(),
    this.policyMode = const Value.absent(),
    this.modelSummary = const Value.absent(),
    this.thinkingLevel = const Value.absent(),
    this.queueCount = const Value.absent(),
    this.lastActivityAt = const Value.absent(),
    this.unreadState = const Value.absent(),
    this.controllerState = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  SessionEntriesCompanion.insert({
    required String sessionId,
    required String hostId,
    this.workspaceId = const Value.absent(),
    required String name,
    required String runtimeState,
    this.policyMode = const Value.absent(),
    this.modelSummary = const Value.absent(),
    this.thinkingLevel = const Value.absent(),
    this.queueCount = const Value.absent(),
    this.lastActivityAt = const Value.absent(),
    this.unreadState = const Value.absent(),
    this.controllerState = const Value.absent(),
    this.rowid = const Value.absent(),
  }) : sessionId = Value(sessionId),
       hostId = Value(hostId),
       name = Value(name),
       runtimeState = Value(runtimeState);
  static Insertable<SessionEntry> custom({
    Expression<String>? sessionId,
    Expression<String>? hostId,
    Expression<String>? workspaceId,
    Expression<String>? name,
    Expression<String>? runtimeState,
    Expression<String>? policyMode,
    Expression<String>? modelSummary,
    Expression<String>? thinkingLevel,
    Expression<int>? queueCount,
    Expression<DateTime>? lastActivityAt,
    Expression<String>? unreadState,
    Expression<String>? controllerState,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (sessionId != null) 'session_id': sessionId,
      if (hostId != null) 'host_id': hostId,
      if (workspaceId != null) 'workspace_id': workspaceId,
      if (name != null) 'name': name,
      if (runtimeState != null) 'runtime_state': runtimeState,
      if (policyMode != null) 'policy_mode': policyMode,
      if (modelSummary != null) 'model_summary': modelSummary,
      if (thinkingLevel != null) 'thinking_level': thinkingLevel,
      if (queueCount != null) 'queue_count': queueCount,
      if (lastActivityAt != null) 'last_activity_at': lastActivityAt,
      if (unreadState != null) 'unread_state': unreadState,
      if (controllerState != null) 'controller_state': controllerState,
      if (rowid != null) 'rowid': rowid,
    });
  }

  SessionEntriesCompanion copyWith({
    Value<String>? sessionId,
    Value<String>? hostId,
    Value<String?>? workspaceId,
    Value<String>? name,
    Value<String>? runtimeState,
    Value<String?>? policyMode,
    Value<String?>? modelSummary,
    Value<String?>? thinkingLevel,
    Value<int>? queueCount,
    Value<DateTime?>? lastActivityAt,
    Value<String?>? unreadState,
    Value<String?>? controllerState,
    Value<int>? rowid,
  }) {
    return SessionEntriesCompanion(
      sessionId: sessionId ?? this.sessionId,
      hostId: hostId ?? this.hostId,
      workspaceId: workspaceId ?? this.workspaceId,
      name: name ?? this.name,
      runtimeState: runtimeState ?? this.runtimeState,
      policyMode: policyMode ?? this.policyMode,
      modelSummary: modelSummary ?? this.modelSummary,
      thinkingLevel: thinkingLevel ?? this.thinkingLevel,
      queueCount: queueCount ?? this.queueCount,
      lastActivityAt: lastActivityAt ?? this.lastActivityAt,
      unreadState: unreadState ?? this.unreadState,
      controllerState: controllerState ?? this.controllerState,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (sessionId.present) {
      map['session_id'] = Variable<String>(sessionId.value);
    }
    if (hostId.present) {
      map['host_id'] = Variable<String>(hostId.value);
    }
    if (workspaceId.present) {
      map['workspace_id'] = Variable<String>(workspaceId.value);
    }
    if (name.present) {
      map['name'] = Variable<String>(name.value);
    }
    if (runtimeState.present) {
      map['runtime_state'] = Variable<String>(runtimeState.value);
    }
    if (policyMode.present) {
      map['policy_mode'] = Variable<String>(policyMode.value);
    }
    if (modelSummary.present) {
      map['model_summary'] = Variable<String>(modelSummary.value);
    }
    if (thinkingLevel.present) {
      map['thinking_level'] = Variable<String>(thinkingLevel.value);
    }
    if (queueCount.present) {
      map['queue_count'] = Variable<int>(queueCount.value);
    }
    if (lastActivityAt.present) {
      map['last_activity_at'] = Variable<DateTime>(lastActivityAt.value);
    }
    if (unreadState.present) {
      map['unread_state'] = Variable<String>(unreadState.value);
    }
    if (controllerState.present) {
      map['controller_state'] = Variable<String>(controllerState.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('SessionEntriesCompanion(')
          ..write('sessionId: $sessionId, ')
          ..write('hostId: $hostId, ')
          ..write('workspaceId: $workspaceId, ')
          ..write('name: $name, ')
          ..write('runtimeState: $runtimeState, ')
          ..write('policyMode: $policyMode, ')
          ..write('modelSummary: $modelSummary, ')
          ..write('thinkingLevel: $thinkingLevel, ')
          ..write('queueCount: $queueCount, ')
          ..write('lastActivityAt: $lastActivityAt, ')
          ..write('unreadState: $unreadState, ')
          ..write('controllerState: $controllerState, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $CachedEventsTable extends CachedEvents
    with TableInfo<$CachedEventsTable, CachedEvent> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $CachedEventsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _eventIdMeta = const VerificationMeta(
    'eventId',
  );
  @override
  late final GeneratedColumn<String> eventId = GeneratedColumn<String>(
    'event_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _hostIdMeta = const VerificationMeta('hostId');
  @override
  late final GeneratedColumn<String> hostId = GeneratedColumn<String>(
    'host_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _streamIdMeta = const VerificationMeta(
    'streamId',
  );
  @override
  late final GeneratedColumn<String> streamId = GeneratedColumn<String>(
    'stream_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _cursorMeta = const VerificationMeta('cursor');
  @override
  late final GeneratedColumn<String> cursor = GeneratedColumn<String>(
    'cursor',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _typeMeta = const VerificationMeta('type');
  @override
  late final GeneratedColumn<String> type = GeneratedColumn<String>(
    'type',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _payloadJsonMeta = const VerificationMeta(
    'payloadJson',
  );
  @override
  late final GeneratedColumn<String> payloadJson = GeneratedColumn<String>(
    'payload_json',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _occurredAtMeta = const VerificationMeta(
    'occurredAt',
  );
  @override
  late final GeneratedColumn<DateTime> occurredAt = GeneratedColumn<DateTime>(
    'occurred_at',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _storedAtMeta = const VerificationMeta(
    'storedAt',
  );
  @override
  late final GeneratedColumn<DateTime> storedAt = GeneratedColumn<DateTime>(
    'stored_at',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: true,
  );
  @override
  List<GeneratedColumn> get $columns => [
    eventId,
    hostId,
    streamId,
    cursor,
    type,
    payloadJson,
    occurredAt,
    storedAt,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'cached_events';
  @override
  VerificationContext validateIntegrity(
    Insertable<CachedEvent> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('event_id')) {
      context.handle(
        _eventIdMeta,
        eventId.isAcceptableOrUnknown(data['event_id']!, _eventIdMeta),
      );
    } else if (isInserting) {
      context.missing(_eventIdMeta);
    }
    if (data.containsKey('host_id')) {
      context.handle(
        _hostIdMeta,
        hostId.isAcceptableOrUnknown(data['host_id']!, _hostIdMeta),
      );
    } else if (isInserting) {
      context.missing(_hostIdMeta);
    }
    if (data.containsKey('stream_id')) {
      context.handle(
        _streamIdMeta,
        streamId.isAcceptableOrUnknown(data['stream_id']!, _streamIdMeta),
      );
    } else if (isInserting) {
      context.missing(_streamIdMeta);
    }
    if (data.containsKey('cursor')) {
      context.handle(
        _cursorMeta,
        cursor.isAcceptableOrUnknown(data['cursor']!, _cursorMeta),
      );
    } else if (isInserting) {
      context.missing(_cursorMeta);
    }
    if (data.containsKey('type')) {
      context.handle(
        _typeMeta,
        type.isAcceptableOrUnknown(data['type']!, _typeMeta),
      );
    } else if (isInserting) {
      context.missing(_typeMeta);
    }
    if (data.containsKey('payload_json')) {
      context.handle(
        _payloadJsonMeta,
        payloadJson.isAcceptableOrUnknown(
          data['payload_json']!,
          _payloadJsonMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_payloadJsonMeta);
    }
    if (data.containsKey('occurred_at')) {
      context.handle(
        _occurredAtMeta,
        occurredAt.isAcceptableOrUnknown(data['occurred_at']!, _occurredAtMeta),
      );
    } else if (isInserting) {
      context.missing(_occurredAtMeta);
    }
    if (data.containsKey('stored_at')) {
      context.handle(
        _storedAtMeta,
        storedAt.isAcceptableOrUnknown(data['stored_at']!, _storedAtMeta),
      );
    } else if (isInserting) {
      context.missing(_storedAtMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {eventId};
  @override
  List<Set<GeneratedColumn>> get uniqueKeys => [
    {streamId, cursor},
  ];
  @override
  CachedEvent map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return CachedEvent(
      eventId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}event_id'],
      )!,
      hostId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}host_id'],
      )!,
      streamId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}stream_id'],
      )!,
      cursor: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}cursor'],
      )!,
      type: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}type'],
      )!,
      payloadJson: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}payload_json'],
      )!,
      occurredAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}occurred_at'],
      )!,
      storedAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}stored_at'],
      )!,
    );
  }

  @override
  $CachedEventsTable createAlias(String alias) {
    return $CachedEventsTable(attachedDatabase, alias);
  }
}

class CachedEvent extends DataClass implements Insertable<CachedEvent> {
  final String eventId;
  final String hostId;
  final String streamId;
  final String cursor;
  final String type;
  final String payloadJson;
  final DateTime occurredAt;
  final DateTime storedAt;
  const CachedEvent({
    required this.eventId,
    required this.hostId,
    required this.streamId,
    required this.cursor,
    required this.type,
    required this.payloadJson,
    required this.occurredAt,
    required this.storedAt,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['event_id'] = Variable<String>(eventId);
    map['host_id'] = Variable<String>(hostId);
    map['stream_id'] = Variable<String>(streamId);
    map['cursor'] = Variable<String>(cursor);
    map['type'] = Variable<String>(type);
    map['payload_json'] = Variable<String>(payloadJson);
    map['occurred_at'] = Variable<DateTime>(occurredAt);
    map['stored_at'] = Variable<DateTime>(storedAt);
    return map;
  }

  CachedEventsCompanion toCompanion(bool nullToAbsent) {
    return CachedEventsCompanion(
      eventId: Value(eventId),
      hostId: Value(hostId),
      streamId: Value(streamId),
      cursor: Value(cursor),
      type: Value(type),
      payloadJson: Value(payloadJson),
      occurredAt: Value(occurredAt),
      storedAt: Value(storedAt),
    );
  }

  factory CachedEvent.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return CachedEvent(
      eventId: serializer.fromJson<String>(json['eventId']),
      hostId: serializer.fromJson<String>(json['hostId']),
      streamId: serializer.fromJson<String>(json['streamId']),
      cursor: serializer.fromJson<String>(json['cursor']),
      type: serializer.fromJson<String>(json['type']),
      payloadJson: serializer.fromJson<String>(json['payloadJson']),
      occurredAt: serializer.fromJson<DateTime>(json['occurredAt']),
      storedAt: serializer.fromJson<DateTime>(json['storedAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'eventId': serializer.toJson<String>(eventId),
      'hostId': serializer.toJson<String>(hostId),
      'streamId': serializer.toJson<String>(streamId),
      'cursor': serializer.toJson<String>(cursor),
      'type': serializer.toJson<String>(type),
      'payloadJson': serializer.toJson<String>(payloadJson),
      'occurredAt': serializer.toJson<DateTime>(occurredAt),
      'storedAt': serializer.toJson<DateTime>(storedAt),
    };
  }

  CachedEvent copyWith({
    String? eventId,
    String? hostId,
    String? streamId,
    String? cursor,
    String? type,
    String? payloadJson,
    DateTime? occurredAt,
    DateTime? storedAt,
  }) => CachedEvent(
    eventId: eventId ?? this.eventId,
    hostId: hostId ?? this.hostId,
    streamId: streamId ?? this.streamId,
    cursor: cursor ?? this.cursor,
    type: type ?? this.type,
    payloadJson: payloadJson ?? this.payloadJson,
    occurredAt: occurredAt ?? this.occurredAt,
    storedAt: storedAt ?? this.storedAt,
  );
  CachedEvent copyWithCompanion(CachedEventsCompanion data) {
    return CachedEvent(
      eventId: data.eventId.present ? data.eventId.value : this.eventId,
      hostId: data.hostId.present ? data.hostId.value : this.hostId,
      streamId: data.streamId.present ? data.streamId.value : this.streamId,
      cursor: data.cursor.present ? data.cursor.value : this.cursor,
      type: data.type.present ? data.type.value : this.type,
      payloadJson: data.payloadJson.present
          ? data.payloadJson.value
          : this.payloadJson,
      occurredAt: data.occurredAt.present
          ? data.occurredAt.value
          : this.occurredAt,
      storedAt: data.storedAt.present ? data.storedAt.value : this.storedAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('CachedEvent(')
          ..write('eventId: $eventId, ')
          ..write('hostId: $hostId, ')
          ..write('streamId: $streamId, ')
          ..write('cursor: $cursor, ')
          ..write('type: $type, ')
          ..write('payloadJson: $payloadJson, ')
          ..write('occurredAt: $occurredAt, ')
          ..write('storedAt: $storedAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
    eventId,
    hostId,
    streamId,
    cursor,
    type,
    payloadJson,
    occurredAt,
    storedAt,
  );
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is CachedEvent &&
          other.eventId == this.eventId &&
          other.hostId == this.hostId &&
          other.streamId == this.streamId &&
          other.cursor == this.cursor &&
          other.type == this.type &&
          other.payloadJson == this.payloadJson &&
          other.occurredAt == this.occurredAt &&
          other.storedAt == this.storedAt);
}

class CachedEventsCompanion extends UpdateCompanion<CachedEvent> {
  final Value<String> eventId;
  final Value<String> hostId;
  final Value<String> streamId;
  final Value<String> cursor;
  final Value<String> type;
  final Value<String> payloadJson;
  final Value<DateTime> occurredAt;
  final Value<DateTime> storedAt;
  final Value<int> rowid;
  const CachedEventsCompanion({
    this.eventId = const Value.absent(),
    this.hostId = const Value.absent(),
    this.streamId = const Value.absent(),
    this.cursor = const Value.absent(),
    this.type = const Value.absent(),
    this.payloadJson = const Value.absent(),
    this.occurredAt = const Value.absent(),
    this.storedAt = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  CachedEventsCompanion.insert({
    required String eventId,
    required String hostId,
    required String streamId,
    required String cursor,
    required String type,
    required String payloadJson,
    required DateTime occurredAt,
    required DateTime storedAt,
    this.rowid = const Value.absent(),
  }) : eventId = Value(eventId),
       hostId = Value(hostId),
       streamId = Value(streamId),
       cursor = Value(cursor),
       type = Value(type),
       payloadJson = Value(payloadJson),
       occurredAt = Value(occurredAt),
       storedAt = Value(storedAt);
  static Insertable<CachedEvent> custom({
    Expression<String>? eventId,
    Expression<String>? hostId,
    Expression<String>? streamId,
    Expression<String>? cursor,
    Expression<String>? type,
    Expression<String>? payloadJson,
    Expression<DateTime>? occurredAt,
    Expression<DateTime>? storedAt,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (eventId != null) 'event_id': eventId,
      if (hostId != null) 'host_id': hostId,
      if (streamId != null) 'stream_id': streamId,
      if (cursor != null) 'cursor': cursor,
      if (type != null) 'type': type,
      if (payloadJson != null) 'payload_json': payloadJson,
      if (occurredAt != null) 'occurred_at': occurredAt,
      if (storedAt != null) 'stored_at': storedAt,
      if (rowid != null) 'rowid': rowid,
    });
  }

  CachedEventsCompanion copyWith({
    Value<String>? eventId,
    Value<String>? hostId,
    Value<String>? streamId,
    Value<String>? cursor,
    Value<String>? type,
    Value<String>? payloadJson,
    Value<DateTime>? occurredAt,
    Value<DateTime>? storedAt,
    Value<int>? rowid,
  }) {
    return CachedEventsCompanion(
      eventId: eventId ?? this.eventId,
      hostId: hostId ?? this.hostId,
      streamId: streamId ?? this.streamId,
      cursor: cursor ?? this.cursor,
      type: type ?? this.type,
      payloadJson: payloadJson ?? this.payloadJson,
      occurredAt: occurredAt ?? this.occurredAt,
      storedAt: storedAt ?? this.storedAt,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (eventId.present) {
      map['event_id'] = Variable<String>(eventId.value);
    }
    if (hostId.present) {
      map['host_id'] = Variable<String>(hostId.value);
    }
    if (streamId.present) {
      map['stream_id'] = Variable<String>(streamId.value);
    }
    if (cursor.present) {
      map['cursor'] = Variable<String>(cursor.value);
    }
    if (type.present) {
      map['type'] = Variable<String>(type.value);
    }
    if (payloadJson.present) {
      map['payload_json'] = Variable<String>(payloadJson.value);
    }
    if (occurredAt.present) {
      map['occurred_at'] = Variable<DateTime>(occurredAt.value);
    }
    if (storedAt.present) {
      map['stored_at'] = Variable<DateTime>(storedAt.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('CachedEventsCompanion(')
          ..write('eventId: $eventId, ')
          ..write('hostId: $hostId, ')
          ..write('streamId: $streamId, ')
          ..write('cursor: $cursor, ')
          ..write('type: $type, ')
          ..write('payloadJson: $payloadJson, ')
          ..write('occurredAt: $occurredAt, ')
          ..write('storedAt: $storedAt, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $SnapshotEntriesTable extends SnapshotEntries
    with TableInfo<$SnapshotEntriesTable, SnapshotEntry> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $SnapshotEntriesTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _streamIdMeta = const VerificationMeta(
    'streamId',
  );
  @override
  late final GeneratedColumn<String> streamId = GeneratedColumn<String>(
    'stream_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _hostIdMeta = const VerificationMeta('hostId');
  @override
  late final GeneratedColumn<String> hostId = GeneratedColumn<String>(
    'host_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _baselineCursorMeta = const VerificationMeta(
    'baselineCursor',
  );
  @override
  late final GeneratedColumn<String> baselineCursor = GeneratedColumn<String>(
    'baseline_cursor',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _snapshotIdMeta = const VerificationMeta(
    'snapshotId',
  );
  @override
  late final GeneratedColumn<String> snapshotId = GeneratedColumn<String>(
    'snapshot_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _payloadJsonMeta = const VerificationMeta(
    'payloadJson',
  );
  @override
  late final GeneratedColumn<String> payloadJson = GeneratedColumn<String>(
    'payload_json',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _receivedAtMeta = const VerificationMeta(
    'receivedAt',
  );
  @override
  late final GeneratedColumn<DateTime> receivedAt = GeneratedColumn<DateTime>(
    'received_at',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: true,
  );
  @override
  List<GeneratedColumn> get $columns => [
    streamId,
    hostId,
    baselineCursor,
    snapshotId,
    payloadJson,
    receivedAt,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'snapshot_entries';
  @override
  VerificationContext validateIntegrity(
    Insertable<SnapshotEntry> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('stream_id')) {
      context.handle(
        _streamIdMeta,
        streamId.isAcceptableOrUnknown(data['stream_id']!, _streamIdMeta),
      );
    } else if (isInserting) {
      context.missing(_streamIdMeta);
    }
    if (data.containsKey('host_id')) {
      context.handle(
        _hostIdMeta,
        hostId.isAcceptableOrUnknown(data['host_id']!, _hostIdMeta),
      );
    } else if (isInserting) {
      context.missing(_hostIdMeta);
    }
    if (data.containsKey('baseline_cursor')) {
      context.handle(
        _baselineCursorMeta,
        baselineCursor.isAcceptableOrUnknown(
          data['baseline_cursor']!,
          _baselineCursorMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_baselineCursorMeta);
    }
    if (data.containsKey('snapshot_id')) {
      context.handle(
        _snapshotIdMeta,
        snapshotId.isAcceptableOrUnknown(data['snapshot_id']!, _snapshotIdMeta),
      );
    } else if (isInserting) {
      context.missing(_snapshotIdMeta);
    }
    if (data.containsKey('payload_json')) {
      context.handle(
        _payloadJsonMeta,
        payloadJson.isAcceptableOrUnknown(
          data['payload_json']!,
          _payloadJsonMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_payloadJsonMeta);
    }
    if (data.containsKey('received_at')) {
      context.handle(
        _receivedAtMeta,
        receivedAt.isAcceptableOrUnknown(data['received_at']!, _receivedAtMeta),
      );
    } else if (isInserting) {
      context.missing(_receivedAtMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {streamId};
  @override
  SnapshotEntry map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return SnapshotEntry(
      streamId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}stream_id'],
      )!,
      hostId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}host_id'],
      )!,
      baselineCursor: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}baseline_cursor'],
      )!,
      snapshotId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}snapshot_id'],
      )!,
      payloadJson: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}payload_json'],
      )!,
      receivedAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}received_at'],
      )!,
    );
  }

  @override
  $SnapshotEntriesTable createAlias(String alias) {
    return $SnapshotEntriesTable(attachedDatabase, alias);
  }
}

class SnapshotEntry extends DataClass implements Insertable<SnapshotEntry> {
  final String streamId;
  final String hostId;
  final String baselineCursor;
  final String snapshotId;
  final String payloadJson;
  final DateTime receivedAt;
  const SnapshotEntry({
    required this.streamId,
    required this.hostId,
    required this.baselineCursor,
    required this.snapshotId,
    required this.payloadJson,
    required this.receivedAt,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['stream_id'] = Variable<String>(streamId);
    map['host_id'] = Variable<String>(hostId);
    map['baseline_cursor'] = Variable<String>(baselineCursor);
    map['snapshot_id'] = Variable<String>(snapshotId);
    map['payload_json'] = Variable<String>(payloadJson);
    map['received_at'] = Variable<DateTime>(receivedAt);
    return map;
  }

  SnapshotEntriesCompanion toCompanion(bool nullToAbsent) {
    return SnapshotEntriesCompanion(
      streamId: Value(streamId),
      hostId: Value(hostId),
      baselineCursor: Value(baselineCursor),
      snapshotId: Value(snapshotId),
      payloadJson: Value(payloadJson),
      receivedAt: Value(receivedAt),
    );
  }

  factory SnapshotEntry.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return SnapshotEntry(
      streamId: serializer.fromJson<String>(json['streamId']),
      hostId: serializer.fromJson<String>(json['hostId']),
      baselineCursor: serializer.fromJson<String>(json['baselineCursor']),
      snapshotId: serializer.fromJson<String>(json['snapshotId']),
      payloadJson: serializer.fromJson<String>(json['payloadJson']),
      receivedAt: serializer.fromJson<DateTime>(json['receivedAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'streamId': serializer.toJson<String>(streamId),
      'hostId': serializer.toJson<String>(hostId),
      'baselineCursor': serializer.toJson<String>(baselineCursor),
      'snapshotId': serializer.toJson<String>(snapshotId),
      'payloadJson': serializer.toJson<String>(payloadJson),
      'receivedAt': serializer.toJson<DateTime>(receivedAt),
    };
  }

  SnapshotEntry copyWith({
    String? streamId,
    String? hostId,
    String? baselineCursor,
    String? snapshotId,
    String? payloadJson,
    DateTime? receivedAt,
  }) => SnapshotEntry(
    streamId: streamId ?? this.streamId,
    hostId: hostId ?? this.hostId,
    baselineCursor: baselineCursor ?? this.baselineCursor,
    snapshotId: snapshotId ?? this.snapshotId,
    payloadJson: payloadJson ?? this.payloadJson,
    receivedAt: receivedAt ?? this.receivedAt,
  );
  SnapshotEntry copyWithCompanion(SnapshotEntriesCompanion data) {
    return SnapshotEntry(
      streamId: data.streamId.present ? data.streamId.value : this.streamId,
      hostId: data.hostId.present ? data.hostId.value : this.hostId,
      baselineCursor: data.baselineCursor.present
          ? data.baselineCursor.value
          : this.baselineCursor,
      snapshotId: data.snapshotId.present
          ? data.snapshotId.value
          : this.snapshotId,
      payloadJson: data.payloadJson.present
          ? data.payloadJson.value
          : this.payloadJson,
      receivedAt: data.receivedAt.present
          ? data.receivedAt.value
          : this.receivedAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('SnapshotEntry(')
          ..write('streamId: $streamId, ')
          ..write('hostId: $hostId, ')
          ..write('baselineCursor: $baselineCursor, ')
          ..write('snapshotId: $snapshotId, ')
          ..write('payloadJson: $payloadJson, ')
          ..write('receivedAt: $receivedAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
    streamId,
    hostId,
    baselineCursor,
    snapshotId,
    payloadJson,
    receivedAt,
  );
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is SnapshotEntry &&
          other.streamId == this.streamId &&
          other.hostId == this.hostId &&
          other.baselineCursor == this.baselineCursor &&
          other.snapshotId == this.snapshotId &&
          other.payloadJson == this.payloadJson &&
          other.receivedAt == this.receivedAt);
}

class SnapshotEntriesCompanion extends UpdateCompanion<SnapshotEntry> {
  final Value<String> streamId;
  final Value<String> hostId;
  final Value<String> baselineCursor;
  final Value<String> snapshotId;
  final Value<String> payloadJson;
  final Value<DateTime> receivedAt;
  final Value<int> rowid;
  const SnapshotEntriesCompanion({
    this.streamId = const Value.absent(),
    this.hostId = const Value.absent(),
    this.baselineCursor = const Value.absent(),
    this.snapshotId = const Value.absent(),
    this.payloadJson = const Value.absent(),
    this.receivedAt = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  SnapshotEntriesCompanion.insert({
    required String streamId,
    required String hostId,
    required String baselineCursor,
    required String snapshotId,
    required String payloadJson,
    required DateTime receivedAt,
    this.rowid = const Value.absent(),
  }) : streamId = Value(streamId),
       hostId = Value(hostId),
       baselineCursor = Value(baselineCursor),
       snapshotId = Value(snapshotId),
       payloadJson = Value(payloadJson),
       receivedAt = Value(receivedAt);
  static Insertable<SnapshotEntry> custom({
    Expression<String>? streamId,
    Expression<String>? hostId,
    Expression<String>? baselineCursor,
    Expression<String>? snapshotId,
    Expression<String>? payloadJson,
    Expression<DateTime>? receivedAt,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (streamId != null) 'stream_id': streamId,
      if (hostId != null) 'host_id': hostId,
      if (baselineCursor != null) 'baseline_cursor': baselineCursor,
      if (snapshotId != null) 'snapshot_id': snapshotId,
      if (payloadJson != null) 'payload_json': payloadJson,
      if (receivedAt != null) 'received_at': receivedAt,
      if (rowid != null) 'rowid': rowid,
    });
  }

  SnapshotEntriesCompanion copyWith({
    Value<String>? streamId,
    Value<String>? hostId,
    Value<String>? baselineCursor,
    Value<String>? snapshotId,
    Value<String>? payloadJson,
    Value<DateTime>? receivedAt,
    Value<int>? rowid,
  }) {
    return SnapshotEntriesCompanion(
      streamId: streamId ?? this.streamId,
      hostId: hostId ?? this.hostId,
      baselineCursor: baselineCursor ?? this.baselineCursor,
      snapshotId: snapshotId ?? this.snapshotId,
      payloadJson: payloadJson ?? this.payloadJson,
      receivedAt: receivedAt ?? this.receivedAt,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (streamId.present) {
      map['stream_id'] = Variable<String>(streamId.value);
    }
    if (hostId.present) {
      map['host_id'] = Variable<String>(hostId.value);
    }
    if (baselineCursor.present) {
      map['baseline_cursor'] = Variable<String>(baselineCursor.value);
    }
    if (snapshotId.present) {
      map['snapshot_id'] = Variable<String>(snapshotId.value);
    }
    if (payloadJson.present) {
      map['payload_json'] = Variable<String>(payloadJson.value);
    }
    if (receivedAt.present) {
      map['received_at'] = Variable<DateTime>(receivedAt.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('SnapshotEntriesCompanion(')
          ..write('streamId: $streamId, ')
          ..write('hostId: $hostId, ')
          ..write('baselineCursor: $baselineCursor, ')
          ..write('snapshotId: $snapshotId, ')
          ..write('payloadJson: $payloadJson, ')
          ..write('receivedAt: $receivedAt, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $DraftEntriesTable extends DraftEntries
    with TableInfo<$DraftEntriesTable, DraftEntry> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $DraftEntriesTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _hostIdMeta = const VerificationMeta('hostId');
  @override
  late final GeneratedColumn<String> hostId = GeneratedColumn<String>(
    'host_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _sessionIdMeta = const VerificationMeta(
    'sessionId',
  );
  @override
  late final GeneratedColumn<String> sessionId = GeneratedColumn<String>(
    'session_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _draftTextMeta = const VerificationMeta(
    'draftText',
  );
  @override
  late final GeneratedColumn<String> draftText = GeneratedColumn<String>(
    'draft_text',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
    defaultValue: const Constant(''),
  );
  static const VerificationMeta _localAttachmentRefsJsonMeta =
      const VerificationMeta('localAttachmentRefsJson');
  @override
  late final GeneratedColumn<String> localAttachmentRefsJson =
      GeneratedColumn<String>(
        'local_attachment_refs_json',
        aliasedName,
        false,
        type: DriftSqlType.string,
        requiredDuringInsert: false,
        defaultValue: const Constant('[]'),
      );
  static const VerificationMeta _selectedDeliveryModeMeta =
      const VerificationMeta('selectedDeliveryMode');
  @override
  late final GeneratedColumn<String> selectedDeliveryMode =
      GeneratedColumn<String>(
        'selected_delivery_mode',
        aliasedName,
        true,
        type: DriftSqlType.string,
        requiredDuringInsert: false,
      );
  static const VerificationMeta _pendingCommandIdMeta = const VerificationMeta(
    'pendingCommandId',
  );
  @override
  late final GeneratedColumn<String> pendingCommandId = GeneratedColumn<String>(
    'pending_command_id',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _pendingPayloadJsonMeta =
      const VerificationMeta('pendingPayloadJson');
  @override
  late final GeneratedColumn<String> pendingPayloadJson =
      GeneratedColumn<String>(
        'pending_payload_json',
        aliasedName,
        true,
        type: DriftSqlType.string,
        requiredDuringInsert: false,
      );
  static const VerificationMeta _pendingStateMeta = const VerificationMeta(
    'pendingState',
  );
  @override
  late final GeneratedColumn<String> pendingState = GeneratedColumn<String>(
    'pending_state',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _updatedAtMeta = const VerificationMeta(
    'updatedAt',
  );
  @override
  late final GeneratedColumn<DateTime> updatedAt = GeneratedColumn<DateTime>(
    'updated_at',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: true,
  );
  @override
  List<GeneratedColumn> get $columns => [
    hostId,
    sessionId,
    draftText,
    localAttachmentRefsJson,
    selectedDeliveryMode,
    pendingCommandId,
    pendingPayloadJson,
    pendingState,
    updatedAt,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'draft_entries';
  @override
  VerificationContext validateIntegrity(
    Insertable<DraftEntry> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('host_id')) {
      context.handle(
        _hostIdMeta,
        hostId.isAcceptableOrUnknown(data['host_id']!, _hostIdMeta),
      );
    } else if (isInserting) {
      context.missing(_hostIdMeta);
    }
    if (data.containsKey('session_id')) {
      context.handle(
        _sessionIdMeta,
        sessionId.isAcceptableOrUnknown(data['session_id']!, _sessionIdMeta),
      );
    } else if (isInserting) {
      context.missing(_sessionIdMeta);
    }
    if (data.containsKey('draft_text')) {
      context.handle(
        _draftTextMeta,
        draftText.isAcceptableOrUnknown(data['draft_text']!, _draftTextMeta),
      );
    }
    if (data.containsKey('local_attachment_refs_json')) {
      context.handle(
        _localAttachmentRefsJsonMeta,
        localAttachmentRefsJson.isAcceptableOrUnknown(
          data['local_attachment_refs_json']!,
          _localAttachmentRefsJsonMeta,
        ),
      );
    }
    if (data.containsKey('selected_delivery_mode')) {
      context.handle(
        _selectedDeliveryModeMeta,
        selectedDeliveryMode.isAcceptableOrUnknown(
          data['selected_delivery_mode']!,
          _selectedDeliveryModeMeta,
        ),
      );
    }
    if (data.containsKey('pending_command_id')) {
      context.handle(
        _pendingCommandIdMeta,
        pendingCommandId.isAcceptableOrUnknown(
          data['pending_command_id']!,
          _pendingCommandIdMeta,
        ),
      );
    }
    if (data.containsKey('pending_payload_json')) {
      context.handle(
        _pendingPayloadJsonMeta,
        pendingPayloadJson.isAcceptableOrUnknown(
          data['pending_payload_json']!,
          _pendingPayloadJsonMeta,
        ),
      );
    }
    if (data.containsKey('pending_state')) {
      context.handle(
        _pendingStateMeta,
        pendingState.isAcceptableOrUnknown(
          data['pending_state']!,
          _pendingStateMeta,
        ),
      );
    }
    if (data.containsKey('updated_at')) {
      context.handle(
        _updatedAtMeta,
        updatedAt.isAcceptableOrUnknown(data['updated_at']!, _updatedAtMeta),
      );
    } else if (isInserting) {
      context.missing(_updatedAtMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {hostId, sessionId};
  @override
  DraftEntry map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return DraftEntry(
      hostId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}host_id'],
      )!,
      sessionId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}session_id'],
      )!,
      draftText: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}draft_text'],
      )!,
      localAttachmentRefsJson: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}local_attachment_refs_json'],
      )!,
      selectedDeliveryMode: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}selected_delivery_mode'],
      ),
      pendingCommandId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}pending_command_id'],
      ),
      pendingPayloadJson: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}pending_payload_json'],
      ),
      pendingState: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}pending_state'],
      ),
      updatedAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}updated_at'],
      )!,
    );
  }

  @override
  $DraftEntriesTable createAlias(String alias) {
    return $DraftEntriesTable(attachedDatabase, alias);
  }
}

class DraftEntry extends DataClass implements Insertable<DraftEntry> {
  final String hostId;
  final String sessionId;
  final String draftText;
  final String localAttachmentRefsJson;
  final String? selectedDeliveryMode;
  final String? pendingCommandId;
  final String? pendingPayloadJson;
  final String? pendingState;
  final DateTime updatedAt;
  const DraftEntry({
    required this.hostId,
    required this.sessionId,
    required this.draftText,
    required this.localAttachmentRefsJson,
    this.selectedDeliveryMode,
    this.pendingCommandId,
    this.pendingPayloadJson,
    this.pendingState,
    required this.updatedAt,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['host_id'] = Variable<String>(hostId);
    map['session_id'] = Variable<String>(sessionId);
    map['draft_text'] = Variable<String>(draftText);
    map['local_attachment_refs_json'] = Variable<String>(
      localAttachmentRefsJson,
    );
    if (!nullToAbsent || selectedDeliveryMode != null) {
      map['selected_delivery_mode'] = Variable<String>(selectedDeliveryMode);
    }
    if (!nullToAbsent || pendingCommandId != null) {
      map['pending_command_id'] = Variable<String>(pendingCommandId);
    }
    if (!nullToAbsent || pendingPayloadJson != null) {
      map['pending_payload_json'] = Variable<String>(pendingPayloadJson);
    }
    if (!nullToAbsent || pendingState != null) {
      map['pending_state'] = Variable<String>(pendingState);
    }
    map['updated_at'] = Variable<DateTime>(updatedAt);
    return map;
  }

  DraftEntriesCompanion toCompanion(bool nullToAbsent) {
    return DraftEntriesCompanion(
      hostId: Value(hostId),
      sessionId: Value(sessionId),
      draftText: Value(draftText),
      localAttachmentRefsJson: Value(localAttachmentRefsJson),
      selectedDeliveryMode: selectedDeliveryMode == null && nullToAbsent
          ? const Value.absent()
          : Value(selectedDeliveryMode),
      pendingCommandId: pendingCommandId == null && nullToAbsent
          ? const Value.absent()
          : Value(pendingCommandId),
      pendingPayloadJson: pendingPayloadJson == null && nullToAbsent
          ? const Value.absent()
          : Value(pendingPayloadJson),
      pendingState: pendingState == null && nullToAbsent
          ? const Value.absent()
          : Value(pendingState),
      updatedAt: Value(updatedAt),
    );
  }

  factory DraftEntry.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return DraftEntry(
      hostId: serializer.fromJson<String>(json['hostId']),
      sessionId: serializer.fromJson<String>(json['sessionId']),
      draftText: serializer.fromJson<String>(json['draftText']),
      localAttachmentRefsJson: serializer.fromJson<String>(
        json['localAttachmentRefsJson'],
      ),
      selectedDeliveryMode: serializer.fromJson<String?>(
        json['selectedDeliveryMode'],
      ),
      pendingCommandId: serializer.fromJson<String?>(json['pendingCommandId']),
      pendingPayloadJson: serializer.fromJson<String?>(
        json['pendingPayloadJson'],
      ),
      pendingState: serializer.fromJson<String?>(json['pendingState']),
      updatedAt: serializer.fromJson<DateTime>(json['updatedAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'hostId': serializer.toJson<String>(hostId),
      'sessionId': serializer.toJson<String>(sessionId),
      'draftText': serializer.toJson<String>(draftText),
      'localAttachmentRefsJson': serializer.toJson<String>(
        localAttachmentRefsJson,
      ),
      'selectedDeliveryMode': serializer.toJson<String?>(selectedDeliveryMode),
      'pendingCommandId': serializer.toJson<String?>(pendingCommandId),
      'pendingPayloadJson': serializer.toJson<String?>(pendingPayloadJson),
      'pendingState': serializer.toJson<String?>(pendingState),
      'updatedAt': serializer.toJson<DateTime>(updatedAt),
    };
  }

  DraftEntry copyWith({
    String? hostId,
    String? sessionId,
    String? draftText,
    String? localAttachmentRefsJson,
    Value<String?> selectedDeliveryMode = const Value.absent(),
    Value<String?> pendingCommandId = const Value.absent(),
    Value<String?> pendingPayloadJson = const Value.absent(),
    Value<String?> pendingState = const Value.absent(),
    DateTime? updatedAt,
  }) => DraftEntry(
    hostId: hostId ?? this.hostId,
    sessionId: sessionId ?? this.sessionId,
    draftText: draftText ?? this.draftText,
    localAttachmentRefsJson:
        localAttachmentRefsJson ?? this.localAttachmentRefsJson,
    selectedDeliveryMode: selectedDeliveryMode.present
        ? selectedDeliveryMode.value
        : this.selectedDeliveryMode,
    pendingCommandId: pendingCommandId.present
        ? pendingCommandId.value
        : this.pendingCommandId,
    pendingPayloadJson: pendingPayloadJson.present
        ? pendingPayloadJson.value
        : this.pendingPayloadJson,
    pendingState: pendingState.present ? pendingState.value : this.pendingState,
    updatedAt: updatedAt ?? this.updatedAt,
  );
  DraftEntry copyWithCompanion(DraftEntriesCompanion data) {
    return DraftEntry(
      hostId: data.hostId.present ? data.hostId.value : this.hostId,
      sessionId: data.sessionId.present ? data.sessionId.value : this.sessionId,
      draftText: data.draftText.present ? data.draftText.value : this.draftText,
      localAttachmentRefsJson: data.localAttachmentRefsJson.present
          ? data.localAttachmentRefsJson.value
          : this.localAttachmentRefsJson,
      selectedDeliveryMode: data.selectedDeliveryMode.present
          ? data.selectedDeliveryMode.value
          : this.selectedDeliveryMode,
      pendingCommandId: data.pendingCommandId.present
          ? data.pendingCommandId.value
          : this.pendingCommandId,
      pendingPayloadJson: data.pendingPayloadJson.present
          ? data.pendingPayloadJson.value
          : this.pendingPayloadJson,
      pendingState: data.pendingState.present
          ? data.pendingState.value
          : this.pendingState,
      updatedAt: data.updatedAt.present ? data.updatedAt.value : this.updatedAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('DraftEntry(')
          ..write('hostId: $hostId, ')
          ..write('sessionId: $sessionId, ')
          ..write('draftText: $draftText, ')
          ..write('localAttachmentRefsJson: $localAttachmentRefsJson, ')
          ..write('selectedDeliveryMode: $selectedDeliveryMode, ')
          ..write('pendingCommandId: $pendingCommandId, ')
          ..write('pendingPayloadJson: $pendingPayloadJson, ')
          ..write('pendingState: $pendingState, ')
          ..write('updatedAt: $updatedAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
    hostId,
    sessionId,
    draftText,
    localAttachmentRefsJson,
    selectedDeliveryMode,
    pendingCommandId,
    pendingPayloadJson,
    pendingState,
    updatedAt,
  );
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is DraftEntry &&
          other.hostId == this.hostId &&
          other.sessionId == this.sessionId &&
          other.draftText == this.draftText &&
          other.localAttachmentRefsJson == this.localAttachmentRefsJson &&
          other.selectedDeliveryMode == this.selectedDeliveryMode &&
          other.pendingCommandId == this.pendingCommandId &&
          other.pendingPayloadJson == this.pendingPayloadJson &&
          other.pendingState == this.pendingState &&
          other.updatedAt == this.updatedAt);
}

class DraftEntriesCompanion extends UpdateCompanion<DraftEntry> {
  final Value<String> hostId;
  final Value<String> sessionId;
  final Value<String> draftText;
  final Value<String> localAttachmentRefsJson;
  final Value<String?> selectedDeliveryMode;
  final Value<String?> pendingCommandId;
  final Value<String?> pendingPayloadJson;
  final Value<String?> pendingState;
  final Value<DateTime> updatedAt;
  final Value<int> rowid;
  const DraftEntriesCompanion({
    this.hostId = const Value.absent(),
    this.sessionId = const Value.absent(),
    this.draftText = const Value.absent(),
    this.localAttachmentRefsJson = const Value.absent(),
    this.selectedDeliveryMode = const Value.absent(),
    this.pendingCommandId = const Value.absent(),
    this.pendingPayloadJson = const Value.absent(),
    this.pendingState = const Value.absent(),
    this.updatedAt = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  DraftEntriesCompanion.insert({
    required String hostId,
    required String sessionId,
    this.draftText = const Value.absent(),
    this.localAttachmentRefsJson = const Value.absent(),
    this.selectedDeliveryMode = const Value.absent(),
    this.pendingCommandId = const Value.absent(),
    this.pendingPayloadJson = const Value.absent(),
    this.pendingState = const Value.absent(),
    required DateTime updatedAt,
    this.rowid = const Value.absent(),
  }) : hostId = Value(hostId),
       sessionId = Value(sessionId),
       updatedAt = Value(updatedAt);
  static Insertable<DraftEntry> custom({
    Expression<String>? hostId,
    Expression<String>? sessionId,
    Expression<String>? draftText,
    Expression<String>? localAttachmentRefsJson,
    Expression<String>? selectedDeliveryMode,
    Expression<String>? pendingCommandId,
    Expression<String>? pendingPayloadJson,
    Expression<String>? pendingState,
    Expression<DateTime>? updatedAt,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (hostId != null) 'host_id': hostId,
      if (sessionId != null) 'session_id': sessionId,
      if (draftText != null) 'draft_text': draftText,
      if (localAttachmentRefsJson != null)
        'local_attachment_refs_json': localAttachmentRefsJson,
      if (selectedDeliveryMode != null)
        'selected_delivery_mode': selectedDeliveryMode,
      if (pendingCommandId != null) 'pending_command_id': pendingCommandId,
      if (pendingPayloadJson != null)
        'pending_payload_json': pendingPayloadJson,
      if (pendingState != null) 'pending_state': pendingState,
      if (updatedAt != null) 'updated_at': updatedAt,
      if (rowid != null) 'rowid': rowid,
    });
  }

  DraftEntriesCompanion copyWith({
    Value<String>? hostId,
    Value<String>? sessionId,
    Value<String>? draftText,
    Value<String>? localAttachmentRefsJson,
    Value<String?>? selectedDeliveryMode,
    Value<String?>? pendingCommandId,
    Value<String?>? pendingPayloadJson,
    Value<String?>? pendingState,
    Value<DateTime>? updatedAt,
    Value<int>? rowid,
  }) {
    return DraftEntriesCompanion(
      hostId: hostId ?? this.hostId,
      sessionId: sessionId ?? this.sessionId,
      draftText: draftText ?? this.draftText,
      localAttachmentRefsJson:
          localAttachmentRefsJson ?? this.localAttachmentRefsJson,
      selectedDeliveryMode: selectedDeliveryMode ?? this.selectedDeliveryMode,
      pendingCommandId: pendingCommandId ?? this.pendingCommandId,
      pendingPayloadJson: pendingPayloadJson ?? this.pendingPayloadJson,
      pendingState: pendingState ?? this.pendingState,
      updatedAt: updatedAt ?? this.updatedAt,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (hostId.present) {
      map['host_id'] = Variable<String>(hostId.value);
    }
    if (sessionId.present) {
      map['session_id'] = Variable<String>(sessionId.value);
    }
    if (draftText.present) {
      map['draft_text'] = Variable<String>(draftText.value);
    }
    if (localAttachmentRefsJson.present) {
      map['local_attachment_refs_json'] = Variable<String>(
        localAttachmentRefsJson.value,
      );
    }
    if (selectedDeliveryMode.present) {
      map['selected_delivery_mode'] = Variable<String>(
        selectedDeliveryMode.value,
      );
    }
    if (pendingCommandId.present) {
      map['pending_command_id'] = Variable<String>(pendingCommandId.value);
    }
    if (pendingPayloadJson.present) {
      map['pending_payload_json'] = Variable<String>(pendingPayloadJson.value);
    }
    if (pendingState.present) {
      map['pending_state'] = Variable<String>(pendingState.value);
    }
    if (updatedAt.present) {
      map['updated_at'] = Variable<DateTime>(updatedAt.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('DraftEntriesCompanion(')
          ..write('hostId: $hostId, ')
          ..write('sessionId: $sessionId, ')
          ..write('draftText: $draftText, ')
          ..write('localAttachmentRefsJson: $localAttachmentRefsJson, ')
          ..write('selectedDeliveryMode: $selectedDeliveryMode, ')
          ..write('pendingCommandId: $pendingCommandId, ')
          ..write('pendingPayloadJson: $pendingPayloadJson, ')
          ..write('pendingState: $pendingState, ')
          ..write('updatedAt: $updatedAt, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

abstract class _$AppDatabase extends GeneratedDatabase {
  _$AppDatabase(QueryExecutor e) : super(e);
  $AppDatabaseManager get managers => $AppDatabaseManager(this);
  late final $MetadataEntriesTable metadataEntries = $MetadataEntriesTable(
    this,
  );
  late final $HostEntriesTable hostEntries = $HostEntriesTable(this);
  late final $StreamCursorsTable streamCursors = $StreamCursorsTable(this);
  late final $SessionEntriesTable sessionEntries = $SessionEntriesTable(this);
  late final $CachedEventsTable cachedEvents = $CachedEventsTable(this);
  late final $SnapshotEntriesTable snapshotEntries = $SnapshotEntriesTable(
    this,
  );
  late final $DraftEntriesTable draftEntries = $DraftEntriesTable(this);
  @override
  Iterable<TableInfo<Table, Object?>> get allTables =>
      allSchemaEntities.whereType<TableInfo<Table, Object?>>();
  @override
  List<DatabaseSchemaEntity> get allSchemaEntities => [
    metadataEntries,
    hostEntries,
    streamCursors,
    sessionEntries,
    cachedEvents,
    snapshotEntries,
    draftEntries,
  ];
}

typedef $$MetadataEntriesTableCreateCompanionBuilder =
    MetadataEntriesCompanion Function({
      required String installationId,
      required String platform,
      required String appVersion,
      required int protocolMajor,
      required int protocolMinor,
      required DateTime firstSeenAt,
      required DateTime lastSeenAt,
      Value<int> rowid,
    });
typedef $$MetadataEntriesTableUpdateCompanionBuilder =
    MetadataEntriesCompanion Function({
      Value<String> installationId,
      Value<String> platform,
      Value<String> appVersion,
      Value<int> protocolMajor,
      Value<int> protocolMinor,
      Value<DateTime> firstSeenAt,
      Value<DateTime> lastSeenAt,
      Value<int> rowid,
    });

class $$MetadataEntriesTableFilterComposer
    extends Composer<_$AppDatabase, $MetadataEntriesTable> {
  $$MetadataEntriesTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get installationId => $composableBuilder(
    column: $table.installationId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get platform => $composableBuilder(
    column: $table.platform,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get appVersion => $composableBuilder(
    column: $table.appVersion,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get protocolMajor => $composableBuilder(
    column: $table.protocolMajor,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get protocolMinor => $composableBuilder(
    column: $table.protocolMinor,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get firstSeenAt => $composableBuilder(
    column: $table.firstSeenAt,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get lastSeenAt => $composableBuilder(
    column: $table.lastSeenAt,
    builder: (column) => ColumnFilters(column),
  );
}

class $$MetadataEntriesTableOrderingComposer
    extends Composer<_$AppDatabase, $MetadataEntriesTable> {
  $$MetadataEntriesTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get installationId => $composableBuilder(
    column: $table.installationId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get platform => $composableBuilder(
    column: $table.platform,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get appVersion => $composableBuilder(
    column: $table.appVersion,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get protocolMajor => $composableBuilder(
    column: $table.protocolMajor,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get protocolMinor => $composableBuilder(
    column: $table.protocolMinor,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get firstSeenAt => $composableBuilder(
    column: $table.firstSeenAt,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get lastSeenAt => $composableBuilder(
    column: $table.lastSeenAt,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$MetadataEntriesTableAnnotationComposer
    extends Composer<_$AppDatabase, $MetadataEntriesTable> {
  $$MetadataEntriesTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get installationId => $composableBuilder(
    column: $table.installationId,
    builder: (column) => column,
  );

  GeneratedColumn<String> get platform =>
      $composableBuilder(column: $table.platform, builder: (column) => column);

  GeneratedColumn<String> get appVersion => $composableBuilder(
    column: $table.appVersion,
    builder: (column) => column,
  );

  GeneratedColumn<int> get protocolMajor => $composableBuilder(
    column: $table.protocolMajor,
    builder: (column) => column,
  );

  GeneratedColumn<int> get protocolMinor => $composableBuilder(
    column: $table.protocolMinor,
    builder: (column) => column,
  );

  GeneratedColumn<DateTime> get firstSeenAt => $composableBuilder(
    column: $table.firstSeenAt,
    builder: (column) => column,
  );

  GeneratedColumn<DateTime> get lastSeenAt => $composableBuilder(
    column: $table.lastSeenAt,
    builder: (column) => column,
  );
}

class $$MetadataEntriesTableTableManager
    extends
        RootTableManager<
          _$AppDatabase,
          $MetadataEntriesTable,
          MetadataEntry,
          $$MetadataEntriesTableFilterComposer,
          $$MetadataEntriesTableOrderingComposer,
          $$MetadataEntriesTableAnnotationComposer,
          $$MetadataEntriesTableCreateCompanionBuilder,
          $$MetadataEntriesTableUpdateCompanionBuilder,
          (
            MetadataEntry,
            BaseReferences<_$AppDatabase, $MetadataEntriesTable, MetadataEntry>,
          ),
          MetadataEntry,
          PrefetchHooks Function()
        > {
  $$MetadataEntriesTableTableManager(
    _$AppDatabase db,
    $MetadataEntriesTable table,
  ) : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$MetadataEntriesTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$MetadataEntriesTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$MetadataEntriesTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> installationId = const Value.absent(),
                Value<String> platform = const Value.absent(),
                Value<String> appVersion = const Value.absent(),
                Value<int> protocolMajor = const Value.absent(),
                Value<int> protocolMinor = const Value.absent(),
                Value<DateTime> firstSeenAt = const Value.absent(),
                Value<DateTime> lastSeenAt = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => MetadataEntriesCompanion(
                installationId: installationId,
                platform: platform,
                appVersion: appVersion,
                protocolMajor: protocolMajor,
                protocolMinor: protocolMinor,
                firstSeenAt: firstSeenAt,
                lastSeenAt: lastSeenAt,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String installationId,
                required String platform,
                required String appVersion,
                required int protocolMajor,
                required int protocolMinor,
                required DateTime firstSeenAt,
                required DateTime lastSeenAt,
                Value<int> rowid = const Value.absent(),
              }) => MetadataEntriesCompanion.insert(
                installationId: installationId,
                platform: platform,
                appVersion: appVersion,
                protocolMajor: protocolMajor,
                protocolMinor: protocolMinor,
                firstSeenAt: firstSeenAt,
                lastSeenAt: lastSeenAt,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$MetadataEntriesTableProcessedTableManager =
    ProcessedTableManager<
      _$AppDatabase,
      $MetadataEntriesTable,
      MetadataEntry,
      $$MetadataEntriesTableFilterComposer,
      $$MetadataEntriesTableOrderingComposer,
      $$MetadataEntriesTableAnnotationComposer,
      $$MetadataEntriesTableCreateCompanionBuilder,
      $$MetadataEntriesTableUpdateCompanionBuilder,
      (
        MetadataEntry,
        BaseReferences<_$AppDatabase, $MetadataEntriesTable, MetadataEntry>,
      ),
      MetadataEntry,
      PrefetchHooks Function()
    >;
typedef $$HostEntriesTableCreateCompanionBuilder =
    HostEntriesCompanion Function({
      required String hostId,
      required String endpoint,
      required String displayName,
      required String generation,
      required String connectionState,
      Value<String?> bridgeVersion,
      Value<String?> piVersion,
      Value<String?> protocolVersion,
      required String capabilitiesJson,
      Value<DateTime?> lastSeenAt,
      Value<int> rowid,
    });
typedef $$HostEntriesTableUpdateCompanionBuilder =
    HostEntriesCompanion Function({
      Value<String> hostId,
      Value<String> endpoint,
      Value<String> displayName,
      Value<String> generation,
      Value<String> connectionState,
      Value<String?> bridgeVersion,
      Value<String?> piVersion,
      Value<String?> protocolVersion,
      Value<String> capabilitiesJson,
      Value<DateTime?> lastSeenAt,
      Value<int> rowid,
    });

class $$HostEntriesTableFilterComposer
    extends Composer<_$AppDatabase, $HostEntriesTable> {
  $$HostEntriesTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get hostId => $composableBuilder(
    column: $table.hostId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get endpoint => $composableBuilder(
    column: $table.endpoint,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get displayName => $composableBuilder(
    column: $table.displayName,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get generation => $composableBuilder(
    column: $table.generation,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get connectionState => $composableBuilder(
    column: $table.connectionState,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get bridgeVersion => $composableBuilder(
    column: $table.bridgeVersion,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get piVersion => $composableBuilder(
    column: $table.piVersion,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get protocolVersion => $composableBuilder(
    column: $table.protocolVersion,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get capabilitiesJson => $composableBuilder(
    column: $table.capabilitiesJson,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get lastSeenAt => $composableBuilder(
    column: $table.lastSeenAt,
    builder: (column) => ColumnFilters(column),
  );
}

class $$HostEntriesTableOrderingComposer
    extends Composer<_$AppDatabase, $HostEntriesTable> {
  $$HostEntriesTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get hostId => $composableBuilder(
    column: $table.hostId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get endpoint => $composableBuilder(
    column: $table.endpoint,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get displayName => $composableBuilder(
    column: $table.displayName,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get generation => $composableBuilder(
    column: $table.generation,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get connectionState => $composableBuilder(
    column: $table.connectionState,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get bridgeVersion => $composableBuilder(
    column: $table.bridgeVersion,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get piVersion => $composableBuilder(
    column: $table.piVersion,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get protocolVersion => $composableBuilder(
    column: $table.protocolVersion,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get capabilitiesJson => $composableBuilder(
    column: $table.capabilitiesJson,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get lastSeenAt => $composableBuilder(
    column: $table.lastSeenAt,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$HostEntriesTableAnnotationComposer
    extends Composer<_$AppDatabase, $HostEntriesTable> {
  $$HostEntriesTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get hostId =>
      $composableBuilder(column: $table.hostId, builder: (column) => column);

  GeneratedColumn<String> get endpoint =>
      $composableBuilder(column: $table.endpoint, builder: (column) => column);

  GeneratedColumn<String> get displayName => $composableBuilder(
    column: $table.displayName,
    builder: (column) => column,
  );

  GeneratedColumn<String> get generation => $composableBuilder(
    column: $table.generation,
    builder: (column) => column,
  );

  GeneratedColumn<String> get connectionState => $composableBuilder(
    column: $table.connectionState,
    builder: (column) => column,
  );

  GeneratedColumn<String> get bridgeVersion => $composableBuilder(
    column: $table.bridgeVersion,
    builder: (column) => column,
  );

  GeneratedColumn<String> get piVersion =>
      $composableBuilder(column: $table.piVersion, builder: (column) => column);

  GeneratedColumn<String> get protocolVersion => $composableBuilder(
    column: $table.protocolVersion,
    builder: (column) => column,
  );

  GeneratedColumn<String> get capabilitiesJson => $composableBuilder(
    column: $table.capabilitiesJson,
    builder: (column) => column,
  );

  GeneratedColumn<DateTime> get lastSeenAt => $composableBuilder(
    column: $table.lastSeenAt,
    builder: (column) => column,
  );
}

class $$HostEntriesTableTableManager
    extends
        RootTableManager<
          _$AppDatabase,
          $HostEntriesTable,
          HostEntry,
          $$HostEntriesTableFilterComposer,
          $$HostEntriesTableOrderingComposer,
          $$HostEntriesTableAnnotationComposer,
          $$HostEntriesTableCreateCompanionBuilder,
          $$HostEntriesTableUpdateCompanionBuilder,
          (
            HostEntry,
            BaseReferences<_$AppDatabase, $HostEntriesTable, HostEntry>,
          ),
          HostEntry,
          PrefetchHooks Function()
        > {
  $$HostEntriesTableTableManager(_$AppDatabase db, $HostEntriesTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$HostEntriesTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$HostEntriesTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$HostEntriesTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> hostId = const Value.absent(),
                Value<String> endpoint = const Value.absent(),
                Value<String> displayName = const Value.absent(),
                Value<String> generation = const Value.absent(),
                Value<String> connectionState = const Value.absent(),
                Value<String?> bridgeVersion = const Value.absent(),
                Value<String?> piVersion = const Value.absent(),
                Value<String?> protocolVersion = const Value.absent(),
                Value<String> capabilitiesJson = const Value.absent(),
                Value<DateTime?> lastSeenAt = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => HostEntriesCompanion(
                hostId: hostId,
                endpoint: endpoint,
                displayName: displayName,
                generation: generation,
                connectionState: connectionState,
                bridgeVersion: bridgeVersion,
                piVersion: piVersion,
                protocolVersion: protocolVersion,
                capabilitiesJson: capabilitiesJson,
                lastSeenAt: lastSeenAt,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String hostId,
                required String endpoint,
                required String displayName,
                required String generation,
                required String connectionState,
                Value<String?> bridgeVersion = const Value.absent(),
                Value<String?> piVersion = const Value.absent(),
                Value<String?> protocolVersion = const Value.absent(),
                required String capabilitiesJson,
                Value<DateTime?> lastSeenAt = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => HostEntriesCompanion.insert(
                hostId: hostId,
                endpoint: endpoint,
                displayName: displayName,
                generation: generation,
                connectionState: connectionState,
                bridgeVersion: bridgeVersion,
                piVersion: piVersion,
                protocolVersion: protocolVersion,
                capabilitiesJson: capabilitiesJson,
                lastSeenAt: lastSeenAt,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$HostEntriesTableProcessedTableManager =
    ProcessedTableManager<
      _$AppDatabase,
      $HostEntriesTable,
      HostEntry,
      $$HostEntriesTableFilterComposer,
      $$HostEntriesTableOrderingComposer,
      $$HostEntriesTableAnnotationComposer,
      $$HostEntriesTableCreateCompanionBuilder,
      $$HostEntriesTableUpdateCompanionBuilder,
      (HostEntry, BaseReferences<_$AppDatabase, $HostEntriesTable, HostEntry>),
      HostEntry,
      PrefetchHooks Function()
    >;
typedef $$StreamCursorsTableCreateCompanionBuilder =
    StreamCursorsCompanion Function({
      required String streamId,
      required String hostId,
      required String lastContiguousCursor,
      required DateTime updatedAt,
      Value<int> rowid,
    });
typedef $$StreamCursorsTableUpdateCompanionBuilder =
    StreamCursorsCompanion Function({
      Value<String> streamId,
      Value<String> hostId,
      Value<String> lastContiguousCursor,
      Value<DateTime> updatedAt,
      Value<int> rowid,
    });

class $$StreamCursorsTableFilterComposer
    extends Composer<_$AppDatabase, $StreamCursorsTable> {
  $$StreamCursorsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get streamId => $composableBuilder(
    column: $table.streamId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get hostId => $composableBuilder(
    column: $table.hostId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get lastContiguousCursor => $composableBuilder(
    column: $table.lastContiguousCursor,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get updatedAt => $composableBuilder(
    column: $table.updatedAt,
    builder: (column) => ColumnFilters(column),
  );
}

class $$StreamCursorsTableOrderingComposer
    extends Composer<_$AppDatabase, $StreamCursorsTable> {
  $$StreamCursorsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get streamId => $composableBuilder(
    column: $table.streamId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get hostId => $composableBuilder(
    column: $table.hostId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get lastContiguousCursor => $composableBuilder(
    column: $table.lastContiguousCursor,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get updatedAt => $composableBuilder(
    column: $table.updatedAt,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$StreamCursorsTableAnnotationComposer
    extends Composer<_$AppDatabase, $StreamCursorsTable> {
  $$StreamCursorsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get streamId =>
      $composableBuilder(column: $table.streamId, builder: (column) => column);

  GeneratedColumn<String> get hostId =>
      $composableBuilder(column: $table.hostId, builder: (column) => column);

  GeneratedColumn<String> get lastContiguousCursor => $composableBuilder(
    column: $table.lastContiguousCursor,
    builder: (column) => column,
  );

  GeneratedColumn<DateTime> get updatedAt =>
      $composableBuilder(column: $table.updatedAt, builder: (column) => column);
}

class $$StreamCursorsTableTableManager
    extends
        RootTableManager<
          _$AppDatabase,
          $StreamCursorsTable,
          StreamCursor,
          $$StreamCursorsTableFilterComposer,
          $$StreamCursorsTableOrderingComposer,
          $$StreamCursorsTableAnnotationComposer,
          $$StreamCursorsTableCreateCompanionBuilder,
          $$StreamCursorsTableUpdateCompanionBuilder,
          (
            StreamCursor,
            BaseReferences<_$AppDatabase, $StreamCursorsTable, StreamCursor>,
          ),
          StreamCursor,
          PrefetchHooks Function()
        > {
  $$StreamCursorsTableTableManager(_$AppDatabase db, $StreamCursorsTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$StreamCursorsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$StreamCursorsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$StreamCursorsTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> streamId = const Value.absent(),
                Value<String> hostId = const Value.absent(),
                Value<String> lastContiguousCursor = const Value.absent(),
                Value<DateTime> updatedAt = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => StreamCursorsCompanion(
                streamId: streamId,
                hostId: hostId,
                lastContiguousCursor: lastContiguousCursor,
                updatedAt: updatedAt,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String streamId,
                required String hostId,
                required String lastContiguousCursor,
                required DateTime updatedAt,
                Value<int> rowid = const Value.absent(),
              }) => StreamCursorsCompanion.insert(
                streamId: streamId,
                hostId: hostId,
                lastContiguousCursor: lastContiguousCursor,
                updatedAt: updatedAt,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$StreamCursorsTableProcessedTableManager =
    ProcessedTableManager<
      _$AppDatabase,
      $StreamCursorsTable,
      StreamCursor,
      $$StreamCursorsTableFilterComposer,
      $$StreamCursorsTableOrderingComposer,
      $$StreamCursorsTableAnnotationComposer,
      $$StreamCursorsTableCreateCompanionBuilder,
      $$StreamCursorsTableUpdateCompanionBuilder,
      (
        StreamCursor,
        BaseReferences<_$AppDatabase, $StreamCursorsTable, StreamCursor>,
      ),
      StreamCursor,
      PrefetchHooks Function()
    >;
typedef $$SessionEntriesTableCreateCompanionBuilder =
    SessionEntriesCompanion Function({
      required String sessionId,
      required String hostId,
      Value<String?> workspaceId,
      required String name,
      required String runtimeState,
      Value<String?> policyMode,
      Value<String?> modelSummary,
      Value<String?> thinkingLevel,
      Value<int> queueCount,
      Value<DateTime?> lastActivityAt,
      Value<String?> unreadState,
      Value<String?> controllerState,
      Value<int> rowid,
    });
typedef $$SessionEntriesTableUpdateCompanionBuilder =
    SessionEntriesCompanion Function({
      Value<String> sessionId,
      Value<String> hostId,
      Value<String?> workspaceId,
      Value<String> name,
      Value<String> runtimeState,
      Value<String?> policyMode,
      Value<String?> modelSummary,
      Value<String?> thinkingLevel,
      Value<int> queueCount,
      Value<DateTime?> lastActivityAt,
      Value<String?> unreadState,
      Value<String?> controllerState,
      Value<int> rowid,
    });

class $$SessionEntriesTableFilterComposer
    extends Composer<_$AppDatabase, $SessionEntriesTable> {
  $$SessionEntriesTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get sessionId => $composableBuilder(
    column: $table.sessionId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get hostId => $composableBuilder(
    column: $table.hostId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get workspaceId => $composableBuilder(
    column: $table.workspaceId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get name => $composableBuilder(
    column: $table.name,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get runtimeState => $composableBuilder(
    column: $table.runtimeState,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get policyMode => $composableBuilder(
    column: $table.policyMode,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get modelSummary => $composableBuilder(
    column: $table.modelSummary,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get thinkingLevel => $composableBuilder(
    column: $table.thinkingLevel,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get queueCount => $composableBuilder(
    column: $table.queueCount,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get lastActivityAt => $composableBuilder(
    column: $table.lastActivityAt,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get unreadState => $composableBuilder(
    column: $table.unreadState,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get controllerState => $composableBuilder(
    column: $table.controllerState,
    builder: (column) => ColumnFilters(column),
  );
}

class $$SessionEntriesTableOrderingComposer
    extends Composer<_$AppDatabase, $SessionEntriesTable> {
  $$SessionEntriesTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get sessionId => $composableBuilder(
    column: $table.sessionId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get hostId => $composableBuilder(
    column: $table.hostId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get workspaceId => $composableBuilder(
    column: $table.workspaceId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get name => $composableBuilder(
    column: $table.name,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get runtimeState => $composableBuilder(
    column: $table.runtimeState,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get policyMode => $composableBuilder(
    column: $table.policyMode,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get modelSummary => $composableBuilder(
    column: $table.modelSummary,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get thinkingLevel => $composableBuilder(
    column: $table.thinkingLevel,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get queueCount => $composableBuilder(
    column: $table.queueCount,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get lastActivityAt => $composableBuilder(
    column: $table.lastActivityAt,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get unreadState => $composableBuilder(
    column: $table.unreadState,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get controllerState => $composableBuilder(
    column: $table.controllerState,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$SessionEntriesTableAnnotationComposer
    extends Composer<_$AppDatabase, $SessionEntriesTable> {
  $$SessionEntriesTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get sessionId =>
      $composableBuilder(column: $table.sessionId, builder: (column) => column);

  GeneratedColumn<String> get hostId =>
      $composableBuilder(column: $table.hostId, builder: (column) => column);

  GeneratedColumn<String> get workspaceId => $composableBuilder(
    column: $table.workspaceId,
    builder: (column) => column,
  );

  GeneratedColumn<String> get name =>
      $composableBuilder(column: $table.name, builder: (column) => column);

  GeneratedColumn<String> get runtimeState => $composableBuilder(
    column: $table.runtimeState,
    builder: (column) => column,
  );

  GeneratedColumn<String> get policyMode => $composableBuilder(
    column: $table.policyMode,
    builder: (column) => column,
  );

  GeneratedColumn<String> get modelSummary => $composableBuilder(
    column: $table.modelSummary,
    builder: (column) => column,
  );

  GeneratedColumn<String> get thinkingLevel => $composableBuilder(
    column: $table.thinkingLevel,
    builder: (column) => column,
  );

  GeneratedColumn<int> get queueCount => $composableBuilder(
    column: $table.queueCount,
    builder: (column) => column,
  );

  GeneratedColumn<DateTime> get lastActivityAt => $composableBuilder(
    column: $table.lastActivityAt,
    builder: (column) => column,
  );

  GeneratedColumn<String> get unreadState => $composableBuilder(
    column: $table.unreadState,
    builder: (column) => column,
  );

  GeneratedColumn<String> get controllerState => $composableBuilder(
    column: $table.controllerState,
    builder: (column) => column,
  );
}

class $$SessionEntriesTableTableManager
    extends
        RootTableManager<
          _$AppDatabase,
          $SessionEntriesTable,
          SessionEntry,
          $$SessionEntriesTableFilterComposer,
          $$SessionEntriesTableOrderingComposer,
          $$SessionEntriesTableAnnotationComposer,
          $$SessionEntriesTableCreateCompanionBuilder,
          $$SessionEntriesTableUpdateCompanionBuilder,
          (
            SessionEntry,
            BaseReferences<_$AppDatabase, $SessionEntriesTable, SessionEntry>,
          ),
          SessionEntry,
          PrefetchHooks Function()
        > {
  $$SessionEntriesTableTableManager(
    _$AppDatabase db,
    $SessionEntriesTable table,
  ) : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$SessionEntriesTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$SessionEntriesTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$SessionEntriesTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> sessionId = const Value.absent(),
                Value<String> hostId = const Value.absent(),
                Value<String?> workspaceId = const Value.absent(),
                Value<String> name = const Value.absent(),
                Value<String> runtimeState = const Value.absent(),
                Value<String?> policyMode = const Value.absent(),
                Value<String?> modelSummary = const Value.absent(),
                Value<String?> thinkingLevel = const Value.absent(),
                Value<int> queueCount = const Value.absent(),
                Value<DateTime?> lastActivityAt = const Value.absent(),
                Value<String?> unreadState = const Value.absent(),
                Value<String?> controllerState = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => SessionEntriesCompanion(
                sessionId: sessionId,
                hostId: hostId,
                workspaceId: workspaceId,
                name: name,
                runtimeState: runtimeState,
                policyMode: policyMode,
                modelSummary: modelSummary,
                thinkingLevel: thinkingLevel,
                queueCount: queueCount,
                lastActivityAt: lastActivityAt,
                unreadState: unreadState,
                controllerState: controllerState,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String sessionId,
                required String hostId,
                Value<String?> workspaceId = const Value.absent(),
                required String name,
                required String runtimeState,
                Value<String?> policyMode = const Value.absent(),
                Value<String?> modelSummary = const Value.absent(),
                Value<String?> thinkingLevel = const Value.absent(),
                Value<int> queueCount = const Value.absent(),
                Value<DateTime?> lastActivityAt = const Value.absent(),
                Value<String?> unreadState = const Value.absent(),
                Value<String?> controllerState = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => SessionEntriesCompanion.insert(
                sessionId: sessionId,
                hostId: hostId,
                workspaceId: workspaceId,
                name: name,
                runtimeState: runtimeState,
                policyMode: policyMode,
                modelSummary: modelSummary,
                thinkingLevel: thinkingLevel,
                queueCount: queueCount,
                lastActivityAt: lastActivityAt,
                unreadState: unreadState,
                controllerState: controllerState,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$SessionEntriesTableProcessedTableManager =
    ProcessedTableManager<
      _$AppDatabase,
      $SessionEntriesTable,
      SessionEntry,
      $$SessionEntriesTableFilterComposer,
      $$SessionEntriesTableOrderingComposer,
      $$SessionEntriesTableAnnotationComposer,
      $$SessionEntriesTableCreateCompanionBuilder,
      $$SessionEntriesTableUpdateCompanionBuilder,
      (
        SessionEntry,
        BaseReferences<_$AppDatabase, $SessionEntriesTable, SessionEntry>,
      ),
      SessionEntry,
      PrefetchHooks Function()
    >;
typedef $$CachedEventsTableCreateCompanionBuilder =
    CachedEventsCompanion Function({
      required String eventId,
      required String hostId,
      required String streamId,
      required String cursor,
      required String type,
      required String payloadJson,
      required DateTime occurredAt,
      required DateTime storedAt,
      Value<int> rowid,
    });
typedef $$CachedEventsTableUpdateCompanionBuilder =
    CachedEventsCompanion Function({
      Value<String> eventId,
      Value<String> hostId,
      Value<String> streamId,
      Value<String> cursor,
      Value<String> type,
      Value<String> payloadJson,
      Value<DateTime> occurredAt,
      Value<DateTime> storedAt,
      Value<int> rowid,
    });

class $$CachedEventsTableFilterComposer
    extends Composer<_$AppDatabase, $CachedEventsTable> {
  $$CachedEventsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get eventId => $composableBuilder(
    column: $table.eventId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get hostId => $composableBuilder(
    column: $table.hostId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get streamId => $composableBuilder(
    column: $table.streamId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get cursor => $composableBuilder(
    column: $table.cursor,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get type => $composableBuilder(
    column: $table.type,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get payloadJson => $composableBuilder(
    column: $table.payloadJson,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get occurredAt => $composableBuilder(
    column: $table.occurredAt,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get storedAt => $composableBuilder(
    column: $table.storedAt,
    builder: (column) => ColumnFilters(column),
  );
}

class $$CachedEventsTableOrderingComposer
    extends Composer<_$AppDatabase, $CachedEventsTable> {
  $$CachedEventsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get eventId => $composableBuilder(
    column: $table.eventId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get hostId => $composableBuilder(
    column: $table.hostId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get streamId => $composableBuilder(
    column: $table.streamId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get cursor => $composableBuilder(
    column: $table.cursor,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get type => $composableBuilder(
    column: $table.type,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get payloadJson => $composableBuilder(
    column: $table.payloadJson,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get occurredAt => $composableBuilder(
    column: $table.occurredAt,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get storedAt => $composableBuilder(
    column: $table.storedAt,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$CachedEventsTableAnnotationComposer
    extends Composer<_$AppDatabase, $CachedEventsTable> {
  $$CachedEventsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get eventId =>
      $composableBuilder(column: $table.eventId, builder: (column) => column);

  GeneratedColumn<String> get hostId =>
      $composableBuilder(column: $table.hostId, builder: (column) => column);

  GeneratedColumn<String> get streamId =>
      $composableBuilder(column: $table.streamId, builder: (column) => column);

  GeneratedColumn<String> get cursor =>
      $composableBuilder(column: $table.cursor, builder: (column) => column);

  GeneratedColumn<String> get type =>
      $composableBuilder(column: $table.type, builder: (column) => column);

  GeneratedColumn<String> get payloadJson => $composableBuilder(
    column: $table.payloadJson,
    builder: (column) => column,
  );

  GeneratedColumn<DateTime> get occurredAt => $composableBuilder(
    column: $table.occurredAt,
    builder: (column) => column,
  );

  GeneratedColumn<DateTime> get storedAt =>
      $composableBuilder(column: $table.storedAt, builder: (column) => column);
}

class $$CachedEventsTableTableManager
    extends
        RootTableManager<
          _$AppDatabase,
          $CachedEventsTable,
          CachedEvent,
          $$CachedEventsTableFilterComposer,
          $$CachedEventsTableOrderingComposer,
          $$CachedEventsTableAnnotationComposer,
          $$CachedEventsTableCreateCompanionBuilder,
          $$CachedEventsTableUpdateCompanionBuilder,
          (
            CachedEvent,
            BaseReferences<_$AppDatabase, $CachedEventsTable, CachedEvent>,
          ),
          CachedEvent,
          PrefetchHooks Function()
        > {
  $$CachedEventsTableTableManager(_$AppDatabase db, $CachedEventsTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$CachedEventsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$CachedEventsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$CachedEventsTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> eventId = const Value.absent(),
                Value<String> hostId = const Value.absent(),
                Value<String> streamId = const Value.absent(),
                Value<String> cursor = const Value.absent(),
                Value<String> type = const Value.absent(),
                Value<String> payloadJson = const Value.absent(),
                Value<DateTime> occurredAt = const Value.absent(),
                Value<DateTime> storedAt = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => CachedEventsCompanion(
                eventId: eventId,
                hostId: hostId,
                streamId: streamId,
                cursor: cursor,
                type: type,
                payloadJson: payloadJson,
                occurredAt: occurredAt,
                storedAt: storedAt,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String eventId,
                required String hostId,
                required String streamId,
                required String cursor,
                required String type,
                required String payloadJson,
                required DateTime occurredAt,
                required DateTime storedAt,
                Value<int> rowid = const Value.absent(),
              }) => CachedEventsCompanion.insert(
                eventId: eventId,
                hostId: hostId,
                streamId: streamId,
                cursor: cursor,
                type: type,
                payloadJson: payloadJson,
                occurredAt: occurredAt,
                storedAt: storedAt,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$CachedEventsTableProcessedTableManager =
    ProcessedTableManager<
      _$AppDatabase,
      $CachedEventsTable,
      CachedEvent,
      $$CachedEventsTableFilterComposer,
      $$CachedEventsTableOrderingComposer,
      $$CachedEventsTableAnnotationComposer,
      $$CachedEventsTableCreateCompanionBuilder,
      $$CachedEventsTableUpdateCompanionBuilder,
      (
        CachedEvent,
        BaseReferences<_$AppDatabase, $CachedEventsTable, CachedEvent>,
      ),
      CachedEvent,
      PrefetchHooks Function()
    >;
typedef $$SnapshotEntriesTableCreateCompanionBuilder =
    SnapshotEntriesCompanion Function({
      required String streamId,
      required String hostId,
      required String baselineCursor,
      required String snapshotId,
      required String payloadJson,
      required DateTime receivedAt,
      Value<int> rowid,
    });
typedef $$SnapshotEntriesTableUpdateCompanionBuilder =
    SnapshotEntriesCompanion Function({
      Value<String> streamId,
      Value<String> hostId,
      Value<String> baselineCursor,
      Value<String> snapshotId,
      Value<String> payloadJson,
      Value<DateTime> receivedAt,
      Value<int> rowid,
    });

class $$SnapshotEntriesTableFilterComposer
    extends Composer<_$AppDatabase, $SnapshotEntriesTable> {
  $$SnapshotEntriesTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get streamId => $composableBuilder(
    column: $table.streamId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get hostId => $composableBuilder(
    column: $table.hostId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get baselineCursor => $composableBuilder(
    column: $table.baselineCursor,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get snapshotId => $composableBuilder(
    column: $table.snapshotId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get payloadJson => $composableBuilder(
    column: $table.payloadJson,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get receivedAt => $composableBuilder(
    column: $table.receivedAt,
    builder: (column) => ColumnFilters(column),
  );
}

class $$SnapshotEntriesTableOrderingComposer
    extends Composer<_$AppDatabase, $SnapshotEntriesTable> {
  $$SnapshotEntriesTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get streamId => $composableBuilder(
    column: $table.streamId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get hostId => $composableBuilder(
    column: $table.hostId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get baselineCursor => $composableBuilder(
    column: $table.baselineCursor,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get snapshotId => $composableBuilder(
    column: $table.snapshotId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get payloadJson => $composableBuilder(
    column: $table.payloadJson,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get receivedAt => $composableBuilder(
    column: $table.receivedAt,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$SnapshotEntriesTableAnnotationComposer
    extends Composer<_$AppDatabase, $SnapshotEntriesTable> {
  $$SnapshotEntriesTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get streamId =>
      $composableBuilder(column: $table.streamId, builder: (column) => column);

  GeneratedColumn<String> get hostId =>
      $composableBuilder(column: $table.hostId, builder: (column) => column);

  GeneratedColumn<String> get baselineCursor => $composableBuilder(
    column: $table.baselineCursor,
    builder: (column) => column,
  );

  GeneratedColumn<String> get snapshotId => $composableBuilder(
    column: $table.snapshotId,
    builder: (column) => column,
  );

  GeneratedColumn<String> get payloadJson => $composableBuilder(
    column: $table.payloadJson,
    builder: (column) => column,
  );

  GeneratedColumn<DateTime> get receivedAt => $composableBuilder(
    column: $table.receivedAt,
    builder: (column) => column,
  );
}

class $$SnapshotEntriesTableTableManager
    extends
        RootTableManager<
          _$AppDatabase,
          $SnapshotEntriesTable,
          SnapshotEntry,
          $$SnapshotEntriesTableFilterComposer,
          $$SnapshotEntriesTableOrderingComposer,
          $$SnapshotEntriesTableAnnotationComposer,
          $$SnapshotEntriesTableCreateCompanionBuilder,
          $$SnapshotEntriesTableUpdateCompanionBuilder,
          (
            SnapshotEntry,
            BaseReferences<_$AppDatabase, $SnapshotEntriesTable, SnapshotEntry>,
          ),
          SnapshotEntry,
          PrefetchHooks Function()
        > {
  $$SnapshotEntriesTableTableManager(
    _$AppDatabase db,
    $SnapshotEntriesTable table,
  ) : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$SnapshotEntriesTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$SnapshotEntriesTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$SnapshotEntriesTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> streamId = const Value.absent(),
                Value<String> hostId = const Value.absent(),
                Value<String> baselineCursor = const Value.absent(),
                Value<String> snapshotId = const Value.absent(),
                Value<String> payloadJson = const Value.absent(),
                Value<DateTime> receivedAt = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => SnapshotEntriesCompanion(
                streamId: streamId,
                hostId: hostId,
                baselineCursor: baselineCursor,
                snapshotId: snapshotId,
                payloadJson: payloadJson,
                receivedAt: receivedAt,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String streamId,
                required String hostId,
                required String baselineCursor,
                required String snapshotId,
                required String payloadJson,
                required DateTime receivedAt,
                Value<int> rowid = const Value.absent(),
              }) => SnapshotEntriesCompanion.insert(
                streamId: streamId,
                hostId: hostId,
                baselineCursor: baselineCursor,
                snapshotId: snapshotId,
                payloadJson: payloadJson,
                receivedAt: receivedAt,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$SnapshotEntriesTableProcessedTableManager =
    ProcessedTableManager<
      _$AppDatabase,
      $SnapshotEntriesTable,
      SnapshotEntry,
      $$SnapshotEntriesTableFilterComposer,
      $$SnapshotEntriesTableOrderingComposer,
      $$SnapshotEntriesTableAnnotationComposer,
      $$SnapshotEntriesTableCreateCompanionBuilder,
      $$SnapshotEntriesTableUpdateCompanionBuilder,
      (
        SnapshotEntry,
        BaseReferences<_$AppDatabase, $SnapshotEntriesTable, SnapshotEntry>,
      ),
      SnapshotEntry,
      PrefetchHooks Function()
    >;
typedef $$DraftEntriesTableCreateCompanionBuilder =
    DraftEntriesCompanion Function({
      required String hostId,
      required String sessionId,
      Value<String> draftText,
      Value<String> localAttachmentRefsJson,
      Value<String?> selectedDeliveryMode,
      Value<String?> pendingCommandId,
      Value<String?> pendingPayloadJson,
      Value<String?> pendingState,
      required DateTime updatedAt,
      Value<int> rowid,
    });
typedef $$DraftEntriesTableUpdateCompanionBuilder =
    DraftEntriesCompanion Function({
      Value<String> hostId,
      Value<String> sessionId,
      Value<String> draftText,
      Value<String> localAttachmentRefsJson,
      Value<String?> selectedDeliveryMode,
      Value<String?> pendingCommandId,
      Value<String?> pendingPayloadJson,
      Value<String?> pendingState,
      Value<DateTime> updatedAt,
      Value<int> rowid,
    });

class $$DraftEntriesTableFilterComposer
    extends Composer<_$AppDatabase, $DraftEntriesTable> {
  $$DraftEntriesTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get hostId => $composableBuilder(
    column: $table.hostId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get sessionId => $composableBuilder(
    column: $table.sessionId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get draftText => $composableBuilder(
    column: $table.draftText,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get localAttachmentRefsJson => $composableBuilder(
    column: $table.localAttachmentRefsJson,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get selectedDeliveryMode => $composableBuilder(
    column: $table.selectedDeliveryMode,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get pendingCommandId => $composableBuilder(
    column: $table.pendingCommandId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get pendingPayloadJson => $composableBuilder(
    column: $table.pendingPayloadJson,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get pendingState => $composableBuilder(
    column: $table.pendingState,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get updatedAt => $composableBuilder(
    column: $table.updatedAt,
    builder: (column) => ColumnFilters(column),
  );
}

class $$DraftEntriesTableOrderingComposer
    extends Composer<_$AppDatabase, $DraftEntriesTable> {
  $$DraftEntriesTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get hostId => $composableBuilder(
    column: $table.hostId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get sessionId => $composableBuilder(
    column: $table.sessionId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get draftText => $composableBuilder(
    column: $table.draftText,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get localAttachmentRefsJson => $composableBuilder(
    column: $table.localAttachmentRefsJson,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get selectedDeliveryMode => $composableBuilder(
    column: $table.selectedDeliveryMode,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get pendingCommandId => $composableBuilder(
    column: $table.pendingCommandId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get pendingPayloadJson => $composableBuilder(
    column: $table.pendingPayloadJson,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get pendingState => $composableBuilder(
    column: $table.pendingState,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get updatedAt => $composableBuilder(
    column: $table.updatedAt,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$DraftEntriesTableAnnotationComposer
    extends Composer<_$AppDatabase, $DraftEntriesTable> {
  $$DraftEntriesTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get hostId =>
      $composableBuilder(column: $table.hostId, builder: (column) => column);

  GeneratedColumn<String> get sessionId =>
      $composableBuilder(column: $table.sessionId, builder: (column) => column);

  GeneratedColumn<String> get draftText =>
      $composableBuilder(column: $table.draftText, builder: (column) => column);

  GeneratedColumn<String> get localAttachmentRefsJson => $composableBuilder(
    column: $table.localAttachmentRefsJson,
    builder: (column) => column,
  );

  GeneratedColumn<String> get selectedDeliveryMode => $composableBuilder(
    column: $table.selectedDeliveryMode,
    builder: (column) => column,
  );

  GeneratedColumn<String> get pendingCommandId => $composableBuilder(
    column: $table.pendingCommandId,
    builder: (column) => column,
  );

  GeneratedColumn<String> get pendingPayloadJson => $composableBuilder(
    column: $table.pendingPayloadJson,
    builder: (column) => column,
  );

  GeneratedColumn<String> get pendingState => $composableBuilder(
    column: $table.pendingState,
    builder: (column) => column,
  );

  GeneratedColumn<DateTime> get updatedAt =>
      $composableBuilder(column: $table.updatedAt, builder: (column) => column);
}

class $$DraftEntriesTableTableManager
    extends
        RootTableManager<
          _$AppDatabase,
          $DraftEntriesTable,
          DraftEntry,
          $$DraftEntriesTableFilterComposer,
          $$DraftEntriesTableOrderingComposer,
          $$DraftEntriesTableAnnotationComposer,
          $$DraftEntriesTableCreateCompanionBuilder,
          $$DraftEntriesTableUpdateCompanionBuilder,
          (
            DraftEntry,
            BaseReferences<_$AppDatabase, $DraftEntriesTable, DraftEntry>,
          ),
          DraftEntry,
          PrefetchHooks Function()
        > {
  $$DraftEntriesTableTableManager(_$AppDatabase db, $DraftEntriesTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$DraftEntriesTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$DraftEntriesTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$DraftEntriesTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> hostId = const Value.absent(),
                Value<String> sessionId = const Value.absent(),
                Value<String> draftText = const Value.absent(),
                Value<String> localAttachmentRefsJson = const Value.absent(),
                Value<String?> selectedDeliveryMode = const Value.absent(),
                Value<String?> pendingCommandId = const Value.absent(),
                Value<String?> pendingPayloadJson = const Value.absent(),
                Value<String?> pendingState = const Value.absent(),
                Value<DateTime> updatedAt = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => DraftEntriesCompanion(
                hostId: hostId,
                sessionId: sessionId,
                draftText: draftText,
                localAttachmentRefsJson: localAttachmentRefsJson,
                selectedDeliveryMode: selectedDeliveryMode,
                pendingCommandId: pendingCommandId,
                pendingPayloadJson: pendingPayloadJson,
                pendingState: pendingState,
                updatedAt: updatedAt,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String hostId,
                required String sessionId,
                Value<String> draftText = const Value.absent(),
                Value<String> localAttachmentRefsJson = const Value.absent(),
                Value<String?> selectedDeliveryMode = const Value.absent(),
                Value<String?> pendingCommandId = const Value.absent(),
                Value<String?> pendingPayloadJson = const Value.absent(),
                Value<String?> pendingState = const Value.absent(),
                required DateTime updatedAt,
                Value<int> rowid = const Value.absent(),
              }) => DraftEntriesCompanion.insert(
                hostId: hostId,
                sessionId: sessionId,
                draftText: draftText,
                localAttachmentRefsJson: localAttachmentRefsJson,
                selectedDeliveryMode: selectedDeliveryMode,
                pendingCommandId: pendingCommandId,
                pendingPayloadJson: pendingPayloadJson,
                pendingState: pendingState,
                updatedAt: updatedAt,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$DraftEntriesTableProcessedTableManager =
    ProcessedTableManager<
      _$AppDatabase,
      $DraftEntriesTable,
      DraftEntry,
      $$DraftEntriesTableFilterComposer,
      $$DraftEntriesTableOrderingComposer,
      $$DraftEntriesTableAnnotationComposer,
      $$DraftEntriesTableCreateCompanionBuilder,
      $$DraftEntriesTableUpdateCompanionBuilder,
      (
        DraftEntry,
        BaseReferences<_$AppDatabase, $DraftEntriesTable, DraftEntry>,
      ),
      DraftEntry,
      PrefetchHooks Function()
    >;

class $AppDatabaseManager {
  final _$AppDatabase _db;
  $AppDatabaseManager(this._db);
  $$MetadataEntriesTableTableManager get metadataEntries =>
      $$MetadataEntriesTableTableManager(_db, _db.metadataEntries);
  $$HostEntriesTableTableManager get hostEntries =>
      $$HostEntriesTableTableManager(_db, _db.hostEntries);
  $$StreamCursorsTableTableManager get streamCursors =>
      $$StreamCursorsTableTableManager(_db, _db.streamCursors);
  $$SessionEntriesTableTableManager get sessionEntries =>
      $$SessionEntriesTableTableManager(_db, _db.sessionEntries);
  $$CachedEventsTableTableManager get cachedEvents =>
      $$CachedEventsTableTableManager(_db, _db.cachedEvents);
  $$SnapshotEntriesTableTableManager get snapshotEntries =>
      $$SnapshotEntriesTableTableManager(_db, _db.snapshotEntries);
  $$DraftEntriesTableTableManager get draftEntries =>
      $$DraftEntriesTableTableManager(_db, _db.draftEntries);
}
