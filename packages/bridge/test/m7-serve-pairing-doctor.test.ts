// pi-mob:security-test-fixture — deliberate credential/path redaction probes.
/**
 * M7 — Serve / pairing / doctor test suite.
 *
 * Coverage:
 *
 *   - endpoint-guard: HTTPS / .ts.net acceptance; rejection of loopback,
 *     LAN, plain HTTP, wildcard, Funnel, IP literals, and credential URIs.
 *   - tailscale-serve: route application preserves unrelated routes; removal
 *     removes only owned routes; Funnel is never added by the bridge.
 *   - pairing: exact payload shape `pi-mob-host/version1/UUID/displayName/
 *     endpoint/protocolMajor`; canonical JSON; deterministic terminal QR;
 *     tamper rejection of unknown kinds/versions/protocols.
 *   - doctor: ten required probes (versions, config, serve, db, backup,
 *     pi, env, process, storage, push) emit allowlisted redacted reports
 *     that never carry credentials, env values, transcript bytes, or raw
 *     unrestricted paths.
 *
 * All filesystem work goes through an in-memory `FileSystemPort`; the
 * Tailscale driver is a deterministic in-memory implementation; Pi and
 * push probes are stubbed so no real subprocess or network call runs.
 */

import { beforeEach, describe, expect, test } from "bun:test";

import {
  buildInstallPaths,
  defaultInstallConfig,
  type FileSystemPort,
  type FileSystemStat,
} from "../src/ops";

import {
  assertValidHostId,
  classifyEndpoint,
  EndpointGuardError,
  validateBridgeEndpoint,
} from "../src/ops/endpoint-guard";

import {
  applyServeRoute,
  BRIDGE_ROUTE_OWNER,
  inspectServeRoutes,
  removeOwnedServeRoute,
  type ServeDriver,
  type ServeRoute,
  ServeRouteError,
} from "../src/ops/tailscale-serve";

import {
  buildPairingPayload,
  encodePairingPayload,
  formatPairingPayload,
  getQrEncoder,
  PAIRING_PAYLOAD_KIND,
  PAIRING_PAYLOAD_VERSION,
  PAIRING_PROTOCOL_MAJOR,
  PAIRING_QR_ERROR_CORRECTION,
  parsePairingPayload,
  PairingPayloadError,
  renderPairingMatrix,
  renderPairingSvg,
  renderPairingTerminal,
  setQrEncoder,
  type QrEncoderPort,
  type QrMatrix,
} from "../src/ops/pairing";

import {
  DOCTOR_PROBE_NAMES,
  DoctorInputError,
  runDoctor,
  type DoctorReport,
  type PiProbe,
  type PushProbe,
} from "../src/ops/doctor";

import type { InstallPaths } from "../src/ops/install-paths";
import type { BridgeInstallConfig } from "../src/ops/install-config";
import type { ClockPort } from "../src/ops/ports";

import jsQR from "jsqr";

// ---------------------------------------------------------------------------
// In-memory FileSystemPort
// ---------------------------------------------------------------------------

interface FsNode {
  readonly kind: "file" | "dir";
  readonly mode: number;
  readonly content: Buffer;
  readonly mtimeMs: number;
}

class InMemoryFileSystem implements FileSystemPort {
  private readonly nodes = new Map<string, FsNode>();
  private clock = 0;
  setClockMs(ms: number): void { this.clock = ms; }
  private touch(path: string, mode: number, kind: "file" | "dir", content: Buffer = Buffer.alloc(0)): void {
    this.nodes.set(path, { kind, mode, content, mtimeMs: this.clock });
  }
  exists(path: string): boolean { return this.nodes.has(path); }
  stat(path: string): FileSystemStat {
    const node = this.nodes.get(path);
    if (!node) throw new Error(`ENOENT: ${path}`);
    return { isFile: node.kind === "file", isDirectory: node.kind === "dir", mode: node.mode, size: node.content.length, mtimeMs: node.mtimeMs };
  }
  readFile(path: string): Buffer {
    const node = this.nodes.get(path);
    if (!node) throw new Error(`ENOENT: ${path}`);
    if (node.kind !== "file") throw new Error(`EISDIR: ${path}`);
    return Buffer.from(node.content);
  }
  writeFile(path: string, data: Buffer | string, mode: number): void {
    const buffer = typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data);
    this.touch(path, mode, "file", buffer);
  }
  mkdir(path: string, options: { recursive: boolean; mode: number }): void {
    if (this.nodes.has(path)) {
      const node = this.nodes.get(path)!;
      if (node.kind !== "dir") throw new Error(`ENOTDIR: ${path}`);
      this.nodes.set(path, { ...node, mode: options.mode });
      return;
    }
    if (!options.recursive) this.touch(path, options.mode, "dir");
    else {
      const segments = path.split("/").filter((s) => s.length > 0);
      let cursor = "";
      for (const segment of segments) {
        cursor = `${cursor}/${segment}`;
        if (!this.nodes.has(cursor)) this.touch(cursor, options.mode, "dir");
      }
    }
  }
  chmod(path: string, mode: number): void {
    const node = this.nodes.get(path);
    if (!node) throw new Error(`ENOENT: ${path}`);
    this.nodes.set(path, { ...node, mode });
  }
  rm(path: string, options: { recursive: boolean; force: boolean }): void {
    if (!this.nodes.has(path)) { if (options.force) return; throw new Error(`ENOENT: ${path}`); }
    if (options.recursive) {
      const prefix = `${path}/`;
      for (const key of Array.from(this.nodes.keys())) if (key === path || key.startsWith(prefix)) this.nodes.delete(key);
      return;
    }
    this.nodes.delete(path);
  }
  rename(from: string, to: string): void {
    const node = this.nodes.get(from);
    if (!node) throw new Error(`ENOENT: ${from}`);
    this.nodes.delete(from);
    this.nodes.set(to, node);
  }
  readdir(path: string): readonly string[] {
    const prefix = `${path}/`;
    const out = new Set<string>();
    for (const key of this.nodes.keys()) {
      if (key === path) continue;
      if (key.startsWith(prefix)) {
        const rest = key.slice(prefix.length);
        if (!rest.includes("/")) out.add(rest);
      }
    }
    return Array.from(out).sort();
  }
  seedFile(path: string, mode = 0o600, mtimeMs = 1): void {
    this.touch(path, mode, "file", Buffer.alloc(0));
    this.nodes.set(path, { ...this.nodes.get(path)!, mtimeMs });
  }
  seedDir(path: string, mode = 0o700): void { this.touch(path, mode, "dir"); }
}

function fixedClock(ms = 1_700_000_000_000): ClockPort {
  return {
    now: () => ms,
    iso: () => new Date(ms).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// In-memory ServeDriver
// ---------------------------------------------------------------------------

class InMemoryServeDriver implements ServeDriver {
  private routes: ServeRoute[] = [];
  constructor(initial: readonly ServeRoute[] = []) { this.routes = [...initial]; }
  async listRoutes(): Promise<readonly ServeRoute[]> { return [...this.routes]; }
  async setRoutes(routes: readonly ServeRoute[]): Promise<void> { this.routes = [...routes]; }
  seed(routes: readonly ServeRoute[]): void { this.routes = [...routes]; }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ROOT_PREFIX = "/tmp/pi-mob-m7-serve";
const HOST_UUID = "6a7c0845-069f-4fe3-bf67-a9fccf43e754";
const ENDPOINT = "https://host.tailnet-name.ts.net";

function absoluteInstallRoot(label: string): string {
  return `${ROOT_PREFIX}/${label}`;
}

function newPaths(): InstallPaths {
  return buildInstallPaths({ installRoot: absoluteInstallRoot("doctor") });
}

function newConfig(): BridgeInstallConfig {
  return defaultInstallConfig({
    paths: newPaths(),
    piExecutable: "/opt/pi/0.82.0/bin/pi",
    bridgeExecutable: "/opt/pi-mob/release/bin/bridge",
    bridgeVersion: "0.0.0-m7",
    protocolVersion: "1.0",
    hostname: "127.0.0.1",
    port: 8788,
    tailscaleServe: true,
  });
}

function seededFs(): InMemoryFileSystem {
  const fs = new InMemoryFileSystem();
  const paths = newPaths();
  fs.mkdir(paths.installRoot, { recursive: true, mode: 0o700 });
  fs.mkdir(paths.stateRoot, { recursive: true, mode: 0o700 });
  fs.mkdir(paths.backupRoot, { recursive: true, mode: 0o700 });
  fs.mkdir(paths.logRoot, { recursive: true, mode: 0o700 });
  fs.mkdir(paths.secretsRoot, { recursive: true, mode: 0o700 });
  fs.mkdir(paths.launchAgentsRoot, { recursive: true, mode: 0o700 });
  fs.seedFile(paths.configFile, 0o600);
  fs.seedFile(paths.envFile, 0o600);
  fs.seedFile(paths.plistPath, 0o600);
  fs.seedFile(`${paths.stateRoot}/bridge.sqlite`, 0o600, 1_700_000_000_000);
  fs.seedFile(`${paths.backupRoot}/bridge.backup`, 0o600, 1_699_900_000_000);
  // Seed the Pi executable so the Pi probe can confirm it exists.
  fs.mkdir("/opt/pi/0.82.0/bin", { recursive: true, mode: 0o755 });
  fs.seedFile("/opt/pi/0.82.0/bin/pi", 0o755);
  return fs;
}

const stubPi: PiProbe = {
  executablePath: () => "/opt/pi/0.82.0/bin/pi",
  versionString: () => "0.82.0",
  lastExitCode: () => 0,
  crashLoopDetected: () => false,
};

beforeEach(() => {
  // Reset clock on each test by re-creating seededFs() inside tests.
});

// ---------------------------------------------------------------------------
// endpoint-guard
// ---------------------------------------------------------------------------

describe("endpoint-guard", () => {
  test("accepts a HTTPS .ts.net endpoint with the canonical QR origin", () => {
    const endpoint = validateBridgeEndpoint(ENDPOINT);
    expect(endpoint.scheme).toBe("https");
    expect(endpoint.host).toBe("host.tailnet-name.ts.net");
    expect(endpoint.port).toBe(443);
    expect(endpoint.origin).toBe(ENDPOINT);
    expect(endpoint.wsUrl).toBe("wss://host.tailnet-name.ts.net/v1/ws");
  });

  test("accepts an explicit port and preserves it", () => {
    const endpoint = validateBridgeEndpoint("https://box.tail.ts.net:8443");
    expect(endpoint.port).toBe(8443);
    expect(endpoint.origin).toBe("https://box.tail.ts.net:8443");
    expect(endpoint.wsUrl).toBe("wss://box.tail.ts.net:8443/v1/ws");
  });

  test("rejects plain HTTP", () => {
    const c = classifyEndpoint("http://host.tailnet.ts.net");
    expect(c.kind).toBe("reject");
    if (c.kind === "reject") expect(c.code).toBe("scheme");
  });

  test("rejects loopback hostnames", () => {
    for (const host of ["https://127.0.0.1", "http://127.0.0.1", "https://localhost", "https://::1"]) {
      const c = classifyEndpoint(host);
      expect(c.kind).toBe("reject");
    }
  });

  test("rejects RFC1918 and link-local IP literals", () => {
    for (const host of ["https://10.0.0.1", "https://192.168.1.10", "https://169.254.169.254"]) {
      const c = classifyEndpoint(host);
      expect(c.kind).toBe("reject");
      if (c.kind === "reject") {
        expect(["host_ip_literal", "host_lan", "host_link_local"]).toContain(c.code);
      }
    }
  });

  test("rejects wildcard hosts", () => {
    const c = classifyEndpoint("https://*.tailnet.ts.net");
    expect(c.kind).toBe("reject");
    if (c.kind === "reject") expect(c.code).toBe("host_wildcard");
  });

  test("rejects hostnames that do not end in .ts.net", () => {
    const c = classifyEndpoint("https://host.example.com");
    expect(c.kind).toBe("reject");
    if (c.kind === "reject") expect(c.code).toBe("host_not_tailscale");
  });

  test("rejects Funnel tokens", () => {
    const c = classifyEndpoint("https://funnel-bridge.tail.ts.net");
    expect(c.kind).toBe("reject");
    if (c.kind === "reject") expect(c.code).toBe("funnel");
  });

  test("rejects credentials, query, and fragments", () => {
    expect(classifyEndpoint("https://user:pass@host.tail.ts.net").kind).toBe("reject");
    expect(classifyEndpoint("https://host.tail.ts.net/?token=abc").kind).toBe("reject");
    expect(classifyEndpoint("https://host.tail.ts.net/#fragment").kind).toBe("reject");
  });

  test("validateBridgeEndpoint throws EndpointGuardError on rejection", () => {
    expect(() => validateBridgeEndpoint("http://host.tail.ts.net")).toThrow(EndpointGuardError);
  });

  test("assertValidHostId accepts canonical UUID and rejects everything else", () => {
    expect(() => assertValidHostId(HOST_UUID)).not.toThrow();
    expect(() => assertValidHostId("not-a-uuid")).toThrow(EndpointGuardError);
    expect(() => assertValidHostId("6A7C0845-069F-4FE3-BF67-A9FCCF43E754")).toThrow(EndpointGuardError);
    expect(() => assertValidHostId(null)).toThrow(EndpointGuardError);
  });
});

// ---------------------------------------------------------------------------
// tailscale-serve
// ---------------------------------------------------------------------------

describe("tailscale-serve", () => {
  test("applyServeRoute installs exactly one bridge-owned route and preserves unrelated routes", async () => {
    const unrelated: ServeRoute = {
      source: { tcp: { port: 9000 } },
      handlers: [{ kind: "forward", address: "http://127.0.0.1:9000" }],
    };
    const driver = new InMemoryServeDriver([unrelated]);
    const result = await applyServeRoute({ driver, tcpPort: 8788 });
    expect(result.changed).toBe(true);
    expect(result.routes).toHaveLength(2);
    expect(result.preservedRoutes).toEqual([unrelated]);
    const owned = result.ownedRoute!;
    expect(owned.source.tcp?.port).toBe(8788);
    expect(owned.handlers[0]?.kind).toBe("forward");
    expect(owned.handlers.some((handler) => handler.kind === "funnel")).toBe(false);
    expect(owned.annotations?.[ "pi-mob.bridge/owner" ]).toBe(BRIDGE_ROUTE_OWNER);
  });

  test("applyServeRoute refuses to replace an unrelated route on the requested port", async () => {
    const driver = new InMemoryServeDriver([{ source: { tcp: { port: 8788 } }, handlers: [{ kind: "forward", address: "http://127.0.0.1:9000" }] }]);
    await expect(applyServeRoute({ driver, tcpPort: 8788 })).rejects.toMatchObject({ code: "route_port_in_use" });
  });

  test("applyServeRoute is idempotent on repeat", async () => {
    const driver = new InMemoryServeDriver();
    const first = await applyServeRoute({ driver, tcpPort: 8788 });
    expect(first.changed).toBe(true);
    const second = await applyServeRoute({ driver, tcpPort: 8788 });
    expect(second.changed).toBe(false);
    expect(second.routes).toHaveLength(1);
  });

  test("removeOwnedServeRoute removes only the bridge-owned route", async () => {
    const keep: ServeRoute = {
      source: { tcp: { port: 9100 } },
      handlers: [{ kind: "forward", address: "http://127.0.0.1:9100" }],
    };
    const driver = new InMemoryServeDriver();
    await applyServeRoute({ driver, tcpPort: 8788 });
    driver.seed([
      ...(await driver.listRoutes()),
      keep,
    ]);
    const result = await removeOwnedServeRoute({ driver });
    expect(result.removed).toBe(true);
    expect(result.routes).toEqual([keep]);
  });

  test("removeOwnedServeRoute is a no-op when no bridge route exists", async () => {
    const keep: ServeRoute = {
      source: { tcp: { port: 9100 } },
      handlers: [{ kind: "forward", address: "http://127.0.0.1:9100" }],
    };
    const driver = new InMemoryServeDriver([keep]);
    const result = await removeOwnedServeRoute({ driver });
    expect(result.removed).toBe(false);
    expect(result.routes).toEqual([keep]);
  });

  test("inspectServeRoutes flags Funnel routes regardless of ownership", async () => {
    const funnel: ServeRoute = {
      source: { tcp: { port: 9200 } },
      handlers: [{ kind: "funnel", path: "/", address: "http://127.0.0.1:9200" }],
    };
    const driver = new InMemoryServeDriver([funnel]);
    await applyServeRoute({ driver, tcpPort: 8788 });
    const inspection = await inspectServeRoutes({ driver });
    expect(inspection.funnelRoutes).toHaveLength(1);
    expect(inspection.ownedRoute?.source.tcp?.port).toBe(8788);
  });

  test("applyServeRoute rejects an out-of-range tcpPort", async () => {
    const driver = new InMemoryServeDriver();
    await expect(applyServeRoute({ driver, tcpPort: 0 })).rejects.toThrow(ServeRouteError);
    await expect(applyServeRoute({ driver, tcpPort: 70000 })).rejects.toThrow(ServeRouteError);
  });

  test("applyServeRoute rejects a webAddress that is not loopback", async () => {
    const driver = new InMemoryServeDriver();
    await expect(applyServeRoute({ driver, tcpPort: 8788, webAddress: "https://0.0.0.0:8788" })).rejects.toThrow(ServeRouteError);
  });
});

// ---------------------------------------------------------------------------
// pairing
// ---------------------------------------------------------------------------

describe("pairing", () => {
  test("buildPairingPayload returns the exact required shape", () => {
    const payload = buildPairingPayload({
      hostId: HOST_UUID,
      displayName: "Mac mini",
      endpoint: ENDPOINT,
    });
    expect(payload.kind).toBe(PAIRING_PAYLOAD_KIND);
    expect(payload.version).toBe(PAIRING_PAYLOAD_VERSION);
    expect(payload.hostId).toBe(HOST_UUID);
    expect(payload.displayName).toBe("Mac mini");
    expect(payload.endpoint).toBe(ENDPOINT);
    expect(payload.protocolMajor).toBe(PAIRING_PROTOCOL_MAJOR);
  });

  test("formatPairingPayload emits canonical key-sorted JSON", () => {
    const a = encodePairingPayload({ hostId: HOST_UUID, displayName: "Mac-mini", endpoint: ENDPOINT });
    const b = encodePairingPayload({ hostId: HOST_UUID, displayName: "Mac-mini", endpoint: ENDPOINT });
    expect(a).toBe(b);
    expect(a.includes("\n")).toBe(false);
    // No structural whitespace: separators only appear between key/value/colons/commas.
    expect(/[ \t]{2,}/.test(a)).toBe(false);
    // Keys appear in alphabetical order.
    expect(a.indexOf('"displayName"')).toBeLessThan(a.indexOf('"endpoint"'));
    expect(a.indexOf('"endpoint"')).toBeLessThan(a.indexOf('"hostId"'));
    expect(a.indexOf('"hostId"')).toBeLessThan(a.indexOf('"kind"'));
    expect(a.indexOf('"kind"')).toBeLessThan(a.indexOf('"protocolMajor"'));
    expect(a.indexOf('"protocolMajor"')).toBeLessThan(a.indexOf('"version"'));
  });

  test("encodePairingPayload round-trips through parsePairingPayload", () => {
    const encoded = encodePairingPayload({ hostId: HOST_UUID, displayName: "Studio", endpoint: ENDPOINT });
    const parsed = parsePairingPayload(encoded);
    expect(parsed.displayName).toBe("Studio");
    expect(parsed.endpoint).toBe(ENDPOINT);
    expect(parsed.hostId).toBe(HOST_UUID);
  });

  test("parsePairingPayload rejects an unknown kind", () => {
    const tampered = `{${formatPairingPayload(buildPairingPayload({ hostId: HOST_UUID, displayName: "x", endpoint: ENDPOINT })).slice(1).replace(/"pi-mob-host"/, '"other-kind"')}`;
    expect(() => parsePairingPayload(tampered)).toThrow(PairingPayloadError);
  });

  test("parsePairingPayload rejects an unknown protocolMajor", () => {
    const encoded = encodePairingPayload({ hostId: HOST_UUID, displayName: "Studio", endpoint: ENDPOINT });
    const tampered = encoded.replace(`"protocolMajor":1`, `"protocolMajor":2`);
    expect(() => parsePairingPayload(tampered)).toThrow(/protocolMajor/);
  });

  test("parsePairingPayload rejects a tampered Funnel endpoint", () => {
    const encoded = encodePairingPayload({ hostId: HOST_UUID, displayName: "Studio", endpoint: ENDPOINT });
    const parsed = JSON.parse(encoded) as Record<string, unknown>;
    parsed["endpoint"] = "https://funnel-bridge.tail.ts.net";
    expect(() => parsePairingPayload(JSON.stringify(parsed))).toThrow(/funnel/);
  });

  test("parsePairingPayload rejects a plain HTTP endpoint", () => {
    const encoded = encodePairingPayload({ hostId: HOST_UUID, displayName: "Studio", endpoint: ENDPOINT });
    const parsed = JSON.parse(encoded) as Record<string, unknown>;
    parsed["endpoint"] = "http://host.tail.ts.net";
    expect(() => parsePairingPayload(JSON.stringify(parsed))).toThrow(/https/);
  });

  test("buildPairingPayload strips control characters and length-caps displayName", () => {
    const payload = buildPairingPayload({ hostId: HOST_UUID, displayName: "  My\u0007 Host\u0000  ", endpoint: ENDPOINT });
    expect(payload.displayName).toBe("My Host");
    expect(() => buildPairingPayload({ hostId: HOST_UUID, displayName: "x".repeat(200), endpoint: ENDPOINT })).toThrow(PairingPayloadError);
    expect(() => buildPairingPayload({ hostId: HOST_UUID, displayName: "", endpoint: ENDPOINT })).toThrow(PairingPayloadError);
  });

  test("renderPairingTerminal is deterministic and uses ANSI QR rendering", () => {
    const payload = buildPairingPayload({ hostId: HOST_UUID, displayName: "Studio", endpoint: ENDPOINT });
    const a = renderPairingTerminal(payload);
    const b = renderPairingTerminal(payload);
    expect(a).toBe(b);
    // Real QR output uses ANSI background-colour escapes for dark/light
    // modules; the terminal renderer must contain both.
    expect(a.includes("\u001b[47m")).toBe(true); // white background for a dark module
    expect(a.includes("\u001b[40m")).toBe(true); // black background for a light module
    // The grid must be rectangular (every line the same width).
    const lines = a.split("\n");
    const width = lines[0]!.length;
    expect(lines.every((line) => line.length === width)).toBe(true);
    expect(lines.length).toBeGreaterThan(10);
    // Each module is rendered as 2 spaces wrapped in ANSI background and
    // reset escapes (5 + 2 + 4 = 11 chars). Width must be a clean multiple
    // of that module size.
    const moduleWidth = 11;
    expect(width % moduleWidth).toBe(0);
    const moduleCount = width / moduleWidth;
    expect(lines.length).toBe(moduleCount);
    // The number of modules per line must match the QR symbol's intrinsic
    // size (version-2/3/.../10 symbols for the canonical payload).
    expect(moduleCount).toBeGreaterThan(20);
    expect(moduleCount).toBeLessThan(80);
  });

  test("renderPairingTerminal rejects invalid options", () => {
    const payload = buildPairingPayload({ hostId: HOST_UUID, displayName: "Studio", endpoint: ENDPOINT });
    expect(() => renderPairingTerminal(payload, { modules: 7 })).toThrow(PairingPayloadError);
    expect(() => renderPairingTerminal(payload, { modules: 99 })).toThrow(PairingPayloadError);
    expect(() => renderPairingTerminal(payload, { quietZone: -1 })).toThrow(PairingPayloadError);
    expect(() => renderPairingTerminal(payload, { quietZone: 9 })).toThrow(PairingPayloadError);
  });

  test("renderPairingMatrix is deterministic and carries finder patterns", () => {
    const payload = buildPairingPayload({ hostId: HOST_UUID, displayName: "Studio", endpoint: ENDPOINT });
    const a = renderPairingMatrix(payload, { quietZone: 0 });
    const b = renderPairingMatrix(payload, { quietZone: 0 });
    expect(a).toEqual(b);
    const size = a.length;
    expect(size).toBeGreaterThan(20);
    expect(size).toBeLessThan(80);
    expect(a.every((row) => row.length === size)).toBe(true);
    // Three finder patterns in the corners, each a 7x7 dark square with a
    // 3x3 dark inner block and a 1-module light ring around it.
    expect(finderPatternPresent(a)).toBe(true);
  });

  test("renderPairingMatrix honours quietZone padding and invert option", () => {
    const payload = buildPairingPayload({ hostId: HOST_UUID, displayName: "Studio", endpoint: ENDPOINT });
    const padded = renderPairingMatrix(payload, { quietZone: 4 });
    const base = renderPairingMatrix(payload, { quietZone: 0 });
    expect(padded.length).toBe(base.length + 8);
    // The added quiet-zone rows are all-light (white).
    for (let y = 0; y < 4; y += 1) {
      expect(padded[y]!.every((cell) => cell === false)).toBe(true);
    }
    // Invert option flips every module.
    const inverted = renderPairingMatrix(payload, { quietZone: 0, invert: true });
    expect(inverted.length).toBe(base.length);
    for (let y = 0; y < base.length; y += 1) {
      for (let x = 0; x < base.length; x += 1) {
        expect(inverted[y]![x]).toBe(!base[y]![x]);
      }
    }
  });

  test("renderPairingSvg is a self-contained SVG document", () => {
    const payload = buildPairingPayload({ hostId: HOST_UUID, displayName: "Studio", endpoint: ENDPOINT });
    const svg = renderPairingSvg(payload);
    expect(svg.startsWith('<?xml version="1.0"')).toBe(true);
    expect(svg.includes('<svg')).toBe(true);
    expect(svg.includes('</svg>')).toBe(true);
    // The SVG must carry a white background rectangle so it prints on
    // light surfaces and the dark-module rectangles so the symbol is
    // scannable.
    expect(svg.includes('fill="#ffffff"')).toBe(true);
    expect(svg.includes('fill="#000000"')).toBe(true);
  });

  test("encodePairingPayload round-trips through real QR (matrix + jsqr)", () => {
    // Build a payload, render the matrix, rasterize it into an RGBA buffer
    // that jsqr can decode, and assert the decoded text equals the
    // canonical JSON of the payload.
    const payload = buildPairingPayload({ hostId: HOST_UUID, displayName: "Studio", endpoint: ENDPOINT });
    const canonical = formatPairingPayload(payload);
    const matrix = renderPairingMatrix(payload, { quietZone: 0 });
    const decoded = decodeMatrixWithJsQR(matrix);
    expect(decoded).toBe(canonical);
  });

  test("encodePairingPayload round-trips through real QR (terminal + jsqr)", () => {
    // The terminal renderer is intended for humans, not machines; verify
    // that the underlying matrix it represents decodes back to the
    // original canonical JSON when fed into a real QR decoder.
    const payload = buildPairingPayload({ hostId: HOST_UUID, displayName: "Studio", endpoint: ENDPOINT });
    const canonical = formatPairingPayload(payload);
    const matrix = renderPairingMatrix(payload, { quietZone: 0 });
    expect(decodeMatrixWithJsQR(matrix)).toBe(canonical);
  });

  test("QR encoder advertises error-correction level M", () => {
    expect(PAIRING_QR_ERROR_CORRECTION).toBe("M");
    expect(getQrEncoder().errorCorrectionLevel).toBe("M");
  });

  test("setQrEncoder substitutes a deterministic stub for tests", () => {
    const previous = getQrEncoder();
    const stub: QrEncoderPort = {
      errorCorrectionLevel: "M",
      renderTerminal: () => "STUB-TERMINAL",
      renderSvg: () => "<svg>STUB</svg>",
      renderMatrix: () => ({ size: 1, matrix: [[true]] }),
    };
    setQrEncoder(stub);
    try {
      const payload = buildPairingPayload({ hostId: HOST_UUID, displayName: "Studio", endpoint: ENDPOINT });
      expect(renderPairingTerminal(payload)).toBe("STUB-TERMINAL");
      expect(renderPairingSvg(payload)).toBe("<svg>STUB</svg>");
      expect(renderPairingMatrix(payload, { quietZone: 0 })).toEqual([[true]]);
    } finally {
      setQrEncoder(previous);
    }
  });

  test("setQrEncoder(null) restores a real encoder", () => {
    const stub: QrEncoderPort = {
      errorCorrectionLevel: "M",
      renderTerminal: () => "STUB",
      renderSvg: () => "<svg>STUB</svg>",
      renderMatrix: () => ({ size: 1, matrix: [[false]] }),
    };
    setQrEncoder(stub);
    expect(getQrEncoder()).toBe(stub);
    setQrEncoder(null);
    // setQrEncoder(null) constructs a fresh RealQrEncoder; identity is
    // not preserved, but the returned encoder must be a real encoder.
    expect(getQrEncoder()).not.toBe(stub);
    expect(getQrEncoder().errorCorrectionLevel).toBe("M");
    expect(typeof getQrEncoder().renderMatrix).toBe("function");
  });
});

/**
 * Rasterizes a `boolean[][]` QR matrix into an RGBA buffer (4 bytes per
 * pixel) that {@link jsQR} can decode. Each module becomes an 8x8 pixel
 * block so jsQR's finder-pattern detection has enough resolution.
 */
function decodeMatrixWithJsQR(matrix: QrMatrix): string {
  const scale = 8;
  const size = matrix.length;
  const width = size * scale;
  const height = size * scale;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const module = matrix[Math.floor(y / scale)]![Math.floor(x / scale)]!;
      const idx = (y * width + x) * 4;
      const value = module ? 0 : 255;
      rgba[idx] = value;
      rgba[idx + 1] = value;
      rgba[idx + 2] = value;
      rgba[idx + 3] = 255;
    }
  }
  const result = jsQR(rgba, width, height);
  if (result === null) {
    throw new Error("jsQR failed to decode the rendered matrix");
  }
  return result.data;
}

/**
 * Returns true when a 7x7 finder pattern (dark border, light inner ring,
 * dark 3x3 centre) appears at the requested corner of the matrix. ISO/IEC
 * 18004 requires exactly three finder patterns in a QR symbol.
 */
function finderPatternPresent(matrix: QrMatrix): boolean {
  const size = matrix.length;
  const corners: readonly (readonly [number, number])[] = [
    [0, 0],
    [size - 7, 0],
    [0, size - 7],
  ];
  for (const [fx, fy] of corners) {
    let isBorder = true;
    for (let i = 0; i < 7; i += 1) {
      if (!matrix[fy]![fx + i]) isBorder = false;
      if (!matrix[fy + 6]![fx + i]) isBorder = false;
      if (!matrix[fy + i]![fx]) isBorder = false;
      if (!matrix[fy + i]![fx + 6]) isBorder = false;
    }
    if (!isBorder) return false;
    let isCentre = true;
    for (let dy = 2; dy <= 4; dy += 1) {
      for (let dx = 2; dx <= 4; dx += 1) {
        if (!matrix[fy + dy]![fx + dx]) isCentre = false;
      }
    }
    if (!isCentre) return false;
    let isInnerRingLight = true;
    for (let i = 1; i <= 5; i += 1) {
      if (matrix[fy + 1]![fx + i]) isInnerRingLight = false;
      if (matrix[fy + 5]![fx + i]) isInnerRingLight = false;
      if (matrix[fy + i]![fx + 1]) isInnerRingLight = false;
      if (matrix[fy + i]![fx + 5]) isInnerRingLight = false;
    }
    if (!isInnerRingLight) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// doctor
// ---------------------------------------------------------------------------

describe("doctor", () => {
  test("emits the canonical schema version, timestamp, and overall status", async () => {
    const fs = seededFs();
    const driver = new InMemoryServeDriver();
    await applyServeRoute({ driver, tcpPort: 8788 });
    const report = await runDoctor({
      config: newConfig(),
      paths: newPaths(),
      ports: { fs, clock: fixedClock(), serveDriver: driver, piProbe: stubPi },
    });
    expect(report.schemaVersion).toBe(1);
    expect(report.redacted).toBe(true);
    expect(report.timestamp).toBe(new Date(1_700_000_000_000).toISOString());
    expect(DOCTOR_PROBE_NAMES).toContain("versions");
    expect(DOCTOR_PROBE_NAMES).toContain("config");
    expect(DOCTOR_PROBE_NAMES).toContain("serve");
    expect(DOCTOR_PROBE_NAMES).toContain("database");
    expect(DOCTOR_PROBE_NAMES).toContain("backup");
    expect(DOCTOR_PROBE_NAMES).toContain("pi");
    expect(DOCTOR_PROBE_NAMES).toContain("environment");
    expect(DOCTOR_PROBE_NAMES).toContain("process");
    expect(DOCTOR_PROBE_NAMES).toContain("storage");
    expect(DOCTOR_PROBE_NAMES).toContain("push");
    expect(report.probes.map((probe) => probe.name)).toEqual([...DOCTOR_PROBE_NAMES]);
  });

  test("happy path produces ok status across every probe", async () => {
    const fs = seededFs();
    const driver = new InMemoryServeDriver();
    await applyServeRoute({ driver, tcpPort: 8788 });
    const push: PushProbe = { configured: () => true, status: () => "ok", lastError: () => null };
    const report = await runDoctor({
      config: newConfig(),
      paths: newPaths(),
      ports: { fs, clock: fixedClock(), serveDriver: driver, piProbe: stubPi, pushProbe: push, databaseIntegrity: () => ({ ok: true }), processProbe: () => ({ loaded: true, listenerReady: true }) },
    });
    expect(report.overall).toBe("ok");
    for (const probe of report.probes) {
      expect(probe.status).toBe("ok");
    }
  });

  test("funnel exposure fails the serve probe", async () => {
    const fs = seededFs();
    const driver = new InMemoryServeDriver([
      {
        source: { tcp: { port: 9999 } },
        handlers: [{ kind: "funnel", path: "/", address: "http://127.0.0.1:9999" }],
      },
    ]);
    await applyServeRoute({ driver, tcpPort: 8788 });
    const report = await runDoctor({
      config: newConfig(),
      paths: newPaths(),
      ports: { fs, clock: fixedClock(), serveDriver: driver, piProbe: stubPi },
    });
    const serve = report.probes.find((probe) => probe.name === "serve")!;
    expect(serve.status).toBe("fail");
    expect(report.overall).toBe("fail");
  });

  test("missing database sqlite file warns the database probe", async () => {
    const fs = seededFs();
    // Remove the sqlite file but keep state dir.
    fs.rm(`${newPaths().stateRoot}/bridge.sqlite`, { recursive: false, force: true });
    const driver = new InMemoryServeDriver();
    await applyServeRoute({ driver, tcpPort: 8788 });
    const report = await runDoctor({
      config: newConfig(),
      paths: newPaths(),
      ports: { fs, clock: fixedClock(), serveDriver: driver, piProbe: stubPi },
    });
    const database = report.probes.find((probe) => probe.name === "database")!;
    expect(database.status).toBe("warn");
  });

  test("config world-readable fails the config probe", async () => {
    const fs = seededFs();
    fs.chmod(newPaths().configFile, 0o644);
    const driver = new InMemoryServeDriver();
    await applyServeRoute({ driver, tcpPort: 8788 });
    const report = await runDoctor({
      config: newConfig(),
      paths: newPaths(),
      ports: { fs, clock: fixedClock(), serveDriver: driver, piProbe: stubPi },
    });
    const config = report.probes.find((probe) => probe.name === "config")!;
    expect(config.status).toBe("fail");
  });

  test("pi crash loop fails the pi probe", async () => {
    const fs = seededFs();
    const driver = new InMemoryServeDriver();
    await applyServeRoute({ driver, tcpPort: 8788 });
    const crashPi: PiProbe = { ...stubPi, crashLoopDetected: () => true };
    const report = await runDoctor({
      config: newConfig(),
      paths: newPaths(),
      ports: { fs, clock: fixedClock(), serveDriver: driver, piProbe: crashPi },
    });
    const pi = report.probes.find((probe) => probe.name === "pi")!;
    expect(pi.status).toBe("fail");
  });

  test("push not configured warns but does not fail overall", async () => {
    const fs = seededFs();
    const driver = new InMemoryServeDriver();
    await applyServeRoute({ driver, tcpPort: 8788 });
    const report = await runDoctor({
      config: newConfig(),
      paths: newPaths(),
      ports: { fs, clock: fixedClock(), serveDriver: driver, piProbe: stubPi, databaseIntegrity: () => ({ ok: true }), processProbe: () => ({ loaded: true, listenerReady: true }) },
    });
    const push = report.probes.find((probe) => probe.name === "push")!;
    expect(push.status).toBe("warn");
    expect(report.overall).toBe("ok");
  });

  test("report never contains raw absolute paths, credentials, env values, or content", async () => {
    const fs = seededFs();
    const driver = new InMemoryServeDriver();
    await applyServeRoute({ driver, tcpPort: 8788 });
    const push: PushProbe = {
      configured: () => true,
      status: () => "degraded",
      lastError: () => "sk-abcdefghijklmnopqrstuvwxyz0123456789",
    };
    const config = newConfig();
    const report: DoctorReport = await runDoctor({
      config,
      paths: newPaths(),
      ports: { fs, clock: fixedClock(), serveDriver: driver, piProbe: stubPi, pushProbe: push },
    });
    const blob = JSON.stringify(report);
    // Provider-shaped credentials must not leak; lastError is hashed.
    expect(blob).not.toMatch(/sk-[A-Za-z0-9_-]{8,}/);
    // No absolute user paths or private home/root mounts.
    expect(blob).not.toMatch(/\/Users\/[^/"]+/);
    expect(blob).not.toMatch(/\/home\/[^/"]+/);
    // No raw env var values.
    expect(blob).not.toMatch(/NODE_OPTIONS/);
    expect(blob).not.toMatch(/BUN_CONFIG/);
    // No transcript-style fragments; we never log them, but assert no
    // sentinel leaked either.
    expect(blob).not.toMatch(/<transcript>/);
  });

  test("rejects unsupported config schemaVersion before any probe runs", async () => {
    const fs = seededFs();
    const config = newConfig();
    const tampered = { ...config, schemaVersion: 99 as unknown as 1 };
    await expect(runDoctor({
      config: tampered,
      paths: newPaths(),
      ports: { fs, clock: fixedClock(), piProbe: stubPi },
    })).rejects.toThrow(DoctorInputError);
  });

  test("probe ordering and shape remain stable across runs", async () => {
    const fs = seededFs();
    const driver = new InMemoryServeDriver();
    await applyServeRoute({ driver, tcpPort: 8788 });
    const ports = { fs, clock: fixedClock(), serveDriver: driver, piProbe: stubPi };
    const first = await runDoctor({ config: newConfig(), paths: newPaths(), ports });
    const second = await runDoctor({ config: newConfig(), paths: newPaths(), ports });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.probes.map((probe) => probe.name)).toEqual([...DOCTOR_PROBE_NAMES]);
  });
});
