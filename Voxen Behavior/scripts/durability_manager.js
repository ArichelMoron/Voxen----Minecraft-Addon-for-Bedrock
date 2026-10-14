import { world, system, EntityDamageCause, EquipmentSlot, GameMode, ItemComponentTypes, EntityComponentTypes } from '@minecraft/server';

class DurabilityManager {
    #customComponentName = 'item:has_durability';
    #coarseList = ['minecraft:dirt', 'minecraft:mycelium', 'minecraft:podzol', 'minecraft:dirt_with_roots', 'minecraft:coarse_dirt'];
    #toolsId = ['minecraft:is_sword', 'minecraft:is_axe', 'minecraft:is_hoe', 'minecraft:is_pickaxe', 'minecraft:is_shovel', 'minecraft:is_tool'];

    static #IGNORABLE_DAMAGE_CAUSES = Object.freeze([
        EntityDamageCause.drowning, EntityDamageCause.fall, EntityDamageCause.flyIntoWall,
        EntityDamageCause.freezing, EntityDamageCause.magic, EntityDamageCause.override,
        EntityDamageCause.starve, EntityDamageCause.suffocation, EntityDamageCause.suicide,
        EntityDamageCause.temperature, EntityDamageCause.void, EntityDamageCause.wither
    ]);

    constructor() {
        this.#register();
    };

    #register() {
        system.beforeEvents.startup.subscribe(initEvent => {
            initEvent.itemComponentRegistry.registerCustomComponent(this.#customComponentName, {
                onMineBlock: ({ source: player, itemStack: item }) => {
                    const durability = item.getComponent(ItemComponentTypes.Durability);

                    if (!durability || this.#activateUnbreaking(item, durability)) return;

                    const tags = item.getTags();
                    this.#reduceDurability(player, item, durability, tags.some(tag => this.#toolsId.includes(tag)));
                },
                onBeforeDurabilityDamage: e => {
                    if (!e.itemStack.hasTag('minecraft:is_sword')) return;
                    e.durabilityDamage--;
                },
                onUseOn: e => {
                    if (e.itemStack.hasTag('minecraft:is_shovel')) {
                        if (!this.#coarseList.includes(e.block.typeId) || e.block.above().typeId !== 'minecraft:air') return;

                        this.#coarseBlock(e.block)
                    }
                }
            });
        });

        system.run(() => {
            world.beforeEvents.playerInteractWithBlock.subscribe(e => this.#handleToolUseOn(e));
        });

        system.run(() => {
            world.afterEvents.entityHurt.subscribe(e => this.#handleArmorDurability(e));
        });
    }

    async #handleToolUseOn(event) {
        const { player, itemStack: item, block } = event;
        if (!item || !item.hasComponent(this.#customComponentName)) return;

        const tags = block.getTags();
        const typeId = block.typeId;

        if (item.hasTag('minecraft:is_axe')) {
            system.runTimeout(() => {
                this.#onStripLog(player, item, block, typeId)
            }, 1)
        }
        else if (item.hasTag('minecraft:is_hoe')) {
            system.runTimeout(() => {
                this.#onTillDirt(player, item, block, typeId, tags)
            }, 1)
        }
        else if (item.hasTag('minecraft:is_shovel')) {
            this.#onCoarseDirt(player, item, block);
        }
    }

    #onStripLog(player, item, afterBlock, beforeTypeId) {
        if (beforeTypeId.includes('stripped') || !afterBlock.typeId.includes('stripped')) return;

        let materialSound = '';
        if (beforeTypeId === 'minecraft:cherry_log') materialSound = 'step.cherry_wood';
        else if (beforeTypeId.includes('log')) materialSound = 'use.wood';
        else if (beforeTypeId.includes('stem')) materialSound = 'use.stem';
        else if (beforeTypeId.includes('bamboo')) materialSound = 'step.bamboo_wood';

        if (!materialSound) return;

        player.dimension.playSound(materialSound, afterBlock.center(), { volume: 1, pitch: 0.8 });

        const durability = item.getComponent(ItemComponentTypes.Durability);
        if (!durability || this.#activateUnbreaking(item, durability)) return;

        this.#reduceDurability(player, item, durability, false);
    }

    #onTillDirt(player, item, block, typeId, tags) {
        const isTillable = tags.includes('grass') || typeId === 'minecraft:dirt_with_roots';
        const hasBlockAbove = block.above().typeId !== 'minecraft:air';
        if (!isTillable || hasBlockAbove) return;

        player.dimension.playSound('use.gravel', block.center(), { volume: 1, pitch: 0.8 });

        const durability = item.getComponent(ItemComponentTypes.Durability);
        if (!durability || this.#activateUnbreaking(item, durability)) return;

        this.#reduceDurability(player, item, durability, false);
    }

    #onCoarseDirt(player, item, block) {
        const isCoarsable = this.#coarseList.includes(block.typeId) || block.typeId === 'minecraft:grass_block';
        const hasBlockAbove = block.above().typeId !== 'minecraft:air';

        if (!isCoarsable || hasBlockAbove) return;

        system.run(() => {
            player.dimension.playSound('use.grass', block.center(), { volume: 1, pitch: 0.8 });

            const durability = item.getComponent(ItemComponentTypes.Durability);
            if (!durability || this.#activateUnbreaking(item, durability)) return;

            this.#reduceDurability(player, item, durability, false);
        })
    }

    async #coarseBlock(block) {
        block.setType('minecraft:grass_path');
    }

    #getOriginalDamage(armorPoints, toughness, finalDamage) {
        const A = Number(armorPoints);
        const T = Number(toughness);
        const Df = Number(finalDamage);

        if (Df < 0 || T === undefined || Number.isNaN(A) || Number.isNaN(T) || Number.isNaN(Df)) {
            return 0;
        }

        const m1 = (4 / 5) * A;
        const CAP = 80;

        if (m1 >= CAP) {
            return Df / 0.2;
        }

        const m2 = D => 4 * A - (16 * D) / (T + 8);

        const denom1 = 1 - m1 / 100;
        if (Math.abs(denom1) > 1e-12) {
            const D_candidate1 = Df / denom1;
            if (D_candidate1 > 0) {
                const m2_at_D1 = m2(D_candidate1);
                if (m2_at_D1 <= m1 + 1e-9) return D_candidate1;
            }
        }

        const alpha = (4 * A) / 100;
        const beta = 16 / (100 * (T + 8));
        const a = beta;
        const b = 1 - alpha;
        const c = -Df;

        if (Math.abs(a) < 1e-12) {
            if (Math.abs(b) > 1e-12) {
                const D_lin = -c / b;
                if (D_lin > 0) {
                    const Rm2 = m2(D_lin);
                    if (Rm2 >= m1 - 1e-9 && Rm2 < CAP - 1e-9) return D_lin;
                }
            }
        } else {
            const disc = b * b - 4 * a * c;
            if (disc >= 0) {
                const s = Math.sqrt(disc);
                const r1 = (-b + s) / (2 * a);
                const r2 = (-b - s) / (2 * a);
                const candidates = [r1, r2].filter(x => x > 0 && Number.isFinite(x));
                for (const Dcand of candidates) {
                    const Rm2 = m2(Dcand);
                    if (Rm2 >= m1 - 1e-9 && Rm2 < CAP - 1e-9) {
                        return Dcand;
                    }
                }
            }
        }

        const threshold_m2_ge_cap = (T + 8) * (4 * A - CAP) / 16;
        if (!Number.isNaN(threshold_m2_ge_cap)) {
            const D_from_cap = Df / 0.2;
            if (D_from_cap > 0 && D_from_cap <= threshold_m2_ge_cap + 1e-9) {
                return D_from_cap;
            }
        }

        return 0;
    }


    #handleArmorDurability(event) {
        if (event.hurtEntity.typeId !== 'minecraft:player' || DurabilityManager.#IGNORABLE_DAMAGE_CAUSES.includes(event.damageSource.cause)) {
            return;
        }

        const player = event.hurtEntity;
        const damage = event.damage;
        const armor = player.getComponent(EntityComponentTypes.Equippable);
        const originalDamage = Math.floor(this.#getOriginalDamage(armor.totalArmor, armor.totalToughness, damage));

        if (!armor) return;

        const equipmentSlots = [EquipmentSlot.Head, EquipmentSlot.Chest, EquipmentSlot.Legs, EquipmentSlot.Feet];
        for (const slot of equipmentSlots) {
            const equipment = armor.getEquipment(slot);
            if (!equipment || !equipment?.hasComponent(this.#customComponentName)) continue;
            const enchantable = equipment.getComponent(ItemComponentTypes.Enchantable);
            const durability = equipment.getComponent(ItemComponentTypes.Durability);

            if (!durability || !enchantable?.hasEnchantment('unbreaking')) continue;

            const unbreakingLv = enchantable.getEnchantment('unbreaking').level;
            const ignoreChance = (60 + (40 / (unbreakingLv + 1))) / 100;
            if (Math.random() < ignoreChance) continue;

            const damageToRestore = Math.max(1, Math.floor(originalDamage / 4));
            durability.damage = Math.max(0, durability.damage - damageToRestore);
            armor.setEquipment(slot, equipment);
        }
    }

    #reduceDurability(player, item, durability, doubleDamage) {
        if (player.getGameMode() == GameMode.Creative) return;

        const mainhand = player.getComponent(EntityComponentTypes.Equippable)?.getEquipmentSlot(EquipmentSlot.Mainhand);
        if (!mainhand) return;

        const damageToApply = 1 + (doubleDamage ? 1 : 0);

        if (durability.damage + damageToApply >= durability.maxDurability) {
            mainhand.setItem(undefined);
            player.dimension.playSound('random.break', player.location, { volume: 1.0, pitch: 0.9 });
        } else {
            durability.damage += damageToApply;
            mainhand.setItem(item);
        }
    }

    #activateUnbreaking(item, durability) {
        if (!durability) return false;

        const enchantable = item.getComponent(ItemComponentTypes.Enchantable);
        if (!enchantable?.hasEnchantment('unbreaking')) return false;

        const unbreakingLevel = enchantable.getEnchantment("unbreaking").level;
        const damageChance = 1 / (unbreakingLevel + 1);

        return Math.random() > damageChance;
    }
}

new DurabilityManager();