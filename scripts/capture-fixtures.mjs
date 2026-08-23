import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Locate the repo root relative to this script, so the script runs from anywhere.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

// The prototype lives outside this repo. PAIR_PROTOTYPE lets a test override it.
const protoPath = process.env.PAIR_PROTOTYPE || "/Users/owen/dev/claude-config/hooks/pair-mode.py";

if (!existsSync(protoPath)) {
  console.error(`pair-mode prototype not found at ${protoPath}. Set PAIR_PROTOTYPE to override.`);
  process.exit(1);
}

const casesDir = path.join(repoRoot, "test/fixtures/cases");
const expectedDir = path.join(repoRoot, "test/fixtures/expected");
const collectDir = path.join(repoRoot, "test/fixtures/collect");

mkdirSync(expectedDir, { recursive: true });

// One render case per directory under test/fixtures/cases: before.txt, after.txt, meta.json.
function listDirs(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

const renderCases = listDirs(casesDir).map((id) => {
  const dir = path.join(casesDir, id);
  const meta = JSON.parse(readFileSync(path.join(dir, "meta.json"), "utf8"));
  const before = readFileSync(path.join(dir, "before.txt"), "utf8");
  const after = readFileSync(path.join(dir, "after.txt"), "utf8");
  return { id, before, after, tool: meta.tool, path: meta.path };
});

const collectCases = listDirs(collectDir).map((id) => {
  const dir = path.join(collectDir, id);
  const input = JSON.parse(readFileSync(path.join(dir, "input.json"), "utf8"));
  return { id, original: input.original, numbers: input.numbers, saved: input.saved };
});

// A here-document feeds this source to python3's stdin, so case data and the result path travel through environment variables instead.
const pythonScript = `
import importlib.util
import json
import os

proto_path = os.environ["PAIR_PROTOTYPE_PATH"]
spec = importlib.util.spec_from_file_location("pair_mode_prototype", proto_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

payload = json.loads(os.environ["PAIR_PAYLOAD"])
render_out = {}

for case in payload["render_cases"]:
    left, right, numbers = module.render_split(case["before"], case["after"], case["tool"], case["path"])
    render_out[case["id"]] = {"left": left, "right": right, "numbers": numbers}

collect_out = {}

for case in payload["collect_cases"]:
    notes = module.collect(case["original"], case["numbers"], case["saved"])
    collect_out[case["id"]] = [{"line": number, "code": code, "text": text} for number, code, text in notes]

with open(os.environ["PAIR_RESULT_PATH"], "w", encoding="utf-8") as fh:
    json.dump({"render": render_out, "collect": collect_out}, fh)
`;

const resultPath = path.join(tmpdir(), `pair-fixtures-${process.pid}.json`);
const shellCommand = `python3 - <<'PAIR_CAPTURE_EOF'\n${pythonScript}\nPAIR_CAPTURE_EOF`;

const result = spawnSync("bash", ["-c", shellCommand], {
  env: {
    ...process.env,
    PAIR_PROTOTYPE_PATH: protoPath,
    PAIR_PAYLOAD: JSON.stringify({ render_cases: renderCases, collect_cases: collectCases }),
    PAIR_RESULT_PATH: resultPath,
  },
  encoding: "utf8",
});

if (result.status !== 0) {
  console.error(result.stderr || result.stdout || "python3 exited with a non-zero status");
  process.exit(1);
}

const parsed = JSON.parse(readFileSync(resultPath, "utf8"));

for (const [id, fixture] of Object.entries(parsed.render)) {
  const outPath = path.join(expectedDir, `${id}.json`);
  writeFileSync(outPath, `${JSON.stringify(fixture, null, 2)}\n`);
}

for (const collectCase of collectCases) {
  const outPath = path.join(collectDir, collectCase.id, "expected.json");
  writeFileSync(outPath, `${JSON.stringify(parsed.collect[collectCase.id], null, 2)}\n`);
}

console.log(
  `Wrote ${Object.keys(parsed.render).length} expected files and ${collectCases.length} collect files.`,
);
