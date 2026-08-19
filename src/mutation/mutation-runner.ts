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
  // Prefer using the certified Context Pack segment content as the base for staging
  // so that expectedSha values compiled from the Context Pack match the staged base.
  const contextBase = new Map<string, string>();
  if (authority.context && Array.isArray((authority.context as any).segments)) {
    for (const seg of (authority.context as any).segments) {
      if (typeof seg.path === "string" && typeof seg.content === "string") contextBase.set(seg.path, seg.content);
    }
  }
  const stagingBase = contextBase.size > 0 ? contextBase : baseFiles;

  const transaction = createMutationTransaction(spec, stagingBase, {
    ...policy,
    maxFilesChanged: policy.maxFilesChanged ?? authority.maxFilesChanged
  });
  return Object.freeze({ spec, transaction });
}
