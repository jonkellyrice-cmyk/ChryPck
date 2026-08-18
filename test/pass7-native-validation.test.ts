import assert from "node:assert/strict";
import test from "node:test";
import { buildValidationCommandPlan } from "../src/validation/command-plan.js";
import { IsolatedSandboxRunner, type SandboxExecutionRequest, type SandboxExecutor } from "../src/validation/sandbox-runner.js";
import { createStructuralValidator } from "../src/validation/structural-validator.js";
import { runNativeValidation } from "../src/validation/validation-runner.js";

class FakeExecutor implements SandboxExecutor {
  readonly requests: SandboxExecutionRequest[] = [];
  constructor(private readonly exitCode = 0, private readonly timedOut = false) {}
  async execute(request: SandboxExecutionRequest) { this.requests.push(request); return { exitCode: this.exitCode, stdout: "ok", stderr: "", timedOut: this.timedOut }; }
}

const policy = { allowedExecutables: new Set(["npm", "node"]), maxCommands: 4, maxTimeoutMs: 120000, defaultTimeoutMs: 30000 };
const structural = createStructuralValidator({ maxFileBytes: 10000 });
const workspace = [{ path: "src/a.ts", content: "export const a = 1;" }];

test("command planning is argv-only and policy bounded", () => {
  const plan = buildValidationCommandPlan([{ id:"test", executable:"npm", args:["test"], cwd:"." }], policy);
  assert.equal(plan.commands[0]?.executable, "npm");
  assert.throws(() => buildValidationCommandPlan([{ id:"shell", executable:"bash", args:["-c", "rm -rf /"] }], policy));
  assert.throws(() => buildValidationCommandPlan([{ id:"escape", executable:"node", cwd:"../outside" }], policy));
});

test("isolated runner always applies hard isolation flags", async () => {
  const executor = new FakeExecutor();
  const runner = new IsolatedSandboxRunner(executor, { imageRef:"validator@sha256:abc", maxOutputBytes:1024, limits:{memoryMb:512,cpuCount:1,pids:64} });
  const command = buildValidationCommandPlan([{ id:"test", executable:"npm", args:["test"] }], policy).commands[0]!;
  await runner.run(command, workspace);
  const request = executor.requests[0]!;
  assert.equal(request.network, "none");
  assert.equal(request.readOnlyRootFilesystem, true);
  assert.equal(request.noNewPrivileges, true);
  assert.equal(request.dropAllCapabilities, true);
  assert.deepEqual(request.environment, {});
});

test("structural failure prevents repository command execution", async () => {
  const executor = new FakeExecutor();
  const runner = new IsolatedSandboxRunner(executor, { imageRef:"validator@sha256:abc", maxOutputBytes:1024, limits:{memoryMb:512,cpuCount:1,pids:64} });
  const report = await runNativeValidation({ structuralContext:{changes:[{path:"bad.json",before:"{}",after:"{"}]}, structuralValidators:[structural], commandPlan:buildValidationCommandPlan([{id:"test",executable:"npm",args:["test"]}],policy), workspace, sandboxRunner:runner });
  assert.equal(report.passed, false);
  assert.equal(executor.requests.length, 0);
});

test("required sandbox failure fails closed while optional failure is warning", async () => {
  const requiredRunner = new IsolatedSandboxRunner(new FakeExecutor(1), { imageRef:"validator@sha256:abc", maxOutputBytes:1024, limits:{memoryMb:512,cpuCount:1,pids:64} });
  const required = await runNativeValidation({ structuralContext:{changes:[{path:"src/a.ts",before:"a",after:"b"}]}, structuralValidators:[structural], commandPlan:buildValidationCommandPlan([{id:"test",executable:"npm",args:["test"]}],policy), workspace, sandboxRunner:requiredRunner });
  assert.equal(required.passed, false);
  const optionalRunner = new IsolatedSandboxRunner(new FakeExecutor(1), { imageRef:"validator@sha256:abc", maxOutputBytes:1024, limits:{memoryMb:512,cpuCount:1,pids:64} });
  const optional = await runNativeValidation({ structuralContext:{changes:[{path:"src/a.ts",before:"a",after:"b"}]}, structuralValidators:[structural], commandPlan:buildValidationCommandPlan([{id:"lint",executable:"npm",args:["run","lint"],required:false}],policy), workspace, sandboxRunner:optionalRunner });
  assert.equal(optional.passed, true);
  assert.equal(optional.findings[0]?.severity, "warning");
});
