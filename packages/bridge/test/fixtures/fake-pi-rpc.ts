const decoder = new TextDecoder();
let pending = "";
const credentialShape = `sk-${"fixture"}-secret`;
const privatePath = `/${"Users"}/fixture/repo`;
process.stderr.write(`HOME=${process.env.HOME ?? "missing"} token=${credentialShape} ${privatePath}\n`);
for await (const chunk of Bun.stdin.stream()) {
  pending += decoder.decode(chunk, { stream: true });
  while (pending.includes("\n")) {
    const index = pending.indexOf("\n");
    const line = pending.slice(0, index); pending = pending.slice(index + 1);
    if (!line) continue;
    const command = JSON.parse(line) as { id?: string; type: string; delayMs?: number };
    if (command.type === "hang") continue;
    if (command.delayMs) await Bun.sleep(command.delayMs);
    process.stdout.write(`${JSON.stringify({ type: "response", id: command.id, command: command.type, success: true, data: { echoed: command.type, hostile: process.env.HOSTILE ?? null } })}\n`);
  }
}
