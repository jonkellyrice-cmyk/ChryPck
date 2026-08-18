const MODULE_ID = "lancer-frame-helm";
const MODULE_TITLE = "Lancer: Frame Helm";

/* ==========================================================
   Action registry
   ========================================================== */

class FrameHelmActionRegistry {
  constructor() {
    this.actions = new Map();
    this.categories = new Map();
  }

  registerCategory(category) {
    if (!category || typeof category !== "object") {
      throw new TypeError(
        "Frame Helm categories must be objects."
      );
    }

    const id = String(category.id ?? "").trim();

    if (!id) {
      throw new Error(
        "Frame Helm categories require a non-empty id."
      );
    }

    if (this.categories.has(id)) {
      throw new Error(
        `Frame Helm category already registered: ${id}`
      );
    }

    const normalizedCategory = Object.freeze({
      id,
      label: String(category.label ?? id),
      description: String(category.description ?? ""),
      order: Number.isFinite(category.order)
        ? category.order
        : 0,
      icon: String(category.icon ?? ""),
      visible: category.visible !== false
    });

    this.categories.set(id, normalizedCategory);
    return normalizedCategory;
  }

  register(action) {
    if (!action || typeof action !== "object") {
      throw new TypeError(
        "Frame Helm actions must be objects."
      );
    }

    const id = String(action.id ?? "").trim();
    const category = String(action.category ?? "").trim();

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

    if (!this.categories.has(category)) {
      throw new Error(
        `Frame Helm action ${id} references unknown category: ${category}`
      );
    }

    if (this.actions.has(id)) {
      throw new Error(
        `Frame Helm action already registered: ${id}`
      );
    }

    const normalizedAction = Object.freeze({
      id,
      label: String(action.label ?? id),
      shortDescription: String(
        action.shortDescription ?? ""
      ),
      description: String(action.description ?? ""),
      category,
      parentId: action.parentId
        ? String(action.parentId)
        : null,
      cost: String(action.cost ?? "none"),
      order: Number.isFinite(action.order)
        ? action.order
        : 0,
      icon: String(action.icon ?? ""),
      tags: Object.freeze(
        Array.isArray(action.tags)
          ? [...action.tags].map(String)
          : []
      ),
      requiresTarget: Boolean(action.requiresTarget),
      targetType: action.targetType
        ? String(action.targetType)
        : null,
      duplicateKey: String(
        action.duplicateKey ?? id
      ),
      repeatRule: String(
        action.repeatRule ?? "once-per-turn"
      ),
      movementMode: action.movementMode
        ? String(action.movementMode)
        : null,
      visible: action.visible !== false,
      metadata: Object.freeze({
        ...(action.metadata ?? {})
      })
    });

    this.actions.set(id, normalizedAction);
    return normalizedAction;
  }

  registerMany(actions) {
    if (!Array.isArray(actions)) {
      throw new TypeError(
        "Frame Helm registerMany requires an array."
      );
    }

    return actions.map(action => this.register(action));
  }

  get(id) {
    return this.actions.get(String(id)) ?? null;
  }

  getCategory(id) {
    return this.categories.get(String(id)) ?? null;
  }

  has(id) {
    return this.actions.has(String(id));
  }

  listCategories({ includeHidden = false } = {}) {
    return [...this.categories.values()]
      .filter(category => includeHidden || category.visible)
      .sort((left, right) => {
        return (
          left.order - right.order ||
          left.label.localeCompare(right.label)
        );
      });
  }

  list({
    category = null,
    parentId = undefined,
    includeHidden = false
  } = {}) {
    return [...this.actions.values()]
      .filter(action => {
        if (!includeHidden && !action.visible) {
          return false;
        }

        if (category && action.category !== category) {
          return false;
        }

        if (
          parentId !== undefined &&
          action.parentId !== parentId
        ) {
          return false;
        }

        return true;
      })
      .sort((left, right) => {
        return (
          left.order - right.order ||
          left.label.localeCompare(right.label)
        );
      });
  }

  childrenOf(parentId, options = {}) {
    return this.list({
      ...options,
      parentId: String(parentId)
    });
  }

  roots(category = null, options = {}) {
    return this.list({
      ...options,
      category,
      parentId: null
    });
  }

  clear() {
    this.actions.clear();
    this.categories.clear();
  }

  toJSON() {
    return {
      categories: this.listCategories({
        includeHidden: true
      }),
      actions: this.list({
        includeHidden: true
      })
    };
  }
}

const frameHelmActionRegistry =
  new FrameHelmActionRegistry();

function registerUniversalActionCategories() {
  frameHelmActionRegistry.registerCategory({
    id: "movement",
    label: "Movement",
    description: "Movement available to the active unit.",
    order: 10,
    icon: "fas fa-person-running"
  });

  frameHelmActionRegistry.registerCategory({
    id: "quick",
    label: "Quick Actions",
    description: "Spend one quick-action slot.",
    order: 20,
    icon: "fas fa-bolt"
  });

  frameHelmActionRegistry.registerCategory({
    id: "full",
    label: "Full Actions",
    description: "Spend the unit's full action.",
    order: 30,
    icon: "fas fa-hourglass"
  });

  frameHelmActionRegistry.registerCategory({
    id: "special",
    label: "Special Actions",
    description: "Actions outside the normal quick/full budget.",
    order: 40,
    icon: "fas fa-star"
  });

  frameHelmActionRegistry.registerCategory({
    id: "reaction",
    label: "Reactions",
    description: "Actions triggered during any character's turn.",
    order: 50,
    icon: "fas fa-reply"
  });

  frameHelmActionRegistry.registerCategory({
    id: "protocol",
    label: "Protocols",
    description: "Free actions usable only at the start of a turn.",
    order: 60,
    icon: "fas fa-microchip"
  });
}

function registerUniversalActions() {
  frameHelmActionRegistry.registerMany([
    {
      id: "movement.standard",
      label: "Standard Move",
      shortDescription: "Move up to your Speed.",
      category: "movement",
      cost: "movement",
      order: 10,
      icon: "fas fa-person-walking",
      repeatRule: "once-per-turn",
      movementMode: "standard"
    },
    {
      id: "movement.jump",
      label: "Jump",
      shortDescription: "Jump instead of making a normal standard move.",
      category: "movement",
      parentId: "movement.standard",
      cost: "movement",
      order: 20,
      icon: "fas fa-arrow-up",
      duplicateKey: "movement.standard",
      repeatRule: "once-per-turn",
      movementMode: "jump"
    },
    {
      id: "movement.climb",
      label: "Climb",
      shortDescription: "Climb at half Speed.",
      category: "movement",
      parentId: "movement.standard",
      cost: "movement",
      order: 30,
      icon: "fas fa-mountain",
      duplicateKey: "movement.standard",
      repeatRule: "once-per-turn",
      movementMode: "climb"
    },
    {
      id: "movement.fly",
      label: "Fly",
      shortDescription: "Use available flight movement.",
      category: "movement",
      parentId: "movement.standard",
      cost: "movement",
      order: 40,
      icon: "fas fa-plane-up",
      duplicateKey: "movement.standard",
      repeatRule: "once-per-turn",
      movementMode: "flight",
      metadata: {
        requiresFlightCapability: true
      }
    },
    {
      id: "movement.teleport",
      label: "Teleport",
      shortDescription: "Use an available teleport movement effect.",
      category: "movement",
      parentId: "movement.standard",
      cost: "movement",
      order: 50,
      icon: "fas fa-wand-sparkles",
      duplicateKey: "movement.standard",
      repeatRule: "once-per-turn",
      movementMode: "teleport",
      metadata: {
        requiresTeleportCapability: true
      }
    },
    {
      id: "quick.skirmish",
      label: "Skirmish",
      shortDescription: "Attack with one weapon.",
      category: "quick",
      cost: "quick",
      order: 10,
      icon: "fas fa-crosshairs",
      requiresTarget: true,
      targetType: "attack"
    },
    {
      id: "quick.boost",
      label: "Boost",
      shortDescription: "Move again, up to your Speed.",
      category: "quick",
      cost: "quick",
      order: 20,
      icon: "fas fa-forward-fast",
      movementMode: "boost"
    },
    {
      id: "quick.grapple",
      label: "Grapple",
      shortDescription: "Make a melee attack to grapple an adjacent character.",
      category: "quick",
      cost: "quick",
      order: 30,
      icon: "fas fa-hand-fist",
      requiresTarget: true,
      targetType: "adjacent-character"
    },
    {
      id: "quick.hide",
      label: "Hide",
      shortDescription: "Become Hidden when the requirements are met.",
      category: "quick",
      cost: "quick",
      order: 40,
      icon: "fas fa-user-ninja",
      metadata: {
        requiresNotEngaged: true,
        requiresCoverOrInvisibility: true
      }
    },
    {
      id: "quick.quick-tech",
      label: "Quick Tech",
      shortDescription: "Choose one available quick-tech option.",
      category: "quick",
      cost: "quick",
      order: 50,
      icon: "fas fa-satellite-dish",
      repeatRule: "different-child-per-use"
    },
    {
      id: "quick.quick-tech.bolster",
      label: "Bolster",
      shortDescription: "Give another character Accuracy on a skill check or save.",
      category: "quick",
      parentId: "quick.quick-tech",
      cost: "quick",
      order: 10,
      icon: "fas fa-shield-plus",
      requiresTarget: true,
      targetType: "character-in-sensors",
      duplicateKey: "quick.quick-tech.bolster"
    },
    {
      id: "quick.quick-tech.scan",
      label: "Scan",
      shortDescription: "Learn information about a target within Sensors.",
      category: "quick",
      parentId: "quick.quick-tech",
      cost: "quick",
      order: 20,
      icon: "fas fa-radar",
      requiresTarget: true,
      targetType: "character-or-object-in-sensors",
      duplicateKey: "quick.quick-tech.scan"
    },
    {
      id: "quick.quick-tech.lock-on",
      label: "Lock On",
      shortDescription: "Give a target the Lock On condition.",
      category: "quick",
      parentId: "quick.quick-tech",
      cost: "quick",
      order: 30,
      icon: "fas fa-bullseye",
      requiresTarget: true,
      targetType: "character-in-sensors",
      duplicateKey: "quick.quick-tech.lock-on"
    },
    {
      id: "quick.quick-tech.invade",
      label: "Invade",
      shortDescription: "Make a tech attack against a character within Sensors.",
      category: "quick",
      parentId: "quick.quick-tech",
      cost: "quick",
      order: 40,
      icon: "fas fa-virus",
      requiresTarget: true,
      targetType: "character-in-sensors",
      duplicateKey: "quick.quick-tech.invade"
    },
    {
      id: "quick.quick-tech.invade.fragment-signal",
      label: "Fragment Signal",
      shortDescription: "On a successful Invade, the target becomes Impaired and Slowed.",
      category: "quick",
      parentId: "quick.quick-tech.invade",
      cost: "quick",
      order: 10,
      icon: "fas fa-signal",
      requiresTarget: true,
      targetType: "character-in-sensors",
      duplicateKey: "quick.quick-tech.invade"
    },
    {
      id: "quick.ram",
      label: "Ram",
      shortDescription: "Knock an adjacent target Prone and optionally push it.",
      category: "quick",
      cost: "quick",
      order: 60,
      icon: "fas fa-people-arrows-left-right",
      requiresTarget: true,
      targetType: "adjacent-character"
    },
    {
      id: "quick.search",
      label: "Search",
      shortDescription: "Attempt to reveal a Hidden character within Sensors.",
      category: "quick",
      cost: "quick",
      order: 70,
      icon: "fas fa-magnifying-glass",
      requiresTarget: true,
      targetType: "suspected-hidden-character"
    },
    {
      id: "quick.prepare",
      label: "Prepare",
      shortDescription: "Prepare another quick action with a specified trigger.",
      category: "quick",
      cost: "quick",
      order: 80,
      icon: "fas fa-clock"
    },
    {
      id: "quick.shut-down",
      label: "Shut Down",
      shortDescription: "Power the mech down and enter the Shut Down state.",
      category: "quick",
      cost: "quick",
      order: 90,
      icon: "fas fa-power-off"
    },
    {
      id: "quick.self-destruct",
      label: "Self-Destruct",
      shortDescription: "Begin a delayed reactor meltdown.",
      category: "quick",
      cost: "quick",
      order: 100,
      icon: "fas fa-radiation"
    },
    {
      id: "full.barrage",
      label: "Barrage",
      shortDescription: "Attack with two weapons or one Superheavy weapon.",
      category: "full",
      cost: "full",
      order: 10,
      icon: "fas fa-gun",
      requiresTarget: true,
      targetType: "attack"
    },
    {
      id: "full.disengage",
      label: "Disengage",
      shortDescription: "Ignore engagement and movement reactions for this turn.",
      category: "full",
      cost: "full",
      order: 20,
      icon: "fas fa-person-walking-arrow-right"
    },
    {
      id: "full.full-tech",
      label: "Full Tech",
      shortDescription: "Take two Quick Tech options or one Full Tech option.",
      category: "full",
      cost: "full",
      order: 30,
      icon: "fas fa-laptop-code",
      repeatRule: "full-tech-selection"
    },
    {
      id: "full.improvised-attack",
      label: "Improvised Attack",
      shortDescription: "Make an improvised melee attack against an adjacent target.",
      category: "full",
      cost: "full",
      order: 40,
      icon: "fas fa-hammer",
      requiresTarget: true,
      targetType: "adjacent-character"
    },
    {
      id: "full.stabilize",
      label: "Stabilize",
      shortDescription: "Clear heat or restore HP, then perform one additional stabilization option.",
      category: "full",
      cost: "full",
      order: 50,
      icon: "fas fa-screwdriver-wrench"
    },
    {
      id: "full.activate",
      label: "Activate",
      shortDescription: "Activate a system or piece of equipment with a Full Action activation cost.",
      category: "full",
      cost: "full",
      order: 60,
      icon: "fas fa-gears",
      metadata: {
        requiresFullActionSystem: true
      }
    },
    {
      id: "full.boot-up",
      label: "Boot Up",
      shortDescription: "Clear Shut Down and restore the mech to a powered state.",
      category: "full",
      cost: "full",
      order: 70,
      icon: "fas fa-toggle-on"
    },
    {
      id: "full.mount-dismount",
      label: "Mount, Dismount, or Eject",
      shortDescription: "Mount or dismount a mech or vehicle, or eject from your mech.",
      category: "full",
      cost: "full",
      order: 80,
      icon: "fas fa-person-arrow-up-from-line",
      metadata: {
        modes: [
          "mount",
          "dismount",
          "eject"
        ]
      }
    },
    {
      id: "full.skill-check",
      label: "Skill Check",
      shortDescription: "Attempt a complex activity not covered by another action.",
      category: "full",
      cost: "full",
      order: 90,
      icon: "fas fa-dice-d20"
    },
    {
      id: "special.overcharge",
      label: "Overcharge",
      shortDescription: "Take Heat to gain one additional quick action as a free action.",
      category: "special",
      cost: "overcharge",
      order: 10,
      icon: "fas fa-temperature-high",
      repeatRule: "once-per-turn",
      metadata: {
        grantsQuickAction: true,
        permitsDuplicateAction: true
      }
    },
    {
      id: "special.end-turn",
      label: "End Turn",
      shortDescription: "Declare that the active unit has finished its turn.",
      category: "special",
      cost: "none",
      order: 1000,
      icon: "fas fa-flag-checkered",
      repeatRule: "unrestricted"
    },
    {
      id: "reaction.brace",
      label: "Brace",
      shortDescription: "Gain Resistance to the triggering attack and hinder later attacks.",
      category: "reaction",
      cost: "reaction",
      order: 10,
      icon: "fas fa-shield-halved",
      repeatRule: "once-per-round"
    },
    {
      id: "reaction.overwatch",
      label: "Overwatch",
      shortDescription: "Skirmish when a hostile character begins movement within Threat.",
      category: "reaction",
      cost: "reaction",
      order: 20,
      icon: "fas fa-eye",
      requiresTarget: true,
      targetType: "hostile-in-threat",
      repeatRule: "once-per-round"
    }
  ]);
}

function initializeActionRegistry() {
  frameHelmActionRegistry.clear();
  registerUniversalActionCategories();
  registerUniversalActions();

  console.log(
    `${MODULE_TITLE} | Registered ${frameHelmActionRegistry.actions.size} universal actions.`
  );
}

/* ==========================================================
   Turn state
   ========================================================== */

class FrameHelmTurnState {
  constructor(context = {}) {
    this.reset(context);
  }

  reset(context = {}) {
    this.context = {
      combatId: context.combatId ?? null,
      combatantId: context.combatantId ?? null,
      tokenId: context.tokenId ?? null,
      actorId: context.actorId ?? null,
      sceneId: context.sceneId ?? null,
      round: Number.isFinite(context.round)
        ? context.round
        : null,
      turn: Number.isFinite(context.turn)
        ? context.turn
        : null
    };

    const hasSpeedValue =
      context.speed !== null &&
      context.speed !== undefined &&
      context.speed !== "";

    const speed = hasSpeedValue
      ? Number(context.speed)
      : null;

    this.speed =
      speed !== null &&
      Number.isFinite(speed) &&
      speed >= 0
        ? speed
        : null;

    this.movement = {
      maximum: this.speed,
      spent: 0,
      remaining: this.speed,
      completed: false,
      totalTracked: 0,
      standardUsed: 0,
      boostUsed: 0,
      overchargeBoostUsed: 0,
      excess: 0,
      segments: [],
      processedMovementIds: []
    };

    this.actionMode = null;
    this.quickActionsRemaining = 2;
    this.fullActionAvailable = true;

    this.overcharge = {
      used: false,
      quickActionRemaining: 0,
      heatFormula: null
    };

    this.protocol = {
      available: true,
      used: false,
      startOfTurnOpen: true
    };

    this.reaction = {
      usedThisTurn: false,
      actionId: null
    };

    this.usedActions = [];
    this.usedDuplicateKeys = [];
    this.history = [];
    this.ended = false;
    this.startedAt = Date.now();
    this.endedAt = null;

    return this;
  }

  setSpeed(speed) {
    const numericSpeed = Number(speed);

    if (!Number.isFinite(numericSpeed) || numericSpeed < 0) {
      throw new TypeError(
        "Frame Helm speed must be a non-negative number."
      );
    }

    const previousMaximum = this.movement.maximum;
    const previousSpent = this.movement.spent;

    this.speed = numericSpeed;
    this.movement.maximum = numericSpeed;
    this.movement.spent = Math.min(
      previousSpent,
      numericSpeed
    );
    this.movement.remaining = Math.max(
      0,
      numericSpeed - this.movement.spent
    );

    if (previousMaximum === null) {
      this.recordHistory("set-speed", {
        speed: numericSpeed
      });
    }

    return this.movement.remaining;
  }

  spendMovement(distance) {
    this.assertTurnActive();

    const numericDistance = Number(distance);

    if (
      !Number.isFinite(numericDistance) ||
      numericDistance < 0
    ) {
      throw new TypeError(
        "Movement distance must be a non-negative number."
      );
    }

    if (this.movement.maximum === null) {
      throw new Error(
        "Movement speed has not been assigned to this turn."
      );
    }

    if (numericDistance > this.movement.remaining) {
      throw new Error(
        `Only ${this.movement.remaining} movement remains.`
      );
    }

    this.movement.spent += numericDistance;
    this.movement.remaining -= numericDistance;

    if (this.movement.remaining === 0) {
      this.movement.completed = true;
    }

    this.closeProtocolWindow();

    this.recordHistory("spend-movement", {
      distance: numericDistance
    });

    return this.movement.remaining;
  }

  completeMovement() {
    this.assertTurnActive();
    this.movement.completed = true;

    this.recordHistory("complete-movement", {
      remaining: this.movement.remaining
    });
  }

  reopenMovement() {
    this.assertTurnActive();

    if (
      this.movement.maximum !== null &&
      this.movement.remaining <= 0
    ) {
      this.movement.spent = 0;
      this.movement.remaining =
        this.movement.maximum;
    }

    this.movement.completed = false;

    this.recordHistory("reopen-movement", {
      remaining: this.movement.remaining
    });
  }

  commitMovement(actionId) {
    this.assertTurnActive();

    if (this.movement.maximum === null) {
      throw new Error(
        "Movement speed has not been assigned to this turn."
      );
    }

    if (this.movement.completed) {
      throw new Error(
        "Movement has already been committed."
      );
    }

    if (this.movement.remaining <= 0) {
      throw new Error(
        "No movement remains to commit."
      );
    }

    const committedDistance =
      this.movement.remaining;

    this.movement.spent += committedDistance;
    this.movement.remaining = 0;
    this.movement.completed = true;

    this.closeProtocolWindow();

    this.recordHistory("movement-commit", {
      actionId,
      distance: committedDistance
    });

    return committedDistance;
  }

  refreshMovementFromBoost() {
    this.assertTurnActive();

    if (this.movement.maximum === null) {
      this.recordHistory(
        "boost-movement-refill",
        {
          distance: null
        }
      );

      return null;
    }

    this.movement.spent = 0;
    this.movement.remaining =
      this.movement.maximum;
    this.movement.completed = false;

    this.recordHistory(
      "boost-movement-refill",
      {
        distance: this.movement.maximum
      }
    );

    return this.movement.remaining;
  }

  movementBoostEntries() {
    return this.usedActions.filter(entry => {
      return entry.actionId === "quick.boost";
    });
  }

  movementBoostCount() {
    return this.movementBoostEntries().length;
  }

  hasProcessedMovementId(movementId) {
    if (!movementId) return false;

    return this.movement.processedMovementIds.includes(
      String(movementId)
    );
  }

  rememberMovementId(movementId) {
    if (!movementId) return;

    const normalizedId = String(movementId);

    if (
      !this.movement.processedMovementIds.includes(
        normalizedId
      )
    ) {
      this.movement.processedMovementIds.push(
        normalizedId
      );
    }

    if (this.movement.processedMovementIds.length > 100) {
      this.movement.processedMovementIds.splice(
        0,
        this.movement.processedMovementIds.length - 100
      );
    }
  }

  ensureAutomaticMovementBoost({
    forceOvercharge = false
  } = {}) {
    this.assertTurnActive();

    const boostAction =
      frameHelmActionRegistry.get("quick.boost");

    if (!boostAction) {
      return {
        committed: false,
        reason: "Boost is not registered."
      };
    }

    if (!forceOvercharge) {
      const normalPermission = this.canUseAction(
        boostAction
      );

      if (normalPermission.allowed) {
        this.useAction(boostAction, {
          metadata: {
            automatic: true,
            reason: "token-movement"
          }
        });

        this.recordHistory(
          "automatic-movement-boost",
          {
            source: "normal"
          }
        );

        return {
          committed: true,
          source: "normal",
          heatFormula: null
        };
      }
    }

    let heatFormula = null;
    let triggeredOvercharge = false;

    if (!this.overcharge.used) {
      heatFormula = this.useOvercharge();
      triggeredOvercharge = true;
    }

    const overchargePermission = this.canUseAction(
      boostAction,
      {
        useOvercharge: true
      }
    );

    if (!overchargePermission.allowed) {
      return {
        committed: false,
        triggeredOvercharge,
        heatFormula,
        reason: overchargePermission.reason
      };
    }

    this.useAction(boostAction, {
      useOvercharge: true,
      metadata: {
        automatic: true,
        reason: "token-movement"
      }
    });

    this.recordHistory(
      "automatic-movement-boost",
      {
        source: "overcharge",
        heatFormula
      }
    );

    return {
      committed: true,
      source: "overcharge",
      triggeredOvercharge,
      heatFormula
    };
  }

  recalculateTrackedMovement() {
    const speed = Number(this.movement.maximum);
    const total = Number(this.movement.totalTracked) || 0;

    if (!Number.isFinite(speed) || speed <= 0) {
      this.movement.standardUsed = total;
      this.movement.boostUsed = 0;
      this.movement.overchargeBoostUsed = 0;
      this.movement.spent = total;
      this.movement.remaining = 0;
      this.movement.excess = 0;
      this.movement.completed = total > 0;
      return;
    }

    const boostEntries = this.movementBoostEntries();

    const normalBoostCount = boostEntries.filter(entry => {
      return entry.source !== "overcharge";
    }).length;

    const overchargeBoostCount = boostEntries.filter(entry => {
      return entry.source === "overcharge";
    }).length;

    const standardUsed = Math.min(total, speed);

    const boostUsed = normalBoostCount > 0
      ? Math.min(
          Math.max(total - speed, 0),
          speed
        )
      : 0;

    const overchargeStart = speed * (
      1 + normalBoostCount
    );

    const overchargeBoostUsed =
      overchargeBoostCount > 0
        ? Math.min(
            Math.max(total - overchargeStart, 0),
            speed
          )
        : 0;

    const legalAllowanceCount =
      1 + normalBoostCount + overchargeBoostCount;

    const legalMaximum =
      speed * legalAllowanceCount;

    const excess = Math.max(
      total - legalMaximum,
      0
    );

    let currentPoolUsed = standardUsed;

    if (normalBoostCount > 0 && total > speed) {
      currentPoolUsed = boostUsed;
    }

    if (
      overchargeBoostCount > 0 &&
      total > overchargeStart
    ) {
      currentPoolUsed = overchargeBoostUsed;
    }

    if (excess > 0) {
      currentPoolUsed = speed;
    }

    this.movement.standardUsed = standardUsed;
    this.movement.boostUsed = boostUsed;
    this.movement.overchargeBoostUsed =
      overchargeBoostUsed;
    this.movement.excess = excess;
    this.movement.spent = currentPoolUsed;
    this.movement.remaining = excess > 0
      ? 0
      : Math.max(speed - currentPoolUsed, 0);
    this.movement.completed =
      this.movement.remaining <= 0;
  }

  trackTokenMovement(
    distance,
    {
      movementId = null,
      method = null,
      origin = null,
      destination = null
    } = {}
  ) {
    this.assertTurnActive();

    const numericDistance = Number(distance);

    if (
      !Number.isFinite(numericDistance) ||
      numericDistance <= 0
    ) {
      return {
        tracked: false,
        distance: 0,
        reason: "Movement distance was zero."
      };
    }

    if (this.hasProcessedMovementId(movementId)) {
      return {
        tracked: false,
        distance: 0,
        reason: "Movement was already recorded."
      };
    }

    const speed = Number(this.movement.maximum);

    if (!Number.isFinite(speed) || speed <= 0) {
      throw new Error(
        "Frame Helm cannot track movement until the unit has a positive Speed."
      );
    }

    const previousTotal =
      this.movement.totalTracked;

    const newTotal =
      previousTotal + numericDistance;

    const previousBoostCount =
      this.movementBoostCount();

    const automaticActions = [];

    if (
      newTotal > speed &&
      this.movementBoostCount() < 1
    ) {
      const result = this.ensureAutomaticMovementBoost({
        forceOvercharge: false
      });

      automaticActions.push({
        threshold: speed,
        ...result
      });
    }

    if (
      newTotal > speed * 2 &&
      this.movementBoostCount() < 2
    ) {
      const result = this.ensureAutomaticMovementBoost({
        forceOvercharge: true
      });

      automaticActions.push({
        threshold: speed * 2,
        ...result
      });
    }

    this.movement.totalTracked = newTotal;

    this.movement.segments.push({
      distance: numericDistance,
      movementId: movementId
        ? String(movementId)
        : null,
      method: method
        ? String(method)
        : null,
      origin: origin
        ? { ...origin }
        : null,
      destination: destination
        ? { ...destination }
        : null,
      timestamp: Date.now()
    });

    this.rememberMovementId(movementId);
    this.closeProtocolWindow();
    this.recalculateTrackedMovement();

    this.recordHistory("token-movement", {
      distance: numericDistance,
      totalDistance: newTotal,
      movementId,
      method,
      automaticActions,
      previousBoostCount,
      boostCount: this.movementBoostCount(),
      excess: this.movement.excess
    });

    return {
      tracked: true,
      distance: numericDistance,
      totalDistance: newTotal,
      remaining: this.movement.remaining,
      standardUsed: this.movement.standardUsed,
      boostUsed: this.movement.boostUsed,
      overchargeBoostUsed:
        this.movement.overchargeBoostUsed,
      excess: this.movement.excess,
      automaticActions
    };
  }

  closeProtocolWindow() {
    if (!this.protocol.startOfTurnOpen) return;

    this.protocol.startOfTurnOpen = false;

    if (!this.protocol.used) {
      this.protocol.available = false;
    }
  }

  useProtocol(actionId = null) {
    this.assertTurnActive();

    if (!this.protocol.startOfTurnOpen) {
      throw new Error(
        "Protocols can only be activated at the start of a turn."
      );
    }

    if (this.protocol.used) {
      throw new Error(
        "A protocol has already been used this turn."
      );
    }

    this.protocol.used = true;
    this.protocol.available = false;

    this.recordHistory("use-protocol", {
      actionId
    });
  }

  overchargeHeatFormula(overchargeCount = 0) {
    if (overchargeCount <= 0) return "1";
    if (overchargeCount === 1) return "1d3";
    if (overchargeCount === 2) return "1d6";
    return "1d6+4";
  }

  useOvercharge({ previousOvercharges = 0 } = {}) {
    this.assertTurnActive();

    if (this.overcharge.used) {
      throw new Error(
        "This unit has already Overcharged this turn."
      );
    }

    this.overcharge.used = true;
    this.overcharge.quickActionRemaining = 1;
    this.overcharge.heatFormula =
      this.overchargeHeatFormula(previousOvercharges);

    this.closeProtocolWindow();

    this.recordHistory("overcharge", {
      heatFormula: this.overcharge.heatFormula,
      previousOvercharges
    });

    return this.overcharge.heatFormula;
  }

  actionDuplicateKey(action) {
    return String(
      action?.duplicateKey ?? action?.id ?? ""
    );
  }

  hasUsedDuplicateKey(duplicateKey) {
    return this.usedDuplicateKeys.includes(
      String(duplicateKey)
    );
  }

  canUseAction(
    actionOrId,
    {
      useOvercharge = false,
      ignoreDuplicate = false
    } = {}
  ) {
    const action = typeof actionOrId === "string"
      ? frameHelmActionRegistry.get(actionOrId)
      : actionOrId;

    if (!action) {
      return {
        allowed: false,
        reason: "Unknown action."
      };
    }

    if (this.ended) {
      return {
        allowed: false,
        reason: "The turn has already ended."
      };
    }

    if (action.id === "special.end-turn") {
      return {
        allowed: true,
        reason: null
      };
    }

    if (action.cost === "movement") {
      if (this.movement.completed) {
        return {
          allowed: false,
          reason: "Movement has been marked complete."
        };
      }

      if (this.movement.remaining === 0) {
        return {
          allowed: false,
          reason: "No standard movement remains."
        };
      }

      return {
        allowed: true,
        reason: null
      };
    }

    if (action.cost === "overcharge") {
      if (this.overcharge.used) {
        return {
          allowed: false,
          reason: "Overcharge has already been used this turn."
        };
      }

      return {
        allowed: true,
        reason: null
      };
    }

    if (action.cost === "full") {
      if (!this.fullActionAvailable) {
        return {
          allowed: false,
          reason: "The normal action budget has already been spent."
        };
      }

      if (this.actionMode === "quick") {
        return {
          allowed: false,
          reason: "A quick action has already been taken."
        };
      }

      return {
        allowed: true,
        reason: null
      };
    }

    if (action.cost === "quick") {
      const duplicateKey = this.actionDuplicateKey(action);
      const duplicateUsed =
        this.hasUsedDuplicateKey(duplicateKey);

      if (useOvercharge) {
        if (!this.overcharge.used) {
          return {
            allowed: false,
            reason: "Overcharge has not been activated."
          };
        }

        if (this.overcharge.quickActionRemaining < 1) {
          return {
            allowed: false,
            reason: "The Overcharge quick action has been spent."
          };
        }

        return {
          allowed: true,
          reason: null,
          source: "overcharge"
        };
      }

      if (this.actionMode === "full") {
        return {
          allowed: false,
          reason: "A full action has already been taken."
        };
      }

      if (this.quickActionsRemaining < 1) {
        return {
          allowed: false,
          reason: "No normal quick actions remain."
        };
      }

      if (
        duplicateUsed &&
        !ignoreDuplicate &&
        action.repeatRule !== "unrestricted"
      ) {
        return {
          allowed: false,
          reason: "This action has already been taken this turn. Use Overcharge to repeat it."
        };
      }

      return {
        allowed: true,
        reason: null,
        source: "normal"
      };
    }

    if (action.cost === "reaction") {
      if (this.reaction.usedThisTurn) {
        return {
          allowed: false,
          reason: "A reaction has already been used during this turn."
        };
      }

      return {
        allowed: true,
        reason: null
      };
    }

    return {
      allowed: true,
      reason: null
    };
  }

  useAction(
    actionOrId,
    {
      useOvercharge = false,
      ignoreDuplicate = false,
      metadata = {}
    } = {}
  ) {
    const action = typeof actionOrId === "string"
      ? frameHelmActionRegistry.get(actionOrId)
      : actionOrId;

    const permission = this.canUseAction(action, {
      useOvercharge,
      ignoreDuplicate
    });

    if (!permission.allowed) {
      throw new Error(permission.reason);
    }

    if (action.id === "special.end-turn") {
      this.endTurn();
      return this.snapshot();
    }

    if (action.cost === "overcharge") {
      this.useOvercharge(metadata);
      return this.snapshot();
    }

    if (action.cost === "quick") {
      if (useOvercharge) {
        this.overcharge.quickActionRemaining -= 1;
      } else {
        this.actionMode = "quick";
        this.quickActionsRemaining -= 1;
        this.fullActionAvailable = false;
      }
    }

    if (action.cost === "full") {
      this.actionMode = "full";
      this.fullActionAvailable = false;
      this.quickActionsRemaining = 0;
    }

    if (action.cost === "reaction") {
      this.reaction.usedThisTurn = true;
      this.reaction.actionId = action.id;
    }

    if (action.cost !== "none") {
      this.closeProtocolWindow();
    }

    const duplicateKey = this.actionDuplicateKey(action);

    this.usedActions.push({
      actionId: action.id,
      duplicateKey,
      source: useOvercharge
        ? "overcharge"
        : "normal",
      timestamp: Date.now(),
      metadata: {
        ...metadata
      }
    });

    if (
      duplicateKey &&
      !this.usedDuplicateKeys.includes(duplicateKey)
    ) {
      this.usedDuplicateKeys.push(duplicateKey);
    }

    this.recordHistory("use-action", {
      actionId: action.id,
      duplicateKey,
      source: useOvercharge
        ? "overcharge"
        : "normal"
    });

    return this.snapshot();
  }

  markReactionAvailable() {
    this.reaction.usedThisTurn = false;
    this.reaction.actionId = null;
  }

  endTurn() {
    if (this.ended) return;

    this.ended = true;
    this.endedAt = Date.now();
    this.protocol.available = false;
    this.protocol.startOfTurnOpen = false;

    this.recordHistory("end-turn", {});
  }

  assertTurnActive() {
    if (this.ended) {
      throw new Error(
        "The current Frame Helm turn has ended."
      );
    }
  }

  recordHistory(type, data = {}) {
    this.history.push({
      type,
      timestamp: Date.now(),
      data: {
        ...data
      }
    });
  }

  snapshot() {
    return {
      context: {
        ...this.context
      },
      speed: this.speed,
      movement: {
        ...this.movement
      },
      actionMode: this.actionMode,
      quickActionsRemaining:
        this.quickActionsRemaining,
      fullActionAvailable:
        this.fullActionAvailable,
      overcharge: {
        ...this.overcharge
      },
      protocol: {
        ...this.protocol
      },
      reaction: {
        ...this.reaction
      },
      usedActions: this.usedActions.map(entry => ({
        ...entry,
        metadata: {
          ...entry.metadata
        }
      })),
      usedDuplicateKeys: [
        ...this.usedDuplicateKeys
      ],
      history: this.history.map(entry => ({
        ...entry,
        data: {
          ...entry.data
        }
      })),
      ended: this.ended,
      startedAt: this.startedAt,
      endedAt: this.endedAt
    };
  }
}

class FrameHelmTurnStateManager {
  constructor() {
    this.current = null;
  }

  beginTurn(context = {}) {
    this.current = new FrameHelmTurnState(context);

    console.log(
      `${MODULE_TITLE} | Began turn state.`,
      this.current.snapshot()
    );

    this.renderApplication();
    return this.current;
  }

  ensureTurn(context = {}) {
    if (!this.current || this.current.ended) {
      return this.beginTurn(context);
    }

    return this.current;
  }

  endTurn() {
    if (!this.current) return null;

    this.current.endTurn();
    this.renderApplication();
    return this.current.snapshot();
  }

  clear() {
    this.current = null;
    this.renderApplication();
  }

  snapshot() {
    return this.current?.snapshot() ?? null;
  }

  renderApplication() {
    if (frameHelmApplication?.rendered) {
      frameHelmApplication.render(false);
    }
  }
}

const frameHelmTurnState =
  new FrameHelmTurnStateManager();

function activeCombatTurnContext(combat = game.combat) {
  const combatant = combat?.combatant ?? null;
  const tokenDocument = combatant?.token ?? null;
  const actor = combatant?.actor ?? null;

  const numericSpeed = Number(
    actor?.system?.speed
  );

  return {
    combatId: combat?.id ?? null,
    combatantId: combatant?.id ?? null,
    tokenId: tokenDocument?.id ?? null,
    actorId: actor?.id ?? null,
    sceneId:
      combat?.scene?.id ??
      canvas?.scene?.id ??
      null,
    round: Number.isFinite(combat?.round)
      ? combat.round
      : null,
    turn: Number.isFinite(combat?.turn)
      ? combat.turn
      : null,
    speed:
      Number.isFinite(numericSpeed) && numericSpeed >= 0
        ? numericSpeed
        : null
  };
}

function syncTurnStateToCombat(combat = game.combat) {
  if (!combat?.started || !combat.combatant) {
    frameHelmTurnState.clear();
    return null;
  }

  const context = activeCombatTurnContext(combat);
  const currentContext =
    frameHelmTurnState.current?.context;

  const isSameTurn = Boolean(
    currentContext &&
    currentContext.combatId === context.combatId &&
    currentContext.combatantId === context.combatantId &&
    currentContext.round === context.round &&
    currentContext.turn === context.turn
  );

  if (isSameTurn) {
    return frameHelmTurnState.current;
  }

  return frameHelmTurnState.beginTurn(context);
}

/* ==========================================================
   Frame Helm application
   ========================================================== */

class FrameHelmApplication extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "lancer-frame-helm",
      title: MODULE_TITLE,
      classes: ["lancer-frame-helm"],
      width: 920,
      height: 460,
      left: 20,
      top: Math.max(20, window.innerHeight - 500),
      resizable: true,
      minimizable: true
    });
  }

  constructor(options = {}) {
    super(options);
    this.selectedCategory = null;
    this.selectedMovementMode = null;
    this.selectedQuickActionId = null;
    this.selectedFullActionId = null;
    this.manualStatsByUnit = new Map();
  }

  _getHeaderButtons() {
    const buttons = super._getHeaderButtons();

    const hasMinimizeButton = buttons.some(
      button => button.class === "frame-helm-minimize"
    );

    if (!hasMinimizeButton) {
      buttons.unshift({
        label: "Minimize",
        class: "frame-helm-minimize",
        icon: "fas fa-minus",
        onclick: () => this.minimize()
      });
    }

    return buttons;
  }

  defaultManualStats() {
    return {
      hpCurrent: 0,
      hpMax: 0,
      heatCurrent: 0,
      heatMax: 0,
      armor: 0,
      overshield: 0,
      burn: 0,
      structureCurrent: 0,
      structureMax: 0,
      stressCurrent: 0,
      stressMax: 0,
      repairsCurrent: 0,
      repairsMax: 0
    };
  }

  manualStatsKey(token) {
    return String(
      token?.actor?.id ??
      token?.document?.actorId ??
      token?.id ??
      token?.document?.id ??
      "unselected"
    );
  }

  getManualStats(token) {
    const key = this.manualStatsKey(token);

    if (!this.manualStatsByUnit.has(key)) {
      this.manualStatsByUnit.set(
        key,
        this.defaultManualStats()
      );
    }

    const fallback = this.manualStatsByUnit.get(key);
    const actor = token?.actor ?? null;
    const system = actor?.system ?? null;

    if (!system) {
      return {
        ...fallback,
        speed: null,
        live: false,
        actorType: null,
        repairsAvailable: true
      };
    }

    const finiteOr = (value, fallbackValue = 0) => {
      const numericValue = Number(value);

      return Number.isFinite(numericValue)
        ? numericValue
        : fallbackValue;
    };

    const rangeValue = (
      range,
      property,
      fallbackValue = 0
    ) => {
      return finiteOr(
        range?.[property],
        fallbackValue
      );
    };

    const repairsAvailable = Boolean(
      system.repairs &&
      typeof system.repairs === "object"
    );

    return {
      hpCurrent: rangeValue(
        system.hp,
        "value",
        fallback.hpCurrent
      ),
      hpMax: rangeValue(
        system.hp,
        "max",
        fallback.hpMax
      ),
      heatCurrent: rangeValue(
        system.heat,
        "value",
        fallback.heatCurrent
      ),
      heatMax: rangeValue(
        system.heat,
        "max",
        fallback.heatMax
      ),
      armor: finiteOr(
        system.armor,
        fallback.armor
      ),
      overshield: rangeValue(
        system.overshield,
        "value",
        fallback.overshield
      ),
      burn: finiteOr(
        system.burn,
        fallback.burn
      ),
      structureCurrent: rangeValue(
        system.structure,
        "value",
        fallback.structureCurrent
      ),
      structureMax: rangeValue(
        system.structure,
        "max",
        fallback.structureMax
      ),
      stressCurrent: rangeValue(
        system.stress,
        "value",
        fallback.stressCurrent
      ),
      stressMax: rangeValue(
        system.stress,
        "max",
        fallback.stressMax
      ),
      repairsCurrent: repairsAvailable
        ? rangeValue(
            system.repairs,
            "value",
            fallback.repairsCurrent
          )
        : fallback.repairsCurrent,
      repairsMax: repairsAvailable
        ? rangeValue(
            system.repairs,
            "max",
            fallback.repairsMax
          )
        : fallback.repairsMax,
      speed: finiteOr(system.speed, null),
      live: true,
      actorType: actor.type ?? null,
      repairsAvailable
    };
  }

  updateManualStat(token, statName, value) {
    const key = this.manualStatsKey(token);

    if (!this.manualStatsByUnit.has(key)) {
      this.manualStatsByUnit.set(
        key,
        this.defaultManualStats()
      );
    }

    const stats = this.manualStatsByUnit.get(key);

    if (!Object.prototype.hasOwnProperty.call(stats, statName)) {
      return;
    }

    const numericValue = Number(value);

    stats[statName] =
      Number.isFinite(numericValue) && numericValue >= 0
        ? numericValue
        : 0;
  }

  synchronizeTurnSpeed(token = this.getControlledToken()) {
    const state = frameHelmTurnState.current;
    const numericSpeed = Number(
      token?.actor?.system?.speed
    );

    if (
      !state ||
      !Number.isFinite(numericSpeed) ||
      numericSpeed < 0
    ) {
      return;
    }

    const tokenId =
      token?.id ??
      token?.document?.id ??
      null;

    const actorId = token?.actor?.id ?? null;

    const stateTokenId = state.context?.tokenId ?? null;
    const stateActorId = state.context?.actorId ?? null;

    const belongsToCurrentPlan = Boolean(
      (!stateTokenId && !stateActorId) ||
      (stateTokenId && stateTokenId === tokenId) ||
      (stateActorId && stateActorId === actorId)
    );

    if (!belongsToCurrentPlan) return;

    if (state.speed !== numericSpeed) {
      state.setSpeed(numericSpeed);
    }
  }

  renderPairedStat({
    label,
    currentName,
    maximumName,
    currentValue,
    maximumValue
  }) {
    return `
      <div class="frame-helm-stat-cell frame-helm-stat-paired">
        <span class="frame-helm-stat-label">
          ${foundry.utils.escapeHTML(label)}
        </span>

        <div class="frame-helm-stat-value-group">
          <input
            type="number"
            min="0"
            step="1"
            inputmode="numeric"
            value="${currentValue}"
            data-frame-helm-stat="${foundry.utils.escapeHTML(currentName)}"
            aria-label="${foundry.utils.escapeHTML(label)} current"
            readonly
          >

          <span class="frame-helm-stat-divider">/</span>

          <input
            type="number"
            min="0"
            step="1"
            inputmode="numeric"
            value="${maximumValue}"
            data-frame-helm-stat="${foundry.utils.escapeHTML(maximumName)}"
            aria-label="${foundry.utils.escapeHTML(label)} maximum"
            readonly
          >
        </div>
      </div>
    `;
  }

  renderSingleStat({
    label,
    statName,
    value
  }) {
    return `
      <div class="frame-helm-stat-cell frame-helm-stat-single">
        <span class="frame-helm-stat-label">
          ${foundry.utils.escapeHTML(label)}
        </span>

        <input
          type="number"
          min="0"
          step="1"
          inputmode="numeric"
          value="${value}"
          data-frame-helm-stat="${foundry.utils.escapeHTML(statName)}"
          aria-label="${foundry.utils.escapeHTML(label)}"
          readonly
        >
      </div>
    `;
  }

  renderMechStatsBar(data) {
    const stats = data.manualStats;

    const telemetryLabel = stats.live
      ? `LIVE ${String(
          stats.actorType ?? "ACTOR"
        ).toUpperCase()} TELEMETRY`
      : "MANUAL FALLBACK TELEMETRY";

    return `
      <section class="frame-helm-mech-stats-bar">
        <header class="frame-helm-mech-stats-heading">
          <span>&lt;MECH//STATS&gt;</span>
          <small>${foundry.utils.escapeHTML(telemetryLabel)}</small>
        </header>

        <div class="frame-helm-mech-stats-grid">
          ${this.renderPairedStat({
            label: "HP",
            currentName: "hpCurrent",
            maximumName: "hpMax",
            currentValue: stats.hpCurrent,
            maximumValue: stats.hpMax
          })}

          ${this.renderPairedStat({
            label: "HEAT",
            currentName: "heatCurrent",
            maximumName: "heatMax",
            currentValue: stats.heatCurrent,
            maximumValue: stats.heatMax
          })}

          ${this.renderSingleStat({
            label: "ARM",
            statName: "armor",
            value: stats.armor
          })}

          ${this.renderSingleStat({
            label: "O.SHLD",
            statName: "overshield",
            value: stats.overshield
          })}

          ${this.renderSingleStat({
            label: "BURN",
            statName: "burn",
            value: stats.burn
          })}

          ${this.renderPairedStat({
            label: "STRUCT",
            currentName: "structureCurrent",
            maximumName: "structureMax",
            currentValue: stats.structureCurrent,
            maximumValue: stats.structureMax
          })}

          ${this.renderPairedStat({
            label: "STRESS",
            currentName: "stressCurrent",
            maximumName: "stressMax",
            currentValue: stats.stressCurrent,
            maximumValue: stats.stressMax
          })}

          ${
            stats.repairsAvailable
              ? this.renderPairedStat({
                  label: "REP",
                  currentName: "repairsCurrent",
                  maximumName: "repairsMax",
                  currentValue: stats.repairsCurrent,
                  maximumValue: stats.repairsMax
                })
              : `
                <div class="frame-helm-stat-cell frame-helm-stat-unavailable">
                  <span class="frame-helm-stat-label">REP</span>
                  <strong>N/A</strong>
                </div>
              `
          }
        </div>
      </section>
    `;
  }

  getControlledToken() {
    const controlledTokens =
      canvas?.tokens?.controlled ?? [];

    if (controlledTokens.length > 0) {
      return controlledTokens[0];
    }

    const combatantToken =
      game.combat?.combatant?.token?.object ?? null;

    return combatantToken;
  }

  getTurnStateForDisplay() {
    return frameHelmTurnState.current?.snapshot() ?? null;
  }

  actionAvailability(action, turnState) {
    if (!turnState) {
      return {
        allowed: false,
        reason: "Begin a turn plan first."
      };
    }

    return frameHelmTurnState.current.canUseAction(action);
  }

  actionViewModel(action, turnState) {
    const availability = this.actionAvailability(
      action,
      turnState
    );

    return {
      ...action,
      allowed: availability.allowed,
      unavailableReason:
        availability.reason ?? ""
    };
  }

  categoryViewModel(category, turnState) {
    const actions = frameHelmActionRegistry.roots(
      category.id
    );

    const actionModels = actions.map(action => {
      return this.actionViewModel(action, turnState);
    });

    return {
      ...category,
      actions: actionModels,
      hasActions: actionModels.length > 0,
      hasAvailableAction: actionModels.some(
        action => action.allowed
      )
    };
  }

  getData(options = {}) {
    const selectedToken = this.getControlledToken();

    this.synchronizeTurnSpeed(selectedToken);

    const turnState = this.getTurnStateForDisplay();
    const manualStats = this.getManualStats(selectedToken);

    const allCategories =
      frameHelmActionRegistry.listCategories();

    const visibleCategoryIds = [
      "movement",
      "quick",
      "full",
      "special",
      "protocol",
      "reaction"
    ];

    const categories = allCategories
      .filter(category => {
        return visibleCategoryIds.includes(category.id);
      })
      .map(category => {
        return this.categoryViewModel(
          category,
          turnState
        );
      });

    const selectedCategory = categories.find(
      category => category.id === this.selectedCategory
    ) ?? null;

    return {
      moduleTitle: MODULE_TITLE,
      tokenName:
        selectedToken?.name ??
        selectedToken?.document?.name ??
        "No token selected",
      tokenImage:
        selectedToken?.document?.texture?.src ??
        selectedToken?.actor?.img ??
        null,
      hasSelectedToken: Boolean(selectedToken),
      hasTurnState: Boolean(turnState),
      controlledToken: selectedToken,
      manualStats,
      turnState,
      categories,
      selectedCategory
    };
  }

  committedPlanEntries(state) {
    if (!state) return [];

    const entries = [];

    for (const event of state.history ?? []) {
      if (
        event.type === "movement-segment" ||
        event.type === "movement-commit" ||
        event.type === "token-movement"
      ) {
        const action = frameHelmActionRegistry.get(
          event.data?.actionId
        );

        const isTrackedDrag =
          event.type === "token-movement";

        entries.push({
          type: "movement",
          icon: action?.icon ?? "fas fa-shoe-prints",
          label: isTrackedDrag
            ? "Token Movement"
            : action?.label ?? "Movement",
          detail: isTrackedDrag
            ? `${event.data?.distance ?? 0} space(s); ${event.data?.totalDistance ?? 0} total${event.data?.excess > 0 ? `; ${event.data.excess} excess` : ""}`
            : `${event.data?.distance ?? 0} space(s) committed`,
          timestamp: event.timestamp
        });
      }

      if (event.type === "overcharge") {
        entries.push({
          type: "overcharge",
          icon: "fas fa-temperature-high",
          label: "Overcharge",
          detail: `Heat ${event.data?.heatFormula ?? "?"}`,
          timestamp: event.timestamp
        });
      }

      if (event.type === "use-protocol") {
        const action = frameHelmActionRegistry.get(
          event.data?.actionId
        );

        entries.push({
          type: "protocol",
          icon: action?.icon ?? "fas fa-microchip",
          label: action?.label ?? "Protocol",
          detail: "Start-of-turn protocol",
          timestamp: event.timestamp
        });
      }
    }

    for (const usedAction of state.usedActions ?? []) {
      const action = frameHelmActionRegistry.get(
        usedAction.actionId
      );

      if (!action) continue;

      entries.push({
        type: action.category,
        icon: action.icon || "fas fa-bolt",
        label: action.label,
        detail:
          usedAction.source === "overcharge"
            ? "Overcharge quick action"
            : action.cost === "full"
              ? "Full action"
              : action.cost === "quick"
                ? "Quick action"
                : action.cost,
        timestamp: usedAction.timestamp
      });
    }

    return entries.sort((left, right) => {
      return left.timestamp - right.timestamp;
    });
  }

  renderCommittedPlan(state) {
    const entries = this.committedPlanEntries(state);

    const entryMarkup = entries.length
      ? entries.map((entry, index) => {
          return `
            <li class="frame-helm-plan-entry frame-helm-plan-${foundry.utils.escapeHTML(entry.type)}">
              <span class="frame-helm-plan-index">
                ${String(index + 1).padStart(2, "0")}
              </span>

              <i class="${foundry.utils.escapeHTML(entry.icon)}"></i>

              <span class="frame-helm-plan-copy">
                <strong>${foundry.utils.escapeHTML(entry.label)}</strong>
                <small>${foundry.utils.escapeHTML(entry.detail)}</small>
              </span>
            </li>
          `;
        }).join("")
      : `
        <li class="frame-helm-plan-empty">
          <i class="fas fa-wave-square"></i>
          <span>No actions committed yet.</span>
        </li>
      `;

    return `
      <section class="frame-helm-plan-panel">
        <header class="frame-helm-plan-header">
          <div>
            <span>Committed Plan</span>
            <small>
              ${
                entries.length
                  ? `${entries.length} declared step${entries.length === 1 ? "" : "s"}`
                  : "No declared steps"
              }
            </small>
          </div>

          <i
            class="fas fa-list-check frame-helm-plan-header-icon"
            aria-hidden="true"
          ></i>
        </header>

        <ol class="frame-helm-plan-list">
          ${entryMarkup}
        </ol>
      </section>
    `;
  }

  renderBudgetPanel(data) {
    if (!data.hasTurnState) {
      return `
        <section class="frame-helm-budget frame-helm-budget-empty">
          <div class="frame-helm-budget-message">
            <i class="fas fa-circle-play"></i>
            <div>
              <strong>No turn plan is active.</strong>
              <p>Begin a plan to track movement, actions, and Overcharge.</p>
            </div>
          </div>

          <button
            type="button"
            class="frame-helm-primary-button"
            data-frame-helm-command="begin-turn"
            ${data.hasSelectedToken ? "" : "disabled"}
          >
            <i class="fas fa-play"></i>
            Begin Turn Plan
          </button>
        </section>
      `;
    }

    const state = data.turnState;

    const movementValue = state.movement.maximum === null
      ? "Unrated"
      : `${state.movement.remaining} / ${state.movement.maximum}`;

    const normalActionLabel = state.actionMode === "full"
      ? "Full action used"
      : state.actionMode === "quick"
        ? `${state.quickActionsRemaining} quick remaining`
        : "2 quick or 1 full";

    const overchargeLabel = state.overcharge.used
      ? state.overcharge.quickActionRemaining > 0
        ? "Quick action ready"
        : "Used"
      : "Available";

    return `
      <section class="frame-helm-budget">
        <div class="frame-helm-budget-grid">
          <div class="frame-helm-budget-item">
            <span>Movement</span>
            <strong>${foundry.utils.escapeHTML(movementValue)}</strong>
          </div>

          <div class="frame-helm-budget-item">
            <span>Actions</span>
            <strong>${foundry.utils.escapeHTML(normalActionLabel)}</strong>
          </div>

          <div class="frame-helm-budget-item">
            <span>Overcharge</span>
            <strong>${foundry.utils.escapeHTML(overchargeLabel)}</strong>
          </div>

          <div class="frame-helm-budget-item">
            <span>Protocol Window</span>
            <strong>
              ${state.protocol.startOfTurnOpen ? "Open" : "Closed"}
            </strong>
          </div>
        </div>

        <div class="frame-helm-budget-controls">
          <button
            type="button"
            class="frame-helm-secondary-button"
            data-frame-helm-command="reset-turn"
          >
            <i class="fas fa-rotate-left"></i>
            Reset Plan
          </button>

          <button
            type="button"
            class="frame-helm-end-turn-button"
            data-frame-helm-command="end-turn"
          >
            <i class="fas fa-flag-checkered"></i>
            End Turn
          </button>
        </div>
      </section>

      ${this.renderCommittedPlan(state)}
    `;
  }

  renderUnitPanel(data) {
    const portrait = data.tokenImage
      ? `
        <img
          class="frame-helm-unit-image"
          src="${foundry.utils.escapeHTML(data.tokenImage)}"
          alt=""
        >
      `
      : `
        <div class="frame-helm-unit-image frame-helm-unit-image-empty">
          <i class="fas fa-robot"></i>
        </div>
      `;

    const unitText = data.hasSelectedToken
      ? `
        <div class="frame-helm-unit-text">
          <span class="frame-helm-label">Controlled Unit</span>
          <strong>${foundry.utils.escapeHTML(data.tokenName)}</strong>
        </div>
      `
      : `
        <div class="frame-helm-unit-text">
          <span class="frame-helm-label">Controlled Unit</span>
          <strong>No token selected</strong>
          <small>Select a mech or NPC token on the canvas.</small>
        </div>
      `;

    return `
      <section class="frame-helm-unit-panel">
        ${portrait}
        ${unitText}
      </section>
    `;
  }

  renderCategoryMenu(data) {
    const buttons = data.categories.map(category => {
      const unavailableClass =
        data.hasTurnState && !category.hasAvailableAction
          ? " frame-helm-category-unavailable"
          : "";

      return `
        <button
          type="button"
          class="frame-helm-category-button${unavailableClass}"
          data-frame-helm-category="${foundry.utils.escapeHTML(category.id)}"
        >
          <i class="${foundry.utils.escapeHTML(category.icon)}"></i>

          <span class="frame-helm-category-copy">
            <strong>${foundry.utils.escapeHTML(category.label)}</strong>
            <small>${foundry.utils.escapeHTML(category.description)}</small>
          </span>

          <i class="fas fa-chevron-right frame-helm-category-arrow"></i>
        </button>
      `;
    }).join("");

    return `
      <section class="frame-helm-action-panel">
        <div class="frame-helm-section-heading">
          <span>Choose an action type</span>
        </div>

        <div class="frame-helm-category-list">
          ${buttons}
        </div>
      </section>
    `;
  }

  quickActionChildren(actionId) {
    return frameHelmActionRegistry.childrenOf(actionId);
  }

  quickActionBreadcrumb(action) {
    const breadcrumb = [];
    let current = action;

    while (current) {
      breadcrumb.unshift(current);

      current = current.parentId
        ? frameHelmActionRegistry.get(current.parentId)
        : null;
    }

    return breadcrumb;
  }

  renderQuickActionBudget(state) {
    const normalRemaining =
      state?.quickActionsRemaining ?? 0;

    const overchargeRemaining =
      state?.overcharge?.quickActionRemaining ?? 0;

    const overchargeStatus = !state?.overcharge?.used
      ? "Available"
      : overchargeRemaining > 0
        ? "Quick action ready"
        : "Spent";

    return `
      <section class="frame-helm-quick-budget">
        <div>
          <span>Normal Quick Actions</span>
          <strong>${normalRemaining}</strong>
        </div>

        <div>
          <span>Overcharge</span>
          <strong>${foundry.utils.escapeHTML(overchargeStatus)}</strong>
        </div>
      </section>
    `;
  }

  canAutomaticallyOvercharge(action, state) {
    if (!state || !action || action.cost !== "quick") {
      return false;
    }

    if (state.ended) return false;

    if (state.overcharge.used) {
      return state.overcharge.quickActionRemaining > 0;
    }

    return true;
  }

  renderQuickActionChoice(action, state) {
    const children = this.quickActionChildren(action.id);
    const hasChildren = children.length > 0;

    let availability;
    let requiresOvercharge = false;

    if (hasChildren) {
      availability = {
        allowed: true,
        reason: null
      };
    } else if (state) {
      const normalPermission =
        frameHelmTurnState.current.canUseAction(action);

      const activeOverchargePermission =
        frameHelmTurnState.current.canUseAction(action, {
          useOvercharge: true
        });

      const automaticOverchargeAvailable =
        this.canAutomaticallyOvercharge(action, state);

      requiresOvercharge =
        !normalPermission.allowed &&
        (
          activeOverchargePermission.allowed ||
          automaticOverchargeAvailable
        );

      availability = {
        allowed:
          normalPermission.allowed ||
          activeOverchargePermission.allowed ||
          automaticOverchargeAvailable,
        reason:
          normalPermission.reason ??
          activeOverchargePermission.reason
      };
    } else {
      availability = {
        allowed: false,
        reason: "Begin a turn plan first."
      };
    }

    const disabled = availability.allowed
      ? ""
      : "disabled";

    const arrow = hasChildren
      ? `<i class="fas fa-chevron-right frame-helm-category-arrow"></i>`
      : "";

    const status = requiresOvercharge
      ? `
        <span class="frame-helm-action-overcharge-warning">
          <i class="fas fa-temperature-high"></i>
          Requires Overcharge
        </span>
      `
      : availability.allowed
        ? ""
        : `
          <span class="frame-helm-action-reason">
            ${foundry.utils.escapeHTML(availability.reason ?? "Unavailable")}
          </span>
        `;

    const overchargeClass = requiresOvercharge
      ? " frame-helm-quick-choice-overcharge"
      : "";

    return `
      <button
        type="button"
        class="frame-helm-action-button frame-helm-quick-choice${overchargeClass}"
        data-frame-helm-quick-action="${foundry.utils.escapeHTML(action.id)}"
        ${disabled}
      >
        <i class="${foundry.utils.escapeHTML(action.icon)}"></i>

        <span class="frame-helm-action-copy">
          <strong>${foundry.utils.escapeHTML(action.label)}</strong>
          <small>${foundry.utils.escapeHTML(action.shortDescription)}</small>
          ${status}
        </span>

        ${arrow}
      </button>
    `;
  }

  renderQuickActionExecution(action, state) {
    const normalPermission = state
      ? frameHelmTurnState.current.canUseAction(action)
      : {
          allowed: false,
          reason: "Begin a turn plan first."
        };

    const activeOverchargePermission = state
      ? frameHelmTurnState.current.canUseAction(action, {
          useOvercharge: true
        })
      : {
          allowed: false,
          reason: "Begin a turn plan first."
        };

    const automaticOverchargeAvailable =
      this.canAutomaticallyOvercharge(action, state);

    const overchargeAllowed =
      activeOverchargePermission.allowed ||
      automaticOverchargeAvailable;

    const willTriggerOvercharge = Boolean(
      state &&
      !state.overcharge.used &&
      automaticOverchargeAvailable
    );

    const normalReason = normalPermission.allowed
      ? "Spend one of your normal Quick Actions."
      : normalPermission.reason;

    let overchargeTitle = "Use Overcharge Action";
    let overchargeReason =
      activeOverchargePermission.reason ??
      "Overcharge is unavailable.";

    if (willTriggerOvercharge) {
      overchargeTitle = "Overcharge and Use Action";
      overchargeReason =
        "Warning: this will trigger Overcharge, apply the current Overcharge Heat cost, and immediately spend the granted Quick Action.";
    } else if (activeOverchargePermission.allowed) {
      overchargeReason =
        "Spend the additional Quick Action already granted by Overcharge.";
    }

    const targetNotice = action.requiresTarget
      ? `
        <div class="frame-helm-quick-requirement">
          <i class="fas fa-crosshairs"></i>
          <span>
            This action requires a target. Guided targeting will be added in a later patch.
          </span>
        </div>
      `
      : "";

    return `
      <section class="frame-helm-quick-detail">
        <div class="frame-helm-quick-detail-header">
          <i class="${foundry.utils.escapeHTML(action.icon)}"></i>

          <div>
            <h3>${foundry.utils.escapeHTML(action.label)}</h3>
            <p>${foundry.utils.escapeHTML(action.shortDescription)}</p>
          </div>
        </div>

        ${targetNotice}

        <div class="frame-helm-quick-execution-options">
          <button
            type="button"
            class="frame-helm-quick-execute-button"
            data-frame-helm-quick-execute="normal"
            data-frame-helm-action-id="${foundry.utils.escapeHTML(action.id)}"
            ${normalPermission.allowed ? "" : "disabled"}
          >
            <i class="fas fa-bolt"></i>

            <span>
              <strong>Use Quick Action</strong>
              <small>${foundry.utils.escapeHTML(normalReason ?? "Unavailable")}</small>
            </span>
          </button>

          <button
            type="button"
            class="frame-helm-quick-execute-button frame-helm-overcharge-execute${willTriggerOvercharge ? " frame-helm-auto-overcharge-execute" : ""}"
            data-frame-helm-quick-execute="overcharge"
            data-frame-helm-action-id="${foundry.utils.escapeHTML(action.id)}"
            ${overchargeAllowed ? "" : "disabled"}
          >
            <i class="fas fa-temperature-high"></i>

            <span>
              <strong>${foundry.utils.escapeHTML(overchargeTitle)}</strong>
              <small>${foundry.utils.escapeHTML(overchargeReason)}</small>
            </span>
          </button>
        </div>

        <p class="frame-helm-quick-placeholder-note">
          This records the selected action in the turn planner. The action's attack, tech, targeting, and dice workflow will be connected in later patches.
        </p>
      </section>
    `;
  }

  renderQuickActionPanel(data) {
    const state = data.turnState;
    const selectedAction = this.selectedQuickActionId
      ? frameHelmActionRegistry.get(
          this.selectedQuickActionId
        )
      : null;

    const parentId = selectedAction?.id ?? null;

    const availableActions = selectedAction
      ? this.quickActionChildren(selectedAction.id)
      : frameHelmActionRegistry.roots("quick");

    const breadcrumb = selectedAction
      ? this.quickActionBreadcrumb(selectedAction)
      : [];

    const breadcrumbText = breadcrumb.length
      ? breadcrumb
          .map(action => action.label)
          .join(" › ")
      : "Quick Actions";

    const hasChildren = availableActions.length > 0;

    const actionChoices = availableActions
      .map(action => {
        return this.renderQuickActionChoice(
          action,
          state
        );
      })
      .join("");

    const content = selectedAction && !hasChildren
      ? this.renderQuickActionExecution(
          selectedAction,
          state
        )
      : `
        <div class="frame-helm-action-list">
          ${actionChoices}
        </div>
      `;

    return `
      <section class="frame-helm-action-panel">
        <div class="frame-helm-section-heading frame-helm-section-heading-with-back">
          <button
            type="button"
            class="frame-helm-back-button"
            data-frame-helm-command="quick-back"
            aria-label="Go back"
          >
            <i class="fas fa-arrow-left"></i>
          </button>

          <div>
            <span>${foundry.utils.escapeHTML(breadcrumbText)}</span>
            <small>
              Choose one universal quick action. Normally, the same action cannot be taken twice in one turn.
            </small>
          </div>
        </div>

        ${this.renderQuickActionBudget(state)}
        ${content}
      </section>
    `;
  }

  renderFullActionBudget(state) {
    let status = "Unavailable";

    if (state) {
      if (state.actionMode === "full") {
        status = "Full action used";
      } else if (state.actionMode === "quick") {
        status = "Quick action already used";
      } else if (state.fullActionAvailable) {
        status = "Available";
      }
    }

    return `
      <section class="frame-helm-full-budget">
        <div>
          <span>Full Action</span>
          <strong>${foundry.utils.escapeHTML(status)}</strong>
        </div>

        <div>
          <span>Normal Quick Actions</span>
          <strong>${state?.quickActionsRemaining ?? 0}</strong>
        </div>
      </section>
    `;
  }

  renderFullActionChoice(action, state) {
    const permission = state
      ? frameHelmTurnState.current.canUseAction(action)
      : {
          allowed: false,
          reason: "Begin a turn plan first."
        };

    const reason = permission.allowed
      ? ""
      : `
        <span class="frame-helm-action-reason">
          ${foundry.utils.escapeHTML(permission.reason ?? "Unavailable")}
        </span>
      `;

    return `
      <button
        type="button"
        class="frame-helm-action-button frame-helm-full-choice"
        data-frame-helm-full-action="${foundry.utils.escapeHTML(action.id)}"
        ${permission.allowed ? "" : "disabled"}
      >
        <i class="${foundry.utils.escapeHTML(action.icon)}"></i>

        <span class="frame-helm-action-copy">
          <strong>${foundry.utils.escapeHTML(action.label)}</strong>
          <small>${foundry.utils.escapeHTML(action.shortDescription)}</small>
          ${reason}
        </span>

        <i class="fas fa-chevron-right frame-helm-category-arrow"></i>
      </button>
    `;
  }

  renderFullActionRequirements(action) {
    const notices = [];

    if (action.requiresTarget) {
      notices.push(`
        <div class="frame-helm-full-requirement">
          <i class="fas fa-crosshairs"></i>
          <span>This action requires one or more targets. Guided targeting will be connected in a later patch.</span>
        </div>
      `);
    }

    if (action.id === "full.barrage") {
      notices.push(`
        <div class="frame-helm-full-requirement">
          <i class="fas fa-gun"></i>
          <span>Choose two eligible weapons, or one eligible Superheavy weapon. Weapon-mount selection will be added later.</span>
        </div>
      `);
    }

    if (action.id === "full.full-tech") {
      notices.push(`
        <div class="frame-helm-full-requirement">
          <i class="fas fa-laptop-code"></i>
          <span>Full Tech allows two different Quick Tech options, or one available Full Tech option. Its nested selector will be added during tech integration.</span>
        </div>
      `);
    }

    if (action.id === "full.stabilize") {
      notices.push(`
        <div class="frame-helm-full-requirement">
          <i class="fas fa-screwdriver-wrench"></i>
          <span>Choose the applicable Stabilize options after selecting this action. The detailed Stabilize workflow will be added later.</span>
        </div>
      `);
    }

    if (action.id === "full.activate") {
      notices.push(`
        <div class="frame-helm-full-requirement">
          <i class="fas fa-gears"></i>
          <span>This branch will list installed systems with an Activate (Full) action once actor-system integration is added.</span>
        </div>
      `);
    }

    if (action.id === "full.mount-dismount") {
      notices.push(`
        <div class="frame-helm-full-requirement">
          <i class="fas fa-person-arrow-up-from-line"></i>
          <span>Choose Mount, Dismount, or Eject. The selected mode will be resolved manually for now.</span>
        </div>
      `);
    }

    return notices.join("");
  }

  renderFullActionExecution(action, state) {
    const permission = state
      ? frameHelmTurnState.current.canUseAction(action)
      : {
          allowed: false,
          reason: "Begin a turn plan first."
        };

    const confirmationText = permission.allowed
      ? "Spend your normal action budget as one Full Action."
      : permission.reason ?? "This Full Action is unavailable.";

    return `
      <section class="frame-helm-full-detail">
        <div class="frame-helm-full-detail-header">
          <i class="${foundry.utils.escapeHTML(action.icon)}"></i>

          <div>
            <h3>${foundry.utils.escapeHTML(action.label)}</h3>
            <p>${foundry.utils.escapeHTML(action.shortDescription)}</p>
          </div>
        </div>

        ${this.renderFullActionRequirements(action)}

        <button
          type="button"
          class="frame-helm-full-execute-button"
          data-frame-helm-full-execute="${foundry.utils.escapeHTML(action.id)}"
          ${permission.allowed ? "" : "disabled"}
        >
          <i class="fas fa-hourglass"></i>

          <span>
            <strong>Use Full Action</strong>
            <small>${foundry.utils.escapeHTML(confirmationText)}</small>
          </span>
        </button>

        <p class="frame-helm-full-placeholder-note">
          Frame Helm will record the action and spend the normal action budget. Dice rolls, targeting, weapon selection, and system effects remain manual until their dedicated workflows are added.
        </p>
      </section>
    `;
  }

  renderFullActionPanel(data) {
    const state = data.turnState;
    const selectedAction = this.selectedFullActionId
      ? frameHelmActionRegistry.get(
          this.selectedFullActionId
        )
      : null;

    const content = selectedAction
      ? this.renderFullActionExecution(
          selectedAction,
          state
        )
      : `
        <div class="frame-helm-action-list">
          ${frameHelmActionRegistry
            .roots("full")
            .map(action => {
              return this.renderFullActionChoice(
                action,
                state
              );
            })
            .join("")}
        </div>
      `;

    const heading = selectedAction
      ? selectedAction.label
      : "Full Actions";

    return `
      <section class="frame-helm-action-panel">
        <div class="frame-helm-section-heading frame-helm-section-heading-with-back">
          <button
            type="button"
            class="frame-helm-back-button"
            data-frame-helm-command="full-back"
            aria-label="Go back"
          >
            <i class="fas fa-arrow-left"></i>
          </button>

          <div>
            <span>${foundry.utils.escapeHTML(heading)}</span>
            <small>
              A Full Action spends both normal Quick Action slots. Overcharge remains separate.
            </small>
          </div>
        </div>

        ${this.renderFullActionBudget(state)}
        ${content}
      </section>
    `;
  }

  renderMovementPanel(data) {
    const state = data.turnState;

    if (!state) {
      return `
        <section class="frame-helm-action-panel">
          <div class="frame-helm-section-heading frame-helm-section-heading-with-back">
            <button
              type="button"
              class="frame-helm-back-button"
              data-frame-helm-command="back"
              aria-label="Back to action categories"
            >
              <i class="fas fa-arrow-left"></i>
            </button>

            <div>
              <span>Movement</span>
              <small>Begin a turn plan before tracking movement.</small>
            </div>
          </div>

          <div class="frame-helm-no-actions">
            <i class="fas fa-circle-play"></i>
            <p>Begin a turn plan to configure and track movement.</p>
          </div>
        </section>
      `;
    }

    const movement = state.movement;
    const hasRatedSpeed = movement.maximum !== null;

    const speedConfiguration = hasRatedSpeed
      ? ""
      : `
        <section class="frame-helm-movement-speed-setup">
          <label for="frame-helm-speed-input">
            Mech Speed
          </label>

          <div class="frame-helm-movement-input-row">
            <input
              id="frame-helm-speed-input"
              type="number"
              min="0"
              step="1"
              inputmode="numeric"
              placeholder="Enter Speed"
              data-frame-helm-speed-input
            >

            <button
              type="button"
              data-frame-helm-command="set-speed"
            >
              <i class="fas fa-gauge-high"></i>
              Set Speed
            </button>
          </div>

          <p class="frame-helm-movement-note">
            Automatic Speed detection will be added during Lancer-system integration.
          </p>
        </section>
      `;

    const movementModes = frameHelmActionRegistry
      .childrenOf("movement.standard")
      .filter(action => action.movementMode)
      .map(action => {
        const selected =
          this.selectedMovementMode === action.id;

        const selectedClass = selected
          ? " frame-helm-movement-mode-selected"
          : "";

        const restrictedNote =
          action.metadata?.requiresFlightCapability
            ? "Requires flight capability."
            : action.metadata?.requiresTeleportCapability
              ? "Requires a teleport effect."
              : "";

        return `
          <button
            type="button"
            class="frame-helm-movement-mode${selectedClass}"
            data-frame-helm-movement-mode="${foundry.utils.escapeHTML(action.id)}"
            ${movement.completed ? "disabled" : ""}
          >
            <i class="${foundry.utils.escapeHTML(action.icon)}"></i>

            <span>
              <strong>${foundry.utils.escapeHTML(action.label)}</strong>
              <small>${foundry.utils.escapeHTML(action.shortDescription)}</small>
              ${
                restrictedNote
                  ? `<em>${foundry.utils.escapeHTML(restrictedNote)}</em>`
                  : ""
              }
            </span>
          </button>
        `;
      })
      .join("");

    const standardMoveSelected =
      this.selectedMovementMode === "movement.standard";

    const standardMoveClass = standardMoveSelected
      ? " frame-helm-movement-mode-selected"
      : "";

    const selectedAction = this.selectedMovementMode
      ? frameHelmActionRegistry.get(this.selectedMovementMode)
      : null;

    const selectedMovementLabel = selectedAction
      ? selectedAction.label
      : "No movement mode selected";

    const tracker = hasRatedSpeed
      ? `
        <section class="frame-helm-movement-tracker">
          <div class="frame-helm-movement-summary">
            <div>
              <span>Speed</span>
              <strong>${movement.maximum}</strong>
            </div>

            <div>
              <span>Total Moved</span>
              <strong>${movement.totalTracked ?? movement.spent}</strong>
            </div>

            <div>
              <span>Current Allowance</span>
              <strong>${movement.remaining}</strong>
            </div>
          </div>

          <div class="frame-helm-movement-ledger">
            <div>
              <span>Standard</span>
              <strong>${movement.standardUsed ?? 0} / ${movement.maximum}</strong>
            </div>

            <div>
              <span>Boost</span>
              <strong>${movement.boostUsed ?? 0} / ${movement.maximum}</strong>
            </div>

            <div>
              <span>OC Boost</span>
              <strong>${movement.overchargeBoostUsed ?? 0} / ${movement.maximum}</strong>
            </div>

            <div class="${movement.excess > 0 ? "frame-helm-movement-excess-active" : ""}">
              <span>Excess</span>
              <strong>${movement.excess ?? 0}</strong>
            </div>
          </div>

          <div class="frame-helm-movement-current-mode">
            <span>Selected Mode</span>
            <strong>${foundry.utils.escapeHTML(selectedMovementLabel)}</strong>
          </div>

          <p class="frame-helm-movement-note frame-helm-movement-commit-note">
            Selecting a movement mode commits the unit's entire currently available movement allowance. Frame Helm tracks the action budget; the token may still be moved normally on the canvas.
          </p>

          <div class="frame-helm-movement-controls">
            <button
              type="button"
              class="frame-helm-secondary-button"
              data-frame-helm-command="reset-movement"
            >
              <i class="fas fa-rotate-left"></i>
              Reset Movement
            </button>

            <button
              type="button"
              class="frame-helm-primary-button"
              data-frame-helm-command="${movement.completed ? "reopen-movement" : "complete-movement"}"
            >
              <i class="fas ${movement.completed ? "fa-lock-open" : "fa-check"}"></i>
              ${movement.completed ? "Reopen Movement" : "Movement Complete"}
            </button>
          </div>
        </section>
      `
      : "";

    return `
      <section class="frame-helm-action-panel frame-helm-movement-panel">
        <div class="frame-helm-section-heading frame-helm-section-heading-with-back">
          <button
            type="button"
            class="frame-helm-back-button"
            data-frame-helm-command="back"
            aria-label="Back to action categories"
          >
            <i class="fas fa-arrow-left"></i>
          </button>

          <div>
            <span>Movement</span>
            <small>Move up to the unit's rated Speed during its turn.</small>
          </div>
        </div>

        ${speedConfiguration}

        <section class="frame-helm-movement-modes">
          <div class="frame-helm-movement-subheading">
            Choose Movement Mode
          </div>

          <button
            type="button"
            class="frame-helm-movement-mode${standardMoveClass}"
            data-frame-helm-movement-mode="movement.standard"
            ${movement.completed ? "disabled" : ""}
          >
            <i class="fas fa-person-walking"></i>

            <span>
              <strong>Standard Move</strong>
              <small>Move normally up to your remaining Speed.</small>
            </span>
          </button>

          ${movementModes}
        </section>

        ${tracker}
      </section>
    `;
  }

  renderActionList(data) {
    const category = data.selectedCategory;

    if (category?.id === "movement") {
      return this.renderMovementPanel(data);
    }

    if (category?.id === "quick") {
      return this.renderQuickActionPanel(data);
    }

    if (category?.id === "full") {
      return this.renderFullActionPanel(data);
    }

    if (!category) {
      return this.renderCategoryMenu(data);
    }

    const actionButtons = category.actions.map(action => {
      const disabledAttribute = action.allowed
        ? ""
        : "disabled";

      const unavailableText = action.allowed
        ? ""
        : `
          <span class="frame-helm-action-reason">
            ${foundry.utils.escapeHTML(action.unavailableReason)}
          </span>
        `;

      return `
        <button
          type="button"
          class="frame-helm-action-button"
          data-frame-helm-action="${foundry.utils.escapeHTML(action.id)}"
          ${disabledAttribute}
        >
          <i class="${foundry.utils.escapeHTML(action.icon)}"></i>

          <span class="frame-helm-action-copy">
            <strong>${foundry.utils.escapeHTML(action.label)}</strong>
            <small>${foundry.utils.escapeHTML(action.shortDescription)}</small>
            ${unavailableText}
          </span>
        </button>
      `;
    }).join("");

    const emptyMessage = category.hasActions
      ? ""
      : `
        <div class="frame-helm-no-actions">
          <i class="fas fa-circle-info"></i>
          <p>No universal actions are registered in this category yet.</p>
        </div>
      `;

    return `
      <section class="frame-helm-action-panel">
        <div class="frame-helm-section-heading frame-helm-section-heading-with-back">
          <button
            type="button"
            class="frame-helm-back-button"
            data-frame-helm-command="back"
            aria-label="Back to action categories"
          >
            <i class="fas fa-arrow-left"></i>
          </button>

          <div>
            <span>${foundry.utils.escapeHTML(category.label)}</span>
            <small>${foundry.utils.escapeHTML(category.description)}</small>
          </div>
        </div>

        <div class="frame-helm-action-list">
          ${actionButtons}
          ${emptyMessage}
        </div>
      </section>
    `;
  }

  async _renderInner(data) {
    const html = `
      <section class="frame-helm-shell">
        ${this.renderMechStatsBar(data)}

        <div class="frame-helm-horizontal-layout">
          <aside class="frame-helm-overview-column">
            ${this.renderUnitPanel(data)}
            ${this.renderBudgetPanel(data)}
          </aside>

          <main class="frame-helm-action-column">
            ${this.renderActionList(data)}
          </main>
        </div>
      </section>
    `;

    return $(html);
  }

  activateListeners(html) {
    super.activateListeners(html);

    html.find("[data-frame-helm-category]").on(
      "click",
      event => {
        this.selectedCategory =
          event.currentTarget.dataset.frameHelmCategory ?? null;

        this.render(false);
      }
    );

    html.find("[data-frame-helm-action]").on(
      "click",
      event => {
        const actionId =
          event.currentTarget.dataset.frameHelmAction;

        this.onActionSelected(actionId);
      }
    );

    html.find("[data-frame-helm-movement-mode]").on(
      "click",
      event => {
        const actionId =
          event.currentTarget.dataset.frameHelmMovementMode ?? null;

        this.commitMovementAction(actionId);
      }
    );

    html.find("[data-frame-helm-quick-action]").on(
      "click",
      event => {
        this.selectedQuickActionId =
          event.currentTarget.dataset.frameHelmQuickAction ?? null;

        this.render(false);
      }
    );

    html.find("[data-frame-helm-quick-execute]").on(
      "click",
      event => {
        const actionId =
          event.currentTarget.dataset.frameHelmActionId;

        const source =
          event.currentTarget.dataset.frameHelmQuickExecute;

        this.executeQuickAction(
          actionId,
          source === "overcharge"
        );
      }
    );

    html.find("[data-frame-helm-full-action]").on(
      "click",
      event => {
        this.selectedFullActionId =
          event.currentTarget.dataset.frameHelmFullAction ?? null;

        this.render(false);
      }
    );

    html.find("[data-frame-helm-full-execute]").on(
      "click",
      event => {
        const actionId =
          event.currentTarget.dataset.frameHelmFullExecute;

        this.executeFullAction(actionId);
      }
    );

    html.find("[data-frame-helm-command]").on(
      "click",
      event => {
        const command =
          event.currentTarget.dataset.frameHelmCommand;

        this.onCommand(command);
      }
    );


  }

  beginTurnPlan() {
    const token = this.getControlledToken();

    if (!token) {
      ui.notifications.warn(
        "Select a mech or NPC token first."
      );
      return;
    }

    const combat = game.combat;
    const combatContext = combat?.started
      ? activeCombatTurnContext(combat)
      : {};

    frameHelmTurnState.beginTurn({
      ...combatContext,
      tokenId:
        token.id ??
        token.document?.id ??
        combatContext.tokenId ??
        null,
      actorId:
        token.actor?.id ??
        combatContext.actorId ??
        null,
      sceneId:
        canvas?.scene?.id ??
        combatContext.sceneId ??
        null,
      speed: (() => {
        const numericSpeed = Number(
          token.actor?.system?.speed
        );

        return Number.isFinite(numericSpeed) && numericSpeed >= 0
          ? numericSpeed
          : null;
      })()
    });

    this.selectedCategory = null;
    this.selectedMovementMode = null;
    this.selectedQuickActionId = null;
    this.selectedFullActionId = null;
    this.render(false);
  }

  resetTurnPlan() {
    const token = this.getControlledToken();
    const previousState = frameHelmTurnState.current;

    frameHelmTurnState.beginTurn({
      ...(previousState?.context ?? {}),
      tokenId:
        token?.id ??
        token?.document?.id ??
        previousState?.context?.tokenId ??
        null,
      actorId:
        token?.actor?.id ??
        previousState?.context?.actorId ??
        null,
      sceneId:
        canvas?.scene?.id ??
        previousState?.context?.sceneId ??
        null,
      speed: previousState?.speed ?? null
    });

    this.selectedCategory = null;
    this.selectedMovementMode = null;
    this.selectedQuickActionId = null;
    this.selectedFullActionId = null;
    this.render(false);

    ui.notifications.info(
      "Frame Helm turn plan reset."
    );
  }

  commitMovementAction(actionId) {
    const action =
      frameHelmActionRegistry.get(actionId);

    const state = frameHelmTurnState.current;

    if (
      !action ||
      action.category !== "movement" ||
      action.cost !== "movement"
    ) {
      ui.notifications.error(
        "The selected entry is not a valid movement action."
      );
      return;
    }

    if (!state) {
      ui.notifications.warn(
        "Begin a turn plan before committing movement."
      );
      return;
    }

    try {
      const committedDistance =
        state.commitMovement(action.id);

      this.selectedMovementMode = action.id;

      ui.notifications.info(
        `${action.label} committed for ${committedDistance} space(s).`
      );

      this.render(false);
    } catch (error) {
      ui.notifications.warn(error.message);
    }
  }

  executeFullAction(actionId) {
    const action = frameHelmActionRegistry.get(actionId);
    const state = frameHelmTurnState.current;

    if (!action || action.cost !== "full") {
      ui.notifications.error(
        "The selected entry is not a valid Full Action."
      );
      return;
    }

    if (!state) {
      ui.notifications.warn(
        "Begin a turn plan before selecting actions."
      );
      return;
    }

    try {
      state.useAction(action);

      ui.notifications.info(
        `${action.label} recorded as the unit's Full Action.`
      );

      this.selectedFullActionId = null;
      this.render(false);
    } catch (error) {
      ui.notifications.warn(error.message);
    }
  }

  executeQuickAction(actionId, useOvercharge = false) {
    const action = frameHelmActionRegistry.get(actionId);
    const state = frameHelmTurnState.current;

    if (!action || action.cost !== "quick") {
      ui.notifications.error(
        "The selected entry is not a valid quick action."
      );
      return;
    }

    if (!state) {
      ui.notifications.warn(
        "Begin a turn plan before selecting actions."
      );
      return;
    }

    try {
      let automaticallyTriggeredOvercharge = false;
      let overchargeHeatFormula = null;

      if (useOvercharge && !state.overcharge.used) {
        overchargeHeatFormula = state.useOvercharge();
        automaticallyTriggeredOvercharge = true;
      }

      state.useAction(action, {
        useOvercharge
      });

      if (action.id === "quick.boost") {
        const refreshedMovement =
          state.refreshMovementFromBoost();

        if (refreshedMovement === null) {
          ui.notifications.warn(
            "Boost was recorded, but Frame Helm cannot refresh movement until the unit's Speed is entered."
          );
        }
      }

      const sourceLabel = useOvercharge
        ? " using Overcharge"
        : "";

      if (automaticallyTriggeredOvercharge) {
        ui.notifications.warn(
          `Overcharge triggered. Apply ${overchargeHeatFormula} Heat. ${action.label} was recorded using the granted Quick Action.`
        );
      } else {
        ui.notifications.info(
          `${action.label} recorded${sourceLabel}.`
        );
      }

      this.selectedQuickActionId = null;
      this.render(false);
    } catch (error) {
      ui.notifications.warn(error.message);
    }
  }

  onCommand(command) {
    if (command === "back") {
      this.selectedCategory = null;
      this.selectedMovementMode = null;
      this.selectedQuickActionId = null;
      this.selectedFullActionId = null;
      this.render(false);
      return;
    }

    if (command === "quick-back") {
      if (!this.selectedQuickActionId) {
        this.selectedCategory = null;
        this.render(false);
        return;
      }

      const selectedAction =
        frameHelmActionRegistry.get(
          this.selectedQuickActionId
        );

      const parentAction = selectedAction?.parentId
        ? frameHelmActionRegistry.get(
            selectedAction.parentId
          )
        : null;

      this.selectedQuickActionId =
        parentAction?.category === "quick"
          ? parentAction.id
          : null;

      this.render(false);
      return;
    }

    if (command === "full-back") {
      if (this.selectedFullActionId) {
        this.selectedFullActionId = null;
      } else {
        this.selectedCategory = null;
      }

      this.render(false);
      return;
    }

    if (command === "set-speed") {
      const input = this.element.find(
        "[data-frame-helm-speed-input]"
      )[0];

      const speed = Number(input?.value);

      if (!Number.isFinite(speed) || speed < 0) {
        ui.notifications.warn(
          "Enter a valid non-negative Speed value."
        );
        return;
      }

      try {
        frameHelmTurnState.current.setSpeed(speed);
        this.render(false);
      } catch (error) {
        ui.notifications.warn(error.message);
      }

      return;
    }

    if (command === "complete-movement") {
      try {
        frameHelmTurnState.current.completeMovement();
        this.render(false);
      } catch (error) {
        ui.notifications.warn(error.message);
      }

      return;
    }

    if (command === "reopen-movement") {
      try {
        frameHelmTurnState.current.reopenMovement();
        this.render(false);
      } catch (error) {
        ui.notifications.warn(error.message);
      }

      return;
    }

    if (command === "reset-movement") {
      const current = frameHelmTurnState.current;

      if (!current) return;

      current.movement.spent = 0;
      current.movement.remaining =
        current.movement.maximum;
      current.movement.completed = false;
      current.movement.totalTracked = 0;
      current.movement.standardUsed = 0;
      current.movement.boostUsed = 0;
      current.movement.overchargeBoostUsed = 0;
      current.movement.excess = 0;
      current.movement.segments = [];
      current.movement.processedMovementIds = [];

      current.recordHistory("reset-movement", {
        maximum: current.movement.maximum
      });

      this.selectedMovementMode = null;
      this.render(false);

      ui.notifications.info(
        "Movement tracking reset."
      );

      return;
    }

    if (command === "begin-turn") {
      this.beginTurnPlan();
      return;
    }

    if (command === "reset-turn") {
      this.resetTurnPlan();
      return;
    }

    if (command === "end-turn") {
      frameHelmTurnState.endTurn();
      this.selectedCategory = null;
      this.selectedMovementMode = null;
      this.selectedQuickActionId = null;
      this.selectedFullActionId = null;
      this.render(false);

      ui.notifications.info(
        "Frame Helm turn plan ended."
      );
    }
  }

  onActionSelected(actionId) {
    const action = frameHelmActionRegistry.get(actionId);

    if (!action) {
      ui.notifications.error(
        `Unknown Frame Helm action: ${actionId}`
      );
      return;
    }

    if (action.category === "quick") {
      this.selectedCategory = "quick";
      this.selectedQuickActionId = action.id;
      this.render(false);
      return;
    }

    if (action.category === "full") {
      this.selectedCategory = "full";
      this.selectedFullActionId = action.id;
      this.render(false);
      return;
    }

    if (action.id === "special.end-turn") {
      this.onCommand("end-turn");
      return;
    }

    if (action.id === "special.overcharge") {
      try {
        const heatFormula =
          frameHelmTurnState.current.useOvercharge();

        this.render(false);

        ui.notifications.info(
          `Overcharge selected. Apply ${heatFormula} Heat. One additional quick action is available.`
        );
      } catch (error) {
        ui.notifications.warn(error.message);
      }

      return;
    }

    ui.notifications.info(
      `${action.label} selected. Its guided workflow will be added in the next development steps.`
    );
  }
}

let frameHelmApplication = null;

function getFrameHelmApplication() {
  if (!frameHelmApplication) {
    frameHelmApplication = new FrameHelmApplication();
  }

  return frameHelmApplication;
}

function openFrameHelm() {
  if (!game.settings.get(MODULE_ID, "enabled")) {
    ui.notifications.warn(`${MODULE_TITLE} is currently disabled.`);
    return;
  }

  getFrameHelmApplication().render(true);
}

function closeFrameHelm() {
  frameHelmApplication?.close();
}

/* ==========================================================
   Settings
   ========================================================== */

function registerSettings() {
  game.settings.register(MODULE_ID, "enabled", {
    name: "Enable Frame Helm",
    hint: "Enables the Frame Helm action-selection interface.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    restricted: true,
    onChange: enabled => {
      if (!enabled) {
        closeFrameHelm();
      }
    }
  });
}

/* ==========================================================
   Scene control button
   ========================================================== */

function addFrameHelmControlButton(controls) {
  if (!game.settings.get(MODULE_ID, "enabled")) return;

  /*
   * Foundry v13 supplies Scene Controls as a keyed record.
   * Older Foundry versions supplied an array. Support both.
   */
  const tokenControls = Array.isArray(controls)
    ? controls.find(control => control.name === "token")
    : controls?.tokens ?? controls?.token ?? null;

  if (!tokenControls) {
    console.warn(
      `${MODULE_TITLE} | Token scene controls could not be located.`,
      controls
    );
    return;
  }

  const tool = {
    name: "lancer-frame-helm",
    title: MODULE_TITLE,
    icon: "fas fa-robot",
    button: true,
    visible: true,
    onClick: openFrameHelm
  };

  if (Array.isArray(tokenControls.tools)) {
    const alreadyExists = tokenControls.tools.some(
      existingTool =>
        existingTool.name === "lancer-frame-helm"
    );

    if (!alreadyExists) {
      tokenControls.tools.push(tool);
    }

    return;
  }

  tokenControls.tools ??= {};

  if (!tokenControls.tools["lancer-frame-helm"]) {
    tokenControls.tools["lancer-frame-helm"] = tool;
  }
}

/* ==========================================================
   Foundry lifecycle
   ========================================================== */

Hooks.once("init", () => {
  console.log(`${MODULE_TITLE} | Initializing.`);
  registerSettings();
  initializeActionRegistry();
});

Hooks.once("ready", () => {
  game.lancerFrameHelm = {
    open: openFrameHelm,
    close: closeFrameHelm,
    get application() {
      return getFrameHelmApplication();
    },
    registry: frameHelmActionRegistry,
    turn: {
      begin: context => {
        return frameHelmTurnState.beginTurn(context);
      },
      ensure: context => {
        return frameHelmTurnState.ensureTurn(context);
      },
      end: () => {
        return frameHelmTurnState.endTurn();
      },
      clear: () => {
        return frameHelmTurnState.clear();
      },
      sync: combat => {
        return syncTurnStateToCombat(combat);
      },
      get current() {
        return frameHelmTurnState.current;
      },
      get state() {
        return frameHelmTurnState.snapshot();
      },
      canUse: (actionId, options) => {
        return frameHelmTurnState
          .ensureTurn()
          .canUseAction(actionId, options);
      },
      use: (actionId, options) => {
        const result = frameHelmTurnState
          .ensureTurn()
          .useAction(actionId, options);

        frameHelmTurnState.renderApplication();
        return result;
      },
      move: distance => {
        const result = frameHelmTurnState
          .ensureTurn()
          .spendMovement(distance);

        frameHelmTurnState.renderApplication();
        return result;
      },
      setSpeed: speed => {
        const result = frameHelmTurnState
          .ensureTurn()
          .setSpeed(speed);

        frameHelmTurnState.renderApplication();
        return result;
      },
      overcharge: options => {
        const result = frameHelmTurnState
          .ensureTurn()
          .useOvercharge(options);

        frameHelmTurnState.renderApplication();
        return result;
      }
    },
    actions: {
      get: id => frameHelmActionRegistry.get(id),
      list: options => frameHelmActionRegistry.list(options),
      roots: (category, options) => {
        return frameHelmActionRegistry.roots(
          category,
          options
        );
      },
      childrenOf: (parentId, options) => {
        return frameHelmActionRegistry.childrenOf(
          parentId,
          options
        );
      },
      categories: options => {
        return frameHelmActionRegistry.listCategories(
          options
        );
      },
      register: action => {
        return frameHelmActionRegistry.register(action);
      }
    }
  };

  syncTurnStateToCombat(game.combat);

  console.log(`${MODULE_TITLE} | Ready.`);
});

Hooks.on(
  "getSceneControlButtons",
  addFrameHelmControlButton
);

Hooks.on("controlToken", () => {
  if (frameHelmApplication?.rendered) {
    frameHelmApplication.render(false);
  }
});

Hooks.on("deleteToken", () => {
  if (frameHelmApplication?.rendered) {
    frameHelmApplication.render(false);
  }
});

/* ==========================================================
   Live Lancer actor synchronization
   ========================================================== */

function displayedFrameHelmToken() {
  return frameHelmApplication?.getControlledToken?.() ?? null;
}

function frameHelmDisplaysActor(actor) {
  if (!actor || !frameHelmApplication?.rendered) {
    return false;
  }

  const displayedActor =
    displayedFrameHelmToken()?.actor ?? null;

  if (!displayedActor) return false;

  return Boolean(
    displayedActor === actor ||
    (
      displayedActor.uuid &&
      actor.uuid &&
      displayedActor.uuid === actor.uuid
    ) ||
    (
      displayedActor.id &&
      actor.id &&
      displayedActor.id === actor.id
    )
  );
}

function refreshFrameHelmTelemetry() {
  if (!frameHelmApplication?.rendered) return;

  const token = displayedFrameHelmToken();

  frameHelmApplication.synchronizeTurnSpeed(token);
  frameHelmApplication.render(false);
}

Hooks.on("updateActor", actor => {
  if (frameHelmDisplaysActor(actor)) {
    refreshFrameHelmTelemetry();
  }
});

Hooks.on("updateToken", tokenDocument => {
  if (!frameHelmApplication?.rendered) return;

  const displayedToken = displayedFrameHelmToken();

  const displayedTokenId =
    displayedToken?.id ??
    displayedToken?.document?.id ??
    null;

  if (displayedTokenId === tokenDocument.id) {
    refreshFrameHelmTelemetry();
  }
});

Hooks.on("updateActorDelta", actorDelta => {
  if (!frameHelmApplication?.rendered) return;

  const displayedTokenDocument =
    displayedFrameHelmToken()?.document ?? null;

  const deltaParent = actorDelta?.parent ?? null;

  if (
    displayedTokenDocument &&
    deltaParent &&
    displayedTokenDocument.id === deltaParent.id
  ) {
    refreshFrameHelmTelemetry();
  }
});

Hooks.on("updateItem", item => {
  if (frameHelmDisplaysActor(item?.parent)) {
    refreshFrameHelmTelemetry();
  }
});

Hooks.on("createItem", item => {
  if (frameHelmDisplaysActor(item?.parent)) {
    refreshFrameHelmTelemetry();
  }
});

Hooks.on("deleteItem", item => {
  if (frameHelmDisplaysActor(item?.parent)) {
    refreshFrameHelmTelemetry();
  }
});

/* ==========================================================
   Combat turn synchronization
   ========================================================== */

Hooks.on("combatStart", combat => {
  syncTurnStateToCombat(combat);
});

Hooks.on("updateCombat", (combat, changes) => {
  const turnChanged =
    Object.prototype.hasOwnProperty.call(
      changes,
      "turn"
    );

  const roundChanged =
    Object.prototype.hasOwnProperty.call(
      changes,
      "round"
    );

  const activeChanged =
    Object.prototype.hasOwnProperty.call(
      changes,
      "active"
    );

  if (turnChanged || roundChanged || activeChanged) {
    syncTurnStateToCombat(combat);
  }
});

Hooks.on("deleteCombat", combat => {
  if (
    frameHelmTurnState.current?.context?.combatId ===
    combat.id
  ) {
    frameHelmTurnState.clear();
  }
});


/* ==========================================================
   Dragged token movement tracking
   ========================================================== */

function frameHelmMovementTokenMatches(
  tokenDocument,
  state = frameHelmTurnState.current
) {
  if (!tokenDocument || !state || state.ended) {
    return false;
  }

  const context = state.context ?? {};

  const tokenMatches = Boolean(
    context.tokenId &&
    context.tokenId === tokenDocument.id
  );

  const actorId =
    tokenDocument.actor?.id ??
    tokenDocument.actorId ??
    null;

  const actorMatches = Boolean(
    !context.tokenId &&
    context.actorId &&
    context.actorId === actorId
  );

  return tokenMatches || actorMatches;
}

function frameHelmPoint(point) {
  if (!point) return null;

  const x = Number(point.x);
  const y = Number(point.y);

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return {
    x,
    y,
    elevation: Number.isFinite(Number(point.elevation))
      ? Number(point.elevation)
      : undefined
  };
}

function frameHelmCollectMovementPoints(movement) {
  const points = [];

  const addPoint = point => {
    const normalized = frameHelmPoint(point);

    if (!normalized) return;

    const previous = points.at(-1);

    if (
      previous &&
      previous.x === normalized.x &&
      previous.y === normalized.y
    ) {
      return;
    }

    points.push(normalized);
  };

  addPoint(movement?.origin);

  const waypointSources = [
    movement?.passed?.waypoints,
    movement?.pending?.waypoints,
    movement?.history?.waypoints,
    movement?.waypoints
  ];

  for (const source of waypointSources) {
    if (!Array.isArray(source)) continue;

    for (const waypoint of source) {
      addPoint(waypoint);
    }
  }

  addPoint(movement?.destination);

  return points;
}

function frameHelmNumericMovementDistance(movement) {
  const candidates = [
    movement?.pending?.distance,
    movement?.passed?.distance,
    movement?.history?.distance,
    movement?.distance,
    movement?.pending?.cost,
    movement?.passed?.cost
  ];

  for (const candidate of candidates) {
    const numeric = Number(candidate);

    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric;
    }
  }

  const measurementSources = [
    movement?.pending?.measurements,
    movement?.passed?.measurements,
    movement?.history?.measurements
  ];

  for (const measurements of measurementSources) {
    if (!Array.isArray(measurements)) continue;

    const total = measurements.reduce(
      (sum, measurement) => {
        const distance = Number(
          measurement?.distance ??
          measurement?.cost ??
          0
        );

        return sum + (
          Number.isFinite(distance)
            ? distance
            : 0
        );
      },
      0
    );

    if (total > 0) return total;
  }

  return null;
}

function frameHelmMeasureMovementPath(
  tokenDocument,
  movement
) {
  const directDistance =
    frameHelmNumericMovementDistance(movement);

  const sceneGridDistance = Number(
    tokenDocument?.parent?.grid?.distance ??
    canvas?.dimensions?.distance ??
    1
  );

  const normalizeSceneDistance = distance => {
    if (!Number.isFinite(distance)) return null;

    if (
      Number.isFinite(sceneGridDistance) &&
      sceneGridDistance > 0
    ) {
      return distance / sceneGridDistance;
    }

    return distance;
  };

  if (directDistance !== null) {
    return normalizeSceneDistance(directDistance);
  }

  const points =
    frameHelmCollectMovementPoints(movement);

  if (points.length < 2) return 0;

  try {
    const measured = canvas?.grid?.measurePath?.(
      points,
      {
        cost: true
      }
    );

    const measuredDistance = Number(
      measured?.cost ??
      measured?.distance
    );

    if (
      Number.isFinite(measuredDistance) &&
      measuredDistance > 0
    ) {
      return normalizeSceneDistance(
        measuredDistance
      );
    }
  } catch (error) {
    console.warn(
      `${MODULE_TITLE} | Foundry path measurement failed; using geometric fallback.`,
      error
    );
  }

  const gridSize = Number(
    canvas?.dimensions?.size ??
    tokenDocument?.parent?.grid?.size ??
    100
  );

  let pixelDistance = 0;

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];

    pixelDistance += Math.hypot(
      current.x - previous.x,
      current.y - previous.y
    );
  }

  if (!Number.isFinite(gridSize) || gridSize <= 0) {
    return 0;
  }

  return pixelDistance / gridSize;
}

function frameHelmRoundMovementDistance(distance) {
  const numeric = Number(distance);

  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 0;
  }

  return Math.round(numeric * 100) / 100;
}

Hooks.on(
  "moveToken",
  (tokenDocument, movement) => {
    const state = frameHelmTurnState.current;

    if (!frameHelmMovementTokenMatches(
      tokenDocument,
      state
    )) {
      return;
    }

    const distance = frameHelmRoundMovementDistance(
      frameHelmMeasureMovementPath(
        tokenDocument,
        movement
      )
    );

    if (distance <= 0) return;

    try {
      const result = state.trackTokenMovement(
        distance,
        {
          movementId: movement?.id ?? null,
          method: movement?.method ?? null,
          origin: frameHelmPoint(movement?.origin),
          destination: frameHelmPoint(
            movement?.destination
          )
        }
      );

      if (!result.tracked) return;

      for (const automaticAction of (
        result.automaticActions ?? []
      )) {
        if (!automaticAction.committed) {
          ui.notifications.warn(
            `Frame Helm tracked movement beyond the current allowance, but could not automatically commit Boost: ${automaticAction.reason ?? "no legal action budget remains"}.`
          );
          continue;
        }

        if (
          automaticAction.source === "overcharge" &&
          automaticAction.triggeredOvercharge
        ) {
          ui.notifications.warn(
            `Movement triggered Overcharge Boost. Apply ${automaticAction.heatFormula ?? "the current Overcharge cost"} Heat.`
          );
        } else if (
          automaticAction.source === "overcharge"
        ) {
          ui.notifications.info(
            "Movement automatically spent the available Overcharge action on Boost."
          );
        } else {
          ui.notifications.info(
            "Movement exceeded Speed. Boost was automatically committed."
          );
        }
      }

      if (result.excess > 0) {
        ui.notifications.warn(
          `Frame Helm recorded ${result.excess} excess movement beyond the currently legal movement allowance. The token was not stopped.`
        );
      }

      frameHelmTurnState.renderApplication();
    } catch (error) {
      console.error(
        `${MODULE_TITLE} | Could not track token movement.`,
        error
      );

      ui.notifications.warn(
        `Frame Helm could not track this movement: ${error.message}`
      );
    }
  }
);
