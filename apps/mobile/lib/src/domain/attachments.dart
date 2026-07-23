// M13 — Draft attachment references.
//
// This file defines the value-type model for the bounded set of image
// attachments a user can attach to a single prompt draft. It does *not* own
// the upload transport; that is a later milestone. The scope here is the
// durable local bookkeeping the composer and the bridge coordinator need to:
//
//   * show the user which draft attachments are pending, uploading, ready,
//     failed, expired, or have been replaced/removed;
//   * enforce hard per-draft limits (count, bytes, dimensions) before a
//     reference is admitted into the registry;
//   * carry the attachment IDs through the durable draft so reconnecting
//     after a host generation reset preserves the user's composition;
//   * build the `attachmentIds` array that ships with `prompt.submit` without
//     any URL materialisation — the IDs are opaque tokens resolved by the
//     host at the dispatch boundary (M13-05).
//
// Every helper that mutates state returns a new [AttachmentRef] or a new
// collection. Nothing in this file schedules network work, opens files, or
// auto-sends anything; the registry is a pure state machine the coordinator
// drives.

import 'dart:convert';
import 'dart:typed_data';

/// Bounded limits for a single prompt draft.
///
/// The values mirror the M13-01 picker validation rules and the M13-04
/// "prompt attachment availability" rule. They are intentionally
/// compile-time constants so tests, the database layer, and the future
/// picker can share the same numbers without an injected configuration.
class AttachmentLimits {
  const AttachmentLimits._();

  /// Maximum number of attachment references a single draft may hold.
  static const int maxCount = 4;

  /// Hard cap on the sum of every attachment's `sizeBytes` per draft.
  static const int maxTotalBytes = 25 * 1024 * 1024;

  /// Hard cap on any single attachment's `sizeBytes`.
  static const int maxSingleBytes = 10 * 1024 * 1024;

  /// Largest accepted pixel dimension on either axis. Anything bigger is
  /// rejected before the reference enters the registry.
  static const int maxDimension = 4096;

  /// Default lifetime for a draft attachment reference. The reference
  /// becomes `expired` after [now] is past `createdAt + ttl` and is removed
  /// from the active draft on the next expiry sweep. The user is never
  /// silently resent the same image; expiry only changes the local state.
  static const Duration defaultTtl = Duration(hours: 24);

  /// Wire-level mime type whitelist. Anything else is rejected at admission
  /// time so the registry can never accumulate a non-image reference.
  static const Set<String> allowedMimeTypes = <String>{
    'image/jpeg',
    'image/png',
  };

  /// Magic-byte prefixes the validator recognises. The list is exhaustive
  /// and intentionally tiny: the picker produces JPEG/PNG only.
  static const List<int> jpegMagic = <int>[0xFF, 0xD8, 0xFF];
  static const List<int> pngMagic = <int>[
    0x89,
    0x50,
    0x4E,
    0x47,
    0x0D,
    0x0A,
    0x1A,
    0x0A,
  ];
}

/// Coarse kind bucket. Kept as a small enum (rather than a free-form string)
/// so the registry and the database can switch on it without parsing the
/// mime type and so an attacker-supplied filename cannot widen the kind.
enum AttachmentKind {
  imageJpeg,
  imagePng;

  /// Canonical mime type associated with this kind.
  String get mimeType => switch (this) {
    AttachmentKind.imageJpeg => 'image/jpeg',
    AttachmentKind.imagePng => 'image/png',
  };

  /// File extension hint used when the host has to materialise a temporary
  /// name. Never used to build a URL.
  String get extension => switch (this) {
    AttachmentKind.imageJpeg => 'jpg',
    AttachmentKind.imagePng => 'png',
  };

  static AttachmentKind fromMimeType(String mime) {
    switch (mime.toLowerCase()) {
      case 'image/jpeg':
      case 'image/jpg':
        return AttachmentKind.imageJpeg;
      case 'image/png':
        return AttachmentKind.imagePng;
      default:
        throw ArgumentError.value(mime, 'mime', 'Unsupported attachment kind');
    }
  }
}

/// Lifecycle state of a single draft attachment reference.
///
/// The transitions are owned by [AttachmentRegistry] and the database
/// adapter; the enum never carries user input, only machine-decided state.
enum AttachmentStatus {
  /// Admitted to the registry; bytes not yet handed to an uploader.
  pending,

  /// The uploader has the bytes and is in flight. The reference is still
  /// counted against the draft's quota and the prompt payload.
  uploading,

  /// The host has acknowledged the upload and the ID can be referenced from
  /// a `prompt.submit`. Only `ready` IDs go into the wire payload.
  ready,

  /// The most recent upload attempt failed. The reference stays in the
  /// registry so the user can retry, replace, or remove it. The wire
  /// payload never carries a `failed` ID.
  failed,

  /// The TTL elapsed (or a forced sweep ran) and the reference is no longer
  /// available. Expired references are not referenced from any wire payload
  /// and are removed from the active draft on the next coordinator sweep.
  expired,

  /// The reference was superseded by a replace operation. The host may still
  /// have a copy of the bytes; the mobile client forgets the local state.
  replaced,

  /// The user explicitly removed the reference. The registry does not
  /// retain removed entries; the value is preserved here only for tests and
  /// for the database row that records the removal timestamp.
  removed,
}

/// Immutable value type for a single draft attachment reference.
///
/// The class is intentionally a plain data holder: equality is structural so
/// callers can deduplicate by `id` cheaply, and [copyWith] is the only way to
/// transition state.
class AttachmentRef {
  AttachmentRef({
    required this.id,
    required this.kind,
    required this.filename,
    required this.sizeBytes,
    required this.mimeType,
    required this.status,
    required this.createdAt,
    required this.expiresAt,
    this.localPath,
    this.uploadAttempt = 0,
    this.lastError,
    this.sha256,
    this.width,
    this.height,
  }) : assert(id.isNotEmpty, 'Attachment id must be non-empty'),
       assert(filename.isNotEmpty, 'Attachment filename must be non-empty'),
       assert(sizeBytes >= 0, 'Attachment size must be non-negative');

  /// Stable opaque ID minted by the mobile client. Used as the
  /// `attachmentIds` value in the `prompt.submit` payload.
  final String id;
  final AttachmentKind kind;
  final String filename;
  final int sizeBytes;
  final String mimeType;
  final AttachmentStatus status;

  /// Local on-device path the picker produced. The host never sees this.
  final String? localPath;

  /// Number of upload attempts so far. Bumped on every failed → retry
  /// transition. The coordinator never auto-sends on retry; the user
  /// remains in control.
  final int uploadAttempt;
  final String? lastError;
  final DateTime createdAt;
  final DateTime expiresAt;
  final String? sha256;
  final int? width;
  final int? height;

  bool get isReady => status == AttachmentStatus.ready;
  bool get isUsable =>
      status == AttachmentStatus.ready ||
      status == AttachmentStatus.pending ||
      status == AttachmentStatus.uploading ||
      status == AttachmentStatus.failed;

  /// True when the reference is past its expiry instant.
  bool isExpiredAt(DateTime now) => !expiresAt.isAfter(now);

  AttachmentRef copyWith({
    AttachmentStatus? status,
    String? localPath,
    int? uploadAttempt,
    String? lastError,
    DateTime? expiresAt,
    String? sha256,
    int? width,
    int? height,
  }) {
    return AttachmentRef(
      id: id,
      kind: kind,
      filename: filename,
      sizeBytes: sizeBytes,
      mimeType: mimeType,
      status: status ?? this.status,
      createdAt: createdAt,
      expiresAt: expiresAt ?? this.expiresAt,
      localPath: localPath ?? this.localPath,
      uploadAttempt: uploadAttempt ?? this.uploadAttempt,
      lastError: lastError ?? this.lastError,
      sha256: sha256 ?? this.sha256,
      width: width ?? this.width,
      height: height ?? this.height,
    );
  }

  Map<String, Object?> toJson() => <String, Object?>{
    'id': id,
    'kind': kind.name,
    'filename': filename,
    'sizeBytes': sizeBytes,
    'mimeType': mimeType,
    'status': status.name,
    'localPath': localPath,
    'uploadAttempt': uploadAttempt,
    'lastError': lastError,
    'createdAt': createdAt.toUtc().toIso8601String(),
    'expiresAt': expiresAt.toUtc().toIso8601String(),
    'sha256': sha256,
    'width': width,
    'height': height,
  };

  static AttachmentRef fromJson(Map<String, Object?> json) {
    final kindName = json['kind'] as String?;
    final statusName = json['status'] as String?;
    if (kindName == null) {
      throw const FormatException('Attachment kind missing');
    }
    if (statusName == null) {
      throw const FormatException('Attachment status missing');
    }
    final created = DateTime.tryParse(json['createdAt'] as String? ?? '');
    final expires = DateTime.tryParse(json['expiresAt'] as String? ?? '');
    if (created == null || expires == null) {
      throw const FormatException('Attachment timestamps missing or malformed');
    }
    return AttachmentRef(
      id: json['id'] as String,
      kind: AttachmentKind.values.byName(kindName),
      filename: json['filename'] as String,
      sizeBytes: (json['sizeBytes'] as num).toInt(),
      mimeType: json['mimeType'] as String,
      status: AttachmentStatus.values.byName(statusName),
      createdAt: created.toUtc(),
      expiresAt: expires.toUtc(),
      localPath: json['localPath'] as String?,
      uploadAttempt: (json['uploadAttempt'] as num?)?.toInt() ?? 0,
      lastError: json['lastError'] as String?,
      sha256: json['sha256'] as String?,
      width: (json['width'] as num?)?.toInt(),
      height: (json['height'] as num?)?.toInt(),
    );
  }
}

/// Result type for [AttachmentValidation] checks. Either [ok] or a single
/// rejection reason. The validator never throws for size, count, or magic
/// failures — it returns a structured result the caller can show to the
/// user and the test can assert on.
class AttachmentValidationResult {
  const AttachmentValidationResult._(this.isOk, this.reason);

  factory AttachmentValidationResult.ok() =>
      const AttachmentValidationResult._(true, null);
  factory AttachmentValidationResult.reject(String reason) =>
      AttachmentValidationResult._(false, reason);

  final bool isOk;
  final String? reason;

  static final AttachmentValidationResult okSingleton =
      AttachmentValidationResult.ok();
}

/// Pure validators. None of these touch the file system — magic-byte and
/// size checks are driven from already-loaded bytes / metadata.
class AttachmentValidation {
  const AttachmentValidation._();

  /// Returns ok() if [head] starts with the JPEG or PNG magic-byte sequence,
  /// reject() otherwise. Empty input is rejected.
  static AttachmentValidationResult validateMagic(List<int> head) {
    if (head.isEmpty) {
      return AttachmentValidationResult.reject('Attachment bytes are empty');
    }
    final jpeg = AttachmentLimits.jpegMagic;
    final png = AttachmentLimits.pngMagic;
    if (head.length >= jpeg.length) {
      var match = true;
      for (var i = 0; i < jpeg.length; i++) {
        if (head[i] != jpeg[i]) {
          match = false;
          break;
        }
      }
      if (match) return AttachmentValidationResult.ok();
    }
    if (head.length >= png.length) {
      var match = true;
      for (var i = 0; i < png.length; i++) {
        if (head[i] != png[i]) {
          match = false;
          break;
        }
      }
      if (match) return AttachmentValidationResult.ok();
    }
    return AttachmentValidationResult.reject(
      'Attachment magic bytes are not JPEG or PNG',
    );
  }

  /// Returns ok() when [sizeBytes] is within the per-attachment cap, else
  /// reject().
  static AttachmentValidationResult validateSize(int sizeBytes) {
    if (sizeBytes < 0) {
      return AttachmentValidationResult.reject('Attachment size is negative');
    }
    if (sizeBytes == 0) {
      return AttachmentValidationResult.reject('Attachment is empty');
    }
    if (sizeBytes > AttachmentLimits.maxSingleBytes) {
      return AttachmentValidationResult.reject(
        'Attachment exceeds per-file size cap',
      );
    }
    return AttachmentValidationResult.ok();
  }

  /// Returns ok() when adding [incoming] to the existing list stays within
  /// both the count and the total-byte caps.
  static AttachmentValidationResult validateDraftQuota({
    required List<AttachmentRef> existing,
    required AttachmentRef incoming,
  }) {
    if (existing.length >= AttachmentLimits.maxCount) {
      return AttachmentValidationResult.reject(
        'Draft is at the maximum attachment count',
      );
    }
    final projected =
        existing.fold<int>(0, (acc, ref) => acc + ref.sizeBytes) +
        incoming.sizeBytes;
    if (projected > AttachmentLimits.maxTotalBytes) {
      return AttachmentValidationResult.reject(
        'Draft would exceed the total attachment byte cap',
      );
    }
    return AttachmentValidationResult.ok();
  }

  /// Returns ok() when [width] and [height] (when supplied) are within the
  /// accepted dimension envelope. Null dimensions are tolerated; the host
  /// will re-validate.
  static AttachmentValidationResult validateDimensions({
    required int? width,
    required int? height,
  }) {
    if (width == null || height == null) return AttachmentValidationResult.ok();
    if (width <= 0 || height <= 0) {
      return AttachmentValidationResult.reject(
        'Attachment dimensions are not positive',
      );
    }
    if (width > AttachmentLimits.maxDimension ||
        height > AttachmentLimits.maxDimension) {
      return AttachmentValidationResult.reject(
        'Attachment dimensions exceed the per-side cap',
      );
    }
    return AttachmentValidationResult.ok();
  }
}

/// In-memory state machine for a single draft's attachment list.
///
/// The registry is intentionally a thin wrapper over an ordered list of
/// [AttachmentRef]. It enforces the invariants the coordinator relies on:
///
///   * IDs are unique inside the list.
///   * `replace(old, new)` only succeeds when [old] is present and the new
///     reference passes the same validation a fresh `add` would.
///   * `expireStale(now)` flips matching entries to [AttachmentStatus.expired]
///     and drops them from the active list. Expiry never triggers a send.
///   * `idsReady()` returns the IDs the wire payload should reference, in
///     the original order. Failed / uploading / expired / replaced IDs are
///     never returned.
class AttachmentRegistry {
  AttachmentRegistry({List<AttachmentRef> initial = const <AttachmentRef>[]})
    : _items = List<AttachmentRef>.of(initial, growable: false);

  final List<AttachmentRef> _items;

  /// Read-only view. Callers must not mutate.
  List<AttachmentRef> get items => List<AttachmentRef>.unmodifiable(_items);

  int get length => _items.length;
  bool get isEmpty => _items.isEmpty;
  bool get isNotEmpty => _items.isNotEmpty;

  /// True when the registry has at least one [AttachmentStatus.ready] entry.
  bool get hasReady => _items.any((ref) => ref.isReady);

  /// IDs in insertion order, filtered to statuses the wire payload may carry.
  /// Failed, expired, and replaced entries are excluded.
  List<String> idsReady() => _items
      .where((ref) => ref.isReady)
      .map((ref) => ref.id)
      .toList(growable: false);

  /// Returns the entry for [id] or `null` when not present.
  AttachmentRef? byId(String id) {
    for (final ref in _items) {
      if (ref.id == id) return ref;
    }
    return null;
  }

  /// Admit [incoming] when it passes the draft-quota validation. Returns the
  /// new registry; on rejection the original registry is returned and the
  /// reason is reported via [rejection].
  AddResult add(AttachmentRef incoming) {
    if (byId(incoming.id) != null) {
      return AddResult._(
        registry: this,
        rejection: 'Attachment id already present',
      );
    }
    final quota = AttachmentValidation.validateDraftQuota(
      existing: _items,
      incoming: incoming,
    );
    if (!quota.isOk) {
      return AddResult._(registry: this, rejection: quota.reason);
    }
    return AddResult._(
      registry: AttachmentRegistry(
        initial: <AttachmentRef>[..._items, incoming],
      ),
    );
  }

  /// Returns a new registry with the entry for [id] marked [removed]. If
  /// [id] is not present the original registry is returned unchanged.
  AttachmentRegistry remove(String id) {
    final kept = <AttachmentRef>[];
    var found = false;
    for (final ref in _items) {
      if (ref.id == id) {
        found = true;
        continue;
      }
      kept.add(ref);
    }
    if (!found) return this;
    return AttachmentRegistry(initial: kept);
  }

  /// Atomically replace [oldId] with [incoming]. The new reference must
  /// satisfy the draft-quota rule using the *surviving* entries as the
  /// baseline. If [oldId] is not present the call is equivalent to [add].
  ReplaceResult replace({
    required String oldId,
    required AttachmentRef incoming,
  }) {
    final existingIndex = _items.indexWhere((ref) => ref.id == oldId);
    if (existingIndex < 0) {
      final added = add(incoming);
      return ReplaceResult._(
        registry: added.registry,
        rejection: added.rejection,
      );
    }
    final baseline = <AttachmentRef>[
      for (var i = 0; i < _items.length; i++)
        if (i != existingIndex) _items[i],
    ];
    final quota = AttachmentValidation.validateDraftQuota(
      existing: baseline,
      incoming: incoming,
    );
    if (!quota.isOk) {
      return ReplaceResult._(registry: this, rejection: quota.reason);
    }
    final next = <AttachmentRef>[...baseline];
    next.insert(existingIndex, incoming);
    return ReplaceResult._(registry: AttachmentRegistry(initial: next));
  }

  /// Returns a new registry with the matching entry transitioned to
  /// [status]. Bumps `uploadAttempt` by one when [bumpAttempt] is true.
  /// If no entry matches [id] the original registry is returned.
  AttachmentRegistry markStatus(
    String id,
    AttachmentStatus status, {
    String? lastError,
    bool bumpAttempt = false,
  }) {
    var changed = false;
    final next = <AttachmentRef>[];
    for (final ref in _items) {
      if (ref.id == id) {
        changed = true;
        next.add(
          ref.copyWith(
            status: status,
            lastError: lastError,
            uploadAttempt: bumpAttempt ? ref.uploadAttempt + 1 : null,
          ),
        );
      } else {
        next.add(ref);
      }
    }
    if (!changed) return this;
    return AttachmentRegistry(initial: next);
  }

  /// Mark any entry whose `expiresAt` is at or before [now] as expired, then
  /// drop expired entries from the active list. The returned registry only
  /// contains live (or non-expired) entries. The original registry is
  /// returned unchanged when nothing was stale.
  ExpireResult expireStale(DateTime now) {
    final expiredIds = <String>[];
    for (final ref in _items) {
      if (ref.isExpiredAt(now)) {
        expiredIds.add(ref.id);
      }
    }
    if (expiredIds.isEmpty) {
      return ExpireResult._(registry: this, expiredIds: const <String>[]);
    }
    final kept = <AttachmentRef>[];
    for (final ref in _items) {
      if (expiredIds.contains(ref.id)) continue;
      kept.add(ref);
    }
    return ExpireResult._(
      registry: AttachmentRegistry(initial: kept),
      expiredIds: List<String>.unmodifiable(expiredIds),
    );
  }

  /// Encode the current list as a JSON array. The order matches
  /// [idsReady] / [items].
  String encodeJson() =>
      jsonEncode(_items.map((ref) => ref.toJson()).toList(growable: false));

  static List<AttachmentRef> decodeJsonList(String? encoded) {
    if (encoded == null || encoded.isEmpty) return const <AttachmentRef>[];
    final decoded = jsonDecode(encoded);
    if (decoded is! List) return const <AttachmentRef>[];
    return decoded
        .whereType<Map>()
        .map((raw) => AttachmentRef.fromJson(Map<String, Object?>.from(raw)))
        .toList(growable: false);
  }
}

class AddResult {
  const AddResult._({required this.registry, this.rejection});
  final AttachmentRegistry registry;
  final String? rejection;
  bool get isAccepted => rejection == null;
}

class ReplaceResult {
  const ReplaceResult._({required this.registry, this.rejection});
  final AttachmentRegistry registry;
  final String? rejection;
  bool get isAccepted => rejection == null;
}

class ExpireResult {
  const ExpireResult._({required this.registry, required this.expiredIds});
  final AttachmentRegistry registry;
  final List<String> expiredIds;
}

/// Best-effort PNG / JPEG dimension probe. Returns `null` when the bytes
/// are unparseable so callers can still accept the reference; the host
/// re-validates with a real decoder at the dispatch boundary.
class AttachmentDimensions {
  const AttachmentDimensions._();

  static (int, int)? probe(Uint8List bytes, AttachmentKind kind) {
    switch (kind) {
      case AttachmentKind.imageJpeg:
        return _probeJpeg(bytes);
      case AttachmentKind.imagePng:
        return _probePng(bytes);
    }
  }

  static (int, int)? _probeJpeg(Uint8List bytes) {
    if (bytes.length < 4) return null;
    if (bytes[0] != 0xFF || bytes[1] != 0xD8 || bytes[2] != 0xFF) {
      return null;
    }
    var i = 2;
    while (i + 8 < bytes.length) {
      if (bytes[i] != 0xFF) {
        i += 1;
        continue;
      }
      final marker = bytes[i + 1];
      // SOF markers carry the dimensions. Exclude the DHT (0xC0) confusion
      // by matching only the documented SOFn range (0xC0..0xCF except C4, C8, CC).
      if (marker >= 0xC0 &&
          marker <= 0xCF &&
          marker != 0xC4 &&
          marker != 0xC8 &&
          marker != 0xCC) {
        final height = (bytes[i + 5] << 8) | bytes[i + 6];
        final width = (bytes[i + 7] << 8) | bytes[i + 8];
        if (width <= 0 || height <= 0) return null;
        return (width, height);
      }
      final segLen = (bytes[i + 2] << 8) | bytes[i + 3];
      if (segLen <= 0) return null;
      i += 2 + segLen;
    }
    return null;
  }

  static (int, int)? _probePng(Uint8List bytes) {
    const sig = <int>[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    if (bytes.length < sig.length + 8 + 8) return null;
    for (var i = 0; i < sig.length; i++) {
      if (bytes[i] != sig[i]) return null;
    }
    final ihdrStart = sig.length + 4; // skip length + 'IHDR'
    if (bytes.length < ihdrStart + 8) return null;
    final width =
        (bytes[ihdrStart] << 24) |
        (bytes[ihdrStart + 1] << 16) |
        (bytes[ihdrStart + 2] << 8) |
        bytes[ihdrStart + 3];
    final height =
        (bytes[ihdrStart + 4] << 24) |
        (bytes[ihdrStart + 5] << 16) |
        (bytes[ihdrStart + 6] << 8) |
        bytes[ihdrStart + 7];
    if (width <= 0 || height <= 0) return null;
    return (width, height);
  }
}
