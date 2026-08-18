/* ============================================================
   FILE PATH / NAME
   ============================================================ */
/**
 * main/resource_service/resource-service.js
 */
/**
 * @file
 * @path main/resource_service/resource-service.js
 * @module resource-service
 * @layer resource-service-public-boundary
 * @responsibility expose-one-stable-frame-helm-facing-resource-service-api
 * @public-boundary true
 * @side-effects delegated-through-resource-hooks-and-resource-transactions
 *
 * @depends-on
 * - resource-contract
 * - resource-resolver
 * - resource-transaction
 * - resource-hooks
 *
 * EXISTING FRAME HELM INTEGRATION:
 * - consumed by runtime-orchestrator.js
 * - consumed by future frame-helm-runtime composition
 * - consumed by feature_runtime_bridge/
 * - consumed by lifecycle_service/*
 * - consumed by execution strategies that need direct resource access
 * - integrates with execution_transaction/ through resource-hooks.js
 *
 * EXISTING ARCHITECTURE PRESERVED:
 * - native_adapter/ remains native Lancer resource authority
 * - semantic_execution_context/ remains execution-input authority
 * - execution_transaction/ remains execution timing authority
 * - feature registry remains declaration/registration authority
 * - future feature_runtime_bridge/ supplies missing resource declarations
 * - future lifecycle_service/ owns reset timing
 *
 * THIS FILE OWNS:
 * - public resource_service façade
 * - stable namespace composition
 * - common resolution/validation/commit entry points
 * - resource hook configuration/registration entry points
 * - resource diagnostics
 *
 * THIS FILE DOES NOT OWN:
 * - resource contracts
 * - resource discovery implementation
 * - resource mutation implementation
 * - transaction sequencing
 * - native document mutation
 * - reset scheduling
 * - action economy
 * - feature-specific rules
 *
 * EDIT CONTRACT:
 * - keep façade thin
 * - contract owns resource shapes/enums
 * - resolver owns discovery/state reads
 * - transaction owns validation/mutation/verification
 * - hooks own transaction integration
 * - do not add tabletop mechanics here
 */
/* ============================================================
   MODULE IMPORTS
   ============================================================ */
/**
 * @section module-imports
 */
import * as contract from "./resource-contract.js";
import * as resolver from "./resource-resolver.js";
import * as transaction from "./resource-transaction.js";
import * as hooks from "./resource-hooks.js";
/* ============================================================
   MODULE IDENTITY
   ============================================================ */
/**
 * @section module-identity
 */
export const RESOURCE_SERVICE_MODULE_ID =
  "lancer-frame-helm.resource-service";
export const RESOURCE_SERVICE_MODULE_VERSION =
  1;
/* ============================================================
   PUBLIC NAMESPACE
   ============================================================ */
/**
 * @section public-namespace
 *
 * Preferred access:
 *
 * resourceService.contract.*
 * resourceService.resolver.*
 * resourceService.transaction.*
 * resourceService.hooks.*
 *
 * Higher runtime layers should normally import this file rather than the
 * implementation siblings directly.
 */
export const resourceService =
  Object.freeze({
    id:
      RESOURCE_SERVICE_MODULE_ID,
    version:
      RESOURCE_SERVICE_MODULE_VERSION,
    contract:
      Object.freeze(contract),
    resolver:
      Object.freeze(resolver),
    transaction:
      Object.freeze(transaction),
    hooks:
      Object.freeze(hooks)
  });
/* ============================================================
   RESOURCE DESCRIPTOR RESOLUTION
   ============================================================ */
/**
 * @section resource-descriptor-resolution
 */
export async function resolveExecutionResourceDescriptors(
  context,
  options
) {
  return resourceService
    .resolver
    .resolveExecutionResourceDescriptors(
      context,
      options
    );
}
export async function resolveExecutionResourceCollection(
  context,
  options
) {
  return resourceService
    .resolver
    .resolveExecutionResourceCollection(
      context,
      options
    );
}
export async function resolveExecutionResources(
  context,
  options
) {
  return resourceService
    .resolver
    .resolveExecutionResources(
      context,
      options
    );
}
/* ============================================================
   RESOURCE SNAPSHOT RESOLUTION
   ============================================================ */
/**
 * @section resource-snapshot-resolution
 */
export async function resolveExecutionResourceSnapshot(
  context,
  descriptor
) {
  return resourceService
    .resolver
    .resolveExecutionResourceSnapshot(
      context,
      descriptor
    );
}
export async function resolveExecutionResourceSnapshots(
  context,
  descriptors
) {
  return resourceService
    .resolver
    .resolveExecutionResourceSnapshots(
      context,
      descriptors
    );
}
/* ============================================================
   RESOURCE TRANSACTION PREPARATION
   ============================================================ */
/**
 * @section resource-transaction-preparation
 */
export async function prepareResourceTransaction(
  context,
  options
) {
  return resourceService
    .transaction
    .prepareResourceTransaction(
      context,
      options
    );
}
export async function beginResourceTransaction(
  context,
  options
) {
  return resourceService
    .transaction
    .beginResourceTransaction(
      context,
      options
    );
}
/* ============================================================
   RESOURCE VALIDATION
   ============================================================ */
/**
 * @section resource-validation
 */
export async function validateExecutionResource(
  context,
  descriptor,
  options
) {
  return resourceService
    .transaction
    .validateExecutionResource(
      context,
      descriptor,
      options
    );
}
export async function validateExecutionResources(
  context,
  options
) {
  return resourceService
    .transaction
    .validateExecutionResources(
      context,
      options
    );
}
/* ============================================================
   RESOURCE COMMIT
   ============================================================ */
/**
 * @section resource-commit
 */
export async function commitExecutionResources(
  context,
  snapshot,
  options
) {
  return resourceService
    .transaction
    .commitExecutionResources(
      context,
      snapshot,
      options
    );
}
export async function commitDeferredResource(
  context,
  descriptor,
  options
) {
  return resourceService
    .transaction
    .commitDeferredResource(
      context,
      descriptor,
      options
    );
}
export async function commitDeferredResources(
  context,
  snapshot,
  options
) {
  return resourceService
    .transaction
    .commitDeferredResources(
      context,
      snapshot,
      options
    );
}
export async function commitImmediateResource(
  context,
  descriptor,
  options
) {
  return resourceService
    .transaction
    .commitImmediateResource(
      context,
      descriptor,
      options
    );
}
/* ============================================================
   NATIVE RESOURCE VERIFICATION
   ============================================================ */
/**
 * @section native-resource-verification
 */
export async function verifyNativeResource(
  context,
  descriptor,
  before
) {
  return resourceService
    .transaction
    .verifyNativeResource(
      context,
      descriptor,
      before
    );
}
export async function verifyNativeResources(
  context,
  snapshot
) {
  return resourceService
    .transaction
    .verifyNativeResources(
      context,
      snapshot
    );
}
/* ============================================================
   RESOURCE RESULT PREDICATES
   ============================================================ */
/**
 * @section resource-result-predicates
 */
export function didResourceValidationSucceed(
  result
) {
  return resourceService
    .transaction
    .didResourceValidationSucceed(
      result
    );
}
export function didResourceCommitSucceed(
  result
) {
  return resourceService
    .transaction
    .didResourceCommitSucceed(
      result
    );
}
export function wasResourceCommitPartial(
  result
) {
  return resourceService
    .transaction
    .wasResourceCommitPartial(
      result
    );
}
export function didResourceCommitFail(
  result
) {
  return resourceService
    .transaction
    .didResourceCommitFail(
      result
    );
}
/* ============================================================
   RESOURCE DESCRIPTOR HELPERS
   ============================================================ */
/**
 * @section resource-descriptor-helpers
 */
export function createResourceIdentity(
  options
) {
  return resourceService
    .contract
    .createResourceIdentity(
      options
    );
}
export function createResourceDescriptor(
  options
) {
  return resourceService
    .contract
    .createResourceDescriptor(
      options
    );
}
export function createResourceDeclaration(
  options
) {
  return resourceService
    .contract
    .createResourceDeclaration(
      options
    );
}
export function createResourceRequirement(
  options
) {
  return resourceService
    .contract
    .createResourceRequirement(
      options
    );
}
export function createResourceMutation(
  options
) {
  return resourceService
    .contract
    .createResourceMutation(
      options
    );
}
/* ============================================================
   COMMON RESOURCE DECLARATIONS
   ============================================================ */
/**
 * @section common-resource-declarations
 */
export function createLimitedResourceDeclaration(
  options
) {
  return resourceService
    .contract
    .createLimitedResourceDeclaration(
      options
    );
}
export function createLoadedResourceDeclaration(
  options
) {
  return resourceService
    .contract
    .createLoadedResourceDeclaration(
      options
    );
}
export function createCoreEnergyResourceDeclaration(
  options
) {
  return resourceService
    .contract
    .createCoreEnergyResourceDeclaration(
      options
    );
}
export function createCounterResourceDeclaration(
  options
) {
  return resourceService
    .contract
    .createCounterResourceDeclaration(
      options
    );
}
export function createFrequencyResourceDeclaration(
  options
) {
  return resourceService
    .contract
    .createFrequencyResourceDeclaration(
      options
    );
}
/* ============================================================
   RESOURCE CLASSIFICATION
   ============================================================ */
/**
 * @section resource-classification
 */
export function classifyResourceDescriptors(
  descriptors
) {
  return resourceService
    .contract
    .classifyResourceDescriptors(
      descriptors
    );
}
export function isNativeResourceDescriptor(
  descriptor
) {
  return resourceService
    .contract
    .isNativeResourceDescriptor(
      descriptor
    );
}
export function isFrameHelmResourceDescriptor(
  descriptor
) {
  return resourceService
    .contract
    .isFrameHelmResourceDescriptor(
      descriptor
    );
}
export function isNativeConsumedResource(
  descriptor
) {
  return resourceService
    .contract
    .isNativeConsumedResource(
      descriptor
    );
}
export function isDeferredResource(
  descriptor
) {
  return resourceService
    .contract
    .isDeferredResource(
      descriptor
    );
}
export function isImmediateResource(
  descriptor
) {
  return resourceService
    .contract
    .isImmediateResource(
      descriptor
    );
}
/* ============================================================
   RESOURCE LOOKUP
   ============================================================ */
/**
 * @section resource-lookup
 */
export function getResourceDescriptorById(
  descriptors,
  resourceId
) {
  return resourceService
    .contract
    .getResourceDescriptorById(
      descriptors,
      resourceId
    );
}
export function getResourceSnapshotById(
  snapshots,
  resourceId
) {
  return resourceService
    .contract
    .getResourceSnapshotById(
      snapshots,
      resourceId
    );
}
export function findResolvedResourceDescriptor(
  descriptors,
  resourceId
) {
  return resourceService
    .resolver
    .findResolvedResourceDescriptor(
      descriptors,
      resourceId
    );
}
export function findResolvedResourceSnapshot(
  snapshots,
  resourceId
) {
  return resourceService
    .resolver
    .findResolvedResourceSnapshot(
      snapshots,
      resourceId
    );
}
/* ============================================================
   REQUIREMENT EVALUATION
   ============================================================ */
/**
 * @section requirement-evaluation
 */
export function evaluateResourceRequirement(
  snapshot,
  requirement
) {
  return resourceService
    .contract
    .evaluateResourceRequirement(
      snapshot,
      requirement
    );
}
export function validateResourceSnapshot(
  descriptor,
  snapshot
) {
  return resourceService
    .contract
    .validateResourceSnapshot(
      descriptor,
      snapshot
    );
}
/* ============================================================
   TRANSACTION RESULT ADAPTERS
   ============================================================ */
/**
 * @section transaction-result-adapters
 */
export function toExecutionTransactionValidationResult(
  validationSummary,
  options
) {
  return resourceService
    .transaction
    .toExecutionTransactionValidationResult(
      validationSummary,
      options
    );
}
export function toExecutionTransactionCommitResult(
  commitResult,
  options
) {
  return resourceService
    .transaction
    .toExecutionTransactionCommitResult(
      commitResult,
      options
    );
}
/* ============================================================
   RESOURCE HOOK CONFIGURATION
   ============================================================ */
/**
 * @section resource-hook-configuration
 *
 * feature_runtime_bridge/ should eventually supply:
 *
 * resource declaration resolver
 *
 * supplemental-state persistence should supply:
 *
 * Frame Helm resource writer
 */
export function setResourceDeclarationResolver(
  resolver
) {
  return resourceService
    .hooks
    .setResourceDeclarationResolver(
      resolver
    );
}
export function getResourceDeclarationResolver() {
  return resourceService
    .hooks
    .getResourceDeclarationResolver();
}
export function setFrameHelmResourceWriter(
  writer
) {
  return resourceService
    .hooks
    .setFrameHelmResourceWriter(
      writer
    );
}
export function getFrameHelmResourceWriter() {
  return resourceService
    .hooks
    .getFrameHelmResourceWriter();
}
/* ============================================================
   RESOURCE HOOK REGISTRATION
   ============================================================ */
/**
 * @section resource-hook-registration
 *
 * Register once during top-level runtime composition.
 */
export function registerResourceTransactionHooks() {
  return resourceService
    .hooks
    .registerResourceTransactionHooks();
}
export function unregisterResourceTransactionHooks() {
  return resourceService
    .hooks
    .unregisterResourceTransactionHooks();
}
export function areResourceTransactionHooksRegistered() {
  return resourceService
    .hooks
    .areResourceTransactionHooksRegistered();
}
/* ============================================================
   RESOURCE HOOK STATE
   ============================================================ */
/**
 * @section resource-hook-state
 */
export function getExecutionResourceHookState(
  executionId
) {
  return resourceService
    .hooks
    .getExecutionResourceHookState(
      executionId
    );
}
export function getExecutionResourceSnapshot(
  executionId
) {
  return resourceService
    .hooks
    .getExecutionResourceSnapshot(
      executionId
    );
}
export function getExecutionResourceValidation(
  executionId
) {
  return resourceService
    .hooks
    .getExecutionResourceValidation(
      executionId
    );
}
export function getExecutionResourceCommit(
  executionId
) {
  return resourceService
    .hooks
    .getExecutionResourceCommit(
      executionId
    );
}
export function clearExecutionResourceHookState(
  executionId
) {
  return resourceService
    .hooks
    .clearExecutionResourceHookState(
      executionId
    );
}
export function clearAllExecutionResourceHookState() {
  return resourceService
    .hooks
    .clearAllExecutionResourceHookState();
}
/* ============================================================
   SERVICE CAPABILITIES
   ============================================================ */
/**
 * @section service-capabilities
 */
export const RESOURCE_SERVICE_CAPABILITY =
  Object.freeze({
    DESCRIPTOR_RESOLUTION:
      "descriptor-resolution",
    NATIVE_DISCOVERY:
      "native-discovery",
    SNAPSHOT:
      "snapshot",
    VALIDATION:
      "validation",
    NATIVE_VERIFICATION:
      "native-verification",
    DEFERRED_COMMIT:
      "deferred-commit",
    IMMEDIATE_COMMIT:
      "immediate-commit",
    TRANSACTION_HOOKS:
      "transaction-hooks",
    RUNTIME_AUGMENTATION:
      "runtime-augmentation",
    SUPPLEMENTAL_WRITER:
      "supplemental-writer"
  });
export function getResourceServiceCapabilities() {
  return Object.freeze(
    Object.values(
      RESOURCE_SERVICE_CAPABILITY
    )
  );
}
/* ============================================================
   SERVICE DIAGNOSTICS
   ============================================================ */
/**
 * @section service-diagnostics
 */
export function getResourceServiceDiagnostics() {
  return Object.freeze({
    module:
      Object.freeze({
        id:
          RESOURCE_SERVICE_MODULE_ID,
        version:
          RESOURCE_SERVICE_MODULE_VERSION
      }),
    capabilities:
      getResourceServiceCapabilities(),
    hooks:
      resourceService
        .hooks
        .getResourceHookDiagnostics()
  });
}
export async function getResourceExecutionDiagnostics(
  context,
  options
) {
  return resourceService
    .resolver
    .getResourceResolverDiagnostics(
      context,
      options
    );
}
/* ============================================================
   FEATURE RUNTIME BRIDGE BOUNDARY
   ============================================================ */
/**
 * @section feature-runtime-bridge-boundary
 *
 * The existing Frame Helm registry remains stable.
 *
 * Future composition:
 *
 * existing registry entry
 *        +
 * runtime augmentation
 *        ↓
 * feature_runtime_bridge
 *        ↓
 * setResourceDeclarationResolver(...)
 *        ↓
 * resource_service
 *
 * The bridge should return declarations only.
 *
 * It should NOT:
 *
 * mutate resource state
 * call native resource APIs
 * perform transaction commit
 */
/* ============================================================
   SUPPLEMENTAL STATE BOUNDARY
   ============================================================ */
/**
 * @section supplemental-state-boundary
 *
 * Frame Helm-owned resources require persistent backing.
 *
 * Examples:
 *
 * - once/turn
 * - once/round
 * - once/scene
 * - trait charges
 * - talent charges
 * - core-bonus charges
 * - supplemental counters
 *
 * Future:
 *
 * supplemental_state_repository/
 *        │
 *        ▼
 * setFrameHelmResourceWriter(...)
 *
 * Reads should eventually be wired into resource-resolver.js through the
 * same repository boundary.
 *
 * Do not hardcode Foundry flag paths into this façade.
 */
/* ============================================================
   LIFECYCLE BOUNDARY
   ============================================================ */
/**
 * @section lifecycle-boundary
 *
 * ResourceDescriptor.resetScope describes WHEN a resource resets.
 *
 * lifecycle_service/ will eventually enact:
 *
 * TURN
 * ROUND
 * SCENE
 * MISSION
 * FULL_REPAIR
 * EVENT
 * CUSTOM
 *
 * resource_service owns resource mutation primitives.
 *
 * lifecycle_service owns timing.
 */
/* ============================================================
   EXECUTION TRANSACTION BOUNDARY
   ============================================================ */
/**
 * @section execution-transaction-boundary
 *
 * Runtime initialization:
 *
 * registerResourceTransactionHooks()
 *
 * Then ordinary transactions automatically receive:
 *
 * BEFORE_PRE_VALIDATE
 * → resource discovery/snapshot/validation
 *
 * BEFORE_COMMIT
 * → native verification + deferred commit
 *
 * terminal
 * → resource transaction state cleanup
 *
 * Runtime orchestrator should not manually reproduce this sequence.
 */
/* ============================================================
   NATIVE RESOURCE BOUNDARY
   ============================================================ */
/**
 * @section native-resource-boundary
 *
 * Native resource authority remains:
 *
 * native_adapter.resources
 *
 * Examples:
 *
 * Limited
 * Loaded
 * Core Energy
 * CounterData
 *
 * resource_service decides:
 *
 * whether to validate
 * whether native execution owns consumption
 * whether Frame Helm owns deferred consumption
 * whether native mutation must only be verified
 *
 * It does not bypass native_adapter.
 */
/* ============================================================
   EXISTING FRAME HELM ARCHITECTURE NOTES
   ============================================================ */
/**
 * @section existing-frame-helm-architecture-notes
 *
 * runtime-orchestrator.js
 * -----------------------
 *
 * Should consume this public boundary rather than importing resource
 * implementation siblings.
 *
 * Normal action execution does NOT need direct resource calls once hooks
 * are registered.
 *
 *
 * feature-registry.js / feature-registry-core.js
 * ------------------------------------------------
 *
 * Existing registry shape remains valid.
 *
 * Missing runtime resource semantics can be supplied through the future
 * feature_runtime_bridge.
 *
 *
 * feature-contract.js
 * -------------------
 *
 * Existing resource declarations, if any, may remain where they already
 * exist and are picked up by resource-resolver.js.
 *
 *
 * semantic_execution_context/
 * ---------------------------
 *
 * Supplies:
 *
 * execution identity
 * source identity
 * action identity
 * native Item identity
 * preattached resources
 *
 *
 * execution_transaction/
 * ----------------------
 *
 * Owns:
 *
 * when resource validation happens
 * when resource commit happens
 *
 * Resource service attaches through hooks.
 *
 *
 * native_adapter/
 * ---------------
 *
 * Owns:
 *
 * authoritative native reads
 * supported native mutations
 *
 * resource_service does not read/write Item.system directly.
 *
 *
 * feature_turn/
 * -------------
 *
 * Quick/Full/etc. economy remains separate.
 *
 * Do not represent ordinary action-economy slots as generic resources.
 *
 *
 * feature_movement/
 * -----------------
 *
 * Special movement charges/frequencies may use resource_service.
 *
 * Actual movement budget remains owned by movement/action systems.
 *
 *
 * lifecycle_service/
 * ------------------
 *
 * Will reset Frame Helm-owned frequency resources according to resetScope.
 *
 *
 * feature_runtime_bridge/
 * -----------------------
 *
 * Provides declarations for missing runtime semantics without forcing
 * existing feature registry refactors.
 */
/* ============================================================
   RECOMMENDED TOP-LEVEL COMPOSITION
   ============================================================ */
/**
 * @section recommended-top-level-composition
 *
 * Future frame-helm-runtime composition should approximately:
 *
 * 1. initialize native_adapter
 *
 * 2. initialize feature_runtime_bridge
 *
 * 3. configure:
 *
 *    setResourceDeclarationResolver(...)
 *
 * 4. initialize supplemental resource persistence
 *
 * 5. configure:
 *
 *    setFrameHelmResourceWriter(...)
 *
 * 6. register:
 *
 *    registerResourceTransactionHooks()
 *
 * 7. initialize remaining cross-cutting services
 *
 * 8. initialize runtime-orchestrator/UI
 */
/* ============================================================
   PUBLIC BOUNDARY RULES
   ============================================================ */
/**
 * @section public-boundary-rules
 *
 * RULE 1
 *
 * Higher runtime code should import resource-service.js rather than the
 * resolver/transaction/hooks sibling files directly.
 *
 *
 * RULE 2
 *
 * Do not manually validate/commit resources from feature UI when the
 * transaction hook pathway applies.
 *
 *
 * RULE 3
 *
 * Feature-specific resources should be expressed as ResourceDeclaration
 * data whenever generic semantics suffice.
 *
 *
 * RULE 4
 *
 * Native Flow-owned resources must never be manually consumed again.
 *
 *
 * RULE 5
 *
 * New persistence mechanisms should be injected through a stable
 * repository/writer boundary rather than leaking storage paths into this
 * façade.
 */
/* ============================================================
   DEPENDENCY DIRECTION
   ============================================================ */
/**
 * @section dependency-direction
 *
 * Intended:
 *
 * feature registry
 *       +
 * feature_runtime_bridge
 *       │
 *       ▼
 * semantic_execution_context
 *       │
 *       ▼
 * execution_transaction
 *       │
 *       ▼
 * resource_service
 *       │
 *       ├── resource-resolver
 *       ├── resource-transaction
 *       └── resource-hooks
 *       │
 *       ▼
 * native_adapter
 *
 *
 * lifecycle_service
 *       │
 *       ▼
 * resource_service
 *
 * for timed reset operations.
 *
 *
 * Forbidden:
 *
 * native_adapter
 * → resource_service
 *
 * resource_service
 * → runtime-orchestrator
 *
 * resource_service
 * → UI
 */
/* ============================================================
   BOUNDARY INVARIANTS
   ============================================================ */
/**
 * @section boundary-invariants
 *
 * INVARIANT 1
 * resource-service.js is the public Frame Helm resource boundary.
 *
 * INVARIANT 2
 * Contract owns shapes.
 *
 * INVARIANT 3
 * Resolver owns discovery and reads.
 *
 * INVARIANT 4
 * Transaction owns validation, verification, and mutation.
 *
 * INVARIANT 5
 * Hooks own execution-transaction integration.
 *
 * INVARIANT 6
 * This façade contains no tabletop feature-specific mechanics.
 *
 * INVARIANT 7
 * Native Flow-owned resources are never double-consumed.
 *
 * INVARIANT 8
 * Frame Helm deferred resources commit only through transaction commit
 * timing.
 *
 * INVARIANT 9
 * Resource reset timing remains outside this module.
 *
 * INVARIANT 10
 * Existing registry entries may be supplemented through runtime
 * augmentation rather than refactored.
 *
 * INVARIANT 11
 * Action economy remains a separate foundational module.
 *
 * INVARIANT 12
 * Higher runtime modules should converge on this public boundary rather
 * than inventing parallel resource models.
 */