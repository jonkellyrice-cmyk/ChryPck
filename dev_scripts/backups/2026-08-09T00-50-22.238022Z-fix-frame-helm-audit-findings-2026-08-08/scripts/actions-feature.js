/**
 * ============================================================
 * FILE PATH / NAME
 * ============================================================
 *
 * scripts/actions-feature.js
 */

/**
 * ============================================================
 * FRAME HELM -- ACTIONS FEATURE
 * ============================================================
 *
 * ROLE:
 *   Owns Frame Helm's universal action catalog and action
 *   registry domain.
 *
 * RESPONSIBILITIES:
 *   - Own the Frame Helm action registry implementation.
 *   - Own universal action-category declarations.
 *   - Own universal action declarations.
 *   - Normalize registered categories and actions.
 *   - Provide action/category lookup.
 *   - Provide root/child action traversal.
 *   - Provide ordered action/category listing.
 *   - Provide action registration for future extensions.
 *   - Initialize the canonical universal action catalog.
 *
 * DOES NOT OWN:
 *   - Turn-state legality.
 *   - Action-budget consumption.
 *   - Movement accounting.
 *   - Overcharge state.
 *   - Protocol state.
 *   - Reaction state.
 *   - Action execution or dice workflows.
 *   - Application rendering.
 *   - Combat synchronization.
 *   - Sensor contacts.
 *   - Actor telemetry.
 *
 * ARCHITECTURAL RELATIONSHIP:
 *
 *   dsl.js
 *      │
 *      ▼
 *   actions-feature.js
 *      │
 *      ├── defines action categories
 *      ├── defines universal actions
 *      ├── owns action registry
 *      └── exposes action-catalog capability
 *      │
 *      ▼
 *   dependent Frame Helm features/runtime
 *
 * TRANSITIONAL INTEGRATION CONTRACT:
 *
 *   lancer-frame-helm.js remains the authoritative runtime and
 *   orchestration surface.
 *
 *   During the current decomposition phase, Foundry startup must
 *   remain synchronous where it is currently synchronous.
 *
 *   Therefore this feature DOES NOT initialize its action catalog
 *   through the feature registry's asynchronous lifecycle runner.
 *
 *   lancer-frame-helm.js should continue calling:
 *
 *     initializeFrameHelmActionRegistry()
 *
 *   synchronously from its existing init hook.
 *
 * FEATURE CONTRACT:
 *
 *   Provides:
 *     - actions.registry
 *     - actions.catalog
 *     - actions.registration
 *
 *   Required dependencies:
 *     - none
 *
 * UI OWNERSHIP:
 *
 *   Generic action-menu presentation belongs to the companion
 *   Actions UI feature:
 *
 *     styles/ui-actions.js
 *     styles/ui-actions.css
 *
 *   Quick-action, Full-action, Movement, Overcharge, and
 *   committed-plan presentation should remain with their more
 *   specific owning domains as those domains are extracted.
 */


import {
  defineFrameHelmActionCategory,
  defineFrameHelmMovementAction,
  defineFrameHelmQuickAction,
  defineFrameHelmFullAction,
  defineFrameHelmSpecialAction,
  defineFrameHelmReaction,
  defineFrameHelmTargetRequirement,
  defineFrameHelmMechSkillMetadata,
  defineFrameHelmRequiresFlightCapabilityMetadata,
  defineFrameHelmRequiresTeleportCapabilityMetadata,
  defineFrameHelmHideRequirementMetadata,
  defineFrameHelmRequiresFullActionSystemMetadata,
  defineFrameHelmMountDismountModesMetadata,
  defineFrameHelmOverchargeMetadata
} from "./frame-helm/dsl.js";

import {
  defineFrameHelmFeature
} from "./feature-contract.js";


/* ============================================================
   Action-domain identity
   ============================================================ */

const MODULE_TITLE =
  "Lancer: Frame Helm";


/* ============================================================
   Action registry implementation
   ============================================================ */

/**
 * Canonical registry implementation for Frame Helm action
 * categories and actions.
 *
 * This registry owns catalog structure only.
 *
 * It does not determine whether an action is legal during a turn.
 */
export class FrameHelmActionRegistry {
  constructor() {
    this.actions =
      new Map();

    this.categories =
      new Map();
  }


  /* ==========================================================
     Action registry -- Category registration
     ========================================================== */

  registerCategory(
    category
  ) {
    if (
      !category ||
      typeof category !==
        "object"
    ) {
      throw new TypeError(
        "Frame Helm categories must be objects."
      );
    }

    const id =
      String(
        category.id ?? ""
      ).trim();

    if (!id) {
      throw new Error(
        "Frame Helm categories require a non-empty id."
      );
    }

    if (
      this.categories.has(id)
    ) {
      throw new Error(
        `Frame Helm category already registered: ${id}`
      );
    }

    const normalizedCategory =
      Object.freeze({
        id,

        label:
          String(
            category.label ??
            id
          ),

        description:
          String(
            category.description ??
            ""
          ),

        order:
          Number.isFinite(
            category.order
          )
            ? category.order
            : 0,

        icon:
          String(
            category.icon ??
            ""
          ),

        visible:
          category.visible !==
          false
      });

    this.categories.set(
      id,
      normalizedCategory
    );

    return normalizedCategory;
  }


  /* ==========================================================
     Action registry -- Action registration
     ========================================================== */

  register(
    action
  ) {
    if (
      !action ||
      typeof action !==
        "object"
    ) {
      throw new TypeError(
        "Frame Helm actions must be objects."
      );
    }

    const id =
      String(
        action.id ?? ""
      ).trim();

    const category =
      String(
        action.category ?? ""
      ).trim();

    if (!id) {
      throw new Error(
        "Frame Helm actions require a non-empty id."
      );
    }

    if (!category) {
      throw new Error(
        `Frame Helm action ${id} requires a category.`
      );
    }

    if (
      !this.categories.has(
        category
      )
    ) {
      throw new Error(
        `Frame Helm action ${id} references unknown category: ${category}`
      );
    }

    if (
      this.actions.has(id)
    ) {
      throw new Error(
        `Frame Helm action already registered: ${id}`
      );
    }

    const normalizedAction =
      Object.freeze({
        id,

        label:
          String(
            action.label ??
            id
          ),

        shortDescription:
          String(
            action.shortDescription ??
            ""
          ),

        description:
          String(
            action.description ??
            ""
          ),

        category,

        parentId:
          action.parentId
            ? String(
                action.parentId
              )
            : null,

        cost:
          String(
            action.cost ??
            "none"
          ),

        order:
          Number.isFinite(
            action.order
          )
            ? action.order
            : 0,

        icon:
          String(
            action.icon ??
            ""
          ),

        tags:
          Object.freeze(
            Array.isArray(
              action.tags
            )
              ? [
                  ...action.tags
                ].map(String)
              : []
          ),

        requiresTarget:
          Boolean(
            action.requiresTarget
          ),

        targetType:
          action.targetType
            ? String(
                action.targetType
              )
            : null,

        duplicateKey:
          String(
            action.duplicateKey ??
            id
          ),

        repeatRule:
          String(
            action.repeatRule ??
            "once-per-turn"
          ),

        movementMode:
          action.movementMode
            ? String(
                action.movementMode
              )
            : null,

        visible:
          action.visible !==
          false,

        metadata:
          Object.freeze({
            ...(
              action.metadata ??
              {}
            )
          })
      });

    this.actions.set(
      id,
      normalizedAction
    );

    return normalizedAction;
  }


  /**
   * Registers several actions in declaration order.
   */
  registerMany(
    actions
  ) {
    if (
      !Array.isArray(
        actions
      )
    ) {
      throw new TypeError(
        "Frame Helm registerMany requires an array."
      );
    }

    return actions.map(
      action =>
        this.register(
          action
        )
    );
  }


  /* ==========================================================
     Action registry -- Lookup
     ========================================================== */

  get(
    id
  ) {
    return (
      this.actions.get(
        String(id)
      ) ??
      null
    );
  }


  getCategory(
    id
  ) {
    return (
      this.categories.get(
        String(id)
      ) ??
      null
    );
  }


  has(
    id
  ) {
    return (
      this.actions.has(
        String(id)
      )
    );
  }


  /* ==========================================================
     Action registry -- Listing
     ========================================================== */

  listCategories({
    includeHidden = false
  } = {}) {
    return [
      ...this.categories.values()
    ]
      .filter(
        category => {
          return (
            includeHidden ||
            category.visible
          );
        }
      )
      .sort(
        (
          left,
          right
        ) => {
          return (
            left.order -
              right.order ||
            left.label.localeCompare(
              right.label
            )
          );
        }
      );
  }


  list({
    category = null,
    parentId = undefined,
    includeHidden = false
  } = {}) {
    return [
      ...this.actions.values()
    ]
      .filter(
        action => {
          if (
            !includeHidden &&
            !action.visible
          ) {
            return false;
          }

          if (
            category &&
            action.category !==
              category
          ) {
            return false;
          }

          if (
            parentId !==
              undefined &&
            action.parentId !==
              parentId
          ) {
            return false;
          }

          return true;
        }
      )
      .sort(
        (
          left,
          right
        ) => {
          return (
            left.order -
              right.order ||
            left.label.localeCompare(
              right.label
            )
          );
        }
      );
  }


  childrenOf(
    parentId,
    options = {}
  ) {
    return this.list({
      ...options,

      parentId:
        String(parentId)
    });
  }


  roots(
    category = null,
    options = {}
  ) {
    return this.list({
      ...options,
      category,
      parentId: null
    });
  }


  /* ==========================================================
     Action registry -- Mutation and diagnostics
     ========================================================== */

  clear() {
    this.actions.clear();
    this.categories.clear();
  }


  toJSON() {
    return {
      categories:
        this.listCategories({
          includeHidden:
            true
        }),

      actions:
        this.list({
          includeHidden:
            true
        })
    };
  }
}


/* ============================================================
   Canonical action registry instance
   ============================================================ */

/**
 * Single action registry instance owned by the Actions feature.
 *
 * Dependent domains should consume this registry through the
 * feature API/capability surface once their extraction permits it.
 *
 * Transitional direct imports are retained below.
 */
export const frameHelmActionRegistry =
  new FrameHelmActionRegistry();


/* ============================================================
   Universal action categories
   ============================================================ */

function registerUniversalActionCategories() {
  [
    defineFrameHelmActionCategory({
      id:
        "movement",

      label:
        "Movement",

      description:
        "Movement available to the active unit.",

      order:
        10,

      icon:
        "fas fa-person-running"
    }),

    defineFrameHelmActionCategory({
      id:
        "quick",

      label:
        "Quick Actions",

      description:
        "Spend one quick-action slot.",

      order:
        20,

      icon:
        "fas fa-bolt"
    }),

    defineFrameHelmActionCategory({
      id:
        "full",

      label:
        "Full Actions",

      description:
        "Spend the unit's full action.",

      order:
        30,

      icon:
        "fas fa-hourglass"
    }),

    defineFrameHelmActionCategory({
      id:
        "special",

      label:
        "Special Actions",

      description:
        "Actions outside the normal quick/full budget.",

      order:
        40,

      icon:
        "fas fa-star"
    }),

    defineFrameHelmActionCategory({
      id:
        "reaction",

      label:
        "Reactions",

      description:
        "Actions triggered during any character's turn.",

      order:
        50,

      icon:
        "fas fa-reply"
    }),

    defineFrameHelmActionCategory({
      id:
        "protocol",

      label:
        "Protocols",

      description:
        "Free actions usable only at the start of a turn.",

      order:
        60,

      icon:
        "fas fa-microchip"
    })
  ].forEach(
    category => {
      frameHelmActionRegistry
        .registerCategory(
          category
        );
    }
  );
}


/* ============================================================
   Universal action declarations
   ============================================================ */

function registerUniversalActions() {
  frameHelmActionRegistry
    .registerMany([
      /* --------------------------------------------------------
         Movement
         -------------------------------------------------------- */

      defineFrameHelmMovementAction({
        id:
          "movement.standard",

        label:
          "Standard Move",

        shortDescription:
          "Move up to your Speed.",

        order:
          10,

        icon:
          "fas fa-person-walking",

        movementMode:
          "standard"
      }),

      defineFrameHelmMovementAction({
        id:
          "movement.jump",

        label:
          "Jump",

        shortDescription:
          "Jump instead of making a normal standard move.",

        parentId:
          "movement.standard",

        order:
          20,

        icon:
          "fas fa-arrow-up",

        duplicateKey:
          "movement.standard",

        movementMode:
          "jump"
      }),

      defineFrameHelmMovementAction({
        id:
          "movement.climb",

        label:
          "Climb",

        shortDescription:
          "Climb at half Speed.",

        parentId:
          "movement.standard",

        order:
          30,

        icon:
          "fas fa-mountain",

        duplicateKey:
          "movement.standard",

        movementMode:
          "climb"
      }),

      defineFrameHelmMovementAction({
        id:
          "movement.fly",

        label:
          "Fly",

        shortDescription:
          "Use available flight movement.",

        parentId:
          "movement.standard",

        order:
          40,

        icon:
          "fas fa-plane-up",

        duplicateKey:
          "movement.standard",

        movementMode:
          "flight",

        metadata:
          defineFrameHelmRequiresFlightCapabilityMetadata()
      }),

      defineFrameHelmMovementAction({
        id:
          "movement.teleport",

        label:
          "Teleport",

        shortDescription:
          "Use an available teleport movement effect.",

        parentId:
          "movement.standard",

        order:
          50,

        icon:
          "fas fa-wand-sparkles",

        duplicateKey:
          "movement.standard",

        movementMode:
          "teleport",

        metadata:
          defineFrameHelmRequiresTeleportCapabilityMetadata()
      }),


      /* --------------------------------------------------------
         Quick actions
         -------------------------------------------------------- */

      defineFrameHelmQuickAction({
        id:
          "quick.skirmish",

        label:
          "Skirmish",

        shortDescription:
          "Attack with one weapon.",

        order:
          10,

        icon:
          "fas fa-crosshairs",

        ...defineFrameHelmTargetRequirement(
          "attack"
        )
      }),

      defineFrameHelmQuickAction({
        id:
          "quick.boost",

        label:
          "Boost",

        shortDescription:
          "Move again, up to your Speed.",

        order:
          20,

        icon:
          "fas fa-forward-fast",

        movementMode:
          "boost"
      }),

      defineFrameHelmQuickAction({
        id:
          "quick.grapple",

        label:
          "Grapple",

        shortDescription:
          "Make a melee attack to grapple an adjacent character.",

        order:
          30,

        icon:
          "fas fa-hand-fist",

        ...defineFrameHelmTargetRequirement(
          "adjacent-character"
        )
      }),

      defineFrameHelmQuickAction({
        id:
          "quick.hide",

        label:
          "Hide",

        shortDescription:
          "Become Hidden when the requirements are met.",

        order:
          40,

        icon:
          "fas fa-user-ninja",

        metadata:
          defineFrameHelmHideRequirementMetadata()
      }),

      defineFrameHelmQuickAction({
        id:
          "quick.quick-tech",

        label:
          "Quick Tech",

        shortDescription:
          "Choose one available quick-tech option.",

        order:
          50,

        icon:
          "fas fa-satellite-dish",

        repeatRule:
          "different-child-per-use"
      }),

      defineFrameHelmQuickAction({
        id:
          "quick.quick-tech.bolster",

        label:
          "Bolster",

        shortDescription:
          "Give another character Accuracy on a skill check or save.",

        parentId:
          "quick.quick-tech",

        order:
          10,

        icon:
          "fas fa-shield-plus",

        ...defineFrameHelmTargetRequirement(
          "character-in-sensors"
        )
      }),

      defineFrameHelmQuickAction({
        id:
          "quick.quick-tech.scan",

        label:
          "Scan",

        shortDescription:
          "Learn information about a target within Sensors.",

        parentId:
          "quick.quick-tech",

        order:
          20,

        icon:
          "fas fa-radar",

        ...defineFrameHelmTargetRequirement(
          "character-or-object-in-sensors"
        )
      }),

      defineFrameHelmQuickAction({
        id:
          "quick.quick-tech.lock-on",

        label:
          "Lock On",

        shortDescription:
          "Give a target the Lock On condition.",

        parentId:
          "quick.quick-tech",

        order:
          30,

        icon:
          "fas fa-bullseye",

        ...defineFrameHelmTargetRequirement(
          "character-in-sensors"
        )
      }),

      defineFrameHelmQuickAction({
        id:
          "quick.quick-tech.invade",

        label:
          "Invade",

        shortDescription:
          "Make a tech attack against a character within Sensors.",

        parentId:
          "quick.quick-tech",

        order:
          40,

        icon:
          "fas fa-virus",

        ...defineFrameHelmTargetRequirement(
          "character-in-sensors"
        )
      }),

      defineFrameHelmQuickAction({
        id:
          "quick.quick-tech.invade.fragment-signal",

        label:
          "Fragment Signal",

        shortDescription:
          "On a successful Invade, the target becomes Impaired and Slowed.",

        parentId:
          "quick.quick-tech.invade",

        order:
          10,

        icon:
          "fas fa-signal",

        ...defineFrameHelmTargetRequirement(
          "character-in-sensors"
        )
      }),

      defineFrameHelmQuickAction({
        id:
          "quick.ram",

        label:
          "Ram",

        shortDescription:
          "Knock an adjacent target Prone and optionally push it.",

        order:
          60,

        icon:
          "fas fa-people-arrows-left-right",

        ...defineFrameHelmTargetRequirement(
          "adjacent-character"
        )
      }),

      defineFrameHelmQuickAction({
        id:
          "quick.search",

        label:
          "Search",

        shortDescription:
          "Attempt to reveal a Hidden character within Sensors.",

        order:
          70,

        icon:
          "fas fa-magnifying-glass",

        ...defineFrameHelmTargetRequirement(
          "suspected-hidden-character"
        )
      }),

      defineFrameHelmQuickAction({
        id:
          "quick.prepare",

        label:
          "Prepare",

        shortDescription:
          "Prepare another quick action with a specified trigger.",

        order:
          80,

        icon:
          "fas fa-clock"
      }),

      defineFrameHelmQuickAction({
        id:
          "quick.shut-down",

        label:
          "Shut Down",

        shortDescription:
          "Power the mech down and enter the Shut Down state.",

        order:
          90,

        icon:
          "fas fa-power-off"
      }),

      defineFrameHelmQuickAction({
        id:
          "quick.self-destruct",

        label:
          "Self-Destruct",

        shortDescription:
          "Begin a delayed reactor meltdown.",

        order:
          100,

        icon:
          "fas fa-radiation"
      }),


      /* --------------------------------------------------------
         Full actions
         -------------------------------------------------------- */

      defineFrameHelmFullAction({
        id:
          "full.barrage",

        label:
          "Barrage",

        shortDescription:
          "Attack with two weapons or one Superheavy weapon.",

        order:
          10,

        icon:
          "fas fa-gun",

        ...defineFrameHelmTargetRequirement(
          "attack"
        )
      }),

      defineFrameHelmFullAction({
        id:
          "full.disengage",

        label:
          "Disengage",

        shortDescription:
          "Ignore engagement and movement reactions for this turn.",

        order:
          20,

        icon:
          "fas fa-person-walking-arrow-right"
      }),

      defineFrameHelmFullAction({
        id:
          "full.full-tech",

        label:
          "Full Tech",

        shortDescription:
          "Take two Quick Tech options or one Full Tech option.",

        order:
          30,

        icon:
          "fas fa-laptop-code",

        repeatRule:
          "full-tech-selection"
      }),

      defineFrameHelmFullAction({
        id:
          "full.improvised-attack",

        label:
          "Improvised Attack",

        shortDescription:
          "Make an improvised melee attack against an adjacent target.",

        order:
          40,

        icon:
          "fas fa-hammer",

        ...defineFrameHelmTargetRequirement(
          "adjacent-character"
        )
      }),

      defineFrameHelmFullAction({
        id:
          "full.stabilize",

        label:
          "Stabilize",

        shortDescription:
          "Clear heat or restore HP, then perform one additional stabilization option.",

        order:
          50,

        icon:
          "fas fa-screwdriver-wrench"
      }),

      defineFrameHelmFullAction({
        id:
          "full.activate",

        label:
          "Activate",

        shortDescription:
          "Activate a system or piece of equipment with a Full Action activation cost.",

        order:
          60,

        icon:
          "fas fa-gears",

        metadata:
          defineFrameHelmRequiresFullActionSystemMetadata()
      }),

      defineFrameHelmFullAction({
        id:
          "full.boot-up",

        label:
          "Boot Up",

        shortDescription:
          "Clear Shut Down and restore the mech to a powered state.",

        order:
          70,

        icon:
          "fas fa-toggle-on"
      }),

      defineFrameHelmFullAction({
        id:
          "full.mount-dismount",

        label:
          "Mount, Dismount, or Eject",

        shortDescription:
          "Mount or dismount a mech or vehicle, or eject from your mech.",

        order:
          80,

        icon:
          "fas fa-person-arrow-up-from-line",

        metadata:
          defineFrameHelmMountDismountModesMetadata()
      }),

      defineFrameHelmFullAction({
        id:
          "full.skill-check",

        label:
          "Skill Check",

        shortDescription:
          "Attempt a complex activity not covered by another action.",

        order:
          90,

        icon:
          "fas fa-dice-d20"
      }),

      defineFrameHelmFullAction({
        id:
          "full.skill-check.hull",

        label:
          "Hull Check",

        shortDescription:
          "Roll a mech skill check using HULL.",

        parentId:
          "full.skill-check",

        order:
          10,

        icon:
          "fas fa-shield-halved",

        duplicateKey:
          "full.skill-check",

        metadata:
          defineFrameHelmMechSkillMetadata({
            statPath:
              "hull",

            statLabel:
              "HULL"
          })
      }),

      defineFrameHelmFullAction({
        id:
          "full.skill-check.agi",

        label:
          "Agility Check",

        shortDescription:
          "Roll a mech skill check using AGI.",

        parentId:
          "full.skill-check",

        order:
          20,

        icon:
          "fas fa-person-running",

        duplicateKey:
          "full.skill-check",

        metadata:
          defineFrameHelmMechSkillMetadata({
            statPath:
              "agi",

            statLabel:
              "AGI"
          })
      }),

      defineFrameHelmFullAction({
        id:
          "full.skill-check.sys",

        label:
          "Systems Check",

        shortDescription:
          "Roll a mech skill check using SYS.",

        parentId:
          "full.skill-check",

        order:
          30,

        icon:
          "fas fa-microchip",

        duplicateKey:
          "full.skill-check",

        metadata:
          defineFrameHelmMechSkillMetadata({
            statPath:
              "sys",

            statLabel:
              "SYS"
          })
      }),

      defineFrameHelmFullAction({
        id:
          "full.skill-check.eng",

        label:
          "Engineering Check",

        shortDescription:
          "Roll a mech skill check using ENG.",

        parentId:
          "full.skill-check",

        order:
          40,

        icon:
          "fas fa-screwdriver-wrench",

        duplicateKey:
          "full.skill-check",

        metadata:
          defineFrameHelmMechSkillMetadata({
            statPath:
              "eng",

            statLabel:
              "ENG"
          })
      }),


      /* --------------------------------------------------------
         Special actions
         -------------------------------------------------------- */

      defineFrameHelmSpecialAction({
        id:
          "special.overcharge",

        label:
          "Overcharge",

        shortDescription:
          "Take Heat to gain one additional quick action as a free action.",

        cost:
          "overcharge",

        order:
          10,

        icon:
          "fas fa-temperature-high",

        metadata:
          defineFrameHelmOverchargeMetadata()
      }),

      defineFrameHelmSpecialAction({
        id:
          "special.end-turn",

        label:
          "End Turn",

        shortDescription:
          "Declare that the active unit has finished its turn.",

        cost:
          "none",

        order:
          1000,

        icon:
          "fas fa-flag-checkered",

        repeatRule:
          "unrestricted"
      }),


      /* --------------------------------------------------------
         Reactions
         -------------------------------------------------------- */

      defineFrameHelmReaction({
        id:
          "reaction.brace",

        label:
          "Brace",

        shortDescription:
          "Gain Resistance to the triggering attack and hinder later attacks.",

        order:
          10,

        icon:
          "fas fa-shield-halved"
      }),

      defineFrameHelmReaction({
        id:
          "reaction.overwatch",

        label:
          "Overwatch",

        shortDescription:
          "Skirmish when a hostile character begins movement within Threat.",

        order:
          20,

        icon:
          "fas fa-eye",

        ...defineFrameHelmTargetRequirement(
          "hostile-in-threat"
        )
      })
    ]);
}


/* ============================================================
   Action catalog initialization
   ============================================================ */

/**
 * Rebuilds the canonical universal action catalog.
 *
 * IMPORTANT:
 *
 * This function intentionally remains synchronous.
 *
 * lancer-frame-helm.js should continue invoking it directly from
 * Foundry's init hook during the transitional extraction phase.
 */
function initializeFrameHelmActionRegistry() {
  frameHelmActionRegistry
    .clear();

  registerUniversalActionCategories();

  registerUniversalActions();

  console.log(
    `${MODULE_TITLE} | Registered ${frameHelmActionRegistry.actions.size} universal actions.`
  );

  return frameHelmActionRegistry;
}


/* ============================================================
   Actions feature definition
   ============================================================ */

/**
 * Canonical Actions feature declaration.
 *
 * This module defines the feature but does not register itself.
 *
 * The canonical feature registry/composition surface is
 * responsible for registration.
 *
 * Initialization is deliberately exposed as a command/API method
 * rather than placed in lifecycle.initialize so existing Foundry
 * startup ordering remains synchronous.
 */
export const frameHelmActionsFeature =
  defineFrameHelmFeature({
    id:
      "actions",

    domain:
      "actions",

    provides: [
      "actions.registry",
      "actions.catalog",
      "actions.registration"
    ],

    dependsOn: [],

    optionalDependsOn: [],

    state: {},

    commands: {
      initialize:
        initializeFrameHelmActionRegistry,

      clear:
        () =>
          frameHelmActionRegistry
            .clear(),

      register:
        action =>
          frameHelmActionRegistry
            .register(action),

      registerCategory:
        category =>
          frameHelmActionRegistry
            .registerCategory(
              category
            )
    },

    queries: {
      get:
        id =>
          frameHelmActionRegistry
            .get(id),

      getCategory:
        id =>
          frameHelmActionRegistry
            .getCategory(id),

      has:
        id =>
          frameHelmActionRegistry
            .has(id),

      list:
        options =>
          frameHelmActionRegistry
            .list(options),

      roots:
        (
          category,
          options
        ) =>
          frameHelmActionRegistry
            .roots(
              category,
              options
            ),

      childrenOf:
        (
          parentId,
          options
        ) =>
          frameHelmActionRegistry
            .childrenOf(
              parentId,
              options
            ),

      categories:
        options =>
          frameHelmActionRegistry
            .listCategories(
              options
            ),

      snapshot:
        () =>
          frameHelmActionRegistry
            .toJSON()
    },

    hooks: {},

    lifecycle: {},

    api: {
      registry:
        frameHelmActionRegistry,

      initialize:
        initializeFrameHelmActionRegistry,

      clear:
        () =>
          frameHelmActionRegistry
            .clear(),

      get:
        id =>
          frameHelmActionRegistry
            .get(id),

      getCategory:
        id =>
          frameHelmActionRegistry
            .getCategory(id),

      has:
        id =>
          frameHelmActionRegistry
            .has(id),

      list:
        options =>
          frameHelmActionRegistry
            .list(options),

      roots:
        (
          category,
          options
        ) =>
          frameHelmActionRegistry
            .roots(
              category,
              options
            ),

      childrenOf:
        (
          parentId,
          options
        ) =>
          frameHelmActionRegistry
            .childrenOf(
              parentId,
              options
            ),

      categories:
        options =>
          frameHelmActionRegistry
            .listCategories(
              options
            ),

      register:
        action =>
          frameHelmActionRegistry
            .register(action),

      registerCategory:
        category =>
          frameHelmActionRegistry
            .registerCategory(
              category
            ),

      snapshot:
        () =>
          frameHelmActionRegistry
            .toJSON()
    },

    metadata: {
      label:
        "Universal Actions",

      description:
        "Owns Frame Helm's universal action definitions, categories, and canonical action registry.",

      extractedFrom:
        "scripts/lancer-frame-helm.js",

      authoritativeRuntime:
        "scripts/lancer-frame-helm.js",

      startupModel:
        "synchronous-runtime-initialization"
    }
  });


/* ============================================================
   Transitional named exports
   ============================================================ */

/**
 * These named exports preserve a low-risk migration path for the
 * primary runtime and the next extracted features.
 *
 * lancer-frame-helm.js can immediately replace its former local
 * action implementation with:
 *
 *   import {
 *     frameHelmActionRegistry,
 *     initializeFrameHelmActionRegistry
 *   } from "./actions-feature.js";
 *
 * Later extracted features should preferably consume
 * actions.registry through the feature registry capability API
 * once the composition graph is fully established.
 */
export {
  initializeFrameHelmActionRegistry,
  registerUniversalActionCategories,
  registerUniversalActions
};