import type { RunState } from "./run-state.js";
export interface RunEvent { runId:string; sequence:number; at:string; state:RunState; event:string; data?:Readonly<Record<string,unknown>>; }
export class RunTelemetry { #events:RunEvent[]=[]; constructor(readonly runId:string){} record(state:RunState,event:string,data?:Readonly<Record<string,unknown>>){const e=Object.freeze({runId:this.runId,sequence:this.#events.length+1,at:new Date().toISOString(),state,event,...(data?{data}:{})});this.#events.push(e);return e;} snapshot(){return Object.freeze([...this.#events]);} }
