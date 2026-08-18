import { PolicyError } from "../policy/errors.js";
export const RUN_STATES=["CREATED","SCOPE_LOCKED","SNAPSHOTTED","DIAGNOSED","CORRIDOR_CERTIFIED","CONTEXT_READY","PATCH_STAGED","PROPAGATION_CERTIFIED","VALIDATING","COMMITTED","SUCCEEDED","FAILED","CANCELLED"] as const;
export type RunState=typeof RUN_STATES[number];
const order=RUN_STATES.slice(0,11); export const isTerminal=(s:RunState)=>s==="SUCCEEDED"||s==="FAILED"||s==="CANCELLED";
export function assertTransition(from:RunState,to:RunState):void { const ok=to==="FAILED"||to==="CANCELLED"||(order.indexOf(to)===order.indexOf(from)+1); if(isTerminal(from)||!ok) throw new PolicyError("INVALID_RUN_TRANSITION",`Invalid run transition ${from} -> ${to}.`,{from,to}); }
