import type { ProjectProfile } from "./profile.js";

function repositoryName(value: string): string {
  return value.trim().replace(/^https:\/\/github\.com\//i, "").replace(/\.git$/i, "").replace(/^\/+|\/+$/g, "").toLowerCase();
}

export class ProjectProfileRegistry {
  readonly #profiles: readonly ProjectProfile[];
  readonly #fallback: ProjectProfile;

  constructor(profiles: readonly ProjectProfile[], fallback: ProjectProfile) {
    const ids = new Set<string>();
    for (const profile of [...profiles, fallback]) {
      if (ids.has(profile.id)) throw new Error(`Duplicate project profile id: ${profile.id}`);
      ids.add(profile.id);
    }
    this.#profiles = Object.freeze([...profiles]);
    this.#fallback = fallback;
  }

  resolve(repository: string): ProjectProfile {
    const candidate = repositoryName(repository);
    for (const profile of this.#profiles) {
      if (profile.repositories.some(value => repositoryName(value) === candidate)) return profile;
    }
    return this.#fallback;
  }

  get(id: string): ProjectProfile | null {
    return [...this.#profiles, this.#fallback].find(profile => profile.id === id) ?? null;
  }

  list(): readonly ProjectProfile[] {
    return Object.freeze([...this.#profiles, this.#fallback]);
  }
}
