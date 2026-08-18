import { ProjectProfileRegistry } from "./registry.js";
import { createFrameConnProjectProfile } from "./profiles/frame-conn.js";
import { createGenericProjectProfile } from "./profiles/generic.js";

export function createBuiltinProjectProfileRegistry(): ProjectProfileRegistry {
  return new ProjectProfileRegistry([createFrameConnProjectProfile()], createGenericProjectProfile());
}
