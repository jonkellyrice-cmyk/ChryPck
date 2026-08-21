export type EffectRuntimeNodeKind =
  | "entry-point"
  | "runtime-operation"
  | "effect-sink"
  | "observation-point"
  | "integration-boundary"
  | "unresolved-runtime-site";

export type EffectRuntimeEdgeKind =
  | "calls"
  | "registers"
  | "invokes-callback"
  | "emits"
  | "observed-by"
  | "reads-state"
  | "writes-state"
  | "mutates-document"
  | "delegates-native"
  | "crosses-integration-boundary"
  | "returns-result"
  | "unresolved-runtime-link";

export type EffectRuntimeEvidenceConfidence =
  | "syntax-confirmed"
  | "lexically-associated"
  | "pattern-detected"
  | "unresolved";

export type EffectRuntimeExtractionSource =
  | "source-syntax"
  | "source-pattern"
  | "symbol-association"
  | "native-contract";

export interface EffectRuntimeNode {
  readonly id: string;
  readonly kind: EffectRuntimeNodeKind;
  readonly effectKind: string;
  readonly file: string;
  readonly symbol: string;
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly detail: string;
  readonly confidence: EffectRuntimeEvidenceConfidence;
  readonly extractionSource: EffectRuntimeExtractionSource;
  readonly unresolvedReason: string | null;
}

export interface EffectRuntimeEdge {
  readonly id: string;
  readonly kind: EffectRuntimeEdgeKind;
  readonly from: string;
  readonly to: string;
  readonly file: string;
  readonly line: number;
  readonly confidence: EffectRuntimeEvidenceConfidence;
  readonly extractionSource: EffectRuntimeExtractionSource;
  readonly unresolvedReason: string | null;
}
