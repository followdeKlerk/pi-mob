# Protocol

Pi Mob uses one JSON WebSocket protocol through the bridge. The TypeBox schemas and generated JSON Schema are the exact message authority.

## Version and capabilities

Each envelope contains:

```text
protocol = { major: 1, minor: 0 }
```

A major mismatch closes the connection with `unsupported_protocol`. Minor revisions are intended to be additive. Alpha compatibility is not guaranteed.

The bridge advertises available capabilities in `hello.accepted`. The client requests required and optional capabilities in `hello`. See [Project status](PROJECT_STATUS.md) for the exact normal-daemon capability matrix.

`hello.accepted` may include `sessionVisibilityCutoff`, an ISO-8601 UTC timestamp. The mobile session catalogue and host-stream session summaries omit inactive sessions older than this cutoff; active, attention, and queued sessions remain visible. Durable session rows, session streams, and history are retained independently.

Internal backend RPC can remain available for older integrations. The released client does not receive `raw_rpc.v1`.

## Connection flow

1. The client opens the WebSocket.
2. The client sends `hello` with its installation ID, credential, version, and capability requests.
3. The bridge authenticates the installation and checks the protocol.
4. The bridge sends `hello.accepted`.
5. The client subscribes and resumes from durable cursors.
6. The bridge sends replay data before live events.

The bridge uses `invalid_auth`, `re_pair_required`, or `unsupported_protocol` when it rejects setup.

## Durability

Streams use host or session scope. A persisted cursor lets the client request missed events.

Commands use a semantic `commandId`. The bridge records a command before dispatch and reports `completed`, `failed`, or `cancelled`. The bridge command ID is not the OMP turn or message ID.

Controller leases give one holder bounded write access to a session. The mobile app restores an active session lease instead of reacquiring it.

Canonical session events use one sequence per session. The bridge stores events before delivery. Replay responses are bounded pages; `complete: false` means the client must resubscribe with its last applied sequence before live delivery is enabled. The client rejects sequence gaps and requests replay.

Replacement fields, such as `partialResult`, replace prior state. They are not deltas unless the schema marks them as deltas.

## Enrollment and HTTP endpoints

`POST /v1/enroll` exchanges a valid one-time passcode for a per-installation credential. The response returns the plaintext credential once. The bridge stores its hash.

`POST /v1/attachments` and `GET /v1/exports/<id>` require these headers:

- `X-Installation-Id`
- `X-Installation-Credential`

The bridge authenticates these headers before it reads an upload body. Attachment size, type, rate, quota, and total storage are bounded. Export IDs expire.
