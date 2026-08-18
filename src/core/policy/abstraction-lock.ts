import { PolicyError } from "./errors.js";
export const TOOLCHAIN_SURFACES=["symbol-families","dependency-graph","dependency-watershed","integration-surface-atlas","runtime-signal-map","effect-atlas","state-namespace-atlas","native-contract-catalog","patch-corridor","corridor-context","patch-staging","change-propagation","filepatcher","canonical-validation"] as const;
export type ToolchainSurface=typeof TOOLCHAIN_SURFACES[number];
export interface SourceAccessGrant { readonly repository:string; readonly commitSha:string; readonly paths:readonly string[]; readonly evidence:string; readonly expiresAt:number; }
export interface AbstractionLock { readonly allowedSurfaces:ReadonlySet<ToolchainSurface>; readonly directSourceAccessRequiresGrant:boolean; }
export const createDefaultAbstractionLock=():AbstractionLock=>Object.freeze({allowedSurfaces:new Set(TOOLCHAIN_SURFACES),directSourceAccessRequiresGrant:true});
export function assertSurfaceAllowed(lock:AbstractionLock,surface:ToolchainSurface):void { if(!lock.allowedSurfaces.has(surface)) throw new PolicyError("ABSTRACTION_VIOLATION","Surface is below the active abstraction wall.",{surface}); }
export function assertSourceGrant(grant:SourceAccessGrant|null,repository:string,commitSha:string,path:string):void { if(!grant) throw new PolicyError("ABSTRACTION_GAP","No source grant is active.",{path}); if(grant.repository!==repository||grant.commitSha!==commitSha||grant.expiresAt<=Date.now()||!grant.paths.includes(path)) throw new PolicyError("ABSTRACTION_VIOLATION","Source path is not authorized by the active grant.",{path}); }
