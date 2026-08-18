import type { RepositoryModel } from "./model.js";
export interface RepositoryIndex { files:ReadonlyMap<string,number>; symbols:ReadonlyMap<string,readonly number[]>; }
export function buildIndex(model:RepositoryModel):RepositoryIndex {const files=new Map(model.snapshot.files.map((f,i)=>[f.path,i] as const));const symbols=new Map<string,number[]>();model.symbols.forEach((s,i)=>{const a=symbols.get(s.name)??[];a.push(i);symbols.set(s.name,a)});return {files,symbols};}
