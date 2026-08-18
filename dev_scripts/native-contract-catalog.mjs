#!/usr/bin/env node

/**
 * Frame Conn Native Contract Catalog
 *
 * Persists already-proven native Lancer integration contracts with explicit
 * version/source/hash evidence. Querying the catalog avoids rediscovering
 * authoritative APIs; verification detects when the upstream evidence drifts.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const VERSION = "1.0.0";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_CATALOG = path.join(ROOT, "dev_scripts", "native-contract-catalog.json");

function parseArgs(argv) {
  const out = {
    catalog: DEFAULT_CATALOG,
    nativeRoot: null,
    query: null,
    show: null,
    verify: false,
    requireSource: false,
    json: false,
    selfTest: false
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--catalog") out.catalog = path.resolve(ROOT, argv[++i] ?? "");
    else if (arg === "--native-root") out.nativeRoot = path.resolve(argv[++i] ?? "");
    else if (arg === "--query") out.query = argv[++i] ?? "";
    else if (arg === "--show") out.show = argv[++i] ?? "";
    else if (arg === "--verify") out.verify = true;
    else if (arg === "--require-source") out.requireSource = true;
    else if (arg === "--json") out.json = true;
    else if (arg === "--self-test") out.selfTest = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(`Frame Conn Native Contract Catalog v${VERSION}\n\nUsage:\n  npm run native-contracts\n  npm run native-contracts -- --query \"basic attack\"\n  npm run native-contracts -- --show native.actor.basic-attack-entrypoint\n  npm run native-contracts:verify -- --native-root /path/to/foundryvtt-lancer\n  npm run native-contracts -- --verify [--native-root path] [--require-source] [--json]\n  npm run native-contracts:self-test`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return out;
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function validateCatalog(catalog) {
  const errors = [];
  if (catalog?.schema_version !== 1) errors.push("schema_version must be 1");
  if (!catalog?.native_system?.name) errors.push("native_system.name is required");
  if (!catalog?.native_system?.version) errors.push("native_system.version is required");
  if (!catalog?.native_system?.git_commit) errors.push("native_system.git_commit is required");
  if (!Array.isArray(catalog?.contracts)) errors.push("contracts must be an array");

  const ids = new Set();
  for (const [index, contract] of (catalog.contracts ?? []).entries()) {
    const prefix = `contracts[${index}]`;
    if (!contract?.id) errors.push(`${prefix}.id is required`);
    else if (ids.has(contract.id)) errors.push(`duplicate contract id: ${contract.id}`);
    else ids.add(contract.id);
    if (contract?.status !== "proven") errors.push(`${prefix}.status must be proven`);
    if (!contract?.summary) errors.push(`${prefix}.summary is required`);
    if (!contract?.boundary?.owner_family) errors.push(`${prefix}.boundary.owner_family is required`);
    if (!contract?.boundary?.rule) errors.push(`${prefix}.boundary.rule is required`);
    if (!Array.isArray(contract?.evidence) || contract.evidence.length === 0) errors.push(`${prefix}.evidence must be non-empty`);
    for (const [eIndex, evidence] of (contract.evidence ?? []).entries()) {
      const ePrefix = `${prefix}.evidence[${eIndex}]`;
      if (!evidence?.source_path) errors.push(`${ePrefix}.source_path is required`);
      if (!evidence?.symbol) errors.push(`${ePrefix}.symbol is required`);
      if (!Number.isInteger(evidence?.line_start) || evidence.line_start < 1) errors.push(`${ePrefix}.line_start must be a positive integer`);
      if (!Number.isInteger(evidence?.line_end) || evidence.line_end < evidence.line_start) errors.push(`${ePrefix}.line_end is invalid`);
      for (const key of ["source_sha256", "slice_sha256"]) {
        if (!/^[a-f0-9]{64}$/.test(String(evidence?.[key] ?? ""))) errors.push(`${ePrefix}.${key} must be a SHA-256 hex digest`);
      }
      if (!evidence?.proof) errors.push(`${ePrefix}.proof is required`);
    }
  }
  return errors;
}

function nativeVersion(nativeRoot) {
  const packageFile = path.join(nativeRoot, "package.json");
  if (!fs.existsSync(packageFile)) return null;
  try {
    return String(readJson(packageFile).version ?? "") || null;
  } catch {
    return null;
  }
}

function verifyEvidence(nativeRoot, catalog, contract, evidence) {
  const file = path.join(nativeRoot, evidence.source_path);
  if (!fs.existsSync(file)) {
    return { contract: contract.id, source: evidence.source_path, symbol: evidence.symbol, status: "missing-source" };
  }
  const bytes = fs.readFileSync(file);
  const text = bytes.toString("utf8");
  const lines = text.split(/(?<=\n)/);
  const slice = lines.slice(evidence.line_start - 1, evidence.line_end).join("");
  const sourceActual = sha256(bytes);
  const sliceActual = sha256(Buffer.from(slice, "utf8"));
  let status = "verified";
  if (sliceActual !== evidence.slice_sha256) status = "contract-drift";
  else if (sourceActual !== evidence.source_sha256) status = "source-drift";
  return {
    contract: contract.id,
    source: evidence.source_path,
    symbol: evidence.symbol,
    status,
    expected_source_sha256: evidence.source_sha256,
    actual_source_sha256: sourceActual,
    expected_slice_sha256: evidence.slice_sha256,
    actual_slice_sha256: sliceActual
  };
}

function verifyCatalog(catalog, nativeRoot, requireSource) {
  const schemaErrors = validateCatalog(catalog);
  const result = {
    schema: schemaErrors.length === 0 ? "valid" : "invalid",
    schema_errors: schemaErrors,
    source: nativeRoot ? "checked" : "not-checked",
    expected_native_version: catalog.native_system?.version ?? null,
    actual_native_version: nativeRoot ? nativeVersion(nativeRoot) : null,
    evidence: []
  };

  if (!nativeRoot) {
    if (requireSource) result.schema_errors.push("--require-source was set but --native-root was not provided");
    return result;
  }

  for (const contract of catalog.contracts ?? []) {
    for (const evidence of contract.evidence ?? []) {
      result.evidence.push(verifyEvidence(nativeRoot, catalog, contract, evidence));
    }
  }
  return result;
}

const QUERY_STOPWORDS = new Set([
  "a", "an", "and", "authoritative", "choice", "committed",
  "conn", "entrypoint", "execution", "for", "frame", "from", "in", "into",
  "lancer", "native", "of", "on", "show", "the", "through", "to",
  "ui", "use", "via", "with", "wire"
]);

function queryTerms(query) {
  return [...new Set(
    String(query ?? "")
      .toLowerCase()
      .match(/[a-z0-9][a-z0-9._-]*/g) ?? []
  )].filter(term => term.length > 1 && !QUERY_STOPWORDS.has(term));
}

function fieldContains(field, term) {
  return String(field ?? "").toLowerCase().includes(term);
}

function scoreContractForTerms(contract, terms) {
  let score = 0;
  let specificHits = 0;
  const keywords = contract.keywords ?? [];
  const evidence = contract.evidence ?? [];

  for (const term of terms) {
    let termScore = 0;
    if (fieldContains(contract.id, term)) termScore = Math.max(termScore, 8);
    if (fieldContains(contract.title, term)) termScore = Math.max(termScore, 7);
    if (keywords.some(keyword => fieldContains(keyword, term))) termScore = Math.max(termScore, 7);
    if (evidence.some(item => fieldContains(item.symbol, term))) termScore = Math.max(termScore, 5);
    if (fieldContains(contract.summary, term)) termScore = Math.max(termScore, 4);
    if (evidence.some(item => fieldContains(item.proof, term))) termScore = Math.max(termScore, 3);
    if (evidence.some(item => fieldContains(item.source_path, term))) termScore = Math.max(termScore, 2);
    if (fieldContains(contract.boundary?.rule, term)) termScore = Math.max(termScore, 1);

    if (termScore > 0) {
      score += termScore;
      specificHits += 1;
    }
  }

  return { score, specificHits };
}

function queryContracts(catalog, query) {
  const terms = queryTerms(query);
  if (!terms.length) return [];

  const ranked = (catalog.contracts ?? [])
    .map(contract => ({ contract, ...scoreContractForTerms(contract, terms) }))
    .filter(item => item.specificHits > 0 && item.score >= 4)
    .sort((a, b) => b.score - a.score || b.specificHits - a.specificHits || a.contract.id.localeCompare(b.contract.id));

  if (!ranked.length) return [];
  const bestScore = ranked[0].score;
  const relevanceFloor = Math.max(4, Math.ceil(bestScore * 0.5));
  return ranked.filter(item => item.score >= relevanceFloor).slice(0, 5).map(item => item.contract);
}

function printContract(contract, nativeSystem) {
  console.log(`\n${contract.id}`);
  console.log(`  ${contract.title}`);
  console.log(`  kind=${contract.contract_kind} status=${contract.status} owner=${contract.boundary.owner_family}`);
  console.log(`  native=${nativeSystem.name}@${nativeSystem.version} commit=${nativeSystem.git_commit}`);
  console.log(`  ${contract.summary}`);
  console.log(`  boundary: ${contract.boundary.rule}`);
  for (const evidence of contract.evidence) {
    console.log(`  evidence: ${evidence.source_path}:${evidence.line_start}-${evidence.line_end} ${evidence.symbol}`);
    console.log(`    source_sha256=${evidence.source_sha256}`);
    console.log(`    slice_sha256=${evidence.slice_sha256}`);
    console.log(`    proof=${evidence.proof}`);
  }
}

function verificationFailed(report) {
  if (report.schema_errors.length) return true;
  if (report.actual_native_version && report.actual_native_version !== report.expected_native_version) return true;
  return report.evidence.some(item => item.status !== "verified");
}

function selfTest() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "frame-conn-native-contracts-"));
  try {
    const nativeRoot = path.join(temp, "native");
    fs.mkdirSync(path.join(nativeRoot, "src"), { recursive: true });
    fs.writeFileSync(path.join(nativeRoot, "package.json"), JSON.stringify({ version: "9.9.9" }));
    const source = "export function demo() {\n  return 7;\n}\n";
    fs.writeFileSync(path.join(nativeRoot, "src", "demo.ts"), source);
    const catalog = {
      schema_version: 1,
      catalog_id: "test",
      native_system: { name: "demo", version: "9.9.9", git_commit: "abcdef" },
      contracts: [{
        id: "native.demo",
        title: "Demo",
        status: "proven",
        contract_kind: "native-entrypoint",
        summary: "Demo contract",
        keywords: ["demo"],
        boundary: { owner_family: "native-adapter", frame_conn_consumers: [], rule: "Use demo." },
        evidence: [{
          source_path: "src/demo.ts",
          symbol: "demo",
          line_start: 1,
          line_end: 3,
          source_sha256: sha256(Buffer.from(source)),
          slice_sha256: sha256(Buffer.from(source)),
          proof: "Synthetic proof"
        }]
      }]
    };
    const report = verifyCatalog(catalog, nativeRoot, true);
    if (verificationFailed(report)) throw new Error("fresh evidence did not verify");
    if (queryContracts(catalog, "demo").length !== 1) throw new Error("query failed");
    const specificityCatalog = {
      ...catalog,
      contracts: [
        ...catalog.contracts,
        {
          ...catalog.contracts[0],
          id: "native.other",
          title: "Other native execution entrypoint",
          summary: "An unrelated attack contract",
          keywords: ["attack"],
          evidence: catalog.contracts[0].evidence.map(item => ({ ...item, symbol: "attackHandler" }))
        }
      ]
    };
    const specific = queryContracts(specificityCatalog, "wire committed demo through the authoritative native execution entrypoint");
    if (specific.length !== 1 || specific[0].id !== "native.demo") throw new Error("query specificity failed");
    fs.appendFileSync(path.join(nativeRoot, "src", "demo.ts"), "// unrelated drift\n");
    const drift = verifyCatalog(catalog, nativeRoot, true);
    if (drift.evidence[0]?.status !== "source-drift") throw new Error("source drift was not detected");
    console.log("[native-contract-catalog] Self-test passed.");
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

const options = parseArgs(process.argv);
if (options.selfTest) {
  selfTest();
  process.exit(0);
}

const catalog = readJson(options.catalog);
const schemaErrors = validateCatalog(catalog);
if (schemaErrors.length) {
  console.error("Native Contract Catalog schema invalid:");
  for (const error of schemaErrors) console.error(`  - ${error}`);
  process.exit(1);
}

if (options.verify) {
  const report = verifyCatalog(catalog, options.nativeRoot, options.requireSource);
  if (options.json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`Frame Conn Native Contract Catalog verification`);
    console.log(`catalog=${catalog.catalog_id} contracts=${catalog.contracts.length}`);
    console.log(`expected_native=${catalog.native_system.name}@${catalog.native_system.version} commit=${catalog.native_system.git_commit}`);
    if (options.nativeRoot) console.log(`actual_native_version=${report.actual_native_version ?? "unknown"}`);
    for (const item of report.evidence) console.log(`  ${item.status} ${item.contract} ${item.source}:${item.symbol}`);
    if (!options.nativeRoot) console.log("  source verification skipped; provide --native-root to re-hash authoritative native source");
  }
  process.exit(verificationFailed(report) ? 1 : 0);
}

let contracts = catalog.contracts;
if (options.show) {
  contracts = contracts.filter(contract => contract.id === options.show);
  if (!contracts.length) {
    console.error(`Native contract not found: ${options.show}`);
    process.exit(1);
  }
} else if (options.query !== null) {
  contracts = queryContracts(catalog, options.query);
}

if (options.json) {
  console.log(JSON.stringify({ native_system: catalog.native_system, contracts }, null, 2));
} else {
  console.log(`Frame Conn Native Contract Catalog v${VERSION}`);
  console.log(`${contracts.length}/${catalog.contracts.length} proven contracts selected`);
  for (const contract of contracts) printContract(contract, catalog.native_system);
}
