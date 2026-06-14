/**
 * Smoke-test Claude layer functions (requires ANTHROPIC_API_KEY in .env).
 * Run: node scripts/test-claude.mjs
 */
import { config } from "dotenv";
import Anthropic from "@anthropic-ai/sdk";

config({ path: ".env" });
config({ path: ".env.local" });

const key = process.env.ANTHROPIC_API_KEY;
const model = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";

if (!key) {
  console.error("FAIL: ANTHROPIC_API_KEY not set");
  process.exit(1);
}

const client = new Anthropic({ apiKey: key });

async function ping() {
  const msg = await client.messages.create({
    model,
    max_tokens: 32,
    messages: [{ role: "user", content: 'Reply with exactly: {"ok":true}' }],
  });
  const text = msg.content.find((b) => b.type === "text")?.text ?? "";
  console.log("Claude ping:", text.slice(0, 80));
  return text.includes("ok");
}

const tests = [
  ["ping", ping],
];

let passed = 0;
for (const [name, fn] of tests) {
  try {
    const ok = await fn();
    console.log(ok ? `✓ ${name}` : `✗ ${name}`);
    if (ok) passed++;
  } catch (e) {
    console.error(`✗ ${name}:`, e.message);
  }
}

console.log(`\n${passed}/${tests.length} passed`);
process.exit(passed === tests.length ? 0 : 1);
