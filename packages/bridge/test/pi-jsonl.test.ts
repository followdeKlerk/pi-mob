import { describe, expect, test } from "bun:test";
import { JsonlDecoder, JsonlIncompleteTrailingRecordError, JsonlRecordTooLargeError, JsonlSyntaxError } from "../src/pi/jsonl";

const encoder = new TextEncoder();

describe("Pi JSONL decoder", () => {
  test("preserves UTF-8 and Unicode separators across every chunk boundary", () => {
    const source = '{"text":"a😀\u2028b\u2029c"}\r\n{"value":2}\n';
    const bytes = encoder.encode(source);
    for (let split = 0; split <= bytes.length; split += 1) {
      const decoder = new JsonlDecoder();
      const records = [...decoder.push(bytes.subarray(0, split)), ...decoder.push(bytes.subarray(split))];
      decoder.finish();
      expect(records.map((record) => record.value)).toEqual([{ text: "a😀 b c" }, { value: 2 }]);
    }
  });

  test("handles many records without applying the limit to the whole chunk", () => {
    const decoder = new JsonlDecoder({ maxRecordBytes: 12 });
    const records = decoder.push(encoder.encode('{"a":1}\n{"b":2}\n'));
    expect(records).toHaveLength(2);
  });

  test("rejects malformed, oversized, and unterminated records", () => {
    expect(() => new JsonlDecoder().push(encoder.encode("{bad}\n"))).toThrow(JsonlSyntaxError);
    expect(() => new JsonlDecoder({ maxRecordBytes: 4 }).push(encoder.encode('{"long":true}'))).toThrow(JsonlRecordTooLargeError);
    const partial = new JsonlDecoder();
    partial.push(encoder.encode('{"ok":true}'));
    expect(() => partial.finish()).toThrow(JsonlIncompleteTrailingRecordError);
  });
});
