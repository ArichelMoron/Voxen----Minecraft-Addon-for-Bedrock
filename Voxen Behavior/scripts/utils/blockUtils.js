// =========================================================
// OBTÉM O ID DE UM BLOCKTYPE
// =========================================================

export function getBlockId(blockType) {

    if (!blockType)
        return undefined;


    // -----------------------------------------------------
    // BlockType do Minecraft
    // -----------------------------------------------------

    if (
        typeof blockType === "object" &&
        typeof blockType.id === "string"
    ) {

        return blockType.id;

    }


    // -----------------------------------------------------
    // String
    // -----------------------------------------------------

    if (
        typeof blockType === "string"
    ) {

        return blockType;

    }


    return undefined;
}