
import {
    world,
    CustomCommandParamType,
    CommandPermissionLevel,
    CustomCommandStatus
} from "@minecraft/server";
import { sendLocalizedMessage } from "../utils/localization.js";

// =========================================================
// CONFIGURATION
// =========================================================

const PALETTE_PROPERTY = "voxen:complementary_palettes";

const PALETTE_ENUM = "voxen:complementary_palette";
const ACTION_ENUM = "voxen:complementary_action";

const MAX_PALETTE_BLOCKS = 8;
const MAX_BLOCKS_PER_COMMAND = 5;

// =========================================================
// STORAGE
// =========================================================

function getPalettes() {
    try {
        const data = world.getDynamicProperty(PALETTE_PROPERTY);

        if (typeof data !== "string" || !data) {
            return {};
        }

        const parsed = JSON.parse(data);

        return parsed &&
            typeof parsed === "object" &&
            !Array.isArray(parsed)
            ? parsed
            : {};
    } catch {
        return {};
    }
}

function savePalettes(palettes) {
    world.setDynamicProperty(
        PALETTE_PROPERTY,
        JSON.stringify(palettes)
    );
}

// =========================================================
// UTILITIES
// =========================================================

function getPlayer(origin) {
    const player = origin.sourceEntity;

    return player?.typeId === "minecraft:player"
        ? player
        : undefined;
}

function sendMessage(player, key, values = []) {
    sendLocalizedMessage(player, key, values);
}

function normalizeBlock(block) {
    if (typeof block === "string") {
        const id = block.trim();

        if (!id) return undefined;

        return id.includes(":")
            ? id
            : `minecraft:${id}`;
    }

    if (block && typeof block === "object") {
        const id = block.typeId ?? block.id;

        if (typeof id === "string" && id.trim()) {
            const normalized = id.trim();

            return normalized.includes(":")
                ? normalized
                : `minecraft:${normalized}`;
        }
    }

    return undefined;
}

function normalizeName(name) {
    return typeof name === "string"
        ? name.trim().toLowerCase()
        : "";
}

function displayName(name) {
    return typeof name === "string"
        ? name.trim()
        : "";
}

function hasPalette(palettes, name) {
    return Object.prototype.hasOwnProperty.call(
        palettes,
        name
    );
}

function getValidBlocks(rawBlocks) {
    return rawBlocks
        .map(normalizeBlock)
        .filter(block =>
            typeof block === "string" &&
            block.length > 0
        );
}

function getUniqueBlocks(blocks) {
    return [...new Set(blocks)];
}

function saveSafely(
    player,
    palettes,
    successKey,
    successValues,
    errorKey
) {
    try {
        savePalettes(palettes);

        sendMessage(player, successKey, successValues);

        return {
            status: CustomCommandStatus.Success
        };
    } catch (error) {
        sendMessage(player, errorKey);

        return {
            status: CustomCommandStatus.Failure
        };
    }
}

// =========================================================
// MAIN COMMAND
//
// /voxen:complementary palette create <name> <block1> <block2> [block3...]
// /voxen:complementary palette add <name> <block1> [block2...]
// /voxen:complementary palette remove <name>
// =========================================================

function complementaryCommand(origin, ...args) {
    const player = getPlayer(origin);

    if (!player) {
        return {
            status: CustomCommandStatus.Failure
        };
    }

    const [paletteType, action, name, ...rawBlocks] = args;

    // -----------------------------------------------------
    // VALIDATE CATEGORY
    // -----------------------------------------------------

    if (paletteType !== "palette") {
        sendMessage(
            player,
            "voxen.message.palette_syntax"
        );

        return {
            status: CustomCommandStatus.Failure
        };
    }

    // -----------------------------------------------------
    // VALIDATE NAME
    // -----------------------------------------------------

    const paletteName = normalizeName(name);
    const originalName = displayName(name);

    if (!paletteName || !originalName) {
        sendMessage(
            player,
            "voxen.message.palette_name_required"
        );

        return {
            status: CustomCommandStatus.Failure
        };
    }

    if (
        ["__proto__", "prototype", "constructor"]
            .includes(paletteName)
    ) {
        sendMessage(
            player,
            "voxen.message.palette_name_reserved"
        );

        return {
            status: CustomCommandStatus.Failure
        };
    }

    const palettes = getPalettes();

    // =====================================================
    // CREATE
    // =====================================================

    if (action === "create") {
        const blocks = getUniqueBlocks(
            getValidBlocks(rawBlocks)
        );

        if (blocks.length < 2) {
            sendMessage(
                player,
                "voxen.message.palette_needs_two_blocks"
            );

            return {
                status: CustomCommandStatus.Failure
            };
        }

        if (blocks.length > MAX_BLOCKS_PER_COMMAND) {
            sendMessage(
                player,
                "voxen.message.palette_command_block_limit",
                [MAX_BLOCKS_PER_COMMAND]
            );

            return {
                status: CustomCommandStatus.Failure
            };
        }

        if (hasPalette(palettes, paletteName)) {
            sendMessage(
                player,
                "voxen.message.palette_already_exists",
                [originalName]
            );

            return {
                status: CustomCommandStatus.Failure
            };
        }

        palettes[paletteName] = {
            name: originalName,
            blocks
        };

        return saveSafely(
            player,
            palettes,
            "voxen.message.palette_created",
            [originalName, blocks.length],
            "voxen.message.palette_save_failed"
        );
    }

    // =====================================================
    // ADD BLOCKS
    // =====================================================

    if (action === "add") {
        if (!hasPalette(palettes, paletteName)) {
            sendMessage(
                player,
                "voxen.message.palette_not_found",
                [originalName]
            );

            return {
                status: CustomCommandStatus.Failure
            };
        }

        const blocks = getUniqueBlocks(
            getValidBlocks(rawBlocks)
        );

        if (blocks.length < 1) {
            sendMessage(
                player,
                "voxen.message.palette_add_block_required"
            );

            return {
                status: CustomCommandStatus.Failure
            };
        }

        if (blocks.length > MAX_BLOCKS_PER_COMMAND) {
            sendMessage(
                player,
                "voxen.message.palette_command_block_limit",
                [MAX_BLOCKS_PER_COMMAND]
            );

            return {
                status: CustomCommandStatus.Failure
            };
        }

        const palette = palettes[paletteName];

        if (!Array.isArray(palette.blocks)) {
            sendMessage(
                player,
                "voxen.message.palette_invalid_data"
            );

            return {
                status: CustomCommandStatus.Failure
            };
        }

        const currentBlocks = getUniqueBlocks(
            palette.blocks
                .map(normalizeBlock)
                .filter(Boolean)
        );

        const newBlocks = blocks.filter(
            block => !currentBlocks.includes(block)
        );

        if (newBlocks.length === 0) {
            sendMessage(
                player,
                "voxen.message.palette_blocks_already_present"
            );

            return {
                status: CustomCommandStatus.Failure
            };
        }

        if (
            currentBlocks.length + newBlocks.length >
            MAX_PALETTE_BLOCKS
        ) {
            sendMessage(
                player,
                "voxen.message.palette_max_blocks",
                [MAX_PALETTE_BLOCKS]
            );

            return {
                status: CustomCommandStatus.Failure
            };
        }

        palette.blocks = [
            ...currentBlocks,
            ...newBlocks
        ];

        return saveSafely(
            player,
            palettes,
            "voxen.message.palette_blocks_added",
            [newBlocks.length, palette.name, palette.blocks.length],
            "voxen.message.palette_update_failed"
        );
    }

    // =====================================================
    // REMOVE
    // =====================================================

    if (action === "remove") {
        const hasBlockArguments = rawBlocks.some(
            block => block !== undefined && block !== null
        );

        if (hasBlockArguments) {
            sendMessage(
                player,
                "voxen.message.palette_remove_has_no_blocks"
            );

            return {
                status: CustomCommandStatus.Failure
            };
        }

        if (!hasPalette(palettes, paletteName)) {
            sendMessage(
                player,
                "voxen.message.palette_not_found",
                [originalName]
            );

            return {
                status: CustomCommandStatus.Failure
            };
        }

        delete palettes[paletteName];

        return saveSafely(
            player,
            palettes,
            "voxen.message.palette_removed",
            [originalName],
            "voxen.message.palette_remove_failed"
        );
    }

    // =====================================================
    // INVALID ACTION
    // =====================================================

    sendMessage(
        player,
        "voxen.message.palette_invalid_action"
    );

    return {
        status: CustomCommandStatus.Failure
    };
}

// =========================================================
// REGISTRATION
// Call inside system.beforeEvents.startup
// =========================================================

export function registerComplementaryCommands(registry) {
    // Register autocomplete enums
    registry.registerEnum(
        PALETTE_ENUM,
        ["palette"]
    );

    registry.registerEnum(
        ACTION_ENUM,
        ["create", "add", "remove"]
    );

    // Register command
    registry.registerCommand(
        {
            name: "voxen:complementary",
            description: "Manage complementary block palettes.",
            permissionLevel: CommandPermissionLevel.Any,

            mandatoryParameters: [
                {
                    name: PALETTE_ENUM,
                    type: CustomCommandParamType.Enum
                },
                {
                    name: ACTION_ENUM,
                    type: CustomCommandParamType.Enum
                },
                {
                    name: "name",
                    type: CustomCommandParamType.String
                }
            ],

            optionalParameters: [
                {
                    name: "block1",
                    type: CustomCommandParamType.BlockType
                },
                {
                    name: "block2",
                    type: CustomCommandParamType.BlockType
                },
                {
                    name: "block3",
                    type: CustomCommandParamType.BlockType
                },
                {
                    name: "block4",
                    type: CustomCommandParamType.BlockType
                },
                {
                    name: "block5",
                    type: CustomCommandParamType.BlockType
                }
            ]
        },
        complementaryCommand
    );
}

// =========================================================
// PALETTE ACCESS FOR OTHER SCRIPTS
// =========================================================

export function getComplementaryPalette(name) {
    return getPalettes()[normalizeName(name)];
}

export function getAllComplementaryPalettes() {
    return getPalettes();
}
