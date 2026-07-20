import { afterEach, describe, expect, test } from "bun:test";
import { RpcAbortError, RpcDuplicateIdError, RpcProcess, RpcTimeoutError } from "../src/pi/rpc-process";

const processes: RpcProcess[] = [];
function create(): RpcProcess {
  const executable = Bun.which("bun");
  if (!executable) throw new Error("bun executable unavailable");
  const process = new RpcProcess({
    executable,
    args: [new URL("./fixtures/fake-pi-rpc.ts", import.meta.url).pathname],
    cwd: new URL("../../..", import.meta.url).pathname,
    environment: { SAFE: "yes" },
    pathDirs: [new URL("../../../node_modules/.bin", import.meta.url).pathname],
    defaultRequestTimeoutMs: 200,
    closeGracePeriodMs: 100,
  });
  processes.push(process);
  return process;
}
afterEach(async () => { await Promise.all(processes.splice(0).map((process) => process.close())); });

describe("Pi RPC subprocess transport", () => {
  test("correlates exact Pi wire responses and does not inherit hostile environment", async () => {
    process.env.HOSTILE = "must-not-leak";
    const rpc = create(); await rpc.start();
    const result = await rpc.request({ id: "one", method: "get_state" });
    expect(result).toEqual({ echoed: "get_state", hostile: null });
    await Bun.sleep(10);
    expect(rpc.getStderrJoined()).not.toContain(`sk-${"fixture"}-secret`);
    expect(rpc.getStderrJoined()).not.toContain(`/${"Users"}/fixture/repo`);
  });

  test("rejects duplicate IDs, timeout, and cancellation", async () => {
    const rpc = create(); await rpc.start();
    const hanging = rpc.request({ id: "same", method: "hang", timeoutMs: 500 });
    expect(rpc.request({ id: "same", method: "get_state" })).rejects.toBeInstanceOf(RpcDuplicateIdError);
    expect(rpc.request({ id: "timeout", method: "hang", timeoutMs: 10 })).rejects.toBeInstanceOf(RpcTimeoutError);
    const controller = new AbortController();
    const aborted = rpc.request({ id: "abort", method: "hang", signal: controller.signal }); controller.abort();
    expect(aborted).rejects.toBeInstanceOf(RpcAbortError);
    await expect(hanging).rejects.toBeInstanceOf(RpcTimeoutError);
  });
});
