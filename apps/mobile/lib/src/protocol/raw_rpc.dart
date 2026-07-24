final class PiRpcRequestPayload {
  const PiRpcRequestPayload({
    required this.sessionId,
    required this.requestId,
    required this.command,
  });

  final String sessionId;
  final String requestId;
  final Map<String, Object?> command;

  Map<String, Object?> toJson() => <String, Object?>{
    'sessionId': sessionId,
    'requestId': requestId,
    'command': Map<String, Object?>.from(command),
  };

  factory PiRpcRequestPayload.fromJson(Map<String, Object?> json) =>
      PiRpcRequestPayload(
        sessionId: json['sessionId'] as String,
        requestId: json['requestId'] as String,
        command: Map<String, Object?>.from(json['command'] as Map),
      );
}

final class PiRpcResponsePayload {
  const PiRpcResponsePayload({
    required this.sessionId,
    required this.requestId,
    required this.response,
  });

  final String sessionId;
  final String requestId;
  final Map<String, Object?> response;

  Map<String, Object?> toJson() => <String, Object?>{
    'sessionId': sessionId,
    'requestId': requestId,
    'response': Map<String, Object?>.from(response),
  };

  factory PiRpcResponsePayload.fromJson(Map<String, Object?> json) =>
      PiRpcResponsePayload(
        sessionId: json['sessionId'] as String,
        requestId: json['requestId'] as String,
        response: Map<String, Object?>.from(json['response'] as Map),
      );
}

final class PiRpcEventPayload {
  const PiRpcEventPayload({required this.sessionId, required this.event});

  final String sessionId;
  final Map<String, Object?> event;

  Map<String, Object?> toJson() => <String, Object?>{
    'sessionId': sessionId,
    'event': Map<String, Object?>.from(event),
  };

  factory PiRpcEventPayload.fromJson(Map<String, Object?> json) =>
      PiRpcEventPayload(
        sessionId: json['sessionId'] as String,
        event: Map<String, Object?>.from(json['event'] as Map),
      );
}
