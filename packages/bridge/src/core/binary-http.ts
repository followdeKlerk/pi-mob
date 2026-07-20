import { createHash } from "node:crypto";
import Busboy from "@fastify/busboy";
import jpeg from "jpeg-js";
import { Readable } from "node:stream";
import { PNG } from "pngjs";
import { AttachmentError, AttachmentStore } from "./attachments";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_DIMENSION = 16_384;
const MAX_PIXELS = 20_000_000;

export interface ExportDownloadProvider {
  getExport(id: string): { exportId: string; format: "html"; bytes: number; expiresAt: string; completion: { state: "pending" | "completed" | "failed" } } | null;
  exportFile(id: string): ReturnType<typeof Bun.file> | null;
}

export interface BinaryHttpOptions {
  readonly attachments: AttachmentStore;
  readonly exports?: ExportDownloadProvider;
}

export function inspectImage(bytes: Uint8Array): { mimeType: "image/jpeg" | "image/png"; width: number; height: number } {
  let mimeType: "image/jpeg" | "image/png";
  let width = 0;
  let height = 0;
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
      && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
      && String.fromCharCode(...bytes.slice(12, 16)) === "IHDR") {
    mimeType = "image/png";
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    width = view.getUint32(16);
    height = view.getUint32(20);
  } else if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    mimeType = "image/jpeg";
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1]!;
      if (marker === 0xd9 || marker === 0xda) break;
      const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
      if (length < 2 || offset + 2 + length > bytes.length) throw new AttachmentError("bad_request", "malformed JPEG segment");
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        height = (bytes[offset + 5]! << 8) | bytes[offset + 6]!;
        width = (bytes[offset + 7]! << 8) | bytes[offset + 8]!;
        break;
      }
      offset += 2 + length;
    }
  } else {
    throw new AttachmentError("bad_request", "content is not a JPEG or PNG image");
  }
  if (width < 1 || height < 1 || width > MAX_DIMENSION || height > MAX_DIMENSION || width * height > MAX_PIXELS) {
    throw new AttachmentError("bad_request", "image dimensions exceed decode limits");
  }
  try {
    const decoded = mimeType === "image/png"
      ? PNG.sync.read(Buffer.from(bytes), { checkCRC: true, skipRescale: true })
      : jpeg.decode(Buffer.from(bytes), { useTArray: true, maxResolutionInMP: 20, maxMemoryUsageInMB: 128 });
    if (!decoded || decoded.width !== width || decoded.height !== height || !decoded.data || decoded.data.length < width * height) {
      throw new Error("decoded dimensions do not match headers");
    }
  } catch {
    throw new AttachmentError("bad_request", "image payload is malformed or exceeds decode limits");
  }
  return { mimeType, width, height };
}

export function createBinaryHttpHandler(options: BinaryHttpOptions): (request: Request) => Promise<Response | null> {
  return async (request) => {
    const url = new URL(request.url);
    if (url.pathname === "/v1/attachments") {
      if (request.method !== "POST") return jsonError("invalid_message", "POST required", 405);
      const length = Number(request.headers.get("content-length") ?? "0");
      if (length > MAX_IMAGE_BYTES + 1024 * 1024) return jsonError("payload_too_large", "upload is too large", 413);
      try {
        const multipart = await parseMultipart(request);
        const { installationId, clientUploadId, bytes, filename } = multipart;
        if (!installationId || !clientUploadId || bytes.length === 0) {
          return jsonError("invalid_message", "installationId, clientUploadId and content are required", 400);
        }
        if (bytes.length < 1 || bytes.length > MAX_IMAGE_BYTES) return jsonError("payload_too_large", "attachment exceeds 10 MiB", 413);
        const image = inspectImage(bytes);
        const digest = createHash("sha256").update(bytes).digest("hex");
        const begun = options.attachments.begin({
          clientUploadId: `${installationId}:${clientUploadId}`,
          contentType: image.mimeType,
          totalBytes: bytes.length,
          chunkSize: bytes.length,
          filename,
          sha256: digest,
        });
        if (begun.kind === "conflict") return jsonError("idempotency_conflict", "clientUploadId already names different content", 409);
        let record = begun.record;
        if (record.state !== "complete") {
          record = options.attachments.appendChunk(record.id, { payload: bytes, offset: 0, contentSha256: digest }).record;
        }
        return Response.json({
          attachmentId: record.id,
          sha256: record.finalSha256,
          mimeType: image.mimeType,
          bytes: record.receivedBytes,
          width: image.width,
          height: image.height,
          expiresAt: new Date(record.expiresAt).toISOString(),
        }, { status: begun.kind === "duplicate" ? 200 : 201 });
      } catch (error) {
        if (error instanceof AttachmentError) return jsonError(error.code === "too_large" ? "payload_too_large" : "invalid_message", error.message, error.code === "too_large" ? 413 : 400);
        return jsonError("invalid_message", "malformed multipart upload", 400);
      }
    }
    const match = /^\/v1\/exports\/([0-9a-f-]{36})$/.exec(url.pathname);
    if (match) {
      if (request.method !== "GET") return jsonError("invalid_message", "GET required", 405);
      const id = match[1]!;
      const metadata = options.exports?.getExport(id);
      const file = options.exports?.exportFile(id);
      if (!metadata || metadata.completion.state !== "completed" || !file || !await file.exists()) return jsonError("export_unavailable", "export is unavailable", 404);
      return new Response(file, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "content-length": String(metadata.bytes),
          "content-disposition": `attachment; filename="pi-session-${id.slice(0, 8)}.html"`,
          "cache-control": "private, no-store",
        },
      });
    }
    return null;
  };
}

async function parseMultipart(request: Request): Promise<{ installationId: string; clientUploadId: string; filename: string; bytes: Uint8Array }> {
  if (!request.body) throw new Error("request body missing");
  return new Promise((resolve, reject) => {
    const fields: Record<string, string> = {};
    const chunks: Buffer[] = [];
    let filename = "image";
    let fileSeen = false;
    let truncated = false;
    const parser = new Busboy({
      headers: Object.fromEntries(request.headers.entries()) as { 'content-type': string; [key: string]: string },
      limits: { files: 1, fields: 3, fileSize: MAX_IMAGE_BYTES, parts: 4 },
    });
    parser.on("field", (name: string, value: string) => {
      if (name === "installationId" || name === "clientUploadId" || name === "intendedSessionId") fields[name] = value.slice(0, 200);
    });
    parser.on("file", (name: string, stream: NodeJS.ReadableStream, suppliedFilename: string) => {
      if (name !== "content" || fileSeen) { stream.resume(); return; }
      fileSeen = true;
      filename = suppliedFilename.slice(0, 200);
      stream.on("limit", () => { truncated = true; });
      stream.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    });
    parser.on("error", reject);
    parser.on("finish", () => {
      if (truncated) { reject(new AttachmentError("too_large", "attachment exceeds 10 MiB")); return; }
      resolve({
        installationId: fields.installationId ?? "",
        clientUploadId: fields.clientUploadId ?? "",
        filename,
        bytes: Uint8Array.from(Buffer.concat(chunks)),
      });
    });
    Readable.fromWeb(request.body as never).pipe(parser);
  });
}

function jsonError(code: string, message: string, status: number): Response {
  return Response.json({ code, message, retryable: false, details: {} }, { status });
}
