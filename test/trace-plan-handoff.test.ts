import test from "node:test";
import assert from "node:assert/strict";

import { NativeMcpService } from "../src/mcp/service.js";
import { validateTraceHandoff } from "../src/planning/trace-handoff.js";
import type { RepositoryAdapter, RepositoryPublishRequest } from "../src/repository/adapter.js";
import { createSnapshot, type RepositorySnapshot } from "../src/repository/snapshot.js";
import { createBuiltinProjectProfileRegistry } from "../src/project/builtin-profiles.js";

class TraceRepository implements RepositoryAdapter {
  sha = "a".repeat(40);
  readonly files = [
    {
      path: "src/entry.ts",
      text: 'import { helper } from "./helper.js";\nexport function entry(){ return helper(); }'
    },
    {
      path: "src/helper.ts",
      text: "export function helper(){ return 1; }"
    },
    {
      path: "src/unrelated.ts",
      text: "export function unrelated(){ return 0; }"
    }
  ];

  async snapshot(repository: string, _ref: string): Promise<RepositorySnapshot> {
    return createSnapshot(
      repository,
      this.sha,
      this.files.map((file, index) => ({
        path: file.path,
        sha: `blob-${index}`,
        size: file.text.length,
        text: file.text,
        kind: "source" as const
      })),
      "2026-01-01T00:00:00Z"
    );
  }

  async publish(_request: RepositoryPublishRequest): Promise<never> {
    throw new Error("Trace handoff tests are read-only.");
  }
}

function serviceOptions(allowedRepositories = new Set(["owner/repo"])) {
  return {
    allowedRepositories,
    defaultTargetRef: "main",
    maxMutationFileBytes: 4096,
    semanticMaxRegions: 8,
    semanticRegionsPerChunk: 2,
    semanticCacheEntries: 8,
    projectProfiles: createBuiltinProjectProfileRegistry()
  };
}

async function completeSemanticBootstrap(service: NativeMcpService, input: any): Promise<any> {
  let response: any = await service.plan(input);
  let iterations = 0;
  while (response.semantic_bootstrap?.status === "required") {
    iterations += 1;
    assert.ok(iterations < 20, "semantic bootstrap must remain bounded");
    const chunk = response.semantic_bootstrap.current_chunk;
    const interpretations = chunk.regions.map((region: any) => {
      const evidenceId = String(region.evidence?.[0]?.id ?? "");
      assert.ok(evidenceId);
      return {
        region_id: region.id,
        name: region.name_hint,
        purpose: {
          text: `${region.name_hint} serves the behavior represented by this bounded metadata region.`,
          evidence_refs: [evidenceId]
        }
      };
    });
    response = await service.plan({
      ...input,
      semantic_bootstrap: {
        bootstrap_id: chunk.bootstrap_id,
        chunk_id: chunk.chunk_id,
        interpretations
      }
    });
  }
  return response;
}

async function createCertifiedTrace(service: NativeMcpService): Promise<any> {
  const response = await completeSemanticBootstrap(service, {
    repository: "owner/repo",
    objective: "Run entry, call helper",
    base_ref: "main",
    analysis: {
      kind: "trace",
      sourceSymbol: "entry",
      options: { maxHops: 8, maxBranches: 3 }
    }
  });
  assert.equal(response.analysis.kind, "trace");
  assert.equal(response.analysis.result.status, "CERTIFIED");
  assert.ok(response.analysis.result.certificate?.certificateId);
  assert.ok(response.analysis.result.path.some((hop: any) => hop.file === "src/helper.ts"));
  assert.equal(response.permitted_next_action, "create_normal_plan_with_trace_handoff");
  return response;
}

test("Trace and normal planning use distinct run identities and Trace is persisted authoritatively", async () => {
  const service = new NativeMcpService(new TraceRepository(), serviceOptions());
  const trace = await createCertifiedTrace(service);

  const plainPlan: any = await service.plan({
    repository: "owner/repo",
    objective: "Run entry, call helper",
    base_ref: "main"
  });
  assert.notEqual(trace.run_id, plainPlan.run_id);

  const traceResult: any = service.result({ run_id: trace.run_id });
  assert.equal(traceResult.analysis.kind, "trace");
  assert.equal(traceResult.analysis.result.certificate.certificateId, trace.analysis.result.certificate.certificateId);
  assert.equal(traceResult.artifacts.traceStatus, "CERTIFIED");
});

test("certified Trace handoff informs a fresh normal plan without directly authorizing the full Trace path", async () => {
  const service = new NativeMcpService(new TraceRepository(), serviceOptions());
  const trace = await createCertifiedTrace(service);
  const certificateId = trace.analysis.result.certificate.certificateId;

  const plan: any = await service.plan({
    repository: "owner/repo",
    objective: "Run entry",
    base_ref: "main",
    trace_handoff: {
      run_id: trace.run_id,
      certificate_id: certificateId
    }
  });

  assert.equal(plan.state, "READY");
  assert.notEqual(plan.run_id, trace.run_id);
  assert.equal(plan.trace_handoff.source_run_id, trace.run_id);
  assert.equal(plan.trace_handoff.certificate_id, certificateId);
  assert.ok(plan.corridor.corridor.includes("src/entry.ts"));
  assert.equal(
    plan.corridor.corridor.includes("src/helper.ts"),
    false,
    "a Trace hop must not become mutation-authorized merely because it appeared in the prior Trace"
  );

  const context: any = service.context({ run_id: plan.run_id });
  assert.ok(context.granted_paths.includes("src/entry.ts"));
  assert.equal(context.granted_paths.includes("src/helper.ts"), false);

  const result: any = service.result({ run_id: plan.run_id });
  assert.equal(result.trace_handoff.source_run_id, trace.run_id);
  assert.equal(result.trace_handoff.certificate_id, certificateId);
  assert.equal(result.analysis, null);
});

test("Trace handoff rejects unknown or forged lineage and incompatible repository state", async () => {
  const repository = new TraceRepository();
  const service = new NativeMcpService(repository, serviceOptions());
  const trace = await createCertifiedTrace(service);
  const traceResult = trace.analysis.result;

  await assert.rejects(
    () => service.plan({
      repository: "owner/repo",
      objective: "Run entry",
      base_ref: "main",
      trace_handoff: { run_id: "missing-run" }
    }),
    /Trace handoff rejected: source run does not exist/
  );

  await assert.rejects(
    () => service.plan({
      repository: "owner/repo",
      objective: "Run entry",
      base_ref: "main",
      trace_handoff: { run_id: trace.run_id, certificate_id: "forged-certificate" }
    }),
    /supplied certificate does not match/
  );

  const source = {
    runId: trace.run_id,
    repository: "owner/repo",
    commitSha: repository.sha,
    projectProfile: trace.project_profile,
    trace: traceResult
  };

  assert.throws(
    () => validateTraceHandoff(
      { run_id: trace.run_id },
      source,
      { repository: "owner/other", commitSha: repository.sha, projectProfile: trace.project_profile }
    ),
    /different repository/
  );
  assert.throws(
    () => validateTraceHandoff(
      { run_id: trace.run_id },
      source,
      { repository: "owner/repo", commitSha: "b".repeat(40), projectProfile: trace.project_profile }
    ),
    /different immutable commit/
  );
  assert.throws(
    () => validateTraceHandoff(
      { run_id: trace.run_id },
      source,
      { repository: "owner/repo", commitSha: repository.sha, projectProfile: "other-profile" }
    ),
    /different project profile/
  );

  assert.throws(
    () => validateTraceHandoff(
      { run_id: trace.run_id },
      { ...source, trace: { ...traceResult, status: "UNABLE_TO_CERTIFY" as const } },
      { repository: "owner/repo", commitSha: repository.sha, projectProfile: trace.project_profile }
    ),
    /not eligible for planning lineage/
  );
});
