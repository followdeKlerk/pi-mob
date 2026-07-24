import { UUID_PATTERN } from "@pi-mob/protocol-schema";
import type { BridgeStore, StoredCommand } from "../core/store";
import type { PiRpcClient } from "./one-session-adapter";

export interface RawRpcAdapter {
  resolveRpc(sessionId: string): PiRpcClient;
}

const uuidPattern = new RegExp(UUID_PATTERN);

function requireBoundedString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 128) {
    throw new TypeError(`${field} must be a non-empty string of at most 128 characters`);
  }
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function handleRawRpcRequest(
  adapter: RawRpcAdapter,
  command: StoredCommand,
  store: BridgeStore,
): Promise<void> {
  const sessionId = String(command.payload.sessionId ?? "");
  if (!uuidPattern.test(sessionId)) {
    throw new TypeError("sessionId must be a lowercase UUID");
  }
  const requestId = requireBoundedString(command.payload.requestId, "requestId");
  const rawCommand = command.payload.command;
  if (!rawCommand || typeof rawCommand !== "object" || Array.isArray(rawCommand)) {
    throw new TypeError("command must be an object");
  }
  const piCommand = rawCommand as Record<string, unknown>;
  const method = requireBoundedString(piCommand.type, "command.type");
  const streamId = `session:${sessionId}`;

  try {
    const response = await adapter.resolveRpc(sessionId).request({
      id: requestId,
      method,
      params: piCommand,
    });
    store.appendEvent(streamId, "pi.rpc.response", {
      sessionId,
      requestId,
      response,
    });
  } catch (error) {
    store.appendEvent(streamId, "pi.rpc.response", {
      sessionId,
      requestId,
      response: { success: false, error: errorMessage(error) },
    });
  }
}
