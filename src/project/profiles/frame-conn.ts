import type { NativeContractRecord } from "../../planning/planning-runner.js";
import type { RepositoryModel } from "../../repository/model.js";
import { createRepositorySourceProfile } from "../../repository/source-profile.js";
import { freezeProjectProfile, type ProjectProfile } from "../profile.js";

const FRAME_CONN_REPOSITORIES = Object.freeze(["jonkellyrice-cmyk/Lancer-Frame-Conn"] as const);
const NATIVE_CONTRACT_CATALOG_PATH = "dev_scripts/native-contract-catalog.json";

function frameConnNativeContracts(model: RepositoryModel): readonly NativeContractRecord[] {
  const file = model.snapshot.files.find(candidate => candidate.path === NATIVE_CONTRACT_CATALOG_PATH && candidate.text !== undefined);
  if (!file?.text) return Object.freeze([]);
  let data: unknown;
  try { data = JSON.parse(file.text); }
  catch (error) {
    throw new Error(`Frame Conn native-contract catalog is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return Object.freeze([Object.freeze({
    id: "frame-conn-native-contract-catalog",
    source: NATIVE_CONTRACT_CATALOG_PATH,
    data
  })]);
}

export function createFrameConnProjectProfile(): ProjectProfile {
  return freezeProjectProfile({
    id: "frame-conn",
    repositories: FRAME_CONN_REPOSITORIES,
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
    },
    nativeContractProvider: frameConnNativeContracts
  });
}
