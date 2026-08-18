import type { RepositorySnapshot } from "./snapshot.js";
export interface DependencyEdge {from:string;to:string;kind:string} export interface SymbolRecord{name:string;file:string;kind:string;exported:boolean} export interface EffectRecord{file:string;kind:string;detail:string} export interface StateRecord{namespace:string;file:string;kind:string}
export interface RepositoryModel {snapshot:RepositorySnapshot;dependencies:readonly DependencyEdge[];symbols:readonly SymbolRecord[];effects:readonly EffectRecord[];states:readonly StateRecord[]}
export const emptyModel=(snapshot:RepositorySnapshot):RepositoryModel=>({snapshot,dependencies:[],symbols:[],effects:[],states:[]});
