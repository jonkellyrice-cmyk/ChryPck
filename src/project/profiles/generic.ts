import { createRepositorySourceProfile } from "../../repository/source-profile.js";
import { freezeProjectProfile, type ProjectProfile } from "../profile.js";

export function createGenericProjectProfile(): ProjectProfile {
  return freezeProjectProfile({
    id: "generic",
    repositories: [],
    sourceProfile: createRepositorySourceProfile(),
    additionalAnalyzers: [],
    validation: {
      commands: [],
      commandPolicy: Object.freeze({
        allowedExecutables: new Set<string>(),
        maxCommands: 0,
        maxTimeoutMs: 1,
        defaultTimeoutMs: 1
      }),
      structural: Object.freeze({ rejectConflictMarkers: true })
    }
  });
}
