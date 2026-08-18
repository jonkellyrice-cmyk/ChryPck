/* ============================================================
   FILE PATH / NAME
   ============================================================ */
/**
 * main/execution_transaction/execution-transaction.js
 */

/**
 * @file
 * @path main/execution_transaction/execution-transaction.js
 * @module execution-transaction
 * @layer execution-transaction-public-boundary
 * @responsibility expose-one-stable-frame-helm-facing-execution-transaction-api
 * @public-boundary true
 * @side-effects delegated-through-runner-hooks-and-execution-callbacks
 *
 * @depends-on
 * - execution-transaction-contract
 * - execution-transaction-runner
 * - execution-transaction-hooks
 *
 * EXISTING FRAME HELM INTEGRATION:
 * - consumed by runtime-orchestrator.js
 * - consumed by feature_actions/*
 * - consumed by execution-strategy runtimes
 * - consumed by granted-action / reaction / Prepare runtimes
 * - provides attachment boundary for:
 *   - action_economy/*
 *   - resource_service/*
 *   - targeting_spatial_service/*
 *   - lifecycle_service/*
 *   - semantic_event_bus/*
 *
 * EXISTING ARCHITECTURE PRESERVED:
 * - runtime-orchestrator.js remains high-level runtime coordinator
 * - semantic_execution_context/ remains canonical execution-input authority
 * - native_adapter/ remains native Lancer integration authority
 * - feature-contract.js remains semantic action-definition authority
 * - feature-registry remains registration authority
 * - feature_turn/ remains turn-feature composition
 * - feature_movement/ remains movement-feature composition/tracking
 *
 * THIS FILE OWNS:
 * - public execution_transaction façade
 * - stable namespace composition
 * - common transaction entry points
 * - global/local hook composition helpers
 * - transaction result predicates/accessors
 * - transaction diagnostics
 *
 * THIS FILE DOES NOT OWN:
 * - transaction sequencing implementation
 * - hook registration implementation
 * - action economy
 * - resource semantics
 * - targeting rules
 * - lifecycle rules
 * - semantic event definitions
 * - native execution
 * - feature-specific mechanics
 *
 * EDIT CONTRACT:
 * - keep façade thin
 * - do not add tabletop rules here
 * - runner owns sequencing
 * - hooks module owns hook registry/composition
 * - contract owns shapes/enums
 * - preserve stable public exports once consumed
 */

/* ============================================================
   MODULE IMPORTS
   ============================================================ */

/**
 * @section module-imports
 */

import * as contract from "./execution-transaction-contract.js";
import * as runner from "./execution-transaction-runner.js";
import * as hooks from "./execution-transaction-hooks.js";

/* ============================================================
   MODULE IDENTITY
   ============================================================ */

/**
 * @section module-identity
 */

export const EXECUTION_TRANSACTION_MODULE_ID =
  "lancer-frame-helm.execution-transaction";

export const EXECUTION_TRANSACTION_MODULE_VERSION =
  1;

/* ============================================================
   PUBLIC NAMESPACE
   ============================================================ */

/**
 * @section public-namespace
 *
 * Preferred higher-layer access:
 *
 * executionTransaction.contract.*
 * executionTransaction.runner.*
 * executionTransaction.hooks.*
 *
 * Runtime consumers should generally import this file instead of
 * importing sibling implementation files directly.
 */

export const executionTransaction =
  Object.freeze({
    id:
      EXECUTION_TRANSACTION_MODULE_ID,

    version:
      EXECUTION_TRANSACTION_MODULE_VERSION,

    contract:
      Object.freeze(contract),

    runner:
      Object.freeze(runner),

    hooks:
      Object.freeze(hooks)
  });

/* ============================================================
   PRIMARY TRANSACTION ENTRY
   ============================================================ */

/**
 * @section primary-transaction-entry
 *
 * Canonical Frame Helm execution pipeline.
 */

export async function runExecutionTransaction(
  options
) {
  return executionTransaction
    .runner
    .runExecutionTransaction(
      options
    );
}

/* ============================================================
   NATIVE EXECUTION ENTRY
   ============================================================ */

/**
 * @section native-execution-entry
 *
 * Convenience for Class 1 actions that primarily delegate to one native
 * execution primitive.
 */

export async function runNativeExecutionTransaction(
  options
) {
  return executionTransaction
    .runner
    .runNativeExecutionTransaction(
      options
    );
}

/* ============================================================
   SEMANTIC PARENT ENTRY
   ============================================================ */

/**
 * @section semantic-parent-entry
 *
 * Used by Class 2 semantic parent actions such as:
 *
 * - Skirmish
 * - Barrage
 * - Stabilize
 * - Jockey
 * - AoE orchestration
 * - granted-action parents
 */

export async function runSemanticParentTransaction(
  options
) {
  return executionTransaction
    .runner
    .runSemanticParentTransaction(
      options
    );
}

/* ============================================================
   DEFAULT GLOBAL HOOK RUNNER
   ============================================================ */

/**
 * @section default-global-hook-runner
 */

export const globalExecutionTransactionHooks =
  hooks.executionTransactionHooks;

/* ============================================================
   GLOBAL HOOK REGISTRATION
   ============================================================ */

/**
 * @section global-hook-registration
 */

export function registerExecutionTransactionHook(
  options
) {
  return hooks
    .registerExecutionTransactionHook(
      options
    );
}

export function registerExecutionTransactionHooks(
  options
) {
  return hooks
    .registerExecutionTransactionHooks(
      options
    );
}

export function unregisterExecutionTransactionHook(
  hookId
) {
  return hooks
    .unregisterExecutionTransactionHook(
      hookId
    );
}

export function clearExecutionTransactionHooks(
  options
) {
  return hooks
    .clearExecutionTransactionHooks(
      options
    );
}

export function clearAllExecutionTransactionHooks() {
  return hooks
    .clearAllExecutionTransactionHooks();
}

/* ============================================================
   HOOK LOOKUP / CONTROL
   ============================================================ */

/**
 * @section hook-lookup-control
 */

export function getExecutionTransactionHooks(
  stage
) {
  return hooks
    .getExecutionTransactionHooks(
      stage
    );
}

export function findExecutionTransactionHook(
  hookId
) {
  return hooks
    .findExecutionTransactionHook(
      hookId
    );
}

export function setExecutionTransactionHookEnabled(
  hookId,
  enabled
) {
  return hooks
    .setExecutionTransactionHookEnabled(
      hookId,
      enabled
    );
}

/* ============================================================
   LOCAL HOOK COLLECTIONS
   ============================================================ */

/**
 * @section local-hook-collections
 *
 * Prefer local hooks for one-off feature strategies instead of polluting
 * the global hook registry.
 */

export function createExecutionTransactionHookCollection(
  definitions
) {
  return hooks
    .createExecutionTransactionHookCollection(
      definitions
    );
}

/* ============================================================
   HOOK RUNNER COMPOSITION
   ============================================================ */

/**
 * @section hook-runner-composition
 *
 * Typical order:
 *
 * global runtime hooks
 * → strategy-local hooks
 * → transaction-local hooks
 */

export function composeExecutionTransactionHookRunners(
  ...hookRunners
) {
  return hooks
    .composeExecutionTransactionHookRunners(
      ...hookRunners
    );
}

/* ============================================================
   RUN WITH GLOBAL HOOKS
   ============================================================ */

/**
 * @section run-with-global-hooks
 *
 * Convenience boundary intended for runtime-orchestrator.js.
 *
 * Automatically includes globally registered cross-cutting services.
 */

export async function runExecutionTransactionWithGlobalHooks({
  hooks: localHooks = null,
  ...options
} = {}) {
  const composedHooks =
    localHooks
      ? composeExecutionTransactionHookRunners(
          globalExecutionTransactionHooks,
          localHooks
        )
      : globalExecutionTransactionHooks;

  return runExecutionTransaction({
    ...options,

    hooks:
      composedHooks
  });
}

/* ============================================================
   RUN NATIVE WITH GLOBAL HOOKS
   ============================================================ */

/**
 * @section run-native-with-global-hooks
 */

export async function runNativeExecutionTransactionWithGlobalHooks({
  hooks: localHooks = null,
  ...options
} = {}) {
  const composedHooks =
    localHooks
      ? composeExecutionTransactionHookRunners(
          globalExecutionTransactionHooks,
          localHooks
        )
      : globalExecutionTransactionHooks;

  return runNativeExecutionTransaction({
    ...options,

    hooks:
      composedHooks
  });
}

/* ============================================================
   RUN SEMANTIC PARENT WITH GLOBAL HOOKS
   ============================================================ */

/**
 * @section run-semantic-parent-with-global-hooks
 */

export async function runSemanticParentTransactionWithGlobalHooks({
  hooks: localHooks = null,
  ...options
} = {}) {
  const composedHooks =
    localHooks
      ? composeExecutionTransactionHookRunners(
          globalExecutionTransactionHooks,
          localHooks
        )
      : globalExecutionTransactionHooks;

  return runSemanticParentTransaction({
    ...options,

    hooks:
      composedHooks
  });
}

/* ============================================================
   HOOK RESULT HELPERS
   ============================================================ */

/**
 * @section hook-result-helpers
 */

export function continueTransaction(
  stage,
  options
) {
  return hooks
    .continueTransaction(
      stage,
      options
    );
}

export function blockTransaction(
  stage,
  reason,
  options
) {
  return hooks
    .blockTransaction(
      stage,
      reason,
      options
    );
}

export function cancelTransaction(
  stage,
  reason,
  options
) {
  return hooks
    .cancelTransaction(
      stage,
      reason,
      options
    );
}

export function failTransaction(
  stage,
  error,
  options
) {
  return hooks
    .failTransaction(
      stage,
      error,
      options
    );
}

export function replaceTransactionContext(
  stage,
  context,
  options
) {
  return hooks
    .replaceTransactionContext(
      stage,
      context,
      options
    );
}

/* ============================================================
   STAGE-SPECIFIC HOOK REGISTRATION
   ============================================================ */

/**
 * @section stage-specific-hook-registration
 */

export function onBeforePreValidate(
  handler,
  options
) {
  return hooks
    .onBeforePreValidate(
      handler,
      options
    );
}

export function onAfterPreValidate(
  handler,
  options
) {
  return hooks
    .onAfterPreValidate(
      handler,
      options
    );
}

export function onBeforeTargeting(
  handler,
  options
) {
  return hooks
    .onBeforeTargeting(
      handler,
      options
    );
}

export function onAfterTargeting(
  handler,
  options
) {
  return hooks
    .onAfterTargeting(
      handler,
      options
    );
}

export function onBeforeFinalValidate(
  handler,
  options
) {
  return hooks
    .onBeforeFinalValidate(
      handler,
      options
    );
}

export function onAfterFinalValidate(
  handler,
  options
) {
  return hooks
    .onAfterFinalValidate(
      handler,
      options
    );
}

export function onBeforeExecute(
  handler,
  options
) {
  return hooks
    .onBeforeExecute(
      handler,
      options
    );
}

export function onAfterExecute(
  handler,
  options
) {
  return hooks
    .onAfterExecute(
      handler,
      options
    );
}

export function onBeforeResolve(
  handler,
  options
) {
  return hooks
    .onBeforeResolve(
      handler,
      options
    );
}

export function onAfterResolve(
  handler,
  options
) {
  return hooks
    .onAfterResolve(
      handler,
      options
    );
}

export function onBeforeCommit(
  handler,
  options
) {
  return hooks
    .onBeforeCommit(
      handler,
      options
    );
}

export function onAfterCommit(
  handler,
  options
) {
  return hooks
    .onAfterCommit(
      handler,
      options
    );
}

export function onTransactionSuccess(
  handler,
  options
) {
  return hooks
    .onTransactionSuccess(
      handler,
      options
    );
}

export function onTransactionBlock(
  handler,
  options
) {
  return hooks
    .onTransactionBlock(
      handler,
      options
    );
}

export function onTransactionCancel(
  handler,
  options
) {
  return hooks
    .onTransactionCancel(
      handler,
      options
    );
}

export function onTransactionFailure(
  handler,
  options
) {
  return hooks
    .onTransactionFailure(
      handler,
      options
    );
}

export function onTransactionPartial(
  handler,
  options
) {
  return hooks
    .onTransactionPartial(
      handler,
      options
    );
}

/* ============================================================
   RESULT PREDICATES
   ============================================================ */

/**
 * @section result-predicates
 */

export function didExecutionTransactionSucceed(
  result
) {
  return contract
    .didExecutionTransactionSucceed(
      result
    );
}

export function wasExecutionTransactionBlocked(
  result
) {
  return contract
    .wasExecutionTransactionBlocked(
      result
    );
}

export function wasExecutionTransactionCancelled(
  result
) {
  return contract
    .wasExecutionTransactionCancelled(
      result
    );
}

export function didExecutionTransactionFail(
  result
) {
  return contract
    .didExecutionTransactionFail(
      result
    );
}

export function wasExecutionTransactionPartial(
  result
) {
  return contract
    .wasExecutionTransactionPartial(
      result
    );
}

/* ============================================================
   RESULT ACCESSORS
   ============================================================ */

/**
 * @section result-accessors
 */

export function getExecutionTransactionId(
  result
) {
  return (
    result
      ?.identity
      ?.transactionId ??
    null
  );
}

export function getExecutionTransactionExecutionId(
  result
) {
  return (
    result
      ?.identity
      ?.executionId ??
    null
  );
}

export function getExecutionTransactionRootExecutionId(
  result
) {
  return (
    result
      ?.identity
      ?.rootExecutionId ??
    null
  );
}

export function getExecutionTransactionStatus(
  result
) {
  return (
    result?.status ??
    null
  );
}

export function getExecutionTransactionPhase(
  result
) {
  return (
    result?.phase ??
    null
  );
}

export function getExecutionTransactionContext(
  result
) {
  return (
    result?.context ??
    null
  );
}

export function getExecutionTransactionValidation(
  result
) {
  return (
    result?.validation ??
    null
  );
}

export function getExecutionTransactionTargeting(
  result
) {
  return (
    result?.targeting ??
    null
  );
}

export function getExecutionTransactionExecution(
  result
) {
  return (
    result?.execution ??
    null
  );
}

export function getExecutionTransactionResolution(
  result
) {
  return (
    result?.resolution ??
    null
  );
}

export function getExecutionTransactionCommit(
  result
) {
  return (
    result?.commit ??
    null
  );
}

export function getExecutionTransactionReason(
  result
) {
  return (
    result?.reason ??
    null
  );
}

export function getExecutionTransactionError(
  result
) {
  return (
    result?.error ??
    null
  );
}

/* ============================================================
   NATIVE RESULT ACCESS
   ============================================================ */

/**
 * @section native-result-access
 */

export function getExecutionTransactionNativeResult(
  result
) {
  return (
    result
      ?.execution
      ?.nativeResult ??
    null
  );
}

/* ============================================================
   CHILD TRANSACTION ACCESS
   ============================================================ */

/**
 * @section child-transaction-access
 */

export function getExecutionChildTransactions(
  result
) {
  return (
    result
      ?.resolution
      ?.childTransactions ??
    Object.freeze([])
  );
}

export function hasExecutionChildTransactions(
  result
) {
  return (
    getExecutionChildTransactions(
      result
    ).length > 0
  );
}

/* ============================================================
   PARTIAL EXECUTION ACCESS
   ============================================================ */

/**
 * @section partial-execution-access
 *
 * Useful when higher runtime needs to report/recover what actually
 * happened before a partial failure.
 */

export function getExecutionTransactionCompletedComponents(
  result
) {
  const components =
    [];

  if (result?.validation) {
    components.push(
      "validation"
    );
  }

  if (result?.targeting) {
    components.push(
      "targeting"
    );
  }

  if (result?.execution) {
    components.push(
      "execution"
    );
  }

  if (result?.resolution) {
    components.push(
      "resolution"
    );
  }

  if (result?.commit) {
    components.push(
      "commit"
    );
  }

  return Object.freeze(
    components
  );
}

/* ============================================================
   ACTIVE TRANSACTION SUPPORT
   ============================================================ */

/**
 * @section active-transaction-support
 */

export function isExecutionTransactionActive(
  executionId
) {
  return runner
    .isExecutionTransactionActive(
      executionId
    );
}

/* ============================================================
   TRANSACTION DIAGNOSTICS
   ============================================================ */

/**
 * @section transaction-diagnostics
 */

export function getExecutionTransactionDiagnostics() {
  return Object.freeze({
    module:
      Object.freeze({
        id:
          EXECUTION_TRANSACTION_MODULE_ID,

        version:
          EXECUTION_TRANSACTION_MODULE_VERSION
      }),

    runner:
      runner
        .getExecutionTransactionDiagnostics(),

    hooks:
      hooks
        .getExecutionTransactionHookDiagnostics()
  });
}

/* ============================================================
   MODULE CAPABILITIES
   ============================================================ */

/**
 * @section module-capabilities
 */

export const EXECUTION_TRANSACTION_CAPABILITY =
  Object.freeze({
    RUNNER:
      "runner",

    GLOBAL_HOOKS:
      "global-hooks",

    LOCAL_HOOKS:
      "local-hooks",

    HOOK_COMPOSITION:
      "hook-composition",

    NATIVE_EXECUTION:
      "native-execution",

    SEMANTIC_PARENT:
      "semantic-parent",

    CHILD_TRANSACTIONS:
      "child-transactions",

    CONCURRENCY_GUARD:
      "concurrency-guard"
  });

export function getExecutionTransactionCapabilities() {
  return Object.freeze(
    Object.values(
      EXECUTION_TRANSACTION_CAPABILITY
    )
  );
}

/* ============================================================
   EXISTING FRAME HELM ARCHITECTURE NOTES
   ============================================================ */

/**
 * @section existing-frame-helm-architecture-notes
 *
 * runtime-orchestrator.js
 * -----------------------
 *
 * This file is the transaction boundary runtime-orchestrator should call.
 *
 * Preferred:
 *
 * runtime-orchestrator
 * → build ExecutionContext
 * → select callbacks/strategy
 * → runExecutionTransactionWithGlobalHooks(...)
 * → consume final result
 *
 * Runtime orchestrator remains responsible for:
 *
 * selecting what semantic action is being attempted
 * selecting the appropriate execution strategy
 * coordinating presentation/UI concerns
 *
 * It does not become obsolete.
 *
 *
 * semantic_execution_context/
 * ---------------------------
 *
 * Remains the canonical execution-input layer.
 *
 * This module accepts ExecutionContext and does not replace its builder.
 *
 *
 * native_adapter/
 * ---------------
 *
 * Native adapter is usually reached inside:
 *
 * callbacks.execute
 *
 * Example:
 *
 * execute:
 *   ({ context }) =>
 *     nativeAdapter.execution.executeNativeWeaponAttack(...)
 *
 * Native adapter must not import execution_transaction.
 *
 *
 * feature-contract.js
 * -------------------
 *
 * Existing action definitions remain semantic definitions.
 *
 * They may point toward a strategy/callback factory that is ultimately
 * executed through this boundary.
 *
 *
 * feature-registry.js / feature-registry-core.js
 * ------------------------------------------------
 *
 * Continue to register semantic action definitions.
 *
 * Registry lookup occurs before this module is invoked.
 *
 *
 * feature_actions/
 * ----------------
 *
 * Existing action runtimes should migrate toward transaction callback
 * factories rather than owning custom execution lifecycles.
 *
 * Simple Class 1:
 *
 * action
 * → native execute callback
 * → transaction
 *
 * Class 2:
 *
 * action
 * → parent semantic callbacks
 * → child transactions
 *
 *
 * feature_turn/
 * -------------
 *
 * Existing turn/action presentation remains.
 *
 * Future action_economy service should attach to global transaction hooks.
 *
 * feature_turn/ should not register rule logic directly from UI components.
 *
 *
 * feature_movement/
 * -----------------
 *
 * Existing movement tracking remains authoritative for actual movement.
 *
 * Movement execution may use this same transaction boundary while
 * delegating actual path/movement bookkeeping to movement services.
 *
 *
 * action_economy/
 * ---------------
 *
 * Future module should register global hooks through this public façade.
 *
 * Example:
 *
 * onBeforePreValidate(...)
 * onBeforeCommit(...)
 *
 *
 * resource_service/
 * -----------------
 *
 * Future module should similarly attach resource validation/commit to
 * stable transaction stages.
 *
 *
 * targeting_spatial_service/
 * --------------------------
 *
 * Target acquisition/final spatial validation should normally be supplied
 * through transaction callbacks.
 *
 * Cross-cutting target modifiers may use hooks.
 *
 *
 * lifecycle_service/
 * ------------------
 *
 * May register post-resolution/commit hooks for temporary effects.
 *
 *
 * semantic_event_bus/
 * -------------------
 *
 * Should attach observational hooks through this module rather than
 * requiring transaction runner modifications.
 *
 *
 * execution-strategy registry
 * ---------------------------
 *
 * Expected:
 *
 * ExecutionContext
 * → strategy lookup
 * → callbacks + optional local hooks
 * → runExecutionTransactionWithGlobalHooks(...)
 *
 * This allows one common transaction model for:
 *
 * native actions
 * semantic parent actions
 * weapon specials
 * talents
 * traits
 * core bonuses
 * mounted systems
 * pilot actions
 */

/* ============================================================
   RECOMMENDED RUNTIME ORCHESTRATOR FLOW
   ============================================================ */

/**
 * @section recommended-runtime-orchestrator-flow
 *
 * 1. receive UI/command request
 *
 * 2. resolve semantic action definition
 *
 * 3. build ExecutionContext
 *
 * 4. resolve execution strategy
 *
 * 5. strategy provides:
 *
 *    callbacks
 *    local hooks
 *
 * 6. compose:
 *
 *    global hooks
 *    + strategy hooks
 *
 * 7. run:
 *
 *    runExecutionTransaction(...)
 *
 * 8. consume:
 *
 *    ExecutionTransactionResult
 *
 * 9. update presentation/UI
 *
 * This keeps:
 *
 * WHAT to execute
 * separate from
 * HOW execution lifecycle is sequenced.
 */

/* ============================================================
   CLASS 1 / CLASS 2 / CLASS 3 NOTES
   ============================================================ */

/**
 * @section runtime-class-notes
 *
 * CLASS 1
 * -------
 *
 * Native Lancer already has complete execution.
 *
 * Typical:
 *
 * execute callback
 * → native_adapter
 *
 *
 * CLASS 2
 * -------
 *
 * Native Lancer has useful primitives but Frame Helm owns orchestration.
 *
 * Typical:
 *
 * parent transaction
 * → native child transactions
 * → semantic resolution
 *
 *
 * CLASS 3
 * -------
 *
 * Native Lancer mostly provides data/state storage.
 *
 * Typical:
 *
 * Frame Helm strategy
 * → transaction
 * → native primitive mutations/rolls/statuses
 *
 * All three classes use the SAME transaction lifecycle.
 */

/* ============================================================
   PUBLIC BOUNDARY RULES
   ============================================================ */

/**
 * @section public-boundary-rules
 *
 * RULE 1
 *
 * Higher runtime code should import execution-transaction.js rather than
 * runner/hooks implementation files directly.
 *
 *
 * RULE 2
 *
 * Use runExecutionTransactionWithGlobalHooks() for ordinary runtime
 * execution once cross-cutting services are registered.
 *
 *
 * RULE 3
 *
 * Use local hook collections for source-specific behavior.
 *
 *
 * RULE 4
 *
 * Do not add feature-specific rules to this façade.
 *
 *
 * RULE 5
 *
 * A new transaction stage requires coordinated changes to:
 *
 * execution-transaction-contract.js
 * execution-transaction-runner.js
 * execution-transaction-hooks.js
 * execution-transaction.js
 *
 * Do not invent ad-hoc stages inside feature code.
 */

/* ============================================================
   DEPENDENCY DIRECTION
   ============================================================ */

/**
 * @section dependency-direction
 *
 * Intended:
 *
 * runtime-orchestrator
 *        │
 *        ▼
 * semantic_execution_context
 *        │
 *        ▼
 * execution_transaction
 *        │
 *        ├──── action_economy
 *        ├──── resource_service
 *        ├──── targeting_spatial_service
 *        ├──── lifecycle_service
 *        └──── semantic_event_bus
 *        │
 *        ▼
 * execution strategy / native_adapter
 *        │
 *        ▼
 * Foundry + Lancer
 *
 *
 * Forbidden:
 *
 * native_adapter
 * → execution_transaction
 *
 * execution_transaction
 * → runtime-orchestrator
 *
 * execution_transaction
 * → UI implementation
 */

/* ============================================================
   BOUNDARY INVARIANTS
   ============================================================ */

/**
 * @section boundary-invariants
 *
 * INVARIANT 1
 * execution-transaction.js is the public transaction boundary.
 *
 * INVARIANT 2
 * Runner owns sequencing.
 *
 * INVARIANT 3
 * Hooks module owns hook registration/composition.
 *
 * INVARIANT 4
 * Contract owns transaction shapes/enums.
 *
 * INVARIANT 5
 * This façade contains no tabletop rules.
 *
 * INVARIANT 6
 * All runtime execution classes share the same transaction lifecycle.
 *
 * INVARIANT 7
 * Global cross-cutting services attach through hooks rather than direct
 * transaction-runner edits.
 *
 * INVARIANT 8
 * Feature-specific behavior should prefer local strategy callbacks/hooks.
 *
 * INVARIANT 9
 * Blocked, Cancelled, Failed, Partial, and Succeeded remain externally
 * visible and distinct.
 *
 * INVARIANT 10
 * runtime-orchestrator remains above this subsystem.
 *
 * INVARIANT 11
 * Native execution remains below this subsystem.
 *
 * INVARIANT 12
 * Existing Frame Helm architecture should converge on this public boundary
 * rather than creating parallel transaction models.
 */