import type { ScopeLock } from "../policy/scope-lock.js";
export interface RequestEnvelope { readonly runId:string; readonly repository:string; readonly objective:string; readonly baseRef:string; readonly scopeLock:ScopeLock; readonly createdAt:string; }
export const createRequestEnvelope=(input:Omit<RequestEnvelope,"createdAt">):RequestEnvelope=>Object.freeze({...input,createdAt:new Date().toISOString()});
