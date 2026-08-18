import type { ScopeLock } from "./scope-lock.js"; import { assertPathInScope } from "./scope-lock.js";
import type { AbstractionLock, SourceAccessGrant, ToolchainSurface } from "./abstraction-lock.js"; import { assertSourceGrant, assertSurfaceAllowed } from "./abstraction-lock.js";
export interface AuthorizationContext { repository:string; commitSha:string; scopeLock:ScopeLock; abstractionLock:AbstractionLock; sourceGrant:SourceAccessGrant|null; }
export const authorizeSurface=(c:AuthorizationContext,s:ToolchainSurface)=>assertSurfaceAllowed(c.abstractionLock,s);
export function authorizeSourceRead(c:AuthorizationContext,path:string):void { assertPathInScope(c.scopeLock,path); if(c.abstractionLock.directSourceAccessRequiresGrant) assertSourceGrant(c.sourceGrant,c.repository,c.commitSha,path); }
export function authorizeMutation(c:AuthorizationContext,path:string):void { assertPathInScope(c.scopeLock,path); assertSurfaceAllowed(c.abstractionLock,"filepatcher"); }
