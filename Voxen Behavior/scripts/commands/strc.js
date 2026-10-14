// DESATIVADO: comandos de estrutura, cópia, preview, rotação, colagem e remoção.
/* import {
  CommandPermissionLevel,
  CustomCommandParamType,
  CustomCommandStatus,
  StructureRotation,
  StructureSaveMode,
  system,
  world,
} from "@minecraft/server";
import {
  getSelection,
  getStructurePosition,
} from "../selection/selectionManager.js";
import { sendLocalizedMessage } from "../utils/localization.js";

const ACTION_ENUM = "voxen:strc_action";
const NAME_PATTERN = /^[a-zA-Z0-9_-]{1,32}$/;
const ROTATIONS = new Set(["0", "90", "180", "-90"]);
const EDGE_CORNERS = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];
const previews = new Map();
const playerRotations = new Map();

function structureId(name) {
  return `voxen:copy_${name.toLowerCase()}`;
}

function resolveName(name) {
  return typeof name === "string" && NAME_PATTERN.test(name)
    ? name.toLowerCase()
    : undefined;
}

function sendMessage(player, key, values = []) {
  sendLocalizedMessage(player, key, values);
}

function getStructureDimensions(structure) {
  return {
    x: structure.size.x,
    y: structure.size.y,
    z: structure.size.z,
  };
}

function getRotatedDimensions(size, rotation) {
  const corners = [
    { x: 0, y: 0, z: 0 },
    { x: size.x, y: 0, z: 0 },
    { x: size.x, y: size.y, z: 0 },
    { x: 0, y: size.y, z: 0 },
    { x: 0, y: 0, z: size.z },
    { x: size.x, y: 0, z: size.z },
    { x: size.x, y: size.y, z: size.z },
    { x: 0, y: size.y, z: size.z },
  ].map((point) => rotatePoint(point, rotation));
  const axes = ["x", "y", "z"];

  return Object.fromEntries(
    axes.map((axis) => {
      const values = corners.map((point) => point[axis]);
      return [
        axis,
        Math.round(Math.max(...values) - Math.min(...values)),
      ];
    }),
  );
}

function rotationRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function rotatePoint(point, rotation) {
  let { x, y, z } = point;
  const radiansX = rotationRadians(rotation.x);
  const radiansY = rotationRadians(rotation.y);
  const radiansZ = rotationRadians(rotation.z);

  let nextY = y * Math.cos(radiansX) - z * Math.sin(radiansX);
  let nextZ = y * Math.sin(radiansX) + z * Math.cos(radiansX);
  y = nextY;
  z = nextZ;

  let nextX = x * Math.cos(radiansY) + z * Math.sin(radiansY);
  nextZ = -x * Math.sin(radiansY) + z * Math.cos(radiansY);
  x = nextX;
  z = nextZ;

  nextX = x * Math.cos(radiansZ) - y * Math.sin(radiansZ);
  nextY = x * Math.sin(radiansZ) + y * Math.cos(radiansZ);
  return { x: nextX, y: nextY, z };
}

function getPreviewCorners(anchor, size, rotation) {
  const sourceCorners = [
    { x: 0, y: 0, z: 0 },
    { x: size.x, y: 0, z: 0 },
    { x: size.x, y: size.y, z: 0 },
    { x: 0, y: size.y, z: 0 },
    { x: 0, y: 0, z: size.z },
    { x: size.x, y: 0, z: size.z },
    { x: size.x, y: size.y, z: size.z },
    { x: 0, y: size.y, z: size.z },
  ];
  const rotated = sourceCorners.map((point) => rotatePoint(point, rotation));
  const min = {
    x: Math.min(...rotated.map((point) => point.x)),
    y: Math.min(...rotated.map((point) => point.y)),
    z: Math.min(...rotated.map((point) => point.z)),
  };

  return rotated.map((point) => ({
    x: anchor.x + Math.round(point.x - min.x),
    y: anchor.y + Math.round(point.y - min.y),
    z: anchor.z + Math.round(point.z - min.z),
  }));
}

function drawPreviewEdge(dimension, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dz = end.z - start.z;
  const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const steps = Math.min(128, Math.max(1, Math.ceil(length / 2)));

  for (let index = 0; index <= steps; index++) {
    const progress = index / steps;
    const location = {
      x: start.x + dx * progress,
      y: start.y + dy * progress,
      z: start.z + dz * progress,
    };

    if (!dimension.isChunkLoaded(location)) {
      continue;
    }

    try {
      dimension.spawnParticle("minecraft:endrod", location);
    } catch (error) {
      console.warn("[voxen:strc] Failed to draw copy preview:", error);
      return;
    }
  }
}

system.runInterval(() => {
  const onlinePlayerIds = new Set();

  for (const player of world.getPlayers()) {
    onlinePlayerIds.add(player.id);
    const preview = previews.get(player.id);

    if (!preview || preview.dimensionId !== player.dimension.id) {
      continue;
    }

    const structure = world.structureManager.get(structureId(preview.name));
    const structurePosition = getStructurePosition(player.id);

    if (!structure || !structurePosition) {
      previews.delete(player.id);
      continue;
    }

    if (structurePosition.dimensionId !== player.dimension.id) {
      continue;
    }

    const corners = getPreviewCorners(
      structurePosition.position,
      getStructureDimensions(structure),
      preview.rotation,
    );

    for (const [start, end] of EDGE_CORNERS) {
      drawPreviewEdge(player.dimension, corners[start], corners[end]);
    }
  }

  for (const playerId of previews.keys()) {
    if (!onlinePlayerIds.has(playerId)) {
      previews.delete(playerId);
    }
  }
}, 20);

function getPlayer(origin) {
  const player = origin.sourceEntity;
  return player?.typeId === "minecraft:player" ? player : undefined;
}

function fail(player, key, values = []) {
  if (player) {
    sendMessage(player, key, values);
  }

  return { status: CustomCommandStatus.Failure };
}

function getRotation(playerId) {
  return playerRotations.get(playerId) ?? { x: 0, y: 0, z: 0 };
}

function handleCopy(player, rawName) {
  const name = resolveName(rawName);

  if (!name) {
    return fail(player, "voxen.message.strc_name_invalid");
  }

  const id = structureId(name);
  const structureManager = world.structureManager;

  const selection = getSelection(player.id);

  if (!selection?.pos1 || !selection?.pos2) {
    return fail(player, "voxen.message.strc_selection_required");
  }

  if (selection.dimensionId !== player.dimension.id) {
    return fail(player, "voxen.message.strc_selection_wrong_dimension");
  }

  const dimension = player.dimension;
  const pos1 = { ...selection.pos1 };
  const pos2 = { ...selection.pos2 };

  system.run(() => {
    try {
      if (
        structureManager.getWorldStructureIds().includes(id) ||
        structureManager.getPackStructureIds().includes(id)
      ) {
        sendMessage(player, "voxen.message.strc_copy_exists", [name]);
        return;
      }

      const structure = structureManager.createFromWorld(
        id,
        dimension,
        pos1,
        pos2,
        {
          includeBlocks: true,
          includeEntities: true,
          saveMode: StructureSaveMode.World,
        },
      );
      const size = getStructureDimensions(structure);
      sendMessage(player, "voxen.message.strc_copy_saved", [
        name,
        size.x,
        size.y,
        size.z,
      ]);
    } catch (error) {
      console.warn(`[voxen:strc] Failed to save copy "${name}":`, error);
      sendMessage(player, "voxen.message.strc_copy_failed", [name]);
    }
  });

  return { status: CustomCommandStatus.Success };
}

function handleDisplay(player, mode, rawName) {
  if (mode !== "on" && mode !== "off") {
    return fail(player, "voxen.message.strc_usage");
  }

  const name = resolveName(rawName);

  if (!name) {
    return fail(player, "voxen.message.strc_name_invalid");
  }

  if (mode === "off") {
    const current = previews.get(player.id);

    if (current?.name !== name) {
      return fail(player, "voxen.message.strc_display_not_active", [name]);
    }

    previews.delete(player.id);
    sendMessage(player, "voxen.message.strc_display_disabled", [name]);
    return { status: CustomCommandStatus.Success };
  }

  const structurePosition = getStructurePosition(player.id);

  if (!structurePosition) {
    return fail(player, "voxen.message.strc_position_required");
  }

  if (structurePosition.dimensionId !== player.dimension.id) {
    return fail(player, "voxen.message.strc_position_wrong_dimension");
  }

  const dimensionId = player.dimension.id;

  system.run(() => {
    try {
      const structure = world.structureManager.get(structureId(name));

      if (!structure) {
        sendMessage(player, "voxen.message.strc_copy_not_found", [name]);
        return;
      }

      const size = getStructureDimensions(structure);
      const occupiedSize = getRotatedDimensions(
        size,
        getRotation(player.id),
      );
      previews.set(player.id, {
        name,
        dimensionId,
        rotation: getRotation(player.id),
        size,
      });
      sendMessage(player, "voxen.message.strc_display_enabled", [
        name,
        occupiedSize.x,
        occupiedSize.y,
        occupiedSize.z,
      ]);
    } catch (error) {
      console.warn(`[voxen:strc] Failed to display copy "${name}":`, error);
      sendMessage(player, "voxen.message.strc_copy_not_found", [name]);
    }
  });

  return { status: CustomCommandStatus.Success };
}

function handleRotate(player, rawX, rawY, rawZ) {
  const rawValues = [rawX, rawY, rawZ].map(String);

  if (rawValues.some((value) => !ROTATIONS.has(value))) {
    return fail(player, "voxen.message.strc_rotation_invalid");
  }

  const rotation = {
    x: Number(rawValues[0]),
    y: Number(rawValues[1]),
    z: Number(rawValues[2]),
  };
  playerRotations.set(player.id, rotation);

  const preview = previews.get(player.id);

  if (preview) {
    preview.rotation = rotation;
    const size = getRotatedDimensions(preview.size, rotation);
    sendMessage(player, "voxen.message.strc_preview_size", [
      preview.name,
      size.x,
      size.y,
      size.z,
    ]);
  }

  sendMessage(player, "voxen.message.strc_rotation_set", [
    rotation.x,
    rotation.y,
    rotation.z,
  ]);
  return { status: CustomCommandStatus.Success };
}

function handlePaste(player) {
  const preview = previews.get(player.id);

  if (!preview) {
    return fail(player, "voxen.message.strc_paste_requires_display");
  }

  const structurePosition = getStructurePosition(player.id);

  if (!structurePosition) {
    return fail(player, "voxen.message.strc_position_required");
  }

  if (structurePosition.dimensionId !== player.dimension.id) {
    return fail(player, "voxen.message.strc_paste_wrong_dimension");
  }

  const rotation = preview.rotation.y;
  const nativeRotation = rotation === 90
    ? StructureRotation.Rotate90
    : rotation === 180
      ? StructureRotation.Rotate180
      : rotation === -90
        ? StructureRotation.Rotate270
        : StructureRotation.None;
  const position = { ...structurePosition.position };
  const dimension = player.dimension;

  system.run(() => {
    try {
      const structure = world.structureManager.get(structureId(preview.name));

      if (!structure) {
        previews.delete(player.id);
        sendMessage(player, "voxen.message.strc_copy_not_found", [preview.name]);
        return;
      }

      world.structureManager.place(
        structure,
        dimension,
        position,
        {
          rotation: nativeRotation,
          includeBlocks: true,
          includeEntities: true,
        },
      );
      sendMessage(player, "voxen.message.strc_pasted", [
        preview.name,
        position.x,
        position.y,
        position.z,
        rotation,
      ]);
    } catch (error) {
      console.warn(`[voxen:strc] Failed to paste copy "${preview.name}":`, error);
      sendMessage(player, "voxen.message.strc_paste_failed", [preview.name]);
    }
  });

  return { status: CustomCommandStatus.Success };
}

function handleDelete(player, rawName) {
  const name = resolveName(rawName);

  if (!name) {
    return fail(player, "voxen.message.strc_name_invalid");
  }

  const id = structureId(name);

  system.run(() => {
    try {
      if (!world.structureManager.getWorldStructureIds().includes(id)) {
        sendMessage(player, "voxen.message.strc_copy_not_found", [name]);
        return;
      }

      if (!world.structureManager.delete(id)) {
        sendMessage(player, "voxen.message.strc_delete_failed", [name]);
        return;
      }

      for (const [playerId, preview] of previews) {
        if (preview.name === name) {
          previews.delete(playerId);
        }
      }
      sendMessage(player, "voxen.message.strc_deleted", [name]);
    } catch (error) {
      console.warn(`[voxen:strc] Failed to delete copy "${name}":`, error);
      sendMessage(player, "voxen.message.strc_delete_failed", [name]);
    }
  });

  return { status: CustomCommandStatus.Success };
}

function strcCommand(origin, ...args) {
  const player = getPlayer(origin);

  if (!player) {
    return { status: CustomCommandStatus.Failure };
  }

  const [action, ...parameters] = args;

  switch (action) {
    case "copy":
      return parameters[0]
        ? handleCopy(player, parameters[0])
        : fail(player, "voxen.message.strc_usage");
    case "display_copy":
      return parameters[0] && parameters[1]
        ? handleDisplay(player, parameters[0], parameters[1])
        : fail(player, "voxen.message.strc_usage");
    case "rotate":
      return parameters.length >= 3
        ? handleRotate(player, parameters[0], parameters[1], parameters[2])
        : fail(player, "voxen.message.strc_usage");
    case "paste":
      return handlePaste(player);
    case "delete":
      return parameters[0]
        ? handleDelete(player, parameters[0])
        : fail(player, "voxen.message.strc_usage");
    default:
      return fail(player, "voxen.message.strc_usage");
  }
}

export function registerStrcCommand(registry) {
  registry.registerEnum(ACTION_ENUM, [
    "copy",
    "display_copy",
    "rotate",
    "paste",
    "delete",
  ]);

  registry.registerCommand(
    {
      name: "voxen:strc",
      description: "Save, preview, paste, and delete structures.",
      permissionLevel: CommandPermissionLevel.Any,
      cheatsRequired: false,
      mandatoryParameters: [
        {
          name: ACTION_ENUM,
          type: CustomCommandParamType.Enum,
        },
      ],
      optionalParameters: [
        {
          name: "nameOrMode",
          type: CustomCommandParamType.String,
        },
        {
          name: "copyName",
          type: CustomCommandParamType.String,
        },
        {
          name: "rotationYOrZ",
          type: CustomCommandParamType.String,
        },
        {
          name: "rotationZ",
          type: CustomCommandParamType.String,
        },
      ],
    },
    strcCommand,
  );
} */