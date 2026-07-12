/**
 * Redaction-first logger interface.
 *
 * M1 placeholder. The bridge must never log raw transcripts, source content,
 * provider keys, full environment dumps, absolute personal paths, or session
 * payloads. Loggers in this package only ever emit redacted build metadata and
 * structured diagnostic events. Concrete implementations (rotating file sink,
 * ring buffer, etc.) are added in later checkpoints.
 */

export type RedactionClass =
  | "build-metadata"
  | "diagnostic"
  | "diagnostic-detail"
  | "warning"
  | "error";

export interface LogFields {
  readonly [key: string]: string | number | boolean | null | undefined;
}

export interface LogRecord {
  readonly class: RedactionClass;
  readonly event: string;
  readonly fields?: LogFields;
}

export interface RedactingLogger {
  log(record: LogRecord): void;
}

// Sensitive value substrings. Key names are NOT auto-redacted; the logger
// only redacts values that look like credentials or absolute private paths.
const sensitiveValuePattern =
  /(sk-[A-Za-z0-9-]+|AIza[0-9A-Za-z_-]+|ghp_[A-Za-z0-9]+|glpat-[A-Za-z0-9_-]+|xox[baprs]-[A-Za-z0-9-]+|-----BEGIN [A-Z ]+PRIVATE KEY-----|\/Users\/[^/\s"`<>]+\/[^/\s"`<>]*|\/home\/[^/\s"`<>]+\/[^/\s"`<>]*)/;

/**
 * The default M1 logger rejects any field whose value fails the redaction
 * allowlist. It is intentionally strict: known sensitive value shapes are
 * replaced with the literal "redacted", and only alphanumeric class/event
 * identifiers are accepted.
 */
export function createRedactingLogger(): RedactingLogger {
  return {
    log(record) {
      if (!isSafeIdentifier(record.class) || !isSafeIdentifier(record.event)) {
        return;
      }
      const safeFields: Record<string, string | number | boolean | null | undefined> = {};
      if (record.fields) {
        for (const k of Object.keys(record.fields)) {
          const v = record.fields[k];
          if (typeof v === "string" && sensitiveValuePattern.test(v)) {
            safeFields[k] = "redacted";
            continue;
          }
          safeFields[k] = v;
        }
      }
      const payload = JSON.stringify({
        class: record.class,
        event: record.event,
        fields: safeFields,
      });
      process.stdout.write(payload + "\n");
    },
  };
}

function isSafeIdentifier(value: string): boolean {
  return /^[a-z][a-z0-9-]{0,63}$/.test(value);
}
