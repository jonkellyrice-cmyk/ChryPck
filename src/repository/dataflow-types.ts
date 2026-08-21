export type DataflowNodeKind =
  | "literal-source"
  | "parameter"
  | "declaration"
  | "assignment"
  | "property-read"
  | "property-write"
  | "transformation"
  | "call-argument"
  | "call-result"
  | "return-value"
  | "state-read"
  | "state-write"
  | "effect-sink"
  | "control-condition"
  | "unresolved-value-site";

export type DataflowEdgeKind =
  | "defines"
  | "assigns"
  | "aliases"
  | "reads-property"
  | "writes-property"
  | "passes-argument"
  | "returns"
  | "receives-result"
  | "transforms"
  | "reads-state"
  | "writes-state"
  | "state-propagates"
  | "binds-parameter"
  | "crosses-contract"
  | "reaches-effect"
  | "control-dependency"
  | "unresolved-flow";

export type DataflowEvidenceConfidence = "syntax-confirmed" | "lexically-associated" | "pattern-detected" | "unresolved";
export type DataflowExtractionSource = "typescript-ast" | "source-pattern";

export interface DataflowNode {
  readonly id: string;
  readonly kind: DataflowNodeKind;
  readonly file: string;
  readonly symbol: string;
  readonly value: string | null;
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly detail: string;
  readonly confidence: DataflowEvidenceConfidence;
  readonly extractionSource: DataflowExtractionSource;
  readonly unresolvedReason: string | null;
}

export interface DataflowEdge {
  readonly id: string;
  readonly kind: DataflowEdgeKind;
  readonly from: string;
  readonly to: string;
  readonly file: string;
  readonly line: number;
  readonly confidence: DataflowEvidenceConfidence;
  readonly extractionSource: DataflowExtractionSource;
  readonly unresolvedReason: string | null;
}

export interface DataflowGap {
  readonly id: string;
  readonly file: string;
  readonly line: number;
  readonly kind: "parse-error" | "unsupported-syntax" | "dynamic-access" | "unresolved-expression";
  readonly summary: string;
}

export interface DataflowFileCoverage {
  readonly candidateSites: number;
  readonly classifiedSites: number;
  readonly unresolvedSites: number;
  readonly parserGaps: number;
  readonly partial: boolean;
}

export interface DataflowFileFacts {
  readonly nodes: readonly DataflowNode[];
  readonly edges: readonly DataflowEdge[];
  readonly gaps: readonly DataflowGap[];
  readonly coverage: DataflowFileCoverage;
}

export const emptyDataflowFileFacts = (): DataflowFileFacts => Object.freeze({
  nodes: Object.freeze([]), edges: Object.freeze([]), gaps: Object.freeze([]),
  coverage: Object.freeze({ candidateSites: 0, classifiedSites: 0, unresolvedSites: 0, parserGaps: 0, partial: false })
});
