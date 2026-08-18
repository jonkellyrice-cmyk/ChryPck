import { posix as path } from "node:path";
import type { RepositoryModel } from "../repository/model.js";
import type { AuthoringEdit } from "../mutation/authoring-compiler.js";

export interface PathMove { readonly from: string; readonly to: string; }
export interface PathMovePlan {
  readonly kind: "path-move";
  readonly planId: string;
  readonly approved: false;
  readonly moves: readonly PathMove[];
  readonly affectedExistingPaths: readonly string[];
  readonly authorizedNewPaths: readonly string[];
  readonly rewrites: readonly Readonly<{ path: string; from: string; to: string; occurrences: number }>[];
  readonly edits: readonly AuthoringEdit[];
  readonly gaps: readonly string[];
}

function norm(value: string): string { return path.normalize(value.replaceAll("\\","/")).replace(/^\.\//,"").replace(/^\/+/,""); }
function remap(file: string, moves: readonly PathMove[]): string {
  for (const move of moves) {
    if (file === move.from) return move.to;
    if (file.startsWith(`${move.from}/`)) return `${move.to}${file.slice(move.from.length)}`;
  }
  return file;
}
function hasExtension(specifier: string): boolean { return Boolean(path.extname(specifier)); }
function relativeSpecifier(importer: string, target: string, original: string): string {
  let relative = path.relative(path.dirname(importer), target); if (!relative.startsWith(".")) relative = `./${relative}`;
  if (!hasExtension(original)) { const ext = path.extname(relative); if (ext) relative = relative.slice(0,-ext.length); relative = relative.replace(/\/index$/,""); if (relative === ".") relative = "./"; }
  return relative;
}
function quoteNeedle(text: string, specifier: string): string | null {
  const double = `"${specifier}"`, single = `'${specifier}'`; const hasDouble=text.includes(double), hasSingle=text.includes(single);
  if (hasDouble && !hasSingle) return double; if (hasSingle && !hasDouble) return single; if (hasDouble) return double; return null;
}
function count(text: string, needle: string): number { let n=0,c=0; while((c=text.indexOf(needle,c))>=0){n++;c+=needle.length;} return n; }
function idFor(moves: readonly PathMove[], rewrites: readonly {path:string;from:string;to:string}[]): string { const raw=JSON.stringify({moves,rewrites}); let h=2166136261; for(let i=0;i<raw.length;i++){h^=raw.charCodeAt(i);h=Math.imul(h,16777619);} return `move-${(h>>>0).toString(16).padStart(8,"0")}`; }

export function planPathMoves(model: RepositoryModel, requestedMoves: readonly PathMove[]): PathMovePlan {
  const moves = requestedMoves.map(move=>Object.freeze({from:norm(move.from),to:norm(move.to)}));
  const gaps: string[] = [];
  if (!moves.length) gaps.push("move plan requires at least one move");
  const files = new Set(model.snapshot.files.map(file=>file.path));
  for (const move of moves) {
    if (!move.from || !move.to || move.from === move.to) gaps.push(`invalid move ${move.from} -> ${move.to}`);
    const matched = [...files].filter(file=>file===move.from || file.startsWith(`${move.from}/`));
    if (!matched.length) gaps.push(`move source does not exist: ${move.from}`);
    for (const source of matched) { const destination=remap(source,[move]); if (files.has(destination) && !matched.includes(destination)) gaps.push(`move destination already exists: ${destination}`); }
  }
  const seenDestinations = new Set<string>();
  for (const file of files) { const next=remap(file,moves); if (next!==file) { if(seenDestinations.has(next)) gaps.push(`multiple sources map to destination: ${next}`); seenDestinations.add(next); } }

  const rewrites: {path:string;from:string;to:string;occurrences:number}[] = [];
  for (const edge of model.dependencies) {
    if (!edge.specifier.startsWith(".")) continue;
    const importerNew=remap(edge.from,moves), targetNew=remap(edge.to,moves);
    if (importerNew===edge.from && targetNew===edge.to) continue;
    const nextSpecifier=relativeSpecifier(importerNew,targetNew,edge.specifier); if(nextSpecifier===edge.specifier) continue;
    const file=model.snapshot.files.find(candidate=>candidate.path===edge.from); if(!file?.text){gaps.push(`importer has no text for rewrite: ${edge.from}`);continue;}
    const needle=quoteNeedle(file.text,edge.specifier); if(!needle){gaps.push(`cannot locate quoted import specifier ${edge.specifier} in ${edge.from}`);continue;}
    const nextNeedle=`${needle[0]}${nextSpecifier}${needle[0]}`; rewrites.push({path:edge.from,from:needle,to:nextNeedle,occurrences:count(file.text,needle)});
  }
  const uniqueRewrites = new Map(rewrites.map(row=>[`${row.path}|${row.from}|${row.to}`,row] as const));
  const rewriteRows=[...uniqueRewrites.values()].sort((a,b)=>a.path.localeCompare(b.path)||a.from.localeCompare(b.from));
  const edits: AuthoringEdit[] = rewriteRows.map(row=>Object.freeze({type:"replace_exact" as const,path:row.path,search:row.from,replace:row.to,expectedOccurrences:row.occurrences}));
  for (const move of moves) edits.push(Object.freeze({type:"move_file" as const,from:move.from,to:move.to}));
  const movedExisting=[...files].filter(file=>remap(file,moves)!==file);
  const affected=[...new Set([...movedExisting,...rewriteRows.map(row=>row.path)])].sort();
  const newPaths=[...new Set(movedExisting.map(file=>remap(file,moves)))].sort();
  return Object.freeze({kind:"path-move",planId:idFor(moves,rewriteRows),approved:false,moves:Object.freeze(moves),affectedExistingPaths:Object.freeze(affected),authorizedNewPaths:Object.freeze(newPaths),rewrites:Object.freeze(rewriteRows),edits:Object.freeze(edits),gaps:Object.freeze([...new Set(gaps)].sort())});
}
