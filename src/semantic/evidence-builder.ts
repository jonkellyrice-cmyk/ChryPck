import { createHash } from "node:crypto";
import type { NativeContractRecord } from "../planning/planning-runner.js";
import type { RepositoryModel } from "../repository/model.js";
import { regionForPath, type SemanticRegionCandidate } from "./region-builder.js";
import type {
  SemanticEvidenceKind,
  SemanticEvidenceReference,
  SemanticRegionEvidence,
  SemanticRelationshipEvidence
} from "./types.js";

const MAX_REPRESENTATIVE_FILES = 8;
const MAX_REPRESENTATIVE_SYMBOLS = 12;
const MAX_RELATIONSHIPS = 8;
const MAX_EFFECTS = 8;
const MAX_STATES = 8;
const MAX_MANIFEST_FACTS = 8;
const MAX_DOCUMENTATION_HINTS = 4;
const MAX_DOC_HINT_CHARS = 480;

interface RelationshipAccumulator {
  readonly regionId: string;
  readonly files: Set<string>;
  edgeCount: number;
}

function evidenceId(regionId: string, kind: SemanticEvidenceKind, key: string): string {
  return `evidence:${createHash("sha256").update(`${regionId}:${kind}:${key}`).digest("hex").slice(0, 14)}`;
}

function boundedText(value: string, max = MAX_DOC_HINT_CHARS): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length <= max ? compact : `${compact.slice(0, max)}…`;
}

function documentationPath(path: string): boolean {
  const lower = path.toLowerCase();
  const name = lower.split("/").at(-1) ?? lower;
  return (
    name === "readme.md" ||
    name === "readme.mdx" ||
    name === "architecture.md" ||
    name === "contributing.md" ||
    lower.startsWith("docs/") && /\.(md|mdx|txt)$/.test(lower)
  );
}

function scopeContains(region: SemanticRegionCandidate, path: string): boolean {
  return region.kind === "repository" || region.paths.includes(path);
}

function filePriority(path: string): number {
  const lower = path.toLowerCase();
  const name = lower.split("/").at(-1) ?? lower;
  if (name === "package.json" || name === "module.json" || name === "system.json") return 0;
  if (/^(index|main|app|server|client|runtime)\.[cm]?[jt]sx?$/.test(name)) return 1;
  if (/adapter|bridge|registry|orchestrator|service|handler|runtime|entry/.test(name)) return 2;
  if (/test|spec/.test(name)) return 5;
  return 3;
}

function representativeFiles(region: SemanticRegionCandidate): readonly string[] {
  return Object.freeze(
    [...region.paths]
      .sort((left, right) => filePriority(left) - filePriority(right) || left.localeCompare(right))
      .slice(0, MAX_REPRESENTATIVE_FILES)
  );
}

function relationshipRows(
  accumulators: ReadonlyMap<string, RelationshipAccumulator>
): readonly SemanticRelationshipEvidence[] {
  return Object.freeze(
    [...accumulators.values()]
      .sort((left, right) => right.edgeCount - left.edgeCount || left.regionId.localeCompare(right.regionId))
      .slice(0, MAX_RELATIONSHIPS)
      .map(row => Object.freeze({
        region_id: row.regionId,
        file_count: row.files.size,
        edge_count: row.edgeCount,
        representative_paths: Object.freeze([...row.files].sort().slice(0, 6))
      }))
  );
}

function appendRelationship(
  map: Map<string, RelationshipAccumulator>,
  regionId: string,
  path: string
): void {
  const existing = map.get(regionId);
  if (existing) {
    existing.edgeCount += 1;
    existing.files.add(path);
    return;
  }
  map.set(regionId, { regionId, files: new Set([path]), edgeCount: 1 });
}

function manifestFacts(model: RepositoryModel, region: SemanticRegionCandidate): readonly string[] {
  const facts: string[] = [];
  for (const file of model.snapshot.files) {
    if (!scopeContains(region, file.path) || file.text === undefined) continue;
    const name = file.path.split("/").at(-1)?.toLowerCase() ?? "";
    if (name !== "package.json" && name !== "module.json" && name !== "system.json" && !name.endsWith("config.json")) continue;
    try {
      const value = JSON.parse(file.text) as Record<string, unknown>;
      for (const key of ["name", "title", "description", "version", "type", "main", "module"] as const) {
        if (typeof value[key] === "string" && String(value[key]).trim()) {
          facts.push(`${file.path}: ${key}=${boundedText(String(value[key]), 220)}`);
        }
      }
      if (value.scripts && typeof value.scripts === "object" && !Array.isArray(value.scripts)) {
        const scriptNames = Object.keys(value.scripts as Record<string, unknown>).sort().slice(0, 12);
        if (scriptNames.length) facts.push(`${file.path}: scripts=${scriptNames.join(", ")}`);
      }
    } catch {
      facts.push(`${file.path}: structured manifest present but could not be parsed as JSON`);
    }
    if (facts.length >= MAX_MANIFEST_FACTS) break;
  }
  return Object.freeze(facts.slice(0, MAX_MANIFEST_FACTS));
}

function documentationHints(model: RepositoryModel, region: SemanticRegionCandidate): readonly string[] {
  const hints: string[] = [];
  for (const file of model.snapshot.files) {
    if (!scopeContains(region, file.path) || file.text === undefined || !documentationPath(file.path)) continue;
    const lines = file.text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const heading = lines.find(line => /^#{1,3}\s+/.test(line));
    const prose = lines.find(line => !line.startsWith("#") && !line.startsWith("```") && line.length >= 24);
    const excerpt = [heading, prose].filter(Boolean).join(" — ");
    if (excerpt) hints.push(`${file.path}: ${boundedText(excerpt)}`);
    if (hints.length >= MAX_DOCUMENTATION_HINTS) break;
  }
  return Object.freeze(hints);
}

function nativeContractHints(
  records: readonly NativeContractRecord[],
  region: SemanticRegionCandidate
): readonly string[] {
  const output: string[] = [];
  for (const record of records) {
    const serialized = JSON.stringify(record.data);
    if (region.kind !== "repository" && !region.paths.some(path => serialized.includes(path))) continue;
    output.push(`${record.id} (${record.source})`);
    if (output.length >= 6) break;
  }
  return Object.freeze(output);
}

function evidenceReferences(args: {
  region: SemanticRegionCandidate;
  representativeFiles: readonly string[];
  incoming: readonly SemanticRelationshipEvidence[];
  outgoing: readonly SemanticRelationshipEvidence[];
  symbols: readonly string[];
  effects: readonly string[];
  states: readonly string[];
  manifests: readonly string[];
  docs: readonly string[];
  nativeContracts: readonly string[];
}): readonly SemanticEvidenceReference[] {
  const refs: SemanticEvidenceReference[] = [];
  const push = (kind: SemanticEvidenceKind, key: string, summary: string, paths: readonly string[]) => {
    refs.push(Object.freeze({ id: evidenceId(args.region.id, kind, key), kind, summary: boundedText(summary, 360), paths: Object.freeze([...paths].slice(0, 8)) }));
  };

  push("path-topology", "scope", `${args.region.pathScopes.join(", ")} contains ${args.region.paths.length} modeled files; representative files: ${args.representativeFiles.join(", ")}`, args.representativeFiles);
  if (args.incoming.length) push("dependency", "incoming", `Incoming dependency relationships from ${args.incoming.map(row => `${row.region_id}(${row.edge_count})`).join(", ")}`, args.incoming.flatMap(row => row.representative_paths));
  if (args.outgoing.length) push("dependency", "outgoing", `Outgoing dependency relationships to ${args.outgoing.map(row => `${row.region_id}(${row.edge_count})`).join(", ")}`, args.outgoing.flatMap(row => row.representative_paths));
  if (args.symbols.length) push("symbol", "symbols", `Representative symbols: ${args.symbols.join(", ")}`, args.representativeFiles);
  if (args.effects.length) push("effect", "effects", `Observed effects: ${args.effects.join(", ")}`, args.representativeFiles);
  if (args.states.length) push("state", "states", `Observed state namespaces: ${args.states.join(", ")}`, args.representativeFiles);
  for (const [index, fact] of args.manifests.entries()) push("manifest", `manifest-${index}`, fact, args.representativeFiles);
  for (const [index, hint] of args.docs.entries()) push("documentation", `docs-${index}`, hint, args.representativeFiles);
  for (const [index, contract] of args.nativeContracts.entries()) push("native-contract", `contract-${index}`, `Native/project contract evidence: ${contract}`, args.representativeFiles);
  return Object.freeze(refs);
}

function fingerprintEvidence(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function buildSemanticEvidencePackets(
  model: RepositoryModel,
  regions: readonly SemanticRegionCandidate[],
  nativeContracts: readonly NativeContractRecord[] = []
): readonly SemanticRegionEvidence[] {
  const assignedRegion = new Map(model.fileFacts.map(facts => [facts.file, regionForPath(regions, facts.file)] as const));

  return Object.freeze(regions.map(region => {
    const facts = model.fileFacts.filter(row => scopeContains(region, row.file));
    const files = representativeFiles(region);
    const symbols = Object.freeze(
      facts.flatMap(row => row.symbols)
        .filter(symbol => symbol.exported || /handler|adapter|bridge|service|runtime|registry|orchestrator/i.test(symbol.name))
        .map(symbol => symbol.name)
        .filter((name, index, all) => all.indexOf(name) === index)
        .slice(0, MAX_REPRESENTATIVE_SYMBOLS)
    );
    const effects = Object.freeze(
      [...new Set(facts.flatMap(row => row.effects.map(effect => `${effect.kind}:${effect.detail}`)))].slice(0, MAX_EFFECTS)
    );
    const states = Object.freeze(
      [...new Set(facts.flatMap(row => row.states.map(state => `${state.namespace}.${state.key}`)))].slice(0, MAX_STATES)
    );

    const incomingMap = new Map<string, RelationshipAccumulator>();
    const outgoingMap = new Map<string, RelationshipAccumulator>();
    if (region.kind !== "repository") {
      for (const edge of model.dependencies) {
        const from = assignedRegion.get(edge.from);
        const to = assignedRegion.get(edge.to);
        if (!from || !to || from.id === to.id) continue;
        if (to.id === region.id) appendRelationship(incomingMap, from.id, edge.from);
        if (from.id === region.id) appendRelationship(outgoingMap, to.id, edge.to);
      }
    }
    const incoming = relationshipRows(incomingMap);
    const outgoing = relationshipRows(outgoingMap);
    const manifests = manifestFacts(model, region);
    const docs = documentationHints(model, region);
    const native = nativeContractHints(nativeContracts, region);
    const evidence = evidenceReferences({
      region,
      representativeFiles: files,
      incoming,
      outgoing,
      symbols,
      effects,
      states,
      manifests,
      docs,
      nativeContracts: native
    });
    const packetWithoutFingerprint = {
      id: region.id,
      kind: region.kind,
      name_hint: region.nameHint,
      path_scopes: region.pathScopes,
      file_count: region.paths.length,
      modeled_file_count: facts.length,
      representative_files: files,
      representative_symbols: symbols,
      incoming_regions: incoming,
      outgoing_regions: outgoing,
      observed_effects: effects,
      observed_state_namespaces: states,
      manifest_facts: manifests,
      documentation_hints: docs,
      evidence
    };
    return Object.freeze({ ...packetWithoutFingerprint, fingerprint: fingerprintEvidence(packetWithoutFingerprint) });
  }));
}
