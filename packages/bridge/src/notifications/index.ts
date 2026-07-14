/**
 * M15 — public surface of the bridge notification subsystem.
 *
 * Re-exports every module under `notifications/`. The runtime imports
 * from here so consumers don't have to know the internal layout.
 */

export * from "./types";
export * from "./policy";
export * from "./payload";
export * from "./coalesce";
export * from "./service";
export * from "./transports/apns";
export * from "./transports/fcm";
export * from "./transports/noop";
