import {system, CommandPermissionLevel, CustomCommandStatus} from "@minecraft/server";
import {clearSelection} from "../selection/selectionManager.js";
import {sendLocalizedMessage} from "../utils/localization.js";


// =========================================================
// REGISTRA /voxen:clearselection E /voxen:clearselecion
// =========================================================

export function registerClearSelectionCommand() {

    system.beforeEvents.startup.subscribe((init) => {

        const registry =
            init.customCommandRegistry;

        const clearCommand = (origin) => {
            const player = origin.sourceEntity;

            if (!player || player.typeId !== "minecraft:player") {
                return {
                    status: CustomCommandStatus.Failure
                };
            }

            clearSelection(player.id);
            sendLocalizedMessage(
                player,
                "voxen.message.selection_cleared"
            );

            return {
                status: CustomCommandStatus.Success
            };
        };

        for (const name of [
            "voxen:clearselection",
            "voxen:clearselecion"
        ]) {
            registry.registerCommand(
                {
                    name,
                    description: "Clears the selection.",
                    permissionLevel: CommandPermissionLevel.Any,
                    cheatsRequired: false
                },
                clearCommand
            );
        }

    });

}