export interface RepositoryFile { readonly path:string; readonly sha:string; readonly size:number; readonly text?:string; }
export interface RepositorySnapshot { readonly repository:string; readonly commitSha:string; readonly files:readonly RepositoryFile[]; readonly createdAt:string; }
export const createSnapshot=(repository:string,commitSha:string,files:readonly RepositoryFile[]):RepositorySnapshot=>Object.freeze({repository,commitSha,files:Object.freeze([...files].sort((a,b)=>a.path.localeCompare(b.path))),createdAt:new Date().toISOString()});
