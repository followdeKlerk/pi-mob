# Protocol

Pi Mob uses one JSON WebSocket protocol through the bridge. TypeBox definitions and generated JSON Schema are the exact message authority.

## Version and capabilities

Each envelope contains:

```text
protocol = { major: 1, minor: 0 }
```

A major mismatch closes the connection with `unsupported_protocol`. Minor changes are additive. Alpha compatibility is not guaranteed.

The bridge advertises capabilities in `hello.accepted`. See [Project status](PROJECT_STATUS.md) for the normal daemon matrix. The released client does not receive `raw_rpc.v1`.

## Connection flow

1. The client opens the WebSocket.
2. The client sends `hello` with its installation details and capability requests.
3. The bridge authenticates the installation and checks the protocol.
4. The bridge sends `hello.accepted`.
5. The client subscribes and resumes from durable cursors.
6. The bridge sends replay data before live events.

Setup failures use `invalid_auth`, `re_pair_required`, or `unsupported_protocol`.

## Durability

Streams use host or session scope. A persisted cursor lets the client request missed events.

Commands use a semantic `commandId`. The bridge records a command before dispatch and reports `completed`, `failed`, or `cancelled`.

Controller leases give one holder write access to a session. Canonical session events use one sequence per session. The bridge stores events before delivery, and the client rejects sequence gaps and requests replay.

## Enrollment and HTTP endpoints

`POST /v1/enroll` exchanges a one-time passcode for an installation credential. The bridge returns the plaintext credential once and stores its hash.

`POST /v1/attachments` and `GET /v1/exports/<id>` require `X-Installation-Id` and `X-Installation-Credential`. Upload size, type, rate, quota, and storage are bounded.
