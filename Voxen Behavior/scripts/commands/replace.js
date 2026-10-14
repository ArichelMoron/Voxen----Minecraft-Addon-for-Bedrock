import {
    world,
    system,
    BlockVolume,
    CustomCommandParamType,
    CommandPermissionLevel,
    CustomCommandStatus
} from "@minecraft/server";

import { getSelection } from "../selection/selectionManager.js";
import { getBlockId } from "../utils/blockUtils.js";
import { sendLocalizedMessage } from "../utils/localization.js";
import { getComplementaryPalette } from "./complementary.js";

// =========================================================
// CONFIGURATION
// =========================================================

const MAX_FILL_BLOCKS = 32768;
const MAX_SHAPE_DIAMETER = 500;

const PALETTE_RANDOM_SEED = 0x9e3779b9;
const PALETTE_CELL_SIZE = 4;
const SHELL_THICKNESS = 1.15;

// More work per generator tick.
// Large solid operations are now handled by fillBlocks()
// instead of individual block.setType() calls.
const BLOCKS_PER_SLICE = 4096;

// Palette operations still perform some JavaScript-side
// calculations, so keep their scheduler slice smaller.
const PALETTE_BLOCKS_PER_SLICE = 8192;

// Choose the largest region size that leaves capacity to preload
// the next region while the current one is being processed.
const TICKING_REGION_CHUNK_SIZES = [
    16,
    8,
    4
];
const BLOCKS_PER_CHUNK = 16;
const SHAPE_ACTIONS = [
    "filled_cylinder_x",
    "filled_cylinder_y",
    "filled_cylinder_z",
    "hollow_cylinder_x",
    "hollow_cylinder_y",
    "hollow_cylinder_z",
    "filled_pyramid_x_positive",
    "filled_pyramid_x_negative",
    "filled_pyramid_y_positive",
    "filled_pyramid_y_negative",
    "filled_pyramid_z_positive",
    "filled_pyramid_z_negative",
    "hollow_pyramid_x_positive",
    "hollow_pyramid_x_negative",
    "hollow_pyramid_y_positive",
    "hollow_pyramid_y_negative",
    "hollow_pyramid_z_positive",
    "hollow_pyramid_z_negative",
    "filled_cone_x_positive",
    "filled_cone_x_negative",
    "filled_cone_y_positive",
    "filled_cone_y_negative",
    "filled_cone_z_positive",
    "filled_cone_z_negative",
    "hollow_cone_x_positive",
    "hollow_cone_x_negative",
    "hollow_cone_y_positive",
    "hollow_cone_y_negative",
    "hollow_cone_z_positive",
    "hollow_cone_z_negative",
    "ring_x",
    "ring_y",
    "ring_z",
    "filled_toroid_x",
    "filled_toroid_y",
    "filled_toroid_z",
    "hollow_toroid_x",
    "hollow_toroid_y",
    "hollow_toroid_z"
];
const LEGACY_ACTIONS = [
    "outlinebox",
    "hollowbox",
    "filledsphere",
    "hollowsphere",
    "filled_cone_y_positive"
];
const LEGACY_ACTION_ALIASES = {
    outlinebox: "outline_box",
    hollowbox: "hollow_box",
    filledsphere: "filled_sphere",
    hollowsphere: "hollow_sphere",
    filled_cone_y_posiive: "filled_cone_y_positive"
};

function normalizeShapeAction(action) {
    return Object.prototype.hasOwnProperty.call(
        LEGACY_ACTION_ALIASES,
        action
    )
        ? LEGACY_ACTION_ALIASES[action]
        : action;
}

// =========================================================
// BASIC UTILITIES
// =========================================================

function sendMessage(
    player,
    key,
    values = []
) {
    sendLocalizedMessage(
        player,
        key,
        values
    );
}

function boundsOf(
    a,
    b
) {
    return {
        minX: Math.min(a.x, b.x),
        minY: Math.min(a.y, b.y),
        minZ: Math.min(a.z, b.z),

        maxX: Math.max(a.x, b.x),
        maxY: Math.max(a.y, b.y),
        maxZ: Math.max(a.z, b.z)
    };
}

function getBoxSize(
    box
) {
    return {
        x:
            box.maxX -
            box.minX +
            1,

        y:
            box.maxY -
            box.minY +
            1,

        z:
            box.maxZ -
            box.minZ +
            1
    };
}

function volumeOf(
    box
) {
    const size =
        getBoxSize(box);

    return (
        size.x *
        size.y *
        size.z
    );
}

function createVolume(
    box
) {
    return new BlockVolume(
        {
            x: box.minX,
            y: box.minY,
            z: box.minZ
        },

        {
            x: box.maxX,
            y: box.maxY,
            z: box.maxZ
        }
    );
}

// =========================================================
// BLOCK ID
// =========================================================

function normalizeBlockId(
    block
) {
    if (
        typeof block ===
        "string"
    ) {
        const id =
            block.trim();

        if (!id) {
            return undefined;
        }

        return id.includes(":")
            ? id
            : `minecraft:${id}`;
    }

    const id =
        block?.typeId ??
        block?.id;

    if (
        typeof id !==
            "string" ||
        !id.trim()
    ) {
        return undefined;
    }

    const normalized =
        id.trim();

    return normalized.includes(":")
        ? normalized
        : `minecraft:${normalized}`;
}

// =========================================================
// PALETTE RESOLUTION
// =========================================================

function resolvePalette(
    name
) {
    if (
        typeof name !==
        "string"
    ) {
        return undefined;
    }

    const raw =
        name.trim();

    if (!raw) {
        return undefined;
    }

    const palette =
        getComplementaryPalette(
            raw
        );

    if (
        !Array.isArray(
            palette?.blocks
        ) ||
        palette.blocks.length === 0
    ) {
        return undefined;
    }

    const blocks = [
        ...new Set(
            palette.blocks
                .map(
                    normalizeBlockId
                )
                .filter(Boolean)
        )
    ];

    if (!blocks.length) {
        return undefined;
    }

    return {
        type: "palette",

        name:
            palette.name ??
            raw,

        blocks
    };
}

// =========================================================
// BLOCK DESTINATION
// =========================================================

function resolveBlock(
    block
) {
    const blockId =
        normalizeBlockId(
            block
        );

    if (!blockId) {
        return undefined;
    }

    return {
        type: "block",

        name: blockId,

        blocks: [
            blockId
        ]
    };
}

function isPalette(
    destination
) {
    return (
        destination?.type ===
        "palette"
    );
}

function getDisplayName(
    destination
) {
    return (
        destination?.name ??
        "unknown"
    );
}

// =========================================================
// DETERMINISTIC PALETTE RANDOM
// =========================================================

function hash3D(
    x,
    y,
    z,
    seed =
        PALETTE_RANDOM_SEED
) {
    let h =
        Math.imul(
            x ^ seed,
            374761393
        );

    h =
        Math.imul(
            h ^
                Math.imul(
                    y,
                    668265263
                ),

            1274126177
        );

    h =
        Math.imul(
            h ^
                Math.imul(
                    z,
                    2246822519
                ),

            3266489917
        );

    h ^=
        h >>> 16;

    h =
        Math.imul(
            h,
            2246822507
        );

    h ^=
        h >>> 13;

    h =
        Math.imul(
            h,
            3266489909
        );

    h ^=
        h >>> 16;

    return (
        (h >>> 0) /
        4294967296
    );
}

function pickPaletteBlock(
    destination,
    x,
    y,
    z
) {
    const blocks =
        destination.blocks;

    if (
        blocks.length === 1
    ) {
        return blocks[0];
    }

    const index =
        Math.floor(
            hash3D(
                Math.floor(
                    x / PALETTE_CELL_SIZE
                ),
                Math.floor(
                    y / PALETTE_CELL_SIZE
                ),
                Math.floor(
                    z / PALETTE_CELL_SIZE
                )
            ) *
                blocks.length
        );

    return blocks[index];
}

// =========================================================
// FAST FILL
// =========================================================
//
// Uses Dimension.fillBlocks() directly.
//
// Minecraft's scripting API supports BlockVolume fills,
// and fillBlocks() is much more efficient for large solid
// regions than calling getBlock().setType() for every block.
// =========================================================

function fillVolumeSafe(
    dimension,
    box,
    blockId,
    options
) {
    const stack = [
        box
    ];

    let total = 0;

    while (
        stack.length
    ) {
        const current =
            stack.pop();

        const size =
            getBoxSize(
                current
            );

        const volume =
            size.x *
            size.y *
            size.z;

        if (
            volume <= 0
        ) {
            continue;
        }

        if (
            volume <=
            MAX_FILL_BLOCKS
        ) {
            dimension.fillBlocks(
                createVolume(
                    current
                ),

                blockId,

                options
            );

            total +=
                volume;

            continue;
        }

        const axes = [
            {
                axis: "x",
                size: size.x
            },

            {
                axis: "y",
                size: size.y
            },

            {
                axis: "z",
                size: size.z
            }
        ].sort(
            (a, b) =>
                b.size -
                a.size
        );

        const axis =
            axes[0].axis;

        if (
            axis === "x"
        ) {
            const mid =
                Math.floor(
                    (
                        current.minX +
                        current.maxX
                    ) / 2
                );

            stack.push(
                {
                    ...current,
                    minX:
                        mid + 1
                },

                {
                    ...current,
                    maxX:
                        mid
                }
            );
        }

        else if (
            axis === "y"
        ) {
            const mid =
                Math.floor(
                    (
                        current.minY +
                        current.maxY
                    ) / 2
                );

            stack.push(
                {
                    ...current,
                    minY:
                        mid + 1
                },

                {
                    ...current,
                    maxY:
                        mid
                }
            );
        }

        else {
            const mid =
                Math.floor(
                    (
                        current.minZ +
                        current.maxZ
                    ) / 2
                );

            stack.push(
                {
                    ...current,
                    minZ:
                        mid + 1
                },

                {
                    ...current,
                    maxZ:
                        mid
                }
            );
        }
    }

    return total;
}

// =========================================================
// PALETTE RUN FILL
// =========================================================
//
// Instead of:
//
// setType()
// setType()
// setType()
// setType()
//
// We detect consecutive equal palette blocks:
//
// Stone Stone Stone Stone
//
// and turn them into:
//
// fillBlocks(StoneVolume)
//
// This drastically reduces API calls.
// =========================================================

function fillPaletteRun(
    dimension,
    y,
    z,
    x1,
    x2,
    blockId,
    progress
) {
    if (
        x1 > x2
    ) {
        return;
    }

    const box = {
        minX: x1,
        maxX: x2,

        minY: y,
        maxY: y,

        minZ: z,
        maxZ: z
    };

    const count =
        x2 -
        x1 +
        1;

    dimension.fillBlocks(
        createVolume(
            box
        ),
        blockId
    );

    progress.placed +=
        count;
}

function getPaletteCellEnd(
    coordinate,
    maximum
) {
    return Math.min(
        maximum,
        (
            Math.floor(
                coordinate / PALETTE_CELL_SIZE
            ) + 1
        ) * PALETTE_CELL_SIZE - 1
    );
}

function fillPaletteCell(
    dimension,
    box,
    blockId,
    progress,
    sourceId
) {
    if (sourceId) {
        const result =
            dimension.fillBlocks(
                createVolume(box),
                blockId,
                {
                    blockFilter: {
                        includeTypes: [
                            sourceId
                        ]
                    }
                }
            );

        if (
            result &&
            typeof result.getCapacity ===
                "function"
        ) {
            progress.placed +=
                result.getCapacity();
        }

        return;
    }

    dimension.fillBlocks(
        createVolume(box),
        blockId
    );

    progress.placed +=
        volumeOf(box);
}

// =========================================================
// PALETTE CUBOID GENERATOR
// =========================================================

function* paletteCuboidGenerator(
    dimension,
    box,
    destination,
    progress
) {
    let processed = 0;

    for (
        let y =
            box.minY;

        y <= box.maxY;

        y =
            getPaletteCellEnd(
                y,
                box.maxY
            ) + 1
    ) {
        const maxY =
            getPaletteCellEnd(
                y,
                box.maxY
            );

        for (
            let z =
                box.minZ;

            z <= box.maxZ;

            z =
                getPaletteCellEnd(
                    z,
                    box.maxZ
                ) + 1
        ) {
            const maxZ =
                getPaletteCellEnd(
                    z,
                    box.maxZ
                );

            for (
                let x =
                    box.minX;

                x <= box.maxX;

                x =
                    getPaletteCellEnd(
                        x,
                        box.maxX
                    ) + 1
            ) {
                const maxX =
                    getPaletteCellEnd(
                        x,
                        box.maxX
                    );
                const blockId =
                    pickPaletteBlock(
                        destination,
                        x,
                        y,
                        z
                    );

                const cell = {
                    minX: x,
                    maxX,
                    minY: y,
                    maxY,
                    minZ: z,
                    maxZ
                };

                fillPaletteCell(
                    dimension,
                    cell,
                    blockId,
                    progress
                );

                processed +=
                    volumeOf(cell);

                if (processed >= PALETTE_BLOCKS_PER_SLICE) {
                    processed = 0;

                    yield;
                }
            }
        }
    }
}

// =========================================================
// GENERAL REPLACE GENERATOR
// =========================================================
//
// Uses fillBlocks() with BlockFilter when a source block
// is specified.
//
// This avoids getBlock()/setType() for every block.
// =========================================================

function* replaceGenerator(
    dimension,
    box,
    destination,
    sourceId,
    progress
) {
    if (
        isPalette(destination)
    ) {
        yield*
            paletteReplaceGenerator(
                dimension,
                box,
                destination,
                sourceId,
                progress
            );

        return;
    }

    const blockId =
        destination.blocks[0];

    const options = {
        blockFilter: {
            includeTypes: [
                sourceId
            ]
        }
    };

    const size =
        getBoxSize(box);

    const volume =
        size.x *
        size.y *
        size.z;

    // fillVolumeSafe performs the splitting
    // automatically when the volume is large.
    //
    // The filter ensures that only sourceId
    // blocks are changed.
    progress.placed +=
        fillVolumeSafe(
            dimension,
            box,
            blockId,
            options
        );

    yield;
}

// =========================================================
// PALETTE REPLACE GENERATOR
// =========================================================
//
// Palette + source is harder because every location may
// receive a different destination block.
//
// We still avoid getBlock().
//
// Each generated run is filled with fillBlocks() and the
// source block is enforced through includeTypes.
// =========================================================

function fillPaletteSourceRun(
    dimension,
    y,
    z,
    x1,
    x2,
    blockId,
    sourceId,
    progress
) {
    if (
        x1 > x2
    ) {
        return;
    }

    const box = {
        minX: x1,
        maxX: x2,

        minY: y,
        maxY: y,

        minZ: z,
        maxZ: z
    };

    const result =
        dimension.fillBlocks(
            createVolume(
                box
            ),

            blockId,

            {
                blockFilter: {
                    includeTypes: [
                        sourceId
                    ]
                }
            }
        );

    // fillBlocks returns the blocks that were placed.
    // getCapacity() gives the number of positions in
    // that returned ListBlockVolume.
    if (
        result &&
        typeof result.getCapacity ===
            "function"
    ) {
        progress.placed +=
            result.getCapacity();
    }
}

// =========================================================
// PALETTE REPLACE GENERATOR
// =========================================================

function* paletteReplaceGenerator(
    dimension,
    box,
    destination,
    sourceId,
    progress
) {
    let processed = 0;

    for (
        let y =
            box.minY;

        y <= box.maxY;

        y =
            getPaletteCellEnd(
                y,
                box.maxY
            ) + 1
    ) {
        const maxY =
            getPaletteCellEnd(
                y,
                box.maxY
            );

        for (
            let z =
                box.minZ;

            z <= box.maxZ;

            z =
                getPaletteCellEnd(
                    z,
                    box.maxZ
                ) + 1
        ) {
            const maxZ =
                getPaletteCellEnd(
                    z,
                    box.maxZ
                );

            for (
                let x =
                    box.minX;

                x <= box.maxX;

                x =
                    getPaletteCellEnd(
                        x,
                        box.maxX
                    ) + 1
            ) {
                const maxX =
                    getPaletteCellEnd(
                        x,
                        box.maxX
                    );
                const blockId =
                    pickPaletteBlock(
                        destination,
                        x,
                        y,
                        z
                    );

                const cell = {
                    minX: x,
                    maxX,
                    minY: y,
                    maxY,
                    minZ: z,
                    maxZ
                };

                fillPaletteCell(
                    dimension,
                    cell,
                    blockId,
                    progress,
                    sourceId
                );

                processed +=
                    volumeOf(cell);

                if (processed >= PALETTE_BLOCKS_PER_SLICE) {
                    processed = 0;

                    yield;
                }
            }
        }
    }
}

// =========================================================
// SPHERE / ELLIPSOID DATA
// =========================================================

function getSphereData(
    pos1,
    pos2
) {
    const bounds =
        boundsOf(
            pos1,
            pos2
        );

    return {
        bounds,

        center: {
            x:
                (
                    bounds.minX +
                    bounds.maxX
                ) / 2,

            y:
                (
                    bounds.minY +
                    bounds.maxY
                ) / 2,

            z:
                (
                    bounds.minZ +
                    bounds.maxZ
                ) / 2
        },

        radiusX:
            (
                bounds.maxX -
                bounds.minX
            ) / 2,

        radiusY:
            (
                bounds.maxY -
                bounds.minY
            ) / 2,

        radiusZ:
            (
                bounds.maxZ -
                bounds.minZ
            ) / 2,

        diameterX:
            bounds.maxX -
            bounds.minX +
            1,

        diameterY:
            bounds.maxY -
            bounds.minY +
            1,

        diameterZ:
            bounds.maxZ -
            bounds.minZ +
            1
    };
}

function validateShape(
    data
) {
    return [
        data.diameterX,
        data.diameterY,
        data.diameterZ
    ].every(
        value =>
            Number.isInteger(
                value
            ) &&
            value >= 1 &&
            value <=
                MAX_SHAPE_DIAMETER
    );
}

function axisTerm(
    value,
    center,
    radius
) {
    if (
        radius === 0
    ) {
        return (
            Math.abs(
                value -
                    center
            ) < 1e-8
        )
            ? 0
            : Infinity;
    }

    const delta =
        value -
        center;

    return (
        delta * delta
    ) / (
        radius * radius
    );
}

// =========================================================
// SPHERE SEGMENTS
// =========================================================

function getSphereSegments(
    y,
    z,
    data,
    hollow
) {
    const {
        center,
        radiusX,
        radiusY,
        radiusZ
    } = data;

    const yTerm =
        axisTerm(
            y,
            center.y,
            radiusY
        );

    const zTerm =
        axisTerm(
            z,
            center.z,
            radiusZ
        );

    const remaining =
        1 -
        yTerm -
        zTerm;

    if (
        remaining <
        -1e-8
    ) {
        return [];
    }

    const minX =
        data.bounds.minX;

    const maxX =
        data.bounds.maxX;

    if (
        radiusX === 0
    ) {
        return [
            {
                x1: minX,
                x2: minX
            }
        ];
    }

    const xRadius =
        radiusX *
        Math.sqrt(
            Math.max(
                0,
                remaining
            )
        );

    const outerMin =
        Math.max(
            minX,
            Math.ceil(
                center.x -
                    xRadius
            )
        );

    const outerMax =
        Math.min(
            maxX,
            Math.floor(
                center.x +
                    xRadius
            )
        );

    if (
        outerMin >
        outerMax
    ) {
        return [];
    }

    if (
        !hollow
    ) {
        return [
            {
                x1: outerMin,
                x2: outerMax
            }
        ];
    }

    const innerX =
        Math.max(
            0,
            radiusX -
                SHELL_THICKNESS
        );

    const innerY =
        Math.max(
            0,
            radiusY -
                SHELL_THICKNESS
        );

    const innerZ =
        Math.max(
            0,
            radiusZ -
                SHELL_THICKNESS
        );

    if (
        innerX === 0 ||
        innerY === 0 ||
        innerZ === 0
    ) {
        return [
            {
                x1: outerMin,
                x2: outerMax
            }
        ];
    }

    const innerRemaining =
        1 -
        axisTerm(
            y,
            center.y,
            innerY
        ) -
        axisTerm(
            z,
            center.z,
            innerZ
        );

    if (
        innerRemaining <= 0
    ) {
        return [
            {
                x1: outerMin,
                x2: outerMax
            }
        ];
    }

    const innerXRadius =
        innerX *
        Math.sqrt(
            innerRemaining
        );

    const innerMin =
        Math.ceil(
            center.x -
                innerXRadius
        );

    const innerMax =
        Math.floor(
            center.x +
                innerXRadius
        );

    const segments = [];

    const leftMax =
        Math.min(
            outerMax,
            innerMin - 1
        );

    if (
        outerMin <=
        leftMax
    ) {
        segments.push({
            x1: outerMin,
            x2: leftMax
        });
    }

    const rightMin =
        Math.max(
            outerMin,
            innerMax + 1
        );

    if (
        rightMin <=
        outerMax
    ) {
        segments.push({
            x1: rightMin,
            x2: outerMax
        });
    }

    return segments;
}

// =========================================================
// SPHERE SEGMENT FILL
// =========================================================

function fillSphereSegment(
    dimension,
    y,
    z,
    segment,
    blockId,
    progress
) {
    const x1 =
        segment.x1;

    const x2 =
        segment.x2;

    if (
        x1 > x2
    ) {
        return;
    }

    const box = {
        minX: x1,
        maxX: x2,

        minY: y,
        maxY: y,

        minZ: z,
        maxZ: z
    };

    dimension.fillBlocks(
        createVolume(
            box
        ),
        blockId
    );

    progress.placed +=
        x2 -
        x1 +
        1;
}

// =========================================================
// PALETTE SPHERE SEGMENT
// =========================================================

function fillPaletteSphereSegment(
    dimension,
    y,
    z,
    segment,
    destination,
    progress
) {
    let runStart =
        segment.x1;

    let runBlock =
        pickPaletteBlock(
            destination,
            runStart,
            y,
            z
        );

    for (
        let x =
            segment.x1 + 1;

        x <= segment.x2;

        x++
    ) {
        const blockId =
            pickPaletteBlock(
                destination,
                x,
                y,
                z
            );

        if (
            blockId !==
            runBlock
        ) {
            fillPaletteRun(
                dimension,
                y,
                z,
                runStart,
                x - 1,
                runBlock,
                progress
            );

            runStart =
                x;

            runBlock =
                blockId;
        }
    }

    fillPaletteRun(
        dimension,
        y,
        z,
        runStart,
        segment.x2,
        runBlock,
        progress
    );
}

// =========================================================
// PALETTE SPHERE + SOURCE
// =========================================================

function fillPaletteSphereSourceSegment(
    dimension,
    y,
    z,
    segment,
    destination,
    sourceId,
    progress
) {
    let runStart =
        segment.x1;

    let runBlock =
        pickPaletteBlock(
            destination,
            runStart,
            y,
            z
        );

    for (
        let x =
            segment.x1 + 1;

        x <= segment.x2;

        x++
    ) {
        const blockId =
            pickPaletteBlock(
                destination,
                x,
                y,
                z
            );

        if (
            blockId !==
            runBlock
        ) {
            fillPaletteSourceRun(
                dimension,
                y,
                z,
                runStart,
                x - 1,
                runBlock,
                sourceId,
                progress
            );

            runStart =
                x;

            runBlock =
                blockId;
        }
    }

    fillPaletteSourceRun(
        dimension,
        y,
        z,
        runStart,
        segment.x2,
        runBlock,
        sourceId,
        progress
    );
}

// =========================================================
// SPHERE GENERATOR
// =========================================================

function* sphereGenerator(
    dimension,
    pos1,
    pos2,
    hollow,
    destination,
    progress,
    region,
    sourceId
) {
    const data =
        getSphereData(
            pos1,
            pos2
        );

    if (
        !validateShape(
            data
        )
    ) {
        throw new Error(
            `Each sphere dimension must be between 1 and ${MAX_SHAPE_DIAMETER} blocks.`
        );
    }

    let processed = 0;

    const minY =
        Math.max(
            data.bounds.minY,
            region.minY
        );

    const maxY =
        Math.min(
            data.bounds.maxY,
            region.maxY
        );

    const minZ =
        Math.max(
            data.bounds.minZ,
            region.minZ
        );

    const maxZ =
        Math.min(
            data.bounds.maxZ,
            region.maxZ
        );

    for (
        let y = minY;

        y <= maxY;

        y++
    ) {
        for (
            let z = minZ;

            z <= maxZ;

            z++
        ) {
            const segments =
                getSphereSegments(
                    y,
                    z,
                    data,
                    hollow
                );

            for (
                const segment of
                    segments
            ) {
                const x1 =
                    Math.max(
                        segment.x1,
                        region.minX
                    );

                const x2 =
                    Math.min(
                        segment.x2,
                        region.maxX
                    );

                if (
                    x1 > x2
                ) {
                    continue;
                }

                const clipped =
                    {
                        x1,
                        x2
                    };

                if (
                    isPalette(
                        destination
                    )
                ) {
                    if (
                        sourceId
                    ) {
                        fillPaletteSphereSourceSegment(
                            dimension,
                            y,
                            z,
                            clipped,
                            destination,
                            sourceId,
                            progress
                        );
                    }

                    else {
                        fillPaletteSphereSegment(
                            dimension,
                            y,
                            z,
                            clipped,
                            destination,
                            progress
                        );
                    }
                }

                else {
                    if (
                        sourceId
                    ) {
                        const result =
                            dimension.fillBlocks(
                                createVolume(
                                    {
                                        minX: x1,
                                        maxX: x2,

                                        minY: y,
                                        maxY: y,

                                        minZ: z,
                                        maxZ: z
                                    }
                                ),

                                destination
                                    .blocks[0],

                                {
                                    blockFilter: {
                                        includeTypes: [
                                            sourceId
                                        ]
                                    }
                                }
                            );

                        if (
                            result &&
                            typeof result.getCapacity ===
                                "function"
                        ) {
                            progress.placed +=
                                result.getCapacity();
                        }
                    }

                    else {
                        fillSphereSegment(
                            dimension,
                            y,
                            z,
                            clipped,
                            destination.blocks[0],
                            progress
                        );
                    }
                }

                processed +=
                    x2 -
                    x1 +
                    1;

                if (
                    processed >=
                    (
                        isPalette(
                            destination
                        )
                            ? PALETTE_BLOCKS_PER_SLICE
                            : BLOCKS_PER_SLICE
                    )
                ) {
                    processed = 0;

                    yield;
                }
            }
        }

        yield;
    }
}

// =========================================================
// AXIS-ORIENTED SHAPES
// =========================================================

const AXIS_SHAPE_AXES = {
    x: ["x", "y", "z"],
    y: ["y", "x", "z"],
    z: ["z", "x", "y"]
};

function getAxisShapeData(
    pos1,
    pos2,
    axisName
) {
    const bounds =
        boundsOf(
            pos1,
            pos2
        );
    const axes =
        AXIS_SHAPE_AXES[axisName];
    const [axis, crossAxis, depthAxis] =
        axes;
    const center = {};
    const radius = {};

    for (const name of axes) {
        center[name] =
            (
                bounds[`min${name.toUpperCase()}`] +
                bounds[`max${name.toUpperCase()}`]
            ) / 2;
        radius[name] =
            (
                bounds[`max${name.toUpperCase()}`] -
                bounds[`min${name.toUpperCase()}`]
            ) / 2;
    }

    return {
        bounds,
        axes,
        axis,
        crossAxis,
        depthAxis,
        center,
        radius
    };
}

function getAxisBounds(
    data,
    axis
) {
    const name =
        axis.toUpperCase();

    return {
        min:
            data.bounds[`min${name}`],
        max:
            data.bounds[`max${name}`]
    };
}

function getEllipseInterval(
    center,
    crossRadius,
    depthRadius,
    offset
) {
    const remaining =
        crossRadius === 0
            ? Math.abs(offset) <= 1e-8
                ? 1
                : -1
            : 1 -
                (offset * offset) /
                    (crossRadius * crossRadius);

    if (remaining < -1e-8) {
        return undefined;
    }

    if (depthRadius === 0) {
        const point =
            Math.floor(
                center + 0.5
            );

        return {
            min: point,
            max: point
        };
    }

    const extent =
        depthRadius *
        Math.sqrt(
            Math.max(
                0,
                remaining
            )
        );

    return {
        min: Math.ceil(center - extent),
        max: Math.floor(center + extent)
    };
}

function subtractIntervals(
    outer,
    inner
) {
    if (!outer) {
        return [];
    }

    if (
        !inner ||
        inner.min > outer.max ||
        inner.max < outer.min
    ) {
        return [outer];
    }

    const result = [];
    const leftMax =
        Math.min(
            outer.max,
            inner.min - 1
        );
    const rightMin =
        Math.max(
            outer.min,
            inner.max + 1
        );

    if (outer.min <= leftMax) {
        result.push({
            min: outer.min,
            max: leftMax
        });
    }

    if (rightMin <= outer.max) {
        result.push({
            min: rightMin,
            max: outer.max
        });
    }

    return result;
}

function getToroidIntervals(
    data,
    axisCoordinate,
    crossCoordinate,
    hollow
) {
    const {
        axis,
        crossAxis,
        depthAxis,
        center,
        radius
    } = data;
    const axialRadius =
        radius[axis];
    const crossRadius =
        radius[crossAxis];
    const depthRadius =
        radius[depthAxis];

    if (
        axialRadius === 0 ||
        crossRadius === 0 ||
        depthRadius === 0
    ) {
        return [];
    }

    const axialOffset =
        (
            axisCoordinate -
            center[axis]
        ) / axialRadius;

    if (Math.abs(axialOffset) > 1) {
        return [];
    }

    const minorRadius =
        Math.min(
            0.45,
            axialRadius /
                Math.min(
                    crossRadius,
                    depthRadius
                )
        );
    const majorRadius =
        1 - minorRadius;
    const axialScale =
        Math.sqrt(
            Math.max(
                0,
                1 -
                    axialOffset *
                    axialOffset
            )
        );
    const radialWidth =
        minorRadius *
        axialScale;
    const innerRadius =
        Math.max(
            0,
            majorRadius - radialWidth
        );
    const outerRadius =
        majorRadius + radialWidth;
    const crossOffset =
        (
            crossCoordinate -
            center[crossAxis]
        ) / crossRadius;

    if (Math.abs(crossOffset) > outerRadius) {
        return [];
    }

    const shellThickness =
        Math.min(
            0.2,
            SHELL_THICKNESS /
                Math.min(
                    crossRadius,
                    depthRadius,
                    axialRadius
                )
        );
    const getRadialIntervals = (
        bandMin,
        bandMax
    ) => {
        if (
            bandMax <= 0 ||
            Math.abs(crossOffset) > bandMax
        ) {
            return [];
        }

        const outerDepth =
            depthRadius *
            Math.sqrt(
                Math.max(
                    0,
                    bandMax * bandMax -
                        crossOffset * crossOffset
                )
            );
        const outer = {
            min: Math.ceil(
                center[depthAxis] -
                    outerDepth
            ),
            max: Math.floor(
                center[depthAxis] +
                    outerDepth
            )
        };

        if (
            bandMin <= 0 ||
            Math.abs(crossOffset) >= bandMin
        ) {
            return [outer];
        }

        const innerDepth =
            depthRadius *
            Math.sqrt(
                Math.max(
                    0,
                    bandMin * bandMin -
                        crossOffset * crossOffset
                )
            );

        return [
            {
                min: outer.min,
                max: Math.min(
                    outer.max,
                    Math.floor(
                        center[depthAxis] -
                            innerDepth
                    )
                )
            },
            {
                min: Math.max(
                    outer.min,
                    Math.ceil(
                        center[depthAxis] +
                            innerDepth
                    )
                ),
                max: outer.max
            }
        ].filter(
            interval =>
                interval.min <= interval.max
        );
    };

    const outerIntervals =
        getRadialIntervals(
            innerRadius,
            outerRadius
        );

    if (!hollow) {
        return outerIntervals;
    }

    const innerMajor =
        Math.max(
            0,
            majorRadius - shellThickness
        );
    const innerTubeRadius =
        Math.max(
            0,
            radialWidth - shellThickness
        );
    const innerIntervals =
        getRadialIntervals(
            Math.max(
                0,
                innerMajor - innerTubeRadius
            ),
            innerMajor + innerTubeRadius
        );

    return innerIntervals.reduce(
        (remaining, interval) =>
            remaining.flatMap(
                current =>
                    subtractIntervals(
                        current,
                        interval
                    )
            ),
        outerIntervals
    );
}

function getAxisShapeSegments(
    data,
    kind,
    filled,
    positive,
    axisCoordinate,
    crossCoordinate
) {
    const {
        axis,
        crossAxis,
        depthAxis,
        bounds,
        center,
        radius
    } = data;

    if (kind === "toroid") {
        return getToroidIntervals(
            data,
            axisCoordinate,
            crossCoordinate,
            !filled
        );
    }

    if (kind === "ring") {
        const outer =
            getEllipseInterval(
                center[depthAxis],
                radius[crossAxis],
                radius[depthAxis],
                crossCoordinate -
                    center[crossAxis]
            );

        if (!outer) {
            return [];
        }

        const innerRadiusCross =
            Math.max(
                0,
                radius[crossAxis] -
                    SHELL_THICKNESS
            );
        const innerRadiusDepth =
            Math.max(
                0,
                radius[depthAxis] -
                    SHELL_THICKNESS
            );

        if (
            innerRadiusCross === 0 ||
            innerRadiusDepth === 0
        ) {
            return [outer];
        }

        const normalizedCross =
            (
                crossCoordinate -
                center[crossAxis]
            ) / innerRadiusCross;

        if (Math.abs(normalizedCross) >= 1) {
            return [outer];
        }

        const innerExtent =
            innerRadiusDepth *
            Math.sqrt(
                1 -
                    normalizedCross *
                    normalizedCross
            );
        const inner = {
            min: Math.ceil(
                center[depthAxis] -
                    innerExtent
            ),
            max: Math.floor(
                center[depthAxis] +
                    innerExtent
            )
        };

        return subtractIntervals(
            outer,
            inner
        );
    }

    if (kind === "cylinder") {
        const outer =
            getEllipseInterval(
                center[depthAxis],
                radius[crossAxis],
                radius[depthAxis],
                crossCoordinate -
                    center[crossAxis]
            );

        if (!outer || filled) {
            return outer ? [outer] : [];
        }

        const isCap =
            axisCoordinate ===
                bounds[`min${axis.toUpperCase()}`] ||
            axisCoordinate ===
                bounds[`max${axis.toUpperCase()}`];

        if (isCap) {
            return [outer];
        }

        const innerCrossRadius =
            Math.max(
                0,
                radius[crossAxis] -
                    SHELL_THICKNESS
            );
        const innerDepthRadius =
            Math.max(
                0,
                radius[depthAxis] -
                    SHELL_THICKNESS
            );

        if (
            innerCrossRadius === 0 ||
            innerDepthRadius === 0
        ) {
            return [outer];
        }

        const inner =
            getEllipseInterval(
                center[depthAxis],
                innerCrossRadius,
                innerDepthRadius,
                crossCoordinate -
                    center[crossAxis]
            );

        if (
            Math.abs(
                crossCoordinate -
                    center[crossAxis]
            ) >
            innerCrossRadius
        ) {
            return [outer];
        }

        return subtractIntervals(
            outer,
            inner
        );
    }

    const axisRange =
        bounds[`max${axis.toUpperCase()}`] -
        bounds[`min${axis.toUpperCase()}`];
    const progress =
        axisRange === 0
            ? 1
            : positive
                ? (
                    axisCoordinate -
                    bounds[`min${axis.toUpperCase()}`]
                ) / axisRange
                : (
                    bounds[`max${axis.toUpperCase()}`] -
                    axisCoordinate
                ) / axisRange;
    const scale =
        Math.max(
            0,
            1 - progress
        );
    const outerCrossRadius =
        radius[crossAxis] *
        scale;
    const outerDepthRadius =
        radius[depthAxis] *
        scale;
    let outer;

    if (kind === "pyramid") {
        if (scale === 0) {
            const crossPoint =
                Math.floor(
                    center[crossAxis] + 0.5
                );

            if (crossCoordinate !== crossPoint) {
                return [];
            }

            const depthPoint =
                Math.floor(
                    center[depthAxis] + 0.5
                );

            outer = {
                min: depthPoint,
                max: depthPoint
            };
        } else {
            if (
                Math.abs(
                    crossCoordinate -
                        center[crossAxis]
                ) >
                outerCrossRadius
            ) {
                return [];
            }

            outer = {
                min: Math.ceil(
                    center[depthAxis] -
                        outerDepthRadius
                ),
                max: Math.floor(
                    center[depthAxis] +
                        outerDepthRadius
                )
            };
        }
    } else {
        outer =
            getEllipseInterval(
                center[depthAxis],
                outerCrossRadius,
                outerDepthRadius,
                crossCoordinate -
                    center[crossAxis]
            );
    }

    if (!outer || filled) {
        return outer ? [outer] : [];
    }

    const isBase =
        progress === 0;

    if (isBase) {
        return [outer];
    }

    const innerCrossRadius =
        Math.max(
            0,
            outerCrossRadius -
                SHELL_THICKNESS
        );
    const innerDepthRadius =
        Math.max(
            0,
            outerDepthRadius -
                SHELL_THICKNESS
        );

    if (
        innerCrossRadius === 0 ||
        innerDepthRadius === 0 ||
        Math.abs(
            crossCoordinate -
                center[crossAxis]
        ) >
            innerCrossRadius
    ) {
        return [outer];
    }

    let inner;

    if (kind === "pyramid") {
        inner = {
            min: Math.ceil(
                center[depthAxis] -
                    innerDepthRadius
            ),
            max: Math.floor(
                center[depthAxis] +
                    innerDepthRadius
            )
        };
    } else {
        inner =
            getEllipseInterval(
                center[depthAxis],
                innerCrossRadius,
                innerDepthRadius,
                crossCoordinate -
                    center[crossAxis]
            );
    }

    return subtractIntervals(
        outer,
        inner
    );
}

function createAxisSegmentBox(
    data,
    axisCoordinate,
    crossCoordinate,
    interval
) {
    const box = {
        minX: 0,
        maxX: 0,
        minY: 0,
        maxY: 0,
        minZ: 0,
        maxZ: 0
    };

    box[`min${data.axis.toUpperCase()}`] =
        axisCoordinate;
    box[`max${data.axis.toUpperCase()}`] =
        axisCoordinate;
    box[`min${data.crossAxis.toUpperCase()}`] =
        crossCoordinate;
    box[`max${data.crossAxis.toUpperCase()}`] =
        crossCoordinate;
    box[`min${data.depthAxis.toUpperCase()}`] =
        interval.min;
    box[`max${data.depthAxis.toUpperCase()}`] =
        interval.max;

    return box;
}

function* axisShapeGenerator(
    dimension,
    pos1,
    pos2,
    action,
    destination,
    progress,
    region
) {
    const parts =
        action.split("_");
    const isRing =
        parts[0] === "ring";
    const filled =
        parts[0] === "filled";
    const kind = isRing
        ? "ring"
        : parts[1];
    const axisName = isRing
        ? parts[1]
        : parts[2];
    const positive =
        parts[3] !== "negative";
    const data =
        getAxisShapeData(
            pos1,
            pos2,
            axisName
        );
    const axisBounds =
        getAxisBounds(
            data,
            data.axis
        );
    const crossBounds =
        getAxisBounds(
            data,
            data.crossAxis
        );
    const depthBounds =
        getAxisBounds(
            data,
            data.depthAxis
        );
    const minAxis =
        Math.max(
            axisBounds.min,
            region[`min${data.axis.toUpperCase()}`]
        );
    const maxAxis =
        Math.min(
            axisBounds.max,
            region[`max${data.axis.toUpperCase()}`]
        );
    const minCross =
        Math.max(
            crossBounds.min,
            region[`min${data.crossAxis.toUpperCase()}`]
        );
    const maxCross =
        Math.min(
            crossBounds.max,
            region[`max${data.crossAxis.toUpperCase()}`]
        );
    const minDepth =
        Math.max(
            depthBounds.min,
            region[`min${data.depthAxis.toUpperCase()}`]
        );
    const maxDepth =
        Math.min(
            depthBounds.max,
            region[`max${data.depthAxis.toUpperCase()}`]
        );
    let processed = 0;

    if (
        minAxis > maxAxis ||
        minCross > maxCross ||
        minDepth > maxDepth
    ) {
        return;
    }

    for (
        let axisCoordinate = minAxis;
        axisCoordinate <= maxAxis;
        axisCoordinate++
    ) {
        for (
            let crossCoordinate = minCross;
            crossCoordinate <= maxCross;
            crossCoordinate++
        ) {
            const intervals =
                getAxisShapeSegments(
                    data,
                    kind,
                    filled,
                    positive,
                    axisCoordinate,
                    crossCoordinate
                );

            for (const interval of intervals) {
                const start =
                    Math.max(
                        interval.min,
                        minDepth
                    );
                const end =
                    Math.min(
                        interval.max,
                        maxDepth
                    );

                if (start > end) {
                    continue;
                }

                let runStart =
                    start;
                const startLocation =
                    getCoordinate(
                        data,
                        data.depthAxis,
                        runStart,
                        axisCoordinate,
                        crossCoordinate
                    );
                let runBlock =
                    isPalette(destination)
                        ? pickPaletteBlock(
                            destination,
                            startLocation.x,
                            startLocation.y,
                            startLocation.z
                        )
                        : destination.blocks[0];

                for (
                    let depthCoordinate = start;
                    depthCoordinate <= end;
                    depthCoordinate++
                ) {
                    const location =
                        getCoordinate(
                            data,
                            data.depthAxis,
                            depthCoordinate,
                            axisCoordinate,
                            crossCoordinate
                        );
                    const blockId =
                        isPalette(destination)
                            ? pickPaletteBlock(
                                destination,
                                location.x,
                                location.y,
                                location.z
                            )
                            : runBlock;

                    if (blockId !== runBlock) {
                        fillAxisPaletteRun(
                            dimension,
                            data,
                            axisCoordinate,
                            crossCoordinate,
                            runStart,
                            depthCoordinate - 1,
                            runBlock,
                            progress
                        );
                        runStart =
                            depthCoordinate;
                        runBlock =
                            blockId;
                    }

                    processed++;

                    if (
                        processed >=
                        (
                            isPalette(destination)
                                ? PALETTE_BLOCKS_PER_SLICE
                                : BLOCKS_PER_SLICE
                        )
                    ) {
                        processed = 0;
                        yield;
                    }
                }

                fillAxisPaletteRun(
                    dimension,
                    data,
                    axisCoordinate,
                    crossCoordinate,
                    runStart,
                    end,
                    runBlock,
                    progress
                );
            }

            if (++processed >= BLOCKS_PER_SLICE) {
                processed = 0;
                yield;
            }
        }
    }
}

function getCoordinate(
    data,
    depthAxis,
    depthCoordinate,
    axisCoordinate,
    crossCoordinate
) {
    const location = {
        x: 0,
        y: 0,
        z: 0
    };

    location[data.axis] =
        axisCoordinate;
    location[data.crossAxis] =
        crossCoordinate;
    location[depthAxis] =
        depthCoordinate;

    return location;
}

function fillAxisPaletteRun(
    dimension,
    data,
    axisCoordinate,
    crossCoordinate,
    start,
    end,
    blockId,
    progress
) {
    if (start > end) {
        return;
    }

    const box =
        createAxisSegmentBox(
            data,
            axisCoordinate,
            crossCoordinate,
            {
                min: start,
                max: end
            }
        );

    dimension.fillBlocks(
        createVolume(box),
        blockId
    );

    progress.placed +=
        end - start + 1;
}

// =========================================================
// BOX SHAPES
// =========================================================

function getOutlineBoxes(
    a,
    b
) {
    const q =
        boundsOf(
            a,
            b
        );

    const boxes = [];

    // Bottom
    boxes.push({
        minX: q.minX,
        maxX: q.maxX,

        minY: q.minY,
        maxY: q.minY,

        minZ: q.minZ,
        maxZ: q.maxZ
    });

    // Top
    if (
        q.maxY >
        q.minY
    ) {
        boxes.push({
            minX: q.minX,
            maxX: q.maxX,

            minY: q.maxY,
            maxY: q.maxY,

            minZ: q.minZ,
            maxZ: q.maxZ
        });
    }

    if (
        q.maxY -
        q.minY >
        1
    ) {
        const y0 =
            q.minY + 1;

        const y1 =
            q.maxY - 1;

        for (
            const x of
                new Set([
                    q.minX,
                    q.maxX
                ])
        ) {
            for (
                const z of
                    new Set([
                        q.minZ,
                        q.maxZ
                    ])
            ) {
                boxes.push({
                    minX: x,
                    maxX: x,

                    minY: y0,
                    maxY: y1,

                    minZ: z,
                    maxZ: z
                });
            }
        }

        if (
            q.maxZ -
            q.minZ >
            1
        ) {
            boxes.push(
                {
                    minX: q.minX,
                    maxX: q.minX,

                    minY: y0,
                    maxY: y1,

                    minZ:
                        q.minZ + 1,
                    maxZ:
                        q.maxZ - 1
                },

                {
                    minX: q.maxX,
                    maxX: q.maxX,

                    minY: y0,
                    maxY: y1,

                    minZ:
                        q.minZ + 1,
                    maxZ:
                        q.maxZ - 1
                }
            );
        }

        if (
            q.maxX -
            q.minX >
            1
        ) {
            boxes.push(
                {
                    minX:
                        q.minX + 1,
                    maxX:
                        q.maxX - 1,

                    minY: y0,
                    maxY: y1,

                    minZ: q.minZ,
                    maxZ: q.minZ
                },

                {
                    minX:
                        q.minX + 1,
                    maxX:
                        q.maxX - 1,

                    minY: y0,
                    maxY: y1,

                    minZ: q.maxZ,
                    maxZ: q.maxZ
                }
            );
        }
    }

    return boxes.filter(
        box =>
            box.minX <=
                box.maxX &&
            box.minY <=
                box.maxY &&
            box.minZ <=
                box.maxZ
    );
}

function getOutlineEdgeBoxes(
    a,
    b
) {
    const box =
        boundsOf(
            a,
            b
        );
    const boxes = [];
    const xBounds = [
        ...new Set([
            box.minX,
            box.maxX
        ])
    ];
    const yBounds = [
        ...new Set([
            box.minY,
            box.maxY
        ])
    ];
    const zBounds = [
        ...new Set([
            box.minZ,
            box.maxZ
        ])
    ];

    for (const y of yBounds) {
        for (const z of zBounds) {
            boxes.push({
                minX: box.minX,
                maxX: box.maxX,
                minY: y,
                maxY: y,
                minZ: z,
                maxZ: z
            });
        }
    }

    if (box.maxY - box.minY > 1) {
        for (const x of xBounds) {
            for (const z of zBounds) {
                boxes.push({
                    minX: x,
                    maxX: x,
                    minY: box.minY + 1,
                    maxY: box.maxY - 1,
                    minZ: z,
                    maxZ: z
                });
            }
        }
    }

    if (box.maxZ - box.minZ > 1) {
        for (const x of xBounds) {
            for (const y of yBounds) {
                boxes.push({
                    minX: x,
                    maxX: x,
                    minY: y,
                    maxY: y,
                    minZ: box.minZ + 1,
                    maxZ: box.maxZ - 1
                });
            }
        }
    }

    return boxes;
}

function clipBoxesToRegion(
    boxes,
    region
) {
    return boxes
        .map(box => ({
            minX: Math.max(box.minX, region.minX),
            maxX: Math.min(box.maxX, region.maxX),
            minY: Math.max(box.minY, region.minY),
            maxY: Math.min(box.maxY, region.maxY),
            minZ: Math.max(box.minZ, region.minZ),
            maxZ: Math.min(box.maxZ, region.maxZ)
        }))
        .filter(box =>
            box.minX <= box.maxX &&
            box.minY <= box.maxY &&
            box.minZ <= box.maxZ
        );
}

function getHollowBoxBoxes(
    a,
    b
) {
    const q =
        boundsOf(
            a,
            b
        );

    const boxes = [];

    // Bottom
    boxes.push({
        ...q,
        maxY: q.minY
    });

    // Top
    if (
        q.maxY >
        q.minY
    ) {
        boxes.push({
            ...q,
            minY: q.maxY
        });
    }

    if (
        q.maxY -
        q.minY >
        1
    ) {
        const y0 =
            q.minY + 1;

        const y1 =
            q.maxY - 1;

        // Left
        boxes.push({
            minX: q.minX,
            maxX: q.minX,

            minY: y0,
            maxY: y1,

            minZ: q.minZ,
            maxZ: q.maxZ
        });

        // Right
        if (
            q.maxX >
            q.minX
        ) {
            boxes.push({
                minX: q.maxX,
                maxX: q.maxX,

                minY: y0,
                maxY: y1,

                minZ: q.minZ,
                maxZ: q.maxZ
            });
        }

        // Front / Back
        if (
            q.maxZ -
                q.minZ >
                1 &&
            q.maxX -
                q.minX >
                1
        ) {
            boxes.push(
                {
                    minX:
                        q.minX + 1,
                    maxX:
                        q.maxX - 1,

                    minY: y0,
                    maxY: y1,

                    minZ: q.minZ,
                    maxZ: q.minZ
                },

                {
                    minX:
                        q.minX + 1,
                    maxX:
                        q.maxX - 1,

                    minY: y0,
                    maxY: y1,

                    minZ: q.maxZ,
                    maxZ: q.maxZ
                }
            );
        }
    }

    return boxes;
}

// =========================================================
// BOX GENERATOR
// =========================================================

function* boxesGenerator(
    dimension,
    boxes,
    destination,
    progress
) {
    for (
        const box of boxes
    ) {
        if (
            isPalette(
                destination
            )
        ) {
            yield*
                paletteCuboidGenerator(
                    dimension,
                    box,
                    destination,
                    progress
                );
        }

        else {
            progress.placed +=
                fillVolumeSafe(
                    dimension,
                    box,
                    destination
                        .blocks[0]
                );
        }

        yield;
    }
}

// =========================================================
// REGION SPLITTING
// =========================================================

function getRegions(
    box,
    dimension
) {
    const manager =
        world.tickingAreaManager;

    for (
        const chunkSize of
            TICKING_REGION_CHUNK_SIZES
    ) {
        const regions =
            createRegionsForChunkSize(
                box,
                chunkSize
            );
        const requiredChunkCount =
            regions
                .map(regionChunkCount)
                .sort(
                    (a, b) =>
                        b - a
                )
                .slice(
                    0,
                    Math.min(
                        2,
                        regions.length
                    )
                )
                .reduce(
                    (total, count) =>
                        total + count,
                    0
                );

        if (
            manager &&
            manager.maxChunkCount -
                manager.chunkCount >=
                requiredChunkCount &&
            regions.every(
                region =>
                    manager.hasCapacity({
                        dimension,

                        from: {
                            x: region.minX,
                            y: region.minY,
                            z: region.minZ
                        },

                        to: {
                            x: region.maxX,
                            y: region.maxY,
                            z: region.maxZ
                        }
                    })
            )
        ) {
            return regions;
        }
    }

    return createRegionsForChunkSize(
        box,
        TICKING_REGION_CHUNK_SIZES[
            TICKING_REGION_CHUNK_SIZES.length - 1
        ]
    );
}

function regionChunkCount(region) {
    const minChunkX =
        Math.floor(
            region.minX / BLOCKS_PER_CHUNK
        );
    const maxChunkX =
        Math.floor(
            region.maxX / BLOCKS_PER_CHUNK
        );
    const minChunkZ =
        Math.floor(
            region.minZ / BLOCKS_PER_CHUNK
        );
    const maxChunkZ =
        Math.floor(
            region.maxZ / BLOCKS_PER_CHUNK
        );

    return (
        (maxChunkX - minChunkX + 1) *
        (maxChunkZ - minChunkZ + 1)
    );
}

function createRegionsForChunkSize(
    box,
    chunkSize
) {
    const regions = [];
    const chunkSpan =
        chunkSize * BLOCKS_PER_CHUNK;
    const minChunkX =
        Math.floor(
            box.minX / BLOCKS_PER_CHUNK
        );
    const maxChunkX =
        Math.floor(
            box.maxX / BLOCKS_PER_CHUNK
        );
    const minChunkZ =
        Math.floor(
            box.minZ / BLOCKS_PER_CHUNK
        );
    const maxChunkZ =
        Math.floor(
            box.maxZ / BLOCKS_PER_CHUNK
        );
    const firstRegionChunkX =
        Math.floor(
            minChunkX / chunkSize
        ) * chunkSize;
    const firstRegionChunkZ =
        Math.floor(
            minChunkZ / chunkSize
        ) * chunkSize;

    for (
        let regionChunkZ =
            firstRegionChunkZ;

        regionChunkZ <= maxChunkZ;

        regionChunkZ += chunkSize
    ) {
        const regionMinZ =
            regionChunkZ * BLOCKS_PER_CHUNK;
        const regionMaxZ =
            regionMinZ + chunkSpan - 1;

        for (
            let regionChunkX =
                firstRegionChunkX;

            regionChunkX <= maxChunkX;

            regionChunkX += chunkSize
        ) {
            const regionMinX =
                regionChunkX * BLOCKS_PER_CHUNK;
            const regionMaxX =
                regionMinX + chunkSpan - 1;

            regions.push({
                minX:
                    Math.max(
                        box.minX,
                        regionMinX
                    ),
                maxX:
                    Math.min(
                        box.maxX,
                        regionMaxX
                    ),

                minY: box.minY,
                maxY: box.maxY,

                minZ:
                    Math.max(
                        box.minZ,
                        regionMinZ
                    ),
                maxZ:
                    Math.min(
                        box.maxZ,
                        regionMaxZ
                    )
            });
        }
    }

    return regions;
}

// =========================================================
// TICKING AREA IDENTIFIER
// =========================================================

let tickingAreaCounter = 0;

function createTickingAreaId() {
    tickingAreaCounter++;

    return (
        `voxen_replace_${Date.now()}_${tickingAreaCounter}`
    );
}

// =========================================================
// TICKING AREA
// =========================================================

function getTickingAreaOptions(
    dimension,
    region
) {
    return {
        dimension,

        from: {
            x: region.minX,
            y: region.minY,
            z: region.minZ
        },

        to: {
            x: region.maxX,
            y: region.maxY,
            z: region.maxZ
        }
    };
}

function canLoadRegion(
    dimension,
    region
) {
    const manager =
        world.tickingAreaManager;

    return Boolean(
        manager &&
        manager.hasCapacity(
            getTickingAreaOptions(
                dimension,
                region
            )
        )
    );
}

async function loadRegion(
    dimension,
    region
) {
    const manager =
        world.tickingAreaManager;

    if (!manager) {
        throw new Error(
            "TickingAreaManager is not available."
        );
    }

    const identifier =
        createTickingAreaId();

    const options =
        getTickingAreaOptions(
            dimension,
            region
        );

    if (
        !manager.hasCapacity(
            options
        )
    ) {
        throw new Error(
            "There is not enough ticking-area capacity for this region."
        );
    }

    await manager.createTickingArea(
        identifier,
        options
    );

    return identifier;
}

// =========================================================
// UNLOAD TICKING AREA
// =========================================================

function unloadRegion(
    identifier
) {
    if (!identifier) {
        return;
    }

    const manager =
        world.tickingAreaManager;

    if (!manager) {
        return;
    }

    try {
        if (
            manager.hasTickingArea(
                identifier
            )
        ) {
            manager.removeTickingArea(
                identifier
            );
        }
    }

    catch (error) {
        console.warn(
            "[voxen:replace] Failed to remove temporary ticking area:",
            error
        );
    }
}

// =========================================================
// GENERATOR EXECUTION
// =========================================================

function runGeneratorAndWait(
    generator,
    tickingAreaId
) {
    return new Promise(
        (
            resolve,
            reject
        ) => {
            let finished =
                false;

            const finish = (
                callback,
                value
            ) => {
                if (
                    finished
                ) {
                    return;
                }

                finished =
                    true;

                unloadRegion(
                    tickingAreaId
                );

                callback(
                    value
                );
            };

            system.runJob(
                (function* () {
                    try {
                        yield* generator;

                        finish(
                            resolve
                        );
                    }

                    catch (
                        error
                    ) {
                        finish(
                            reject,
                            error
                        );
                    }
                })()
            );
        }
    );
}

// =========================================================
// REGION OPERATION
// =========================================================

async function processRegions(
    player,
    dimension,
    regions,
    generatorFactory,
    progress,
    destination,
    mode
) {
    try {
        let activeTickingAreaId;

        for (
            let index = 0;

            index <
            regions.length;

            index++
        ) {
            const region =
                regions[index];

            if (!activeTickingAreaId) {
                sendMessage(
                    player,
                    "voxen.message.loading_region",
                    [
                        index + 1,
                        regions.length
                    ]
                );

                activeTickingAreaId =
                    await loadRegion(
                        dimension,
                        region
                    );
            }

            let nextRegionLoad;

            if (
                index + 1 < regions.length &&
                canLoadRegion(
                    dimension,
                    regions[index + 1]
                )
            ) {
                nextRegionLoad =
                    loadRegion(
                        dimension,
                        regions[index + 1]
                    ).then(
                        identifier => ({
                            identifier
                        }),
                        error => ({
                            error
                        })
                    );
            }

            try {
                const generator =
                    generatorFactory(
                        region
                    );

                await runGeneratorAndWait(
                    generator,
                    activeTickingAreaId
                );
            }

            catch (
                error
            ) {
                unloadRegion(
                    activeTickingAreaId
                );

                if (nextRegionLoad) {
                    const next =
                        await nextRegionLoad;

                    unloadRegion(
                        next.identifier
                    );
                }

                throw error;
            }

            activeTickingAreaId =
                undefined;

            if (nextRegionLoad) {
                const next =
                    await nextRegionLoad;

                if (next.error) {
                    throw next.error;
                }

                activeTickingAreaId =
                    next.identifier;
            }
        }

        sendCompleted(
            player,
            progress.placed,
            destination,
            mode
        );
    }

    catch (
        error
    ) {
        console.warn(
            "[voxen:replace] Operation failed:",
            error
        );

        sendMessage(
            player,

            "voxen.message.operation_interrupted"
        );
    }
}

// =========================================================
// COMPLETION
// =========================================================

function sendCompleted(
    player,
    count,
    destination,
    mode
) {
    const name =
        getDisplayName(
            destination
        );

    const formatted =
        Number(
            count
        ).toLocaleString(
            "en-US"
        );

    const messageKeys = {
        in: "voxen.message.replaced",
        fill: "voxen.message.filled",
        outline_box: "voxen.message.outline_created",
        hollow_box: "voxen.message.hollow_box_created",
        filled_sphere: "voxen.message.filled_sphere_created",
        hollow_sphere: "voxen.message.hollow_sphere_created"
    };
    const shapeMessageKey =
        `voxen.message.${mode}_created`;

    sendMessage(
        player,
        messageKeys[mode] ??
            (
                SHAPE_ACTIONS.includes(mode)
                    ? shapeMessageKey
                    : messageKeys.fill
            ),
        SHAPE_ACTIONS.includes(mode)
            ? [
                {
                    translate:
                        `voxen.shape.${mode}`
                },
                formatted,
                name
            ]
            : [
                formatted,
                name
            ]
    );
}

// =========================================================
// VALIDATION
// =========================================================

function validateSelection(
    player,
    selection
) {
    if (
        !selection?.pos1 ||
        !selection?.pos2
    ) {
        sendMessage(
            player,
            "voxen.message.selection_required"
        );

        return false;
    }

    if (
        selection.dimensionId &&
        selection.dimensionId !==
            player.dimension.id
    ) {
        sendMessage(
            player,
            "voxen.message.selection_wrong_dimension"
        );

        return false;
    }

    const data =
        getSphereData(
            selection.pos1,
            selection.pos2
        );

    if (
        !validateShape(
            data
        )
    ) {
        sendMessage(
            player,
            "voxen.message.selection_size_limit",
            [
                MAX_SHAPE_DIAMETER
            ]
        );

        return false;
    }

    return true;
}

// =========================================================
// COMMON COMMAND EXECUTION
// =========================================================

function executeReplace(
    player,
    destination,
    action,
    source
) {
    action =
        normalizeShapeAction(
            action
        );

    const selection =
        getSelection(
            player.id
        );

    if (
        !validateSelection(
            player,
            selection
        )
    ) {
        return {
            status:
                CustomCommandStatus.Failure
        };
    }

    const {
        pos1,
        pos2
    } = selection;

    const dimension =
        player.dimension;

    const box =
        boundsOf(
            pos1,
            pos2
        );

    // =====================================================
    // SOURCE VALIDATION
    // =====================================================

    if (
        source !==
            undefined &&
        action !== "in"
    ) {
        sendMessage(
            player,
            "voxen.message.source_only_for_replace"
        );

        return {
            status:
                CustomCommandStatus.Failure
        };
    }

    // =====================================================
    // REPLACE ONLY MATCHING SOURCE
    // =====================================================

    if (
        action === "in"
    ) {
        if (
            source ===
                undefined
        ) {
            sendMessage(
                player,
                "voxen.message.replace_source_usage"
            );

            return {
                status:
                    CustomCommandStatus.Failure
            };
        }

        const sourceId =
            getBlockId(
                source
            );

        if (!sourceId) {
            sendMessage(
                player,
                "voxen.message.source_not_found"
            );

            return {
                status:
                    CustomCommandStatus.Failure
            };
        }

        const progress = {
            placed: 0
        };

        const regions =
            getRegions(
                box,
                dimension
            );

        void processRegions(
            player,
            dimension,
            regions,

            region =>
                replaceGenerator(
                    dimension,
                    region,
                    destination,
                    sourceId,
                    progress
                ),

            progress,
            destination,
            "in"
        );

        return {
            status:
                CustomCommandStatus.Success
        };
    }

    // =====================================================
    // NORMAL FILL
    // =====================================================

    if (
        !action
    ) {
        const progress = {
            placed: 0
        };

        const regions =
            getRegions(
                box,
                dimension
            );

        void processRegions(
            player,
            dimension,
            regions,

            region => {
                if (
                    isPalette(
                        destination
                    )
                ) {
                    return paletteCuboidGenerator(
                        dimension,
                        region,
                        destination,
                        progress
                    );
                }

                return (
                    function* () {
                        progress.placed +=
                            fillVolumeSafe(
                                dimension,
                                region,
                                destination
                                    .blocks[0]
                            );

                        yield;
                    }
                )();
            },

            progress,
            destination,
            "fill"
        );

        return {
            status:
                CustomCommandStatus.Success
        };
    }

    // =====================================================
    // OUTLINE BOX
    // =====================================================

    if (
        action ===
        "outline_box"
    ) {
        const edgeBoxes =
            getOutlineEdgeBoxes(
                pos1,
                pos2
            );

        const progress = {
            placed: 0
        };

        const regions =
            getRegions(
                box,
                dimension
            );

        void processRegions(
            player,
            dimension,
            regions,

            region =>
                boxesGenerator(
                    dimension,

                    clipBoxesToRegion(
                        edgeBoxes,
                        region
                    ),

                    destination,
                    progress
                ),

            progress,
            destination,
            action
        );

        return {
            status:
                CustomCommandStatus.Success
        };
    }

    // =====================================================
    // HOLLOW BOX
    // =====================================================

    if (
        action ===
        "hollow_box"
    ) {
        const shellBoxes =
            getHollowBoxBoxes(
                pos1,
                pos2
            );

        const progress = {
            placed: 0
        };

        const regions =
            getRegions(
                box,
                dimension
            );

        void processRegions(
            player,
            dimension,
            regions,

            region =>
                boxesGenerator(
                    dimension,

                    clipBoxesToRegion(
                        shellBoxes,
                        region
                    ),

                    destination,
                    progress
                ),

            progress,
            destination,
            action
        );

        return {
            status:
                CustomCommandStatus.Success
        };
    }

    // =====================================================
    // FILLED / HOLLOW SPHERE
    // =====================================================

    if (
        action ===
            "filled_sphere" ||
        action ===
            "hollow_sphere"
    ) {
        const data =
            getSphereData(
                pos1,
                pos2
            );

        if (
            !validateShape(
                data
            )
        ) {
            sendMessage(
                player,
                "voxen.message.selection_size_limit",
                [
                    MAX_SHAPE_DIAMETER
                ]
            );

            return {
                status:
                    CustomCommandStatus.Failure
            };
        }

        const progress = {
            placed: 0
        };

        const regions =
            getRegions(
                box,
                dimension
            );

        void processRegions(
            player,
            dimension,
            regions,

            region =>
                sphereGenerator(
                    dimension,

                    pos1,
                    pos2,

                    action ===
                        "hollow_sphere",

                    destination,

                    progress,

                    region
                ),

            progress,
            destination,
            action
        );

        return {
            status:
                CustomCommandStatus.Success
        };
    }

    if (
        SHAPE_ACTIONS.includes(
            action
        )
    ) {
        const progress = {
            placed: 0
        };
        const regions =
            getRegions(
                box,
                dimension
            );

        void processRegions(
            player,
            dimension,
            regions,

            region =>
                axisShapeGenerator(
                    dimension,
                    pos1,
                    pos2,
                    action,
                    destination,
                    progress,
                    region
                ),

            progress,
            destination,
            action
        );

        return {
            status:
                CustomCommandStatus.Success
        };
    }

    // =====================================================
    // INVALID ACTION
    // =====================================================

    sendMessage(
        player,
        "voxen.message.replace_usage"
    );

    return {
        status:
            CustomCommandStatus.Failure
    };
}

// =========================================================
// BLOCK COMMAND
// =========================================================

function replaceBlockCommand(
    origin,
    ...args
) {
    const player =
        origin.sourceEntity;

    if (
        !player ||
        player.typeId !==
            "minecraft:player"
    ) {
        return {
            status:
                CustomCommandStatus.Failure
        };
    }

    const destinationArg =
        args[0];

    const action =
        args[1];

    const source =
        args[2];

    const destination =
        resolveBlock(
            destinationArg
        );

    if (!destination) {
        sendMessage(
            player,
            "voxen.message.invalid_destination"
        );

        return {
            status:
                CustomCommandStatus.Failure
        };
    }

    // Custom command callbacks use restricted execution.
    // Defer world-changing operations.
    system.run(
        () => {
            try {
                executeReplace(
                    player,
                    destination,
                    action,
                    source
                );
            }

            catch (
                error
            ) {
                console.warn(
                    "[voxen:replace] Deferred operation failed:",
                    error
                );

                sendMessage(
                    player,
                    "voxen.message.operation_failed"
                );
            }
        }
    );

    return {
        status:
            CustomCommandStatus.Success
    };
}

// =========================================================
// PALETTE COMMAND
// =========================================================

function replacePaletteCommand(
    origin,
    ...args
) {
    const player =
        origin.sourceEntity;

    if (
        !player ||
        player.typeId !==
            "minecraft:player"
    ) {
        return {
            status:
                CustomCommandStatus.Failure
        };
    }

    const paletteName =
        args[0];

    const action =
        args[1];

    const source =
        args[2];

    const destination =
        resolvePalette(
            paletteName
        );

    if (!destination) {
        sendMessage(
            player,
            "voxen.message.palette_not_found",
            [
                paletteName ?? ""
            ]
        );

        return {
            status:
                CustomCommandStatus.Failure
        };
    }

    system.run(
        () => {
            try {
                executeReplace(
                    player,
                    destination,
                    action,
                    source
                );
            }

            catch (
                error
            ) {
                console.warn(
                    "[voxen:replacepalette] Deferred operation failed:",
                    error
                );

                sendMessage(
                    player,
                    "voxen.message.operation_failed"
                );
            }
        }
    );

    return {
        status:
            CustomCommandStatus.Success
    };
}

// =========================================================
// COMMAND REGISTRATION
// =========================================================

export function registerReplaceCommand(
    registry
) {
    const ACTION_ENUM =
        "voxen:replace_action";

    registry.registerEnum(
        ACTION_ENUM,
        [
            "in",
            "outline_box",
            "hollow_box",
            "filled_sphere",
            "hollow_sphere",
            ...LEGACY_ACTIONS,
            ...SHAPE_ACTIONS
        ]
    );

    // =====================================================
    // /voxen:replace
    // =====================================================

    registry.registerCommand(
        {
            name:
                "voxen:replace",

            description:
                "Fills, replaces, or creates shapes using a block.",

            permissionLevel:
                CommandPermissionLevel.Any,

            cheatsRequired:
                false,

            mandatoryParameters: [
                {
                    name:
                        "destination",

                    type:
                        CustomCommandParamType.BlockType
                }
            ],

            optionalParameters: [
                {
                    name:
                        ACTION_ENUM,

                    type:
                        CustomCommandParamType.Enum
                },

                {
                    name:
                        "source",

                    type:
                        CustomCommandParamType.BlockType
                }
            ]
        },

        replaceBlockCommand
    );

    // =====================================================
    // /voxen:replacepalette
    // =====================================================

    registry.registerCommand(
        {
            name:
                "voxen:replacepalette",

            description:
                "Fills, replaces, or creates shapes using a Complementary palette.",

            permissionLevel:
                CommandPermissionLevel.Any,

            cheatsRequired:
                false,

            mandatoryParameters: [
                {
                    name:
                        "palette",

                    type:
                        CustomCommandParamType.String
                }
            ],

            optionalParameters: [
                {
                    name:
                        ACTION_ENUM,

                    type:
                        CustomCommandParamType.Enum
                },

                {
                    name:
                        "source",

                    type:
                        CustomCommandParamType.BlockType
                }
            ]
        },

        replacePaletteCommand
    );
}