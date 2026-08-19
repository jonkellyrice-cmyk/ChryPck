export const FAILURE_EVIDENCE_EXTRACTOR_SCHEMA_VERSION=1;
export type NativeFailureStage="planning"|"mutation"|"propagation"|"validation"|"promotion"|"execution";
export interface NativeFailureEvidence{readonly schema_version:1;readonly kind:"chrypck_native_failure_evidence";readonly failed_stage:NativeFailureStage;readonly failure_class:string;readonly summary:string;readonly relevant_evidence:readonly unknown[];readonly permitted_next_action:"modify_request"}
const CLASSES:Readonly<Record<NativeFailureStage,string>>=Object.freeze({planning:"planning_failure",mutation:"mutation_failure",propagation:"propagation_failure",validation:"validation_failure",promotion:"promotion_failure",execution:"native_execution_failure"});
export function classifyFailureStage(stageName = ""): string {
	const stage = String(stageName).toLowerCase();
	if (stage.includes("promot") || stage.includes("publish") || stage.includes("commit")) return "promotion_failure";
	// accept both 'validate' and 'validation' and related forms
	if (["validat", "validate", "test", "audit", "diff"].some(token => stage.includes(token))) return "validation_failure";
	if (stage.includes("propagat")) return "propagation_failure";
	if (["corridor", "context", "plan"].some(token => stage.includes(token))) return "planning_failure";
	if (stage.includes("mutat") || stage.includes("patch")) return "mutation_failure";
	return "native_execution_failure";
}
export function buildNativeFailureEvidence(stage:NativeFailureStage,error:unknown,relevantEvidence:readonly unknown[]=[]):NativeFailureEvidence{return Object.freeze({schema_version:1,kind:"chrypck_native_failure_evidence",failed_stage:stage,failure_class:CLASSES[stage],summary:error instanceof Error?error.message:String(error),relevant_evidence:Object.freeze([...relevantEvidence]),permitted_next_action:"modify_request"})}
