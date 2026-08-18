import type { Analyzer } from "../analysis/analyzer.js";
import type { RepositoryModel } from "../repository/model.js";
import type { RepositorySourceProfile } from "../repository/source-profile.js";
import type { PatchCorridor } from "../planning/patch-corridor.js";
import type { RuntimeProbePlan } from "../planning/runtime-probes.js";
import type { NativeContractRecord } from "../planning/planning-runner.js";
import type { ValidationCommandPolicy, ValidationCommandSpec } from "../validation/command-plan.js";

export interface ProjectStructuralValidationPolicy {
  readonly maxFileBytes?: number;
  readonly rejectConflictMarkers?: boolean;
}

export interface ProjectValidationProfile {
  readonly commands: readonly ValidationCommandSpec[];
  readonly commandPolicy: ValidationCommandPolicy;
  readonly structural: ProjectStructuralValidationPolicy;
}

export interface ProjectProfile {
  readonly id: string;
  readonly repositories: readonly string[];
  readonly sourceProfile: RepositorySourceProfile;
  readonly additionalAnalyzers: readonly Analyzer[];
  readonly validation: ProjectValidationProfile;
  readonly runtimeProbePlanner?: (corridor: PatchCorridor, model: RepositoryModel) => RuntimeProbePlan;
  readonly nativeContractProvider?: (model: RepositoryModel) => readonly NativeContractRecord[];
}

export function freezeProjectProfile(profile: ProjectProfile): ProjectProfile {
  const repositories = Object.freeze([...new Set(profile.repositories.map(value => value.trim()).filter(Boolean))]);
  if (!profile.id.trim()) throw new Error("Project profile id is required.");
  return Object.freeze({
    ...profile,
    id: profile.id.trim(),
    repositories,
    additionalAnalyzers: Object.freeze([...profile.additionalAnalyzers]),
    validation: Object.freeze({
      commands: Object.freeze([...profile.validation.commands]),
      commandPolicy: profile.validation.commandPolicy,
      structural: Object.freeze({ ...profile.validation.structural })
    })
  });
}
