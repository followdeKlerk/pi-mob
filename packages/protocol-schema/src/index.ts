/**
 * Protocol schema package placeholder.
 *
 * M2 introduces the canonical TypeBox envelopes, command/event/error schemas,
 * and the JSON Schema + command/event catalogue generator. M1 only reserves
 * the package and exports the protocol identity constants consumed by the
 * bridge, the fixtures package, and the cross-language fixture decoder tests.
 */

export const PROTOCOL_MAJOR = 1 as const;
export const PROTOCOL_MINOR = 0 as const;
export const PROTOCOL_VERSION = `${PROTOCOL_MAJOR}.${PROTOCOL_MINOR}` as const;

export interface ProtocolIdentity {
  readonly major: typeof PROTOCOL_MAJOR;
  readonly minor: typeof PROTOCOL_MINOR;
  readonly version: typeof PROTOCOL_VERSION;
}

export function getProtocolIdentity(): ProtocolIdentity {
  return {
    major: PROTOCOL_MAJOR,
    minor: PROTOCOL_MINOR,
    version: PROTOCOL_VERSION,
  };
}
