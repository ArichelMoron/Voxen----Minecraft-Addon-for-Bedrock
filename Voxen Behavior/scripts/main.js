import {
    system
} from "@minecraft/server";

import { registerReplaceCommand } from "./commands/replace.js";
import { registerSelectionSystem } from "./selection/selectionManager.js";
import { registerClearSelectionCommand } from "./commands/clearselection.js";
import { registerComplementaryCommands } from "./commands/complementary.js";
// import { registerStrcCommand } from "./commands/strc.js";


// =========================================================
// INICIALIZAÇÃO DO SISTEMA DE SELEÇÃO
// =========================================================

registerClearSelectionCommand();

registerSelectionSystem();


// =========================================================
// REGISTRO DOS COMANDOS CUSTOM
// =========================================================

system.beforeEvents.startup.subscribe(({ customCommandRegistry }) => {

    registerReplaceCommand(customCommandRegistry);

    registerComplementaryCommands(customCommandRegistry);

    // registerStrcCommand(customCommandRegistry);

});