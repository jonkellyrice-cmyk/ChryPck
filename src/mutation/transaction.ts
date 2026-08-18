import type { PatchSpec } from "./patch-dsl.js";
import { stagePatch, type FilePatcherPolicy, type StagedPatch } from "./file-patcher.js";

export type MutationTransactionState = "STAGED" | "VALIDATED" | "COMMITTED" | "ABORTED";

export interface MutationValidationResult {
  readonly validator: string;
  readonly passed: boolean;
  readonly summary: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface MutationValidator {
  readonly name: string;
  validate(staged: StagedPatch): Promise<MutationValidationResult> | MutationValidationResult;
}

export interface CommitReceipt {
  readonly commitSha: string;
  readonly changedPaths: readonly string[];
  readonly patchFingerprint: string;
}

export interface MutationCommitter {
  commit(staged: StagedPatch): Promise<CommitReceipt>;
}

export interface MutationTransaction {
  readonly id: string;
  readonly state: MutationTransactionState;
  readonly staged: StagedPatch;
  readonly validation: readonly MutationValidationResult[];
  readonly receipt: CommitReceipt | null;
  readonly abortReason: string | null;
}

function immutableTransaction(value: MutationTransaction): MutationTransaction {
  return Object.freeze({ ...value, validation: Object.freeze([...value.validation]) });
}

export function createMutationTransaction(spec: PatchSpec, base: ReadonlyMap<string, string>, policy: FilePatcherPolicy = {}): MutationTransaction {
  return immutableTransaction({ id: spec.id, state: "STAGED", staged: stagePatch(spec, base, policy), validation: [], receipt: null, abortReason: null });
}

export async function validateMutationTransaction(transaction: MutationTransaction, validators: readonly MutationValidator[]): Promise<MutationTransaction> {
  if (transaction.state !== "STAGED") throw new Error(`Mutation validation requires STAGED state; received ${transaction.state}.`);
  const results: MutationValidationResult[] = [];
  for (const validator of validators) results.push(await validator.validate(transaction.staged));
  const failed = results.filter(result => !result.passed);
  if (failed.length) return immutableTransaction({ ...transaction, state: "ABORTED", validation: results, abortReason: failed.map(result => `${result.validator}: ${result.summary}`).join("; ") });
  return immutableTransaction({ ...transaction, state: "VALIDATED", validation: results });
}

export async function commitMutationTransaction(transaction: MutationTransaction, committer: MutationCommitter): Promise<MutationTransaction> {
  if (transaction.state !== "VALIDATED") throw new Error(`Mutation commit requires VALIDATED state; received ${transaction.state}.`);
  const receipt = await committer.commit(transaction.staged);
  if (receipt.patchFingerprint !== transaction.staged.patchFingerprint) throw new Error("Commit receipt patch fingerprint does not match validated staged patch.");
  const expected = transaction.staged.changedPaths.join("\n"), actual = [...receipt.changedPaths].sort().join("\n");
  if (actual !== [...transaction.staged.changedPaths].sort().join("\n")) throw new Error(`Commit receipt changed-path mismatch. Expected ${expected}.`);
  return immutableTransaction({ ...transaction, state: "COMMITTED", receipt });
}

export function abortMutationTransaction(transaction: MutationTransaction, reason: string): MutationTransaction {
  if (transaction.state === "COMMITTED") throw new Error("Committed mutation transactions cannot be aborted.");
  return immutableTransaction({ ...transaction, state: "ABORTED", abortReason: reason.trim() || "aborted" });
}
