import { world, system } from "@minecraft/server";
import { sendLocalizedMessage } from "../utils/localization.js";

// =========================================================
// ARMAZENAMENTO DAS SELEÇÕES
// =========================================================

const playerPositions = new Map();
/* const structurePositions = new Map(); */

// =========================================================
// RETORNA A SELEÇÃO DE UM JOGADOR
// =========================================================

export function getSelection(playerId) {
  return playerPositions.get(playerId);
}

/* export function getStructurePosition(playerId) {
  return structurePositions.get(playerId);
} */

export function clearSelection(playerId) {
  playerPositions.delete(playerId);
  /* structurePositions.delete(playerId); */
}

// =========================================================
// MENSAGENS
// =========================================================

function sendPositionMessage(player, positionNumber, position) {
  const { x, y, z } = position;

  sendLocalizedMessage(
    player,
    "voxen.message.position_set",
    [
      positionNumber,
      x,
      y,
      z
    ]
  );
}

/* function sendStructurePositionMessage(player, position) {
  const { x, y, z } = position;

  sendLocalizedMessage(
    player,
    "voxen.message.structure_position_set",
    [x, y, z]
  );
} */

// =========================================================
// CRIA UMA LINHA DE PARTÍCULAS
// =========================================================

function drawEdge(dimension, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dz = end.z - start.z;

  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

  // Approximately one particle per block
  const steps = Math.max(1, Math.ceil(distance));

  for (let i = 0; i <= steps; i++) {
    const progress = i / steps;

    const location = {
      x: start.x + dx * progress,
      y: start.y + dy * progress,
      z: start.z + dz * progress,
    };

    try {
      // Skip particles in unloaded chunks
      if (!dimension.isChunkLoaded(location)) {
        continue;
      }

      dimension.spawnParticle("minecraft:endrod", location);
    } catch (error) {
      // Avoid repeatedly flooding the event log
      continue;
    }
  }
}

// =========================================================
// DESENHA A CAIXA DE ARESTAS
// =========================================================

function drawSelectionBox(dimension, pos1, pos2) {
  const minX = Math.min(pos1.x, pos2.x);
  const minY = Math.min(pos1.y, pos2.y);
  const minZ = Math.min(pos1.z, pos2.z);

  const maxX = Math.max(pos1.x, pos2.x) + 1;
  const maxY = Math.max(pos1.y, pos2.y) + 1;
  const maxZ = Math.max(pos1.z, pos2.z) + 1;

  // 8 cantos da caixa
  const c000 = { x: minX, y: minY, z: minZ };
  const c100 = { x: maxX, y: minY, z: minZ };
  const c010 = { x: minX, y: maxY, z: minZ };
  const c110 = { x: maxX, y: maxY, z: minZ };
  const c001 = { x: minX, y: minY, z: maxZ };
  const c101 = { x: maxX, y: minY, z: maxZ };
  const c011 = { x: minX, y: maxY, z: maxZ };
  const c111 = { x: maxX, y: maxY, z: maxZ };

  // Base
  drawEdge(dimension, c000, c100);
  drawEdge(dimension, c100, c101);
  drawEdge(dimension, c101, c001);
  drawEdge(dimension, c001, c000);

  // Topo
  drawEdge(dimension, c010, c110);
  drawEdge(dimension, c110, c111);
  drawEdge(dimension, c111, c011);
  drawEdge(dimension, c011, c010);

  // Verticais
  drawEdge(dimension, c000, c010);
  drawEdge(dimension, c100, c110);
  drawEdge(dimension, c101, c111);
  drawEdge(dimension, c001, c011);
}

// =========================================================
// ATUALIZA A CAIXA A CADA 1 SEGUNDO
// =========================================================

system.runInterval(() => {
  const players = world.getPlayers();

  for (const player of players) {
    const data = playerPositions.get(player.id);

    if (!data?.pos1 || !data?.pos2) {
      continue;
    }

    // Não desenha a seleção em uma dimensão diferente
    if (data.dimensionId !== player.dimension.id) {
      continue;
    }

    drawSelectionBox(player.dimension, data.pos1, data.pos2);
  }
}, 20);

// =========================================================
// REGISTRA O SISTEMA DE POS1 / POS2
// =========================================================

export function registerSelectionSystem() {
  world.beforeEvents.playerInteractWithBlock.subscribe((ev) => {
    const player = ev.player;
    const block = ev.block;
    const itemStack = ev.itemStack;

    if (
      itemStack?.typeId !== "voxen:edit_staff"
    ) {
      return;
    }

    ev.cancel = true;

    const playerId = player.id;
    const position = Object.freeze({
      x: block.location.x,
      y: block.location.y,
      z: block.location.z,
    });
    const dimensionId = player.dimension.id;

    /* if (itemStack.typeId === "voxen:structure_staff") {
      structurePositions.set(playerId, {
        position: { ...position },
        dimensionId,
      });

      system.run(() => {
        try {
          player.playSound("random.orb");
          sendStructurePositionMessage(player, position);
        } catch (error) {
          console.warn(
            "[voxen:selection] Error sending structure position feedback:",
            error,
          );
        }
      });

      return;
    } */

    const data = playerPositions.get(playerId) ?? {
      pos1: null,
      pos2: null,
      next: 1,
      dimensionId: player.dimension.id,
    };

    // Evita manter posições de uma dimensão anterior
    if (data.dimensionId !== dimensionId) {
      data.pos1 = null;
      data.pos2 = null;
      data.next = 1;
    }

    data.dimensionId = dimensionId;

    // =================================================
    // POSIÇÃO 1
    // =================================================

    if (data.next === 1) {
      data.pos1 = { ...position };
      data.pos2 = null;
      data.next = 2;

      playerPositions.set(playerId, data);

      // Snapshot dos valores usados na mensagem
      const messagePosition = Object.freeze({
        x: position.x,
        y: position.y,
        z: position.z,
      });

      system.run(() => {
        try {
          player.playSound("random.orb");
          sendPositionMessage(player, 1, messagePosition);
        } catch (error) {
          console.warn(
            "[voxen:selection] Error sending Position 1 feedback:",
            error,
          );
        }
      });

      return;
    }

    // =================================================
    // POSIÇÃO 2
    // =================================================

    data.pos2 = { ...position };
    data.next = 1;
    data.dimensionId = dimensionId;

    playerPositions.set(playerId, data);

    // Snapshot independente para o callback agendado
    const messagePosition = Object.freeze({
      x: position.x,
      y: position.y,
      z: position.z,
    });

    system.run(() => {
      try {
        player.playSound("random.orb");
        sendPositionMessage(player, 2, messagePosition);
      } catch (error) {
        console.warn(
          "[voxen:selection] Error sending Position 2 feedback:",
          error,
        );
      }
    });
  });
}
