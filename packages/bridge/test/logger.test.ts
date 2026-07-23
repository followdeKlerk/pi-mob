// pi-mob:security-test-fixtureimport { describe, expect, test } from "bun:test";
import { createRedactingLogger } from "../src/logger";

function captureStdout<T>(fn: () => T): { writes: string[]; result: T } {
  const writes: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: unknown) => {
    writes.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    const result = fn();
    return { writes, result };
  } finally {
    process.stdout.write = original;
  }
}

describe("createRedactingLogger", () => {
  test("accepts safe build-metadata records", () => {
    const { writes } = captureStdout(() => {
      const logger = createRedactingLogger();
      logger.log({ class: "build-metadata", event: "bridge-smoke-ok", fields: { version: "0.0.0" } });
    });
    expect(writes.length).toBe(1);
    expect(writes[0]).toContain("bridge-smoke-ok");
    expect(writes[0]).toContain("0.0.0");
  });

  test("redacts sensitive value shapes regardless of key name", () => {
    const { writes } = captureStdout(() => {
      const logger = createRedactingLogger();
      logger.log({
        class: "diagnostic",
        event: "config-loaded",
        fields: {
          apiKey: "sk-supersecretvalue123",
          userPath: "/Users/alice/private/notes.txt",
          safe: "harmless string",
        },
      });
    });
    expect(writes[0]).toContain("redacted");
    expect(writes[0]).not.toContain("supersecretvalue");
    expect(writes[0]).not.toContain("alice");
    expect(writes[0]).toContain("harmless string");
  });

  test("drops records with non-allowlisted class/event identifiers", () => {
    const { writes } = captureStdout(() => {
      const logger = createRedactingLogger();
      logger.log({ class: "DROP TABLE" as never, event: "x" });
      logger.log({ class: "diagnostic", event: "BadEvent" });
    });
    expect(writes.length).toBe(0);
  });
});
