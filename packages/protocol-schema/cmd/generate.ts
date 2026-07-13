import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  AttachmentResponseSchema, CapabilitySchema, COMMAND_METADATA, CommandSchema, ControlSchema, DecimalCursorSchema, EnvelopeSchema, ERROR_CODES, ErrorSchema,
  EVENT_STREAM_OWNERSHIP, EventSchema, ExportMetadataSchema, HelloSchema, LeaseStateSchema, PairingSchema, PROTOCOL_VERSION, ResponseSchema,
  SnapshotSchema, StreamSchema, SubscriptionSchema,
} from "../src/index.ts";

const outDir = resolve(process.env.PROTOCOL_SCHEMA_OUT_DIR ?? new URL("../generated", import.meta.url).pathname);
const generatedAtUtc = process.env.PROTOCOL_SCHEMA_FIXED_TIMESTAMP ?? "2026-07-12T00:00:00.000Z";

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sorted(item)]));
  return value;
}

function emit(file: string, value: unknown): void {
  writeFileSync(resolve(outDir, file), `${JSON.stringify(sorted(value), null, 2)}\n`, "utf8");
}

mkdirSync(outDir, { recursive: true });
const artifacts = [
  "attachment.schema.json", "capability.schema.json", "command-catalogue.json", "command.schema.json", "control.schema.json",
  "decimal-cursor.schema.json", "envelope.schema.json", "error-codes.json", "error.schema.json", "event-catalogue.json", "event.schema.json",
  "export.schema.json", "hello.schema.json", "lease.schema.json", "pairing.schema.json", "response.schema.json", "snapshot.schema.json",
  "stream.schema.json", "subscription.schema.json", "schema-manifest.json",
];
emit("envelope.schema.json", EnvelopeSchema);
emit("capability.schema.json", CapabilitySchema);
emit("decimal-cursor.schema.json", DecimalCursorSchema);
emit("stream.schema.json", StreamSchema);
emit("subscription.schema.json", SubscriptionSchema);
emit("snapshot.schema.json", SnapshotSchema);
emit("lease.schema.json", LeaseStateSchema);
emit("hello.schema.json", HelloSchema);
emit("command.schema.json", CommandSchema);
emit("event.schema.json", EventSchema);
emit("response.schema.json", ResponseSchema);
emit("error.schema.json", ErrorSchema);
emit("control.schema.json", ControlSchema);
emit("pairing.schema.json", PairingSchema);
emit("attachment.schema.json", AttachmentResponseSchema);
emit("export.schema.json", ExportMetadataSchema);
emit("command-catalogue.json", COMMAND_METADATA.map((metadata) => ({ ...metadata, class: "command", requiresCommandId: true })));
emit("event-catalogue.json", Object.entries(EVENT_STREAM_OWNERSHIP).map(([type, stream]) => ({ type, class: "event", stream })));
emit("error-codes.json", [...ERROR_CODES].sort());
emit("schema-manifest.json", { schemaVersion: 1, protocolVersion: PROTOCOL_VERSION, generatedAtUtc, artifacts });
