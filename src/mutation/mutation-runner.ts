import type { AuthoringAuthority, AuthoringIntent } from "./authoring-compiler.js";
import { compileAuthoringIntent } from "./authoring-compiler.js";
import type { FilePatcherPolicy } from "./file-patcher.js";
import { createMutationTransaction, type MutationTransaction } from "./transaction.js";
import type { PatchSpec } from "./patch-dsl.js";

export interface PreparedMutation {
  readonly spec: PatchSpec;
  readonly transaction: MutationTransaction;
}

export function prepareNativeMutation(
  intent: AuthoringIntent,
  authority: AuthoringAuthority,
  baseFiles: ReadonlyMap<string, string>,
  policy: FilePatcherPolicy = {}
): PreparedMutation {
  const spec = compileAuthoringIntent(intent, authority);
  if (spec.baseCommitSha !== authority.context.commitSha) throw new Error("Compiled mutation lost Context Pack base-commit authority.");
  const transaction = createMutationTransaction(spec, baseFiles, {
    ...policy,
    maxFilesChanged: policy.maxFilesChanged ?? authority.maxFilesChanged
  });
  return Object.freeze({ spec, transaction });
}
