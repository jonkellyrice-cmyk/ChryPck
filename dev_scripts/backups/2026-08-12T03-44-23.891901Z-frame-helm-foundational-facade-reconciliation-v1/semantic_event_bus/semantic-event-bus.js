/* ============================================================
   FILE PATH / NAME
   ============================================================ */
/**
 * main/semantic_event_bus/semantic-event-bus.js
 */
/**
 * @file
 * @path main/semantic_event_bus/semantic-event-bus.js
 * @module semantic-event-bus
 * @layer semantic-event-bus-public-boundary
 * @responsibility expose-one-stable-frame-helm-facing-semantic-event-bus-api
 * @public-boundary true
 * @side-effects delegated-through-registry-dispatcher-and-transaction-hooks
 *
 * @depends-on
 * - semantic-event-contract
 * - semantic-event-registry
 * - semantic-event-dispatcher
 * - semantic-event-hooks
 *
 * EXISTING FRAME HELM INTEGRATION:
 * - consumed by future lifecycle_service/
 * - consumed by future targeting_spatial_service/
 * - consumed by future actor_owned_feature_registry/
 * - consumed by future system_bridge/
 * - consumed by runtime-orchestrator.js where direct domain event emission
 *   is needed
 * - integrates with execution_transaction/ through semantic-event-hooks.js
 *
 * EXISTING ARCHITECTURE PRESERVED:
 * - execution_transaction/ remains execution lifecycle authority
 * - semantic-event-registry.js owns subscriptions
 * - semantic-event-dispatcher.js owns delivery
 * - semantic-event-hooks.js owns transaction-event bridge
 * - feature-specific mechanics remain outside this façade
 *
 * THIS FILE OWNS:
 * - public semantic_event_bus façade
 * - stable namespace composition
 * - event creation helpers
 * - listener registration façade
 * - dispatch façade
 * - transaction hook registration façade
 * - diagnostics
 *
 * THIS FILE DOES NOT OWN:
 * - event contracts
 * - listener storage implementation
 * - listener dispatch implementation
 * - transaction sequencing
 * - lifecycle timing
 * - feature trigger mechanics
 * - native Lancer execution
 *
 * EDIT CONTRACT:
 * - keep façade thin
 * - contract owns event shapes/vocabulary
 * - registry owns subscriptions
 * - dispatcher owns delivery
 * - hooks own execution_transaction integration
 * - do not add feature-specific rules here
 */
/* ============================================================
   MODULE IMPORTS
   ============================================================ */
import * as contract from "./semantic-event-contract.js";
import * as registry from "./semantic-event-registry.js";
import * as dispatcher from "./semantic-event-dispatcher.js";
import * as hooks from "./semantic-event-hooks.js";
/* ============================================================
   MODULE IDENTITY
   ============================================================ */
export const SEMANTIC_EVENT_BUS_MODULE_ID =
  "lancer-frame-helm.semantic-event-bus";
export const SEMANTIC_EVENT_BUS_MODULE_VERSION =
  1;
/* ============================================================
   PUBLIC NAMESPACE
   ============================================================ */
/**
 * @section public-namespace
 *
 * Preferred access:
 *
 * semanticEventBus.contract.*
 * semanticEventBus.registry.*
 * semanticEventBus.dispatcher.*
 * semanticEventBus.hooks.*
 *
 * Higher runtime modules should generally import this file instead of
 * sibling implementation files directly.
 */
export const semanticEventBus =
  Object.freeze({
    id:
      SEMANTIC_EVENT_BUS_MODULE_ID,
    version:
      SEMANTIC_EVENT_BUS_MODULE_VERSION,
    contract:
      Object.freeze(contract),
    registry:
      Object.freeze(registry),
    dispatcher:
      Object.freeze(dispatcher),
    hooks:
      Object.freeze(hooks)
  });
/* ============================================================
   EVENT CREATION
   ============================================================ */
export function createSemanticEvent(
  options
) {
  return semanticEventBus
    .contract
    .createSemanticEvent(
      options
    );
}
export function createSemanticEventFromExecutionContext(
  context,
  options
) {
  return semanticEventBus
    .contract
    .createSemanticEventFromExecutionContext(
      context,
      options
    );
}
export function createSemanticEventIdentity(
  options
) {
  return semanticEventBus
    .contract
    .createSemanticEventIdentity(
      options
    );
}
export function createSemanticEventExecutionLineage(
  options
) {
  return semanticEventBus
    .contract
    .createSemanticEventExecutionLineage(
      options
    );
}
export function createSemanticEventActorReference(
  options
) {
  return semanticEventBus
    .contract
    .createSemanticEventActorReference(
      options
    );
}
export function createSemanticEventSource(
  options
) {
  return semanticEventBus
    .contract
    .createSemanticEventSource(
      options
    );
}
export function createSemanticEventTarget(
  options
) {
  return semanticEventBus
    .contract
    .createSemanticEventTarget(
      options
    );
}
/* ============================================================
   EVENT MATCH
   ============================================================ */
export function createSemanticEventMatch(
  options
) {
  return semanticEventBus
    .contract
    .createSemanticEventMatch(
      options
    );
}
export function doesSemanticEventMatch(
  event,
  match
) {
  return semanticEventBus
    .contract
    .doesSemanticEventMatch(
      event,
      match
    );
}
/* ============================================================
   COMMON EXECUTION EVENT CONSTRUCTORS
   ============================================================ */
export function createExecutionStartedEvent(
  context,
  options
) {
  return semanticEventBus
    .contract
    .createExecutionStartedEvent(
      context,
      options
    );
}
export function createExecutionExecutedEvent(
  context,
  options
) {
  return semanticEventBus
    .contract
    .createExecutionExecutedEvent(
      context,
      options
    );
}
export function createExecutionResolvedEvent(
  context,
  options
) {
  return semanticEventBus
    .contract
    .createExecutionResolvedEvent(
      context,
      options
    );
}
export function createExecutionCommittedEvent(
  context,
  options
) {
  return semanticEventBus
    .contract
    .createExecutionCommittedEvent(
      context,
      options
    );
}
export function createExecutionSucceededEvent(
  context,
  options
) {
  return semanticEventBus
    .contract
    .createExecutionSucceededEvent(
      context,
      options
    );
}
export function createExecutionBlockedEvent(
  context,
  options
) {
  return semanticEventBus
    .contract
    .createExecutionBlockedEvent(
      context,
      options
    );
}
export function createExecutionCancelledEvent(
  context,
  options
) {
  return semanticEventBus
    .contract
    .createExecutionCancelledEvent(
      context,
      options
    );
}
export function createExecutionFailedEvent(
  context,
  options
) {
  return semanticEventBus
    .contract
    .createExecutionFailedEvent(
      context,
      options
    );
}
export function createExecutionPartialEvent(
  context,
  options
) {
  return semanticEventBus
    .contract
    .createExecutionPartialEvent(
      context,
      options
    );
}
/* ============================================================
   LISTENER REGISTRATION
   ============================================================ */
export function registerSemanticEventListener(
  options
) {
  return semanticEventBus
    .registry
    .registerSemanticEventListener(
      options
    );
}
export function registerSemanticEventListeners(
  definitions
) {
  return semanticEventBus
    .registry
    .registerSemanticEventListeners(
      definitions
    );
}
export function unregisterSemanticEventListener(
  listenerId
) {
  return semanticEventBus
    .registry
    .unregisterSemanticEventListener(
      listenerId
    );
}
export function clearSemanticEventListeners(
  options
) {
  return semanticEventBus
    .registry
    .clearSemanticEventListeners(
      options
    );
}
export function clearAllSemanticEventListeners() {
  return semanticEventBus
    .registry
    .clearAllSemanticEventListeners();
}
/* ============================================================
   LISTENER LOOKUP / CONTROL
   ============================================================ */
export function getSemanticEventListener(
  listenerId
) {
  return semanticEventBus
    .registry
    .getSemanticEventListener(
      listenerId
    );
}
export function hasSemanticEventListener(
  listenerId
) {
  return semanticEventBus
    .registry
    .hasSemanticEventListener(
      listenerId
    );
}
export function setSemanticEventListenerEnabled(
  listenerId,
  enabled
) {
  return semanticEventBus
    .registry
    .setSemanticEventListenerEnabled(
      listenerId,
      enabled
    );
}
export function setSemanticEventListenerMatch(
  listenerId,
  match
) {
  return semanticEventBus
    .registry
    .setSemanticEventListenerMatch(
      listenerId,
      match
    );
}
export function getMatchingSemanticEventListeners(
  event,
  options
) {
  return semanticEventBus
    .registry
    .getMatchingSemanticEventListeners(
      event,
      options
    );
}
export function getSemanticEventListenersByKind(
  kind
) {
  return semanticEventBus
    .registry
    .getSemanticEventListenersByKind(
      kind
    );
}
export function getSemanticEventListenersByCategory(
  category
) {
  return semanticEventBus
    .registry
    .getSemanticEventListenersByCategory(
      category
    );
}
export function getSemanticEventListenersBySource(
  options
) {
  return semanticEventBus
    .registry
    .getSemanticEventListenersBySource(
      options
    );
}
/* ============================================================
   COMMON SUBSCRIPTION HELPERS
   ============================================================ */
export function onSemanticEvent(
  kind,
  handler,
  options
) {
  return semanticEventBus
    .registry
    .onSemanticEvent(
      kind,
      handler,
      options
    );
}
export function onSemanticEventCategory(
  category,
  handler,
  options
) {
  return semanticEventBus
    .registry
    .onSemanticEventCategory(
      category,
      handler,
      options
    );
}
export function onSemanticEventSourceKind(
  sourceKind,
  handler,
  options
) {
  return semanticEventBus
    .registry
    .onSemanticEventSourceKind(
      sourceKind,
      handler,
      options
    );
}
export function onActorSemanticEvent(
  actorUuid,
  handler,
  options
) {
  return semanticEventBus
    .registry
    .onActorSemanticEvent(
      actorUuid,
      handler,
      options
    );
}
export function onFeatureSemanticEvent(
  sourceFeatureId,
  handler,
  options
) {
  return semanticEventBus
    .registry
    .onFeatureSemanticEvent(
      sourceFeatureId,
      handler,
      options
    );
}
export function onExecutionSemanticEvent(
  executionId,
  handler,
  options
) {
  return semanticEventBus
    .registry
    .onExecutionSemanticEvent(
      executionId,
      handler,
      options
    );
}
export function onExecutionRootSemanticEvent(
  rootExecutionId,
  handler,
  options
) {
  return semanticEventBus
    .registry
    .onExecutionRootSemanticEvent(
      rootExecutionId,
      handler,
      options
    );
}
/* ============================================================
   EVENT DISPATCH
   ============================================================ */
export async function dispatchSemanticEvent(
  event,
  options
) {
  return semanticEventBus
    .dispatcher
    .dispatchSemanticEvent(
      event,
      options
    );
}
export async function dispatchSemanticEvents(
  events,
  options
) {
  return semanticEventBus
    .dispatcher
    .dispatchSemanticEvents(
      events,
      options
    );
}
export async function dispatchObservationalSemanticEvent(
  event,
  options
) {
  return semanticEventBus
    .dispatcher
    .dispatchObservationalSemanticEvent(
      event,
      options
    );
}
export async function dispatchCoordinatedSemanticEvent(
  event,
  options
) {
  return semanticEventBus
    .dispatcher
    .dispatchCoordinatedSemanticEvent(
      event,
      options
    );
}
export async function dispatchVetoableSemanticEvent(
  event,
  options
) {
  return semanticEventBus
    .dispatcher
    .dispatchVetoableSemanticEvent(
      event,
      options
    );
}
/* ============================================================
   EXECUTION-CONTEXT EVENT EMISSION
   ============================================================ */
/**
 * @section execution-context-event-emission
 *
 * Preferred domain-service helper when an ExecutionContext exists.
 */
export async function emitExecutionSemanticEvent(
  context,
  options
) {
  return semanticEventBus
    .hooks
    .emitExecutionSemanticEvent(
      context,
      options
    );
}
/* ============================================================
   DISPATCH RESULT ACCESS
   ============================================================ */
export function getHandledSemanticEventResults(
  dispatchResult
) {
  return semanticEventBus
    .dispatcher
    .getHandledSemanticEventResults(
      dispatchResult
    );
}
export function getFailedSemanticEventResults(
  dispatchResult
) {
  return semanticEventBus
    .dispatcher
    .getFailedSemanticEventResults(
      dispatchResult
    );
}
export function getVetoingSemanticEventResult(
  dispatchResult
) {
  return semanticEventBus
    .dispatcher
    .getVetoingSemanticEventResult(
      dispatchResult
    );
}
/* ============================================================
   DISPATCH RESULT PREDICATES
   ============================================================ */
export function didSemanticEventDispatchSucceed(
  result
) {
  return semanticEventBus
    .dispatcher
    .didSemanticEventDispatchSucceed(
      result
    );
}
export function wasSemanticEventDispatchPartial(
  result
) {
  return semanticEventBus
    .dispatcher
    .wasSemanticEventDispatchPartial(
      result
    );
}
export function wasSemanticEventVetoed(
  result
) {
  return semanticEventBus
    .dispatcher
    .wasSemanticEventVetoed(
      result
    );
}
export function didSemanticEventDispatchFail(
  result
) {
  return semanticEventBus
    .dispatcher
    .didSemanticEventDispatchFail(
      result
    );
}
/* ============================================================
   TRANSACTION HOOK REGISTRATION
   ============================================================ */
/**
 * @section transaction-hook-registration
 *
 * Register once during runtime composition.
 */
export function registerSemanticEventTransactionHooks() {
  return semanticEventBus
    .hooks
    .registerSemanticEventTransactionHooks();
}
export function unregisterSemanticEventTransactionHooks() {
  return semanticEventBus
    .hooks
    .unregisterSemanticEventTransactionHooks();
}
export function areSemanticEventTransactionHooksRegistered() {
  return semanticEventBus
    .hooks
    .areSemanticEventTransactionHooksRegistered();
}
/* ============================================================
   TRANSACTION EVENT DIAGNOSTICS
   ============================================================ */
export function getLastTransactionSemanticEventDispatch(
  executionId
) {
  return semanticEventBus
    .hooks
    .getLastTransactionSemanticEventDispatch(
      executionId
    );
}
export function clearTransactionSemanticEventDispatchDiagnostics(
  executionId
) {
  return semanticEventBus
    .hooks
    .clearTransactionSemanticEventDispatchDiagnostics(
      executionId
    );
}
export function clearAllTransactionSemanticEventDispatchDiagnostics() {
  return semanticEventBus
    .hooks
    .clearAllTransactionSemanticEventDispatchDiagnostics();
}
/* ============================================================
   CONTRACT RESULT HELPERS
   ============================================================ */
export function semanticEventHandled(
  options
) {
  return semanticEventBus
    .contract
    .semanticEventHandled(
      options
    );
}
export function semanticEventIgnored(
  options
) {
  return semanticEventBus
    .contract
    .semanticEventIgnored(
      options
    );
}
export function semanticEventStopPropagation(
  options
) {
  return semanticEventBus
    .contract
    .semanticEventStopPropagation(
      options
    );
}
export function semanticEventVetoed(
  options
) {
  return semanticEventBus
    .contract
    .semanticEventVetoed(
      options
    );
}
export function semanticEventListenerFailed(
  options
) {
  return semanticEventBus
    .contract
    .semanticEventListenerFailed(
      options
    );
}
/* ============================================================
   SERVICE CAPABILITIES
   ============================================================ */
export const SEMANTIC_EVENT_BUS_CAPABILITY =
  Object.freeze({
    EVENT_CONSTRUCTION:
      "event-construction",
    EXECUTION_LINEAGE:
      "execution-lineage",
    LISTENER_REGISTRATION:
      "listener-registration",
    MATCH_FILTERING:
      "match-filtering",
    PRIORITY_ORDERING:
      "priority-ordering",
    ASYNC_DISPATCH:
      "async-dispatch",
    OBSERVATIONAL_DELIVERY:
      "observational-delivery",
    COORDINATED_DELIVERY:
      "coordinated-delivery",
    VETOABLE_DELIVERY:
      "vetoable-delivery",
    ONCE_LISTENERS:
      "once-listeners",
    TRANSACTION_EVENTS:
      "transaction-events",
    DOMAIN_EVENT_EMISSION:
      "domain-event-emission"
  });
export function getSemanticEventBusCapabilities() {
  return Object.freeze(
    Object.values(
      SEMANTIC_EVENT_BUS_CAPABILITY
    )
  );
}
/* ============================================================
   DIAGNOSTICS
   ============================================================ */
export function getSemanticEventBusDiagnostics() {
  return Object.freeze({
    module:
      Object.freeze({
        id:
          SEMANTIC_EVENT_BUS_MODULE_ID,
        version:
          SEMANTIC_EVENT_BUS_MODULE_VERSION
      }),
    capabilities:
      getSemanticEventBusCapabilities(),
    registry:
      semanticEventBus
        .registry
        .getSemanticEventRegistryDiagnostics(),
    hooks:
      semanticEventBus
        .hooks
        .getSemanticEventHookDiagnostics()
  });
}
export function getSemanticEventRegistrySnapshot() {
  return semanticEventBus
    .registry
    .getSemanticEventRegistrySnapshot();
}
export function getSemanticEventDispatchDiagnostics(
  result
) {
  return semanticEventBus
    .dispatcher
    .getSemanticEventDispatchDiagnostics(
      result
    );
}
/* ============================================================
   EXECUTION TRANSACTION BOUNDARY
   ============================================================ */
/**
 * @section execution-transaction-boundary
 *
 * Runtime composition:
 *
 * registerSemanticEventTransactionHooks()
 *
 * Generic execution events then emit automatically:
 *
 * execution.started
 * execution.rebuilt
 * execution.targeted
 * execution.validated
 * execution.executed
 * execution.resolved
 * execution.committed
 * execution.succeeded
 * execution.blocked
 * execution.cancelled
 * execution.failed
 * execution.partial
 *
 * runtime-orchestrator should not manually emit those same generic events.
 */
/* ============================================================
   DOMAIN EVENT BOUNDARY
   ============================================================ */
/**
 * @section domain-event-boundary
 *
 * Domain services remain responsible for their own semantic events.
 *
 * resource_service:
 *
 * resource.validated
 * resource.spent
 * resource.restored
 * resource.reset
 *
 *
 * action_economy:
 *
 * economy.validated
 * economy.spent
 * economy.reset
 *
 *
 * lifecycle_service:
 *
 * turn.started
 * turn.ended
 * round.started
 * round.ended
 * scene.started
 * scene.ended
 * full-repair.completed
 *
 *
 * targeting_spatial_service:
 *
 * target.acquired
 * target.removed
 * targeting.completed
 * targeting.template-placed
 *
 * Use emitExecutionSemanticEvent() when an ExecutionContext exists.
 *
 * Otherwise construct + dispatch an event through this façade.
 */
/* ============================================================
   LIFECYCLE SERVICE BOUNDARY
   ============================================================ */
/**
 * @section lifecycle-service-boundary
 *
 * lifecycle_service may both:
 *
 * emit lifecycle events
 * consume semantic events
 *
 * Example:
 *
 * turn.started
 * → action_economy.initializeActionEconomyTurn()
 *
 * full-repair.completed
 * → resource reset processing
 *
 * semantic_event_bus transports the boundary.
 *
 * lifecycle_service decides lifecycle meaning/timing.
 */
/* ============================================================
   TARGETING SPATIAL SERVICE BOUNDARY
   ============================================================ */
/**
 * @section targeting-spatial-service-boundary
 *
 * targeting_spatial_service may emit:
 *
 * target.acquired
 * target.removed
 * targeting.completed
 * targeting.template-placed
 *
 * SemanticEventTarget carries compact identity/position.
 *
 * Full:
 *
 * range
 * threat
 * sensors
 * LOS
 * cover
 * AoE geometry
 *
 * remains owned by targeting_spatial_service.
 */
/* ============================================================
   ACTOR-OWNED FEATURE REGISTRY BOUNDARY
   ============================================================ */
/**
 * @section actor-owned-feature-registry-boundary
 *
 * actor_owned_feature_registry can use event kinds as trigger keys.
 *
 * Example:
 *
 * attack.hit
 *        ↓
 * semantic_event_bus
 *        ↓
 * actor-owned feature trigger listener
 *
 * If triggered mechanic produces execution:
 *
 * listener
 * → resolve owned feature
 * → build child ExecutionContext
 * → execution_transaction
 *
 * Do not execute tabletop feature mechanics directly in this façade.
 */
/* ============================================================
   SYSTEM BRIDGE BOUNDARY
   ============================================================ */
/**
 * @section system-bridge-boundary
 *
 * future system_bridge may supplement runtime descriptors with:
 *
 * triggerKinds
 * producedEvents
 * listenerPriority
 * event predicates
 *
 * It should reference semantic-event-contract vocabulary.
 *
 * It does not become the listener registry or dispatcher.
 */
/* ============================================================
   OBSERVATIONAL / COORDINATED / VETOABLE RULE
   ============================================================ */
/**
 * @section delivery-mode-rule
 *
 * OBSERVATIONAL
 * -------------
 *
 * Default.
 *
 * Use after mechanical truth exists.
 *
 * Listener failure cannot rewrite originating mechanic.
 *
 *
 * COORDINATED
 * -----------
 *
 * Collects contributions.
 *
 * Owning service decides how contributions combine.
 *
 *
 * VETOABLE
 * --------
 *
 * Only for true pre-resolution gates.
 *
 * Explicit VETO may stop the owning operation.
 *
 * Do not use VETOABLE merely because a rule listener might disagree with
 * an already-completed mechanic.
 */
/* ============================================================
   EVENT-TRIGGERED EXECUTION RULE
   ============================================================ */
/**
 * @section event-triggered-execution-rule
 *
 * Semantic event listener discovers:
 *
 * "this mechanic should now trigger"
 *
 * It should not bypass:
 *
 * resources
 * action economy
 * targeting
 * lifecycle
 * native execution
 *
 * Instead:
 *
 * semantic event
 * → feature trigger
 * → child ExecutionContext
 * → execution_transaction
 *
 * This preserves the same foundational runtime for triggered mechanics.
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
 * Should consume this public boundary when manual domain event emission is
 * required.
 *
 * Generic transaction events are emitted automatically through hooks.
 *
 *
 * semantic_execution_context/
 * ---------------------------
 *
 * Supplies actor/source/target/execution lineage used by
 * createSemanticEventFromExecutionContext().
 *
 *
 * execution_transaction/
 * ----------------------
 *
 * Remains transaction truth authority.
 *
 * semantic event transaction hooks are observers.
 *
 *
 * resource_service/
 * -----------------
 *
 * May emit resource domain events through this service.
 *
 *
 * action_economy/
 * ----------------
 *
 * May emit economy domain events through this service.
 *
 *
 * future lifecycle_service/
 * -------------------------
 *
 * Will become a major producer/consumer of semantic events.
 *
 *
 * future targeting_spatial_service/
 * ---------------------------------
 *
 * Will emit normalized targeting/spatial domain events.
 *
 *
 * future actor_owned_feature_registry/
 * ------------------------------------
 *
 * Will use semantic events as trigger/discovery boundaries.
 *
 *
 * future system_bridge/
 * ---------------------
 *
 * Will reference event vocabulary during runtime augmentation/composition.
 */
/* ============================================================
   RECOMMENDED TOP-LEVEL COMPOSITION
   ============================================================ */
/**
 * @section recommended-top-level-composition
 *
 * Future runtime composition:
 *
 * 1. initialize execution_transaction
 *
 * 2. initialize semantic_event_bus
 *
 * 3. register:
 *
 *    registerSemanticEventTransactionHooks()
 *
 * 4. initialize lifecycle_service listeners
 *
 * 5. initialize targeting_spatial_service listeners
 *
 * 6. initialize actor_owned_feature_registry trigger listeners
 *
 * 7. initialize observability/UI listeners
 *
 * Register transaction-event hooks once.
 */
/* ============================================================
   PUBLIC BOUNDARY RULES
   ============================================================ */
/**
 * @section public-boundary-rules
 *
 * RULE 1
 *
 * Higher runtime code should import semantic-event-bus.js instead of
 * registry/dispatcher/hooks implementation files directly.
 *
 *
 * RULE 2
 *
 * Event bus transports semantic truth; it does not own feature mechanics.
 *
 *
 * RULE 3
 *
 * Post-resolution events should normally be observational.
 *
 *
 * RULE 4
 *
 * Triggered mechanics should execute through normal child transactions.
 *
 *
 * RULE 5
 *
 * Stable reusable event kinds belong in semantic-event-contract.js.
 */
/* ============================================================
   DEPENDENCY DIRECTION
   ============================================================ */
/**
 * @section dependency-direction
 *
 * Intended:
 *
 * execution_transaction
 *          │
 *          ▼
 * semantic_event_bus
 *          │
 *          ├── lifecycle_service
 *          ├── targeting_spatial_service
 *          ├── actor_owned_feature_registry
 *          ├── observability
 *          └── UI observers
 *
 *
 * resource_service
 * action_economy
 * lifecycle_service
 * targeting_spatial_service
 *          │
 *          ▼
 * semantic_event_bus
 *
 * for domain event emission.
 *
 *
 * Forbidden:
 *
 * semantic_event_bus
 * → runtime-orchestrator
 *
 * semantic_event_bus
 * → native_adapter
 *
 * semantic_event_bus
 * → feature-specific mechanic implementation
 */
/* ============================================================
   BOUNDARY INVARIANTS
   ============================================================ */
/**
 * @section boundary-invariants
 *
 * INVARIANT 1
 * semantic-event-bus.js is the public Frame Helm semantic-event boundary.
 *
 * INVARIANT 2
 * Contract owns event shapes/vocabulary.
 *
 * INVARIANT 3
 * Registry owns subscriptions.
 *
 * INVARIANT 4
 * Dispatcher owns delivery.
 *
 * INVARIANT 5
 * Hooks own execution_transaction integration.
 *
 * INVARIANT 6
 * Generic transaction semantic events remain observational.
 *
 * INVARIANT 7
 * Listener failure cannot rewrite settled transaction truth.
 *
 * INVARIANT 8
 * Veto has mechanical meaning only for explicitly VETOABLE events.
 *
 * INVARIANT 9
 * Semantic event bus is not a second transaction engine.
 *
 * INVARIANT 10
 * Event-triggered mechanics use child ExecutionContext +
 * execution_transaction.
 *
 * INVARIANT 11
 * lifecycle_service remains lifecycle authority.
 *
 * INVARIANT 12
 * targeting_spatial_service remains spatial authority.
 *
 * INVARIANT 13
 * actor_owned_feature_registry remains owned-feature authority.
 *
 * INVARIANT 14
 * system_bridge may reference event semantics but does not replace the bus.
 *
 * INVARIANT 15
 * Higher runtime modules should converge on this public boundary rather
 * than creating parallel event systems.
 */