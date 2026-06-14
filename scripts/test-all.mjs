/**
 * Integration smoke tests against local dev server.
 * Start: npm run dev
 * Run: node scripts/test-all.mjs
 */
const BASE = process.env.TEST_BASE || "http://localhost:3000";

async function get(path) {
  const r = await fetch(`${BASE}${path}`);
  const text = await r.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: r.status, json };
}

async function post(path, body = {}) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: r.status, json };
}

const routes = [
  ["GET /", () => get("/")],
  ["GET /api/health", () => get("/api/health")],
  ["GET /api/thoughts (guest)", () => get("/api/thoughts")],
  ["POST /api/claude/interpret (guest)", () => post("/api/claude/interpret", {})],
  ["POST /api/claude/branch (guest)", () => post("/api/claude/branch", { content: "test" })],
  ["POST /api/claude/execute (guest)", () => post("/api/claude/execute", { instruction: "x", selection: "y" })],
  ["POST /api/claude/legibility (guest)", () => post("/api/claude/legibility", { threadId: "x" })],
  ["GET /api/tools (guest)", () => get("/api/tools")],
  ["GET /api/threads (guest)", () => get("/api/threads")],
];

let ok = 0;
for (const [name, fn] of routes) {
  try {
    const { status, json } = await fn();
    const pass =
      name === "GET /"
        ? status === 200
        : name.includes("health")
        ? status === 200 && json?.claude === true
        : status === 401 || status === 200;
    console.log(pass ? "✓" : "✗", name, `→ ${status}`, typeof json === "object" ? JSON.stringify(json).slice(0, 80) : "");
    if (pass) ok++;
  } catch (e) {
    console.log("✗", name, e.message);
  }
}

console.log(`\n${ok}/${routes.length} checks passed`);
if (ok < routes.length) process.exit(1);
