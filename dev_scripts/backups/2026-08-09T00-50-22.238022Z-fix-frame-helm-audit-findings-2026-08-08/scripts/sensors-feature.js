/**
 * ============================================================
 * FILE PATH / NAME
 * ============================================================
 *
 * scripts/sensors-feature.js
 */

/**
 * ============================================================
 * FRAME HELM -- SENSOR CONTACTS FEATURE
 * ============================================================
 *
 * ROLE:
 *   Owns Frame Helm's sensor-contact gameplay/domain behavior.
 *
 * RESPONSIBILITIES:
 *   - Determine the current sensor-source token.
 *   - Read the source unit's Lancer sensor range.
 *   - Measure hostile-token distance from the source.
 *   - Identify hostile contacts within Sensors.
 *   - Construct sensor-contact presentation data.
 *   - Request rendering through the Sensors UI feature.
 *   - Refresh contacts in response to sensor-relevant
 *     Foundry canvas hooks.
 *
 * DOES NOT OWN:
 *   - PIXI containers.
 *   - PIXI graphics.
 *   - PIXI text.
 *   - Sensor-contact colors.
 *   - Sensor-contact typography.
 *   - Sensor-contact marker geometry.
 *   - Canvas presentation-layer lifecycle.
 *   - Frame Helm application rendering.
 *   - Actor telemetry synchronization.
 *   - Turn state.
 *   - Movement tracking.
 *   - Action registration.
 *   - Action execution.
 *   - Combat synchronization.
 *
 * UI OWNERSHIP:
 *
 *   styles/ui-sensors.js
 *       - PIXI construction
 *       - PIXI layer ownership
 *       - marker rendering
 *       - label rendering
 *       - canvas.interface attachment
 *
 *   styles/ui-sensors.css
 *       - sensor UI visual configuration
 *       - contact colors
 *       - stroke widths
 *       - label typography
 *       - sizing and spacing constants
 *
 * FEATURE CONTRACT:
 *
 *   Provides:
 *     - sensors.contacts
 *     - sensors.refresh
 *     - sensors.measurement
 *
 *   Required dependencies:
 *     - none
 */

import {
  defineFrameHelmFeature
} from "./feature-contract.js";

import {
  renderFrameHelmSensorContacts,
  destroyFrameHelmSensorContacts,
  getFrameHelmSensorLayer
} from "../styles/ui-sensors.js";


/* ============================================================
   Sensor-domain identity
   ============================================================ */

const MODULE_TITLE =
  "Lancer: Frame Helm";


/* ============================================================
   Sensor-distance measurement
   ============================================================ */

function frameHelmSensorDistance(
  sourceToken,
  targetToken
) {
  const source =
    sourceToken?.center;

  const target =
    targetToken?.center;

  if (
    !source ||
    !target
  ) {
    return Infinity;
  }

  try {
    const measured =
      canvas?.grid?.measurePath?.(
        [
          source,
          target
        ],
        {
          cost: true
        }
      );

    const sceneDistance =
      Number(
        canvas?.scene?.grid?.distance ??
        canvas?.dimensions?.distance ??
        1
      );

    const measuredDistance =
      Number(
        measured?.cost ??
        measured?.distance
      );

    if (
      Number.isFinite(
        measuredDistance
      )
    ) {
      return (
        Number.isFinite(
          sceneDistance
        ) &&
        sceneDistance > 0
      )
        ? measuredDistance /
          sceneDistance
        : measuredDistance;
    }
  } catch (error) {
    console.warn(
      `${MODULE_TITLE} | Sensor range measurement fell back to geometry.`,
      error
    );
  }

  const gridSize =
    Number(
      canvas?.dimensions?.size ??
      100
    );

  if (
    !Number.isFinite(gridSize) ||
    gridSize <= 0
  ) {
    return Infinity;
  }

  return Math.hypot(
    target.x - source.x,
    target.y - source.y
  ) / gridSize;
}


/* ============================================================
   Sensor-source resolution
   ============================================================ */

function frameHelmSensorSourceToken() {
  const controlled =
    canvas?.tokens?.controlled ??
    [];

  if (
    controlled.length > 0
  ) {
    return controlled[0];
  }

  return (
    game.combat
      ?.combatant
      ?.token
      ?.object ??
    null
  );
}


/* ============================================================
   Sensor-contact discovery
   ============================================================ */

/**
 * Produces presentation-neutral contact records.
 *
 * The Sensors domain decides WHO qualifies as a contact.
 * The Sensors UI decides HOW that contact looks.
 */
function getFrameHelmSensorContacts() {
  const sourceToken =
    frameHelmSensorSourceToken();

  const sensorRange =
    Number(
      sourceToken
        ?.actor
        ?.system
        ?.sensor_range
    );

  if (
    !sourceToken ||
    !Number.isFinite(
      sensorRange
    ) ||
    sensorRange <= 0
  ) {
    return [];
  }

  const contacts = [];

  for (
    const token
    of (
      canvas
        ?.tokens
        ?.placeables ??
      []
    )
  ) {
    if (
      token === sourceToken ||
      Number(
        token
          ?.document
          ?.disposition
      ) >= 0
    ) {
      continue;
    }

    const distance =
      frameHelmSensorDistance(
        sourceToken,
        token
      );

    if (
      !Number.isFinite(distance) ||
      distance > sensorRange
    ) {
      continue;
    }

    contacts.push({
      id:
        token.document?.id ??
        token.id ??
        null,

      name:
        token.document?.name ??
        token.name ??
        "CONTACT",

      x:
        Number(token.center?.x) ||
        0,

      y:
        Number(token.center?.y) ||
        0,

      width:
        Number(token.w) ||
        30,

      height:
        Number(token.h) ||
        30,

      distance
    });
  }

  return contacts;
}


/* ============================================================
   Sensor-contact refresh
   ============================================================ */

/**
 * Coordinates domain discovery with UI rendering.
 */
function refreshFrameHelmSensorContacts() {
  if (
    !canvas?.ready ||
    !canvas?.interface
  ) {
    destroyFrameHelmSensorContacts();
    return;
  }

  const contacts =
    getFrameHelmSensorContacts();

  renderFrameHelmSensorContacts(
    contacts
  );
}


/* ============================================================
   Sensor-domain Foundry hook handlers
   ============================================================ */

function handleFrameHelmCanvasReady() {
  refreshFrameHelmSensorContacts();
}


function handleFrameHelmCanvasPan() {
  refreshFrameHelmSensorContacts();
}


function handleFrameHelmCreateToken() {
  refreshFrameHelmSensorContacts();
}


function handleFrameHelmDeleteToken() {
  refreshFrameHelmSensorContacts();
}


function handleFrameHelmRefreshToken() {
  refreshFrameHelmSensorContacts();
}


function handleFrameHelmSightRefresh() {
  refreshFrameHelmSensorContacts();
}


/* ============================================================
   Sensor feature definition
   ============================================================ */

export const frameHelmSensorsFeature =
  defineFrameHelmFeature({
    id:
      "sensors",

    domain:
      "sensors",

    provides: [
      "sensors.contacts",
      "sensors.refresh",
      "sensors.measurement"
    ],

    dependsOn: [],

    optionalDependsOn: [],

    state: {},

    commands: {
      refresh:
        refreshFrameHelmSensorContacts,

      destroy:
        destroyFrameHelmSensorContacts
    },

    queries: {
      getLayer:
        getFrameHelmSensorLayer,

      getSourceToken:
        frameHelmSensorSourceToken,

      getContacts:
        getFrameHelmSensorContacts,

      distance:
        frameHelmSensorDistance
    },

    hooks: {
      canvasReady:
        handleFrameHelmCanvasReady,

      canvasPan:
        handleFrameHelmCanvasPan,

      createToken:
        handleFrameHelmCreateToken,

      deleteToken:
        handleFrameHelmDeleteToken,

      refreshToken:
        handleFrameHelmRefreshToken,

      sightRefresh:
        handleFrameHelmSightRefresh
    },

    lifecycle: {},

    api: {
      refresh:
        refreshFrameHelmSensorContacts,

      destroy:
        destroyFrameHelmSensorContacts,

      getLayer:
        getFrameHelmSensorLayer,

      getSourceToken:
        frameHelmSensorSourceToken,

      getContacts:
        getFrameHelmSensorContacts,

      distance:
        frameHelmSensorDistance
    },

    metadata: {
      label:
        "Sensor Contacts",

      description:
        "Identifies hostile contacts within the selected unit's Lancer sensor range.",

      extractedFrom:
        "scripts/lancer-frame-helm.js",

      uiImplementation:
        "styles/ui-sensors.js",

      uiStyles:
        "styles/ui-sensors.css",

      authoritativeRuntime:
        "scripts/lancer-frame-helm.js"
    }
  });


/* ============================================================
   Transitional named exports
   ============================================================ */

export {
  refreshFrameHelmSensorContacts,
  destroyFrameHelmSensorContacts as frameHelmDestroySensorLayer,
  frameHelmSensorDistance,
  frameHelmSensorSourceToken,
  getFrameHelmSensorContacts
};