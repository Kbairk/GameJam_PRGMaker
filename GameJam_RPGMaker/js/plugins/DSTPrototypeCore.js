/*:
 * @target MZ
 * @plugindesc Survival/action prototype systems: object debug panel, outline, HUD inventory, held items, simple combat
 * @author Spacefok
 * @help
 * Controls on the map:
 * W A S D - movement
 * Arrows  - movement
 * E     - interact / pick up highlighted object
 * F     - attack in front of the player
 * Q     - open or close the object debug panel
 * 1..5  - equip visible HUD slot into hands
 * R     - clear hands
 *
 * Event note/comment tags:
 * <dstName: Wooden Door>
 * <dstType: door>
 * <dstInteractable: true>
 * <dstHighlightRange: 1.8>
 * <dstInteractRange: 1.3>
 * <dstElevation: 0>
 * <dstShadowScale: 0.7>
 * <dstShadowOpacity: 160>
 *
 * Pickup object:
 * <dstPickupType: item>
 * <dstPickupItemId: 1>
 * <dstPickupCount: 1>
 * <dstPickupTo: inventory>
 * or
 * <dstPickupTo: hands>
 *
 * Enemy object:
 * <dstType: enemy>
 * <dstEnemyHp: 45>
 * <dstEnemyDamage: 8>
 * <dstEnemyChaseRange: 5>
 * <dstEnemyAttackRange: 1.1>
 * <dstEnemyAttackCooldown: 45>
 * <dstEnemyWander: false>
 *
 * Editable runtime params in the Q panel:
 * <dstParam: openness|number|0|0|1|0.1|Open>
 * <dstParam: locked|boolean|false||||Locked>
 * <dstParam: state|select|closed||||State|closed,open,broken>
 * <dstParam: material|string|oak||||Material>
 *
 * Optional item note tags for held items:
 * <dstPower: 16>
 * <dstReach: 1.6>
 * <dstHoldOffsetX: 18>
 * <dstHoldOffsetY: -18>
 */

(() => {
    "use strict";

    const DEFAULT_HIGHLIGHT_RANGE = 1.8;
    const DEFAULT_INTERACT_RANGE = 1.35;
    const DEFAULT_ATTACK_RANGE = 1.3;
    const DEFAULT_ATTACK_POWER = 8;
    const INVENTORY_HUD_SLOTS = 5;
    const OUTLINE_OFFSETS = [
        [-2, 0],
        [2, 0],
        [0, -2],
        [0, 2],
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1]
    ];

    Input.keyMapper[65] = "left";
    Input.keyMapper[68] = "right";
    Input.keyMapper[69] = "dstInteract";
    Input.keyMapper[70] = "dstAttack";
    Input.keyMapper[82] = "dstRelease";
    Input.keyMapper[83] = "down";
    Input.keyMapper[87] = "up";
    Input.keyMapper[49] = "dstSlot1";
    Input.keyMapper[50] = "dstSlot2";
    Input.keyMapper[51] = "dstSlot3";
    Input.keyMapper[52] = "dstSlot4";
    Input.keyMapper[53] = "dstSlot5";

    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const isWorldPaused = () => {
        const debugOpen = typeof $gameTemp !== "undefined" && $gameTemp && $gameTemp.dstIsDebugPanelOpen && $gameTemp.dstIsDebugPanelOpen();
        const messageBusy = typeof $gameMessage !== "undefined" && $gameMessage && $gameMessage.isBusy && $gameMessage.isBusy();
        return !!debugOpen || !!messageBusy;
    };

    function toNumber(value, fallback = 0) {
        const number = Number(value);
        return Number.isFinite(number) ? number : fallback;
    }

    function toText(value) {
        return value == null ? "" : String(value).trim();
    }

    function toBool(value, fallback = false) {
        if (value == null || value === "") {
            return fallback;
        }
        const text = String(value).trim().toLowerCase();
        if (["true", "1", "yes", "y", "on"].includes(text)) {
            return true;
        }
        if (["false", "0", "no", "n", "off"].includes(text)) {
            return false;
        }
        return fallback;
    }

    function formatValue(value) {
        if (typeof value === "number") {
            return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
        }
        if (typeof value === "boolean") {
            return value ? "true" : "false";
        }
        return toText(value);
    }

    function readSingleTag(text, tagName) {
        const regex = new RegExp(`<${tagName}(?::\\s*([^>]+))?>`, "i");
        const match = regex.exec(text || "");
        return match ? toText(match[1]) : "";
    }

    function readMultiTag(text, tagName) {
        const regex = new RegExp(`<${tagName}:\\s*([^>]+)>`, "gi");
        const values = [];
        let match = null;
        while ((match = regex.exec(text || ""))) {
            values.push(toText(match[1]));
        }
        return values;
    }

    function commentTextFromPage(page) {
        if (!page || !page.list) {
            return "";
        }
        const lines = [];
        for (const command of page.list) {
            if (command.code === 108 || command.code === 408) {
                lines.push(toText(command.parameters[0]));
            }
        }
        return lines.join("\n");
    }

    function configTextForEvent(gameEvent) {
        const eventData = gameEvent.event ? gameEvent.event() : null;
        const page = gameEvent.page ? gameEvent.page() : null;
        return [eventData?.note || "", commentTextFromPage(page)].filter(Boolean).join("\n");
    }

    function normalizeKind(kind) {
        const text = toText(kind).toLowerCase();
        return ["item", "weapon", "armor"].includes(text) ? text : "item";
    }

    function inventoryKey(kind, id) {
        return `${kind}:${id}`;
    }

    function databaseForKind(kind) {
        switch (kind) {
            case "weapon":
                return $dataWeapons;
            case "armor":
                return $dataArmors;
            default:
                return $dataItems;
        }
    }

    function databaseObject(kind, id) {
        return databaseForKind(kind)?.[id] || null;
    }

    function objectNoteValue(dataObject, tagName, fallback = "") {
        const text = dataObject?.note || "";
        const value = readSingleTag(text, tagName);
        return value !== "" ? value : fallback;
    }

    function showPrototypeMessage(lines) {
        const messageLines = (Array.isArray(lines) ? lines : [lines]).map(toText).filter(Boolean);
        if (!$gameMessage || !messageLines.length) {
            return;
        }
        $gameMessage.setBackground(0);
        $gameMessage.setPositionType(2);
        for (const line of messageLines) {
            $gameMessage.add(line);
        }
    }

    function parseParamSpec(rawText) {
        const parts = rawText.split("|").map(part => toText(part));
        while (parts.length < 8) {
            parts.push("");
        }
        const [key, typeRaw, defaultRaw, minRaw, maxRaw, stepRaw, labelRaw, optionsRaw] = parts;
        if (!key) {
            return null;
        }
        const type = ["number", "boolean", "string", "select"].includes(typeRaw.toLowerCase())
            ? typeRaw.toLowerCase()
            : "string";
        const options = optionsRaw
            ? optionsRaw.split(",").map(value => toText(value)).filter(Boolean)
            : [];
        const spec = {
            key,
            type,
            label: labelRaw || key,
            min: minRaw !== "" ? toNumber(minRaw, 0) : null,
            max: maxRaw !== "" ? toNumber(maxRaw, 0) : null,
            step: stepRaw !== "" ? toNumber(stepRaw, 1) : type === "number" ? 1 : null,
            options
        };
        spec.defaultValue = normalizeParamValue(spec, defaultRaw);
        return spec;
    }

    function normalizeParamValue(spec, value) {
        switch (spec.type) {
            case "number": {
                let number = toNumber(value, toNumber(spec.defaultValue, 0));
                if (spec.min != null) {
                    number = Math.max(number, spec.min);
                }
                if (spec.max != null) {
                    number = Math.min(number, spec.max);
                }
                return number;
            }
            case "boolean":
                return toBool(value, toBool(spec.defaultValue, false));
            case "select": {
                const text = toText(value);
                if (spec.options.length === 0) {
                    return text;
                }
                if (text && spec.options.includes(text)) {
                    return text;
                }
                return spec.options[0];
            }
            default:
                return toText(value || spec.defaultValue);
        }
    }

    function adjustParamValue(spec, currentValue, direction) {
        switch (spec.type) {
            case "number":
                return normalizeParamValue(spec, toNumber(currentValue, 0) + (spec.step || 1) * direction);
            case "boolean":
                return !toBool(currentValue, false);
            case "select": {
                if (!spec.options.length) {
                    return currentValue;
                }
                const currentIndex = Math.max(0, spec.options.indexOf(currentValue));
                const nextIndex = (currentIndex + direction + spec.options.length) % spec.options.length;
                return spec.options[nextIndex];
            }
            default:
                return currentValue;
        }
    }

    function parseEventConfig(gameEvent) {
        const eventData = gameEvent.event ? gameEvent.event() : null;
        const rawText = configTextForEvent(gameEvent);
        const hasConfig = /<dst/i.test(rawText);
        const pickupItemId = toNumber(readSingleTag(rawText, "dstPickupItemId"), 0);
        const enemyByType = toText(readSingleTag(rawText, "dstType")).toLowerCase() === "enemy";
        const enemyEnabled =
            enemyByType ||
            readSingleTag(rawText, "dstEnemyHp") !== "" ||
            toBool(readSingleTag(rawText, "dstEnemy"), false);
        const type = toText(readSingleTag(rawText, "dstType")).toLowerCase() || (enemyEnabled ? "enemy" : pickupItemId > 0 ? "pickup" : "object");
        const interactableTag = readSingleTag(rawText, "dstInteractable");
        const interactable = hasConfig ? (interactableTag === "" ? true : toBool(interactableTag, true)) : false;
        const paramSpecs = readMultiTag(rawText, "dstParam").map(parseParamSpec).filter(Boolean);
        return {
            enabled: hasConfig,
            name: readSingleTag(rawText, "dstName") || eventData?.name || `Event ${gameEvent.eventId()}`,
            type,
            interactable,
            highlightRange: Math.max(0.5, toNumber(readSingleTag(rawText, "dstHighlightRange"), DEFAULT_HIGHLIGHT_RANGE)),
            interactRange: Math.max(0.5, toNumber(readSingleTag(rawText, "dstInteractRange"), DEFAULT_INTERACT_RANGE)),
            elevation: toNumber(readSingleTag(rawText, "dstElevation"), 0),
            shadowScale: Math.max(0.2, toNumber(readSingleTag(rawText, "dstShadowScale"), type === "enemy" ? 0.75 : 0.55)),
            shadowOpacity: clamp(toNumber(readSingleTag(rawText, "dstShadowOpacity"), 160), 0, 255),
            pickup: {
                enabled: pickupItemId > 0,
                kind: normalizeKind(readSingleTag(rawText, "dstPickupType")),
                itemId: pickupItemId,
                count: Math.max(1, toNumber(readSingleTag(rawText, "dstPickupCount"), 1)),
                to: toText(readSingleTag(rawText, "dstPickupTo")).toLowerCase() === "hands" ? "hands" : "inventory"
            },
            enemy: {
                enabled: enemyEnabled,
                hp: Math.max(1, toNumber(readSingleTag(rawText, "dstEnemyHp"), 30)),
                damage: Math.max(1, toNumber(readSingleTag(rawText, "dstEnemyDamage"), 5)),
                chaseRange: Math.max(1, toNumber(readSingleTag(rawText, "dstEnemyChaseRange"), 6)),
                attackRange: Math.max(0.8, toNumber(readSingleTag(rawText, "dstEnemyAttackRange"), 1.05)),
                attackCooldown: Math.max(12, toNumber(readSingleTag(rawText, "dstEnemyAttackCooldown"), 45)),
                wander: toBool(readSingleTag(rawText, "dstEnemyWander"), false)
            },
            params: paramSpecs
        };
    }

    function drawPanelRect(bitmap, x, y, width, height, fillColor, accentColor) {
        bitmap.fillRect(x, y, width, height, fillColor);
        bitmap.fillRect(x, y, width, 2, accentColor);
        bitmap.fillRect(x, y + height - 2, width, 2, accentColor);
    }

    function visibleInventoryEntries() {
        return $gameSystem.dstInventory().filter(entry => entry.count > 0);
    }

    const _Game_Temp_initialize = Game_Temp.prototype.initialize;
    Game_Temp.prototype.initialize = function() {
        _Game_Temp_initialize.call(this);
        this._dstDebugPanelOpen = false;
    };

    Game_Temp.prototype.dstSetDebugPanelOpen = function(open) {
        this._dstDebugPanelOpen = !!open;
    };

    Game_Temp.prototype.dstIsDebugPanelOpen = function() {
        return !!this._dstDebugPanelOpen;
    };

    const _Game_System_initialize = Game_System.prototype.initialize;
    Game_System.prototype.initialize = function() {
        _Game_System_initialize.call(this);
        this.dstInitPrototypeState();
    };

    Game_System.prototype.dstInitPrototypeState = function() {
        this._dstPrototypeState = {
            inventory: [],
            heldKey: "",
            objects: {}
        };
    };

    Game_System.prototype.dstPrototypeState = function() {
        if (!this._dstPrototypeState) {
            this.dstInitPrototypeState();
        }
        return this._dstPrototypeState;
    };

    Game_System.prototype.dstObjectState = function(mapId, eventId) {
        const state = this.dstPrototypeState();
        state.objects[mapId] = state.objects[mapId] || {};
        state.objects[mapId][eventId] = state.objects[mapId][eventId] || {
            params: {},
            hp: null,
            picked: false,
            lastEnemyAttackFrame: 0,
            hitFlashFrames: 0
        };
        return state.objects[mapId][eventId];
    };

    Game_System.prototype.dstInventory = function() {
        return this.dstPrototypeState().inventory;
    };

    Game_System.prototype.dstFindInventoryEntry = function(kind, id) {
        return this.dstInventory().find(entry => entry.kind === kind && entry.id === id);
    };

    Game_System.prototype.dstGainInventory = function(kind, id, count) {
        const normalizedKind = normalizeKind(kind);
        if (!databaseObject(normalizedKind, id) || count <= 0) {
            return null;
        }
        let entry = this.dstFindInventoryEntry(normalizedKind, id);
        if (!entry) {
            entry = {
                key: inventoryKey(normalizedKind, id),
                kind: normalizedKind,
                id,
                count: 0
            };
            this.dstInventory().push(entry);
        }
        entry.count += count;
        return entry;
    };

    Game_System.prototype.dstLoseInventory = function(kind, id, count) {
        const entry = this.dstFindInventoryEntry(normalizeKind(kind), id);
        if (!entry) {
            return;
        }
        entry.count = Math.max(0, entry.count - count);
        this._dstPrototypeState.inventory = this.dstInventory().filter(item => item.count > 0);
        this.dstValidateHeldItem();
    };

    Game_System.prototype.dstHeldKey = function() {
        return this.dstPrototypeState().heldKey || "";
    };

    Game_System.prototype.dstSetHeldKey = function(key) {
        this.dstPrototypeState().heldKey = key || "";
        this.dstValidateHeldItem();
    };

    Game_System.prototype.dstValidateHeldItem = function() {
        const heldKey = this.dstHeldKey();
        if (!heldKey) {
            return;
        }
        const valid = this.dstInventory().some(entry => entry.key === heldKey && entry.count > 0);
        if (!valid) {
            this.dstPrototypeState().heldKey = "";
        }
    };

    Game_System.prototype.dstHeldEntry = function() {
        const heldKey = this.dstHeldKey();
        return this.dstInventory().find(entry => entry.key === heldKey) || null;
    };

    Game_System.prototype.dstVisibleSlots = function(maxSlots = INVENTORY_HUD_SLOTS) {
        return visibleInventoryEntries().slice(0, maxSlots);
    };

    Game_CharacterBase.prototype.dstElevationPixels = function() {
        return 0;
    };

    const _Game_Player_initMembers = Game_Player.prototype.initMembers;
    Game_Player.prototype.initMembers = function() {
        _Game_Player_initMembers.call(this);
        this._dstAttackCooldownUntil = 0;
        this._dstDamageCooldownUntil = 0;
    };

    const _Game_Player_canMove = Game_Player.prototype.canMove;
    Game_Player.prototype.canMove = function() {
        if (isWorldPaused()) {
            return false;
        }
        return _Game_Player_canMove.call(this);
    };

    Game_Player.prototype.dstFacingVector = function() {
        switch (this.direction()) {
            case 4:
                return { x: -1, y: 0 };
            case 6:
                return { x: 1, y: 0 };
            case 8:
                return { x: 0, y: -1 };
            default:
                return { x: 0, y: 1 };
        }
    };

    Game_Player.prototype.dstHeldItemData = function() {
        const entry = $gameSystem.dstHeldEntry();
        return entry ? databaseObject(entry.kind, entry.id) : null;
    };

    Game_Player.prototype.dstAttackPower = function() {
        const item = this.dstHeldItemData();
        return Math.max(1, toNumber(objectNoteValue(item, "dstPower", DEFAULT_ATTACK_POWER), DEFAULT_ATTACK_POWER));
    };

    Game_Player.prototype.dstAttackRange = function() {
        const item = this.dstHeldItemData();
        return Math.max(0.8, toNumber(objectNoteValue(item, "dstReach", DEFAULT_ATTACK_RANGE), DEFAULT_ATTACK_RANGE));
    };

    Game_Player.prototype.dstHeldOffsetX = function() {
        const item = this.dstHeldItemData();
        return toNumber(objectNoteValue(item, "dstHoldOffsetX", 18), 18);
    };

    Game_Player.prototype.dstHeldOffsetY = function() {
        const item = this.dstHeldItemData();
        return toNumber(objectNoteValue(item, "dstHoldOffsetY", -18), -18);
    };

    Game_Player.prototype.dstHeldToolType = function() {
        const item = this.dstHeldItemData();
        const explicitTool = toText(objectNoteValue(item, "dstTool")).toLowerCase();
        if (explicitTool) {
            return explicitTool;
        }
        const itemName = toText(item?.name).toLowerCase();
        if (itemName.includes("axe")) {
            return "axe";
        }
        return "";
    };

    Game_Player.prototype.dstTryAttack = function() {
        if (!this.canMove() || Graphics.frameCount < this._dstAttackCooldownUntil) {
            return false;
        }
        const targets = $gameMap
            .events()
            .filter(event => event.dstCanReceivePlayerAttack())
            .filter(event => this.dstCanHitEvent(event, this.dstAttackRange()))
            .sort((a, b) => a.dstDistanceToPlayer() - b.dstDistanceToPlayer());
        this._dstAttackCooldownUntil = Graphics.frameCount + (targets.length > 0 ? 20 : 12);
        SoundManager.playOk();
        if (targets.length === 0) {
            return false;
        }
        const damage = this.dstAttackPower();
        let hitSomething = false;
        for (const target of targets.slice(0, 2)) {
            hitSomething = target.dstReceivePlayerAttack(damage) || hitSomething;
        }
        return hitSomething;
    };

    Game_Player.prototype.dstCanHitEvent = function(gameEvent, range) {
        const dx = gameEvent._realX - this._realX;
        const dy = gameEvent._realY - this._realY;
        const distance = Math.hypot(dx, dy);
        if (distance > range + 0.2) {
            return false;
        }
        const facing = this.dstFacingVector();
        const forward = dx * facing.x + dy * facing.y;
        const lateral = Math.abs(dx * facing.y - dy * facing.x);
        return forward >= -0.1 && forward <= range + 0.25 && lateral <= 0.95;
    };

    Game_Player.prototype.dstTakeDamage = function(amount) {
        if (Graphics.frameCount < this._dstDamageCooldownUntil) {
            return false;
        }
        const actor = $gameParty.leader();
        if (!actor) {
            return false;
        }
        actor.gainHp(-Math.max(1, amount));
        this._dstDamageCooldownUntil = Graphics.frameCount + 45;
        $gameTemp.requestBalloon(this, 2);
        $gameScreen.startFlash([255, 120, 120, 96], 12);
        return true;
    };

    const _Game_Event_initialize = Game_Event.prototype.initialize;
    Game_Event.prototype.initialize = function(mapId, eventId) {
        _Game_Event_initialize.call(this, mapId, eventId);
        this.dstRefreshPrototypeConfig();
    };

    const _Game_Event_refresh = Game_Event.prototype.refresh;
    Game_Event.prototype.refresh = function() {
        if (this.dstRuntimeState().picked) {
            this._erased = true;
        }
        _Game_Event_refresh.call(this);
        this.dstRefreshPrototypeConfig();
    };

    const _Game_Event_update = Game_Event.prototype.update;
    Game_Event.prototype.update = function() {
        this.dstApplyVisualState();
        if (isWorldPaused()) {
            return;
        }
        _Game_Event_update.call(this);
        const state = this.dstRuntimeState();
        if (state.hitFlashFrames > 0) {
            state.hitFlashFrames--;
        }
    };

    const _Game_Event_updateSelfMovement = Game_Event.prototype.updateSelfMovement;
    Game_Event.prototype.updateSelfMovement = function() {
        if (this.dstIsAliveEnemy()) {
            this.dstUpdateEnemyMovement(_Game_Event_updateSelfMovement);
        } else {
            _Game_Event_updateSelfMovement.call(this);
        }
    };

    Game_Event.prototype.dstRefreshPrototypeConfig = function() {
        this._dstPrototypeConfig = parseEventConfig(this);
        const config = this._dstPrototypeConfig;
        const state = this.dstRuntimeState();
        for (const spec of config.params) {
            if (!(spec.key in state.params)) {
                state.params[spec.key] = normalizeParamValue(spec, spec.defaultValue);
            }
        }
        if (config.enemy.enabled && state.hp == null) {
            state.hp = config.enemy.hp;
        }
        this.dstApplyVisualState();
    };

    Game_Event.prototype.dstConfig = function() {
        if (!this._dstPrototypeConfig) {
            this.dstRefreshPrototypeConfig();
        }
        return this._dstPrototypeConfig;
    };

    Game_Event.prototype.dstRuntimeState = function() {
        return $gameSystem.dstObjectState(this._mapId, this._eventId);
    };

    Game_Event.prototype.dstElevationPixels = function() {
        return this.dstConfig().elevation;
    };

    Game_Event.prototype.dstDistanceToPlayer = function() {
        return Math.hypot(this._realX - $gamePlayer._realX, this._realY - $gamePlayer._realY);
    };

    Game_Event.prototype.dstIsConfigured = function() {
        return this.dstConfig().enabled && !this._erased;
    };

    Game_Event.prototype.dstIsInteractable = function() {
        const config = this.dstConfig();
        return config.enabled && config.interactable && !this._erased;
    };

    Game_Event.prototype.dstIsAliveEnemy = function() {
        const config = this.dstConfig();
        const hp = this.dstRuntimeState().hp;
        return config.enemy.enabled && !this._erased && hp != null && hp > 0;
    };

    Game_Event.prototype.dstParamSpecs = function() {
        return this.dstConfig().params;
    };

    Game_Event.prototype.dstParamValue = function(key) {
        return this.dstRuntimeState().params[key];
    };

    Game_Event.prototype.dstHasParam = function(key) {
        return this.dstParamSpecs().some(item => item.key === key);
    };

    Game_Event.prototype.dstSetParamValue = function(key, value) {
        const spec = this.dstParamSpecs().find(item => item.key === key);
        if (!spec) {
            return;
        }
        this.dstRuntimeState().params[key] = normalizeParamValue(spec, value);
        this.dstApplyVisualState();
    };

    Game_Event.prototype.dstApplyVisualState = function() {
        if (!this._dstPrototypeConfig || this._erased) {
            return;
        }
        switch (this.dstConfig().type) {
            case "door":
                this.dstApplyDoorVisualState();
                break;
            case "chest":
                this.dstApplyChestVisualState();
                break;
            case "tree":
                this.dstApplyTreeVisualState();
                break;
        }
    };

    Game_Event.prototype.dstApplyDoorVisualState = function() {
        const openness = clamp(toNumber(this.dstParamValue("openness"), 0), 0, 1);
        const pattern = openness >= 0.66 ? 2 : openness >= 0.33 ? 1 : 0;
        this.setPattern(pattern);
        this.setThrough(openness >= 0.95);
    };

    Game_Event.prototype.dstApplyChestVisualState = function() {
        const state = toText(this.dstParamValue("state")).toLowerCase() || (toBool(this.dstParamValue("opened"), false) ? "open" : "closed");
        const pattern = state === "open" ? 2 : state === "broken" ? 1 : 0;
        this.setPattern(pattern);
        this.setThrough(false);
    };

    Game_Event.prototype.dstApplyTreeVisualState = function() {
        const growth = toText(this.dstParamValue("growth")).toLowerCase();
        const hp = toNumber(this.dstParamValue("hp"), 0);
        const resourceAmount = toNumber(this.dstParamValue("resourceAmount"), 0);
        let pattern = 1;
        if (growth === "sapling" || resourceAmount <= 0 || hp <= 0) {
            pattern = 2;
        } else if (growth === "young") {
            pattern = 0;
        }
        this.setPattern(pattern);
        this.setThrough(false);
    };

    Game_Event.prototype.dstCanReceivePlayerAttack = function() {
        if (this.dstIsAliveEnemy()) {
            return true;
        }
        if (this._erased || !this.dstIsConfigured()) {
            return false;
        }
        return ["tree", "prop"].includes(this.dstConfig().type);
    };

    Game_Event.prototype.dstReceivePlayerAttack = function(amount) {
        if (this.dstIsAliveEnemy()) {
            this.dstTakeDamage(amount);
            return true;
        }
        switch (this.dstConfig().type) {
            case "tree":
                return this.dstTakeTreeDamage(amount);
            case "prop":
                return this.dstHitProp();
            default:
                return false;
        }
    };

    Game_Event.prototype.dstHitProp = function() {
        $gameTemp.requestBalloon(this, 1);
        return true;
    };

    Game_Event.prototype.dstTakeTreeDamage = function(amount) {
        if ($gamePlayer.dstHeldToolType() !== "axe") {
            SoundManager.playBuzzer();
            return false;
        }
        const currentHp = Math.max(0, toNumber(this.dstParamValue("hp"), 0));
        const currentResources = Math.max(0, toNumber(this.dstParamValue("resourceAmount"), 0));
        if (currentHp <= 0 || currentResources <= 0) {
            SoundManager.playBuzzer();
            return false;
        }
        const chopDamage = Math.max(1, Math.round(Math.max(1, amount) / 8));
        const nextHp = Math.max(0, currentHp - chopDamage);
        this.dstSetParamValue("hp", nextHp);
        $gameTemp.requestBalloon(this, 1);
        if (nextHp > 0) {
            return true;
        }
        const rewardCount = currentResources;
        const reward = $gameSystem.dstGainInventory("item", 4, rewardCount);
        this.dstSetParamValue("resourceAmount", 0);
        this.dstSetParamValue("growth", "sapling");
        SoundManager.playOk();
        if (reward) {
            showPrototypeMessage([
                `${this.dstConfig().name} falls.`,
                `Collected Log x${rewardCount}.`
            ]);
        }
        return true;
    };

    Game_Event.prototype.dstTryBuiltinInteract = function() {
        switch (this.dstConfig().type) {
            case "door":
                return this.dstTryDoorInteract();
            case "chest":
                return this.dstTryChestInteract();
            case "tree":
                return this.dstTryTreeInteract();
            default:
                return false;
        }
    };

    Game_Event.prototype.dstTryDoorInteract = function() {
        const name = this.dstConfig().name;
        const state = toText(this.dstParamValue("state")).toLowerCase();
        if (state === "jammed") {
            SoundManager.playBuzzer();
            showPrototypeMessage(`${name} is jammed.`);
            return true;
        }
        if (toBool(this.dstParamValue("locked"), false)) {
            SoundManager.playBuzzer();
            showPrototypeMessage(`${name} is locked.`);
            return true;
        }
        const currentOpenness = clamp(toNumber(this.dstParamValue("openness"), 0), 0, 1);
        const nextOpenness = currentOpenness >= 0.5 ? 0 : 1;
        this.dstSetParamValue("openness", nextOpenness);
        SoundManager.playOk();
        showPrototypeMessage(nextOpenness > 0 ? `${name} opens.` : `${name} closes.`);
        return true;
    };

    Game_Event.prototype.dstChestRewardData = function() {
        const tier = clamp(toNumber(this.dstParamValue("lootTier"), 1), 1, 5);
        if (tier >= 4) {
            return { kind: "item", id: 4, count: tier - 1 };
        }
        if (tier === 3) {
            return { kind: "item", id: 2, count: 2 };
        }
        return { kind: "item", id: 5, count: tier };
    };

    Game_Event.prototype.dstTryChestInteract = function() {
        const name = this.dstConfig().name;
        const state = toText(this.dstParamValue("state")).toLowerCase() || "closed";
        if (state === "broken") {
            SoundManager.playBuzzer();
            showPrototypeMessage(`${name} is broken.`);
            return true;
        }
        if (state === "open" || toBool(this.dstParamValue("opened"), false)) {
            SoundManager.playOk();
            showPrototypeMessage(`${name} is empty.`);
            return true;
        }
        const reward = this.dstChestRewardData();
        const rewardEntry = $gameSystem.dstGainInventory(reward.kind, reward.id, reward.count);
        const rewardObject = databaseObject(reward.kind, reward.id);
        this.dstSetParamValue("opened", true);
        this.dstSetParamValue("state", "open");
        SoundManager.playOk();
        showPrototypeMessage([
            `${name} opens.`,
            rewardEntry ? `Found ${rewardObject?.name || "loot"} x${reward.count}.` : "It seems to be empty."
        ]);
        return true;
    };

    Game_Event.prototype.dstTryTreeInteract = function() {
        const name = this.dstConfig().name;
        const hp = Math.max(0, toNumber(this.dstParamValue("hp"), 0));
        const resourceAmount = Math.max(0, toNumber(this.dstParamValue("resourceAmount"), 0));
        const growth = toText(this.dstParamValue("growth")).toLowerCase() || "full";
        const toolHint = $gamePlayer.dstHeldToolType() === "axe"
            ? "Press F to chop it."
            : "Equip the Hand Axe, then press F to chop it.";
        SoundManager.playOk();
        showPrototypeMessage([
            `${name}: ${growth}.`,
            `HP ${hp}  Resources ${resourceAmount}.`,
            toolHint
        ]);
        return true;
    };

    Game_Event.prototype.dstTakeDamage = function(amount) {
        if (!this.dstIsAliveEnemy()) {
            return;
        }
        const state = this.dstRuntimeState();
        state.hp = Math.max(0, state.hp - Math.max(1, amount));
        state.hitFlashFrames = 12;
        $gameTemp.requestBalloon(this, 1);
        if (state.hp <= 0) {
            state.picked = true;
            this._erased = true;
            this.refresh();
        }
    };

    Game_Event.prototype.dstTryAttackPlayer = function() {
        if (!this.dstIsAliveEnemy()) {
            return false;
        }
        const config = this.dstConfig().enemy;
        const state = this.dstRuntimeState();
        if (this.dstDistanceToPlayer() > config.attackRange) {
            return false;
        }
        if (Graphics.frameCount < state.lastEnemyAttackFrame + config.attackCooldown) {
            return false;
        }
        if ($gamePlayer.dstTakeDamage(config.damage)) {
            state.lastEnemyAttackFrame = Graphics.frameCount;
            this.turnTowardPlayer();
            return true;
        }
        return false;
    };

    Game_Event.prototype.dstUpdateEnemyMovement = function(defaultMovement) {
        const config = this.dstConfig().enemy;
        if (!this.dstIsAliveEnemy()) {
            return;
        }
        const distance = this.dstDistanceToPlayer();
        if (distance <= config.chaseRange) {
            if (this._stopCount > this.stopCountThreshold()) {
                this.moveTowardCharacter($gamePlayer);
            }
        } else if (config.wander) {
            defaultMovement.call(this);
        }
    };

    Game_Event.prototype.dstTryPickup = function() {
        const config = this.dstConfig();
        if (!config.pickup.enabled || this._erased) {
            return false;
        }
        const entry = $gameSystem.dstGainInventory(config.pickup.kind, config.pickup.itemId, config.pickup.count);
        if (!entry) {
            SoundManager.playBuzzer();
            return false;
        }
        if (config.pickup.to === "hands") {
            $gameSystem.dstSetHeldKey(entry.key);
        }
        this.dstRuntimeState().picked = true;
        this._erased = true;
        this.refresh();
        SoundManager.playOk();
        return true;
    };

    class Sprite_DSTIcon extends Sprite {
        initialize() {
            super.initialize(ImageManager.loadSystem("IconSet"));
            this._iconIndex = -1;
            this.visible = false;
        }

        setIconIndex(iconIndex) {
            if (this._iconIndex === iconIndex) {
                return;
            }
            this._iconIndex = iconIndex;
            if (iconIndex == null || iconIndex < 0) {
                this.visible = false;
                return;
            }
            const iconWidth = ImageManager.iconWidth || 32;
            const iconHeight = ImageManager.iconHeight || 32;
            const sx = (iconIndex % 16) * iconWidth;
            const sy = Math.floor(iconIndex / 16) * iconHeight;
            this.setFrame(sx, sy, iconWidth, iconHeight);
            this.visible = true;
        }
    }

    class Sprite_DSTPrompt extends Sprite {
        initialize() {
            super.initialize(new Bitmap(260, 60));
            this.anchor.x = 0.5;
            this.anchor.y = 1;
            this._target = null;
            this.visible = false;
        }

        setTarget(target) {
            if (this._target === target) {
                return;
            }
            this._target = target;
            this.redraw();
        }

        update() {
            super.update();
            const blocked = $gameMessage.isBusy() || $gameTemp.dstIsDebugPanelOpen();
            if (blocked || !this._target || this._target._erased) {
                this.visible = false;
                return;
            }
            this.visible = true;
            this.x = this._target.screenX();
            this.y = this._target.screenY() - 58 - this._target.dstElevationPixels();
        }

        redraw() {
            const bitmap = this.bitmap;
            bitmap.clear();
            if (!this._target) {
                return;
            }
            const config = this._target.dstConfig();
            drawPanelRect(bitmap, 0, 0, bitmap.width, bitmap.height, "rgba(18,24,33,0.85)", "rgba(255,255,255,0.55)");
            bitmap.fontSize = 18;
            bitmap.textColor = "#ffffff";
            bitmap.drawText(config.name, 12, 6, bitmap.width - 24, 24, "left");
            bitmap.fontSize = 14;
            bitmap.textColor = "#dce6f5";
            const actionText = config.pickup.enabled ? "E pick up  |  Q debug" : "E interact  |  Q debug";
            bitmap.drawText(actionText, 12, 30, bitmap.width - 24, 20, "left");
        }
    }

    class Sprite_DSTHeldVisual extends Sprite {
        initialize() {
            super.initialize();
            this._icon = new Sprite_DSTIcon();
            this._icon.anchor.x = 0.5;
            this._icon.anchor.y = 1;
            this._label = new Sprite(new Bitmap(140, 24));
            this._label.anchor.x = 0.5;
            this._label.anchor.y = 1;
            this._label.y = -34;
            this.addChild(this._icon);
            this.addChild(this._label);
            this.visible = false;
            this._lastKey = "";
        }

        update() {
            super.update();
            if ($gameMessage.isBusy() || $gameTemp.dstIsDebugPanelOpen()) {
                this.visible = false;
                return;
            }
            const entry = $gameSystem.dstHeldEntry();
            if (!entry) {
                this.visible = false;
                this._lastKey = "";
                return;
            }
            const item = databaseObject(entry.kind, entry.id);
            this.visible = !!item;
            if (!item) {
                return;
            }
            this.x = $gamePlayer.screenX() + $gamePlayer.dstHeldOffsetX();
            this.y = $gamePlayer.screenY() + $gamePlayer.dstHeldOffsetY();
            this._icon.setIconIndex(item.iconIndex);
            if (this._lastKey !== entry.key) {
                this._lastKey = entry.key;
                const bitmap = this._label.bitmap;
                bitmap.clear();
                bitmap.fontSize = 16;
                bitmap.textColor = "#ffffff";
                bitmap.drawText(item.name, 0, 0, bitmap.width, 20, "center");
            }
        }
    }

    class Sprite_DSTInventoryHud extends Sprite {
        initialize() {
            super.initialize(new Bitmap(560, 124));
            this.x = 20;
            this._lastStateKey = "";
            this._slotIcons = [];
            for (let i = 0; i < INVENTORY_HUD_SLOTS; i++) {
                const icon = new Sprite_DSTIcon();
                icon.x = 24 + i * 104;
                icon.y = 58;
                this._slotIcons.push(icon);
                this.addChild(icon);
            }
        }

        update() {
            super.update();
            this.visible = !$gameMessage.isBusy();
            if (!this.visible) {
                return;
            }
            this.y = Graphics.height - this.bitmap.height - 18;
            this.redrawIfNeeded();
        }

        redrawIfNeeded() {
            const leader = $gameParty.leader();
            const hp = leader ? `${leader.hp}/${leader.mhp}` : "--";
            const inventoryState = JSON.stringify({
                inventory: visibleInventoryEntries().map(entry => `${entry.key}:${entry.count}`),
                held: $gameSystem.dstHeldKey(),
                hp
            });
            if (inventoryState !== this._lastStateKey) {
                this._lastStateKey = inventoryState;
                this.redraw();
            }
        }

        redraw() {
            const bitmap = this.bitmap;
            bitmap.clear();
            drawPanelRect(bitmap, 0, 0, bitmap.width, bitmap.height, "rgba(12,16,22,0.86)", "rgba(255,255,255,0.45)");
            bitmap.fontSize = 18;
            bitmap.textColor = "#ffffff";
            bitmap.drawText("Inventory", 16, 8, 160, 24, "left");
            bitmap.fontSize = 14;
            bitmap.textColor = "#9ec5ff";
            bitmap.drawText("WASD move  E interact  F attack  Q debug", 16, 30, 360, 18, "left");
            bitmap.textColor = "#ffffff";
            const actor = $gameParty.leader();
            const hpText = actor ? `HP ${actor.hp}/${actor.mhp}` : "HP --";
            bitmap.drawText(hpText, bitmap.width - 130, 8, 110, 20, "right");

            const visibleEntries = $gameSystem.dstVisibleSlots(INVENTORY_HUD_SLOTS);
            const heldKey = $gameSystem.dstHeldKey();
            for (let i = 0; i < INVENTORY_HUD_SLOTS; i++) {
                const x = 16 + i * 104;
                const y = 54;
                const slotWidth = 96;
                const slotHeight = 54;
                const entry = visibleEntries[i];
                const active = entry && entry.key === heldKey;
                drawPanelRect(
                    bitmap,
                    x,
                    y,
                    slotWidth,
                    slotHeight,
                    active ? "rgba(42,78,128,0.95)" : "rgba(32,38,48,0.92)",
                    active ? "rgba(255,255,255,0.75)" : "rgba(255,255,255,0.25)"
                );
                bitmap.fontSize = 13;
                bitmap.textColor = "#ffffff";
                bitmap.drawText(String(i + 1), x + 6, y + 4, 18, 16, "left");
                if (entry) {
                    const item = databaseObject(entry.kind, entry.id);
                    this._slotIcons[i].setIconIndex(item?.iconIndex ?? -1);
                    this._slotIcons[i].x = x + 24;
                    this._slotIcons[i].y = y + 35;
                    bitmap.fontSize = 14;
                    bitmap.textColor = "#ffffff";
                    bitmap.drawText(item?.name || entry.key, x + 56, y + 10, 34, 18, "center");
                    bitmap.fontSize = 13;
                    bitmap.textColor = "#d7e6ff";
                    bitmap.drawText(`x${entry.count}`, x + 56, y + 28, 34, 16, "center");
                } else {
                    this._slotIcons[i].setIconIndex(-1);
                    bitmap.fontSize = 13;
                    bitmap.textColor = "#8d97a8";
                    bitmap.drawText("empty", x + 20, y + 18, 60, 18, "center");
                }
            }
        }
    }

    class Sprite_DSTDebugPanel extends Sprite {
        initialize() {
            super.initialize(new Bitmap(380, 308));
            this._target = null;
            this._selectedIndex = 0;
            this._lastStateKey = "";
            this.visible = false;
        }

        target() {
            return this._target;
        }

        isOpen() {
            return !!this._target;
        }

        open(target) {
            if (!target) {
                return;
            }
            this._target = target;
            this._selectedIndex = 0;
            this.visible = true;
            this._lastStateKey = "";
            $gameTemp.dstSetDebugPanelOpen(true);
            this.redraw();
        }

        close() {
            this._target = null;
            this.visible = false;
            this._selectedIndex = 0;
            this._lastStateKey = "";
            $gameTemp.dstSetDebugPanelOpen(false);
            this.bitmap.clear();
        }

        update() {
            super.update();
            if (!this._target) {
                return;
            }
            if (this._target._erased || this._target.dstDistanceToPlayer() > this._target.dstConfig().highlightRange + 0.6) {
                this.close();
                return;
            }
            this.updatePlacement();
            this.handleInput();
            if (!this._target) {
                return;
            }
            this.handleMouseInput();
            if (!this._target) {
                return;
            }
            this.redrawIfNeeded();
        }

        handleInput() {
            const specs = this._target.dstParamSpecs();
            if (!specs.length) {
                return;
            }
            if (Input.isTriggered("up")) {
                this._selectedIndex = (this._selectedIndex + specs.length - 1) % specs.length;
                SoundManager.playCursor();
                this.redraw();
            } else if (Input.isTriggered("down")) {
                this._selectedIndex = (this._selectedIndex + 1) % specs.length;
                SoundManager.playCursor();
                this.redraw();
            } else if (Input.isTriggered("left")) {
                this.adjustSelectedValue(-1);
            } else if (Input.isTriggered("right") || Input.isTriggered("ok")) {
                this.adjustSelectedValue(1);
            }
        }

        handleMouseInput() {
            if (!TouchInput.isTriggered()) {
                return;
            }
            const specs = this._target.dstParamSpecs();
            const localX = TouchInput.x - this.x;
            const localY = TouchInput.y - this.y;
            if (!this.isInsidePanel(localX, localY) || !specs.length) {
                return;
            }
            const rowIndex = this.rowIndexAt(localX, localY);
            if (rowIndex < 0) {
                return;
            }
            if (this._selectedIndex !== rowIndex) {
                this._selectedIndex = rowIndex;
                SoundManager.playCursor();
                this.redraw();
            }
            const spec = specs[rowIndex];
            const direction = this.mouseAdjustDirection(localX);
            if (spec && spec.type !== "string" && direction !== 0) {
                this.adjustSelectedValue(direction);
            }
        }

        isInsidePanel(localX, localY) {
            return localX >= 0 && localY >= 0 && localX < this.bitmap.width && localY < this.bitmap.height;
        }

        paramRowsTop() {
            if (!this._target) {
                return 84;
            }
            const config = this._target.dstConfig();
            let y = 84;
            if (config.enemy.enabled) {
                y += 22;
            }
            if (config.pickup.enabled) {
                y += 22;
            }
            return y;
        }

        rowRect(index) {
            return {
                x: 12,
                y: this.paramRowsTop() + index * 28,
                width: this.bitmap.width - 24,
                height: 24
            };
        }

        rowIndexAt(localX, localY) {
            const specs = this._target.dstParamSpecs();
            for (let i = 0; i < specs.length; i++) {
                const rect = this.rowRect(i);
                const insideX = localX >= rect.x && localX < rect.x + rect.width;
                const insideY = localY >= rect.y && localY < rect.y + rect.height;
                if (insideX && insideY) {
                    return i;
                }
            }
            return -1;
        }

        mouseAdjustDirection(localX) {
            const left = 240;
            const right = 360;
            if (localX < left || localX >= right) {
                return 0;
            }
            return localX < (left + right) / 2 ? -1 : 1;
        }

        adjustSelectedValue(direction) {
            const specs = this._target.dstParamSpecs();
            const spec = specs[this._selectedIndex];
            if (!spec || spec.type === "string") {
                SoundManager.playBuzzer();
                return;
            }
            const currentValue = this._target.dstParamValue(spec.key);
            const nextValue = adjustParamValue(spec, currentValue, direction);
            this._target.dstSetParamValue(spec.key, nextValue);
            SoundManager.playCursor();
            this.redraw();
        }

        updatePlacement() {
            const desiredX = this._target.screenX() + 36;
            const desiredY = this._target.screenY() - this.bitmap.height - 30;
            this.x = clamp(desiredX, 12, Graphics.width - this.bitmap.width - 12);
            this.y = clamp(desiredY, 12, Graphics.height - this.bitmap.height - 12);
        }

        redrawIfNeeded() {
            const state = this._target.dstRuntimeState();
            const specs = this._target.dstParamSpecs().map(spec => `${spec.key}:${formatValue(this._target.dstParamValue(spec.key))}`);
            const signature = JSON.stringify({
                eventId: this._target.eventId(),
                hp: state.hp,
                selectedIndex: this._selectedIndex,
                specs
            });
            if (signature !== this._lastStateKey) {
                this._lastStateKey = signature;
                this.redraw();
            }
        }

        redraw() {
            const bitmap = this.bitmap;
            bitmap.clear();
            if (!this._target) {
                return;
            }
            const config = this._target.dstConfig();
            const runtimeState = this._target.dstRuntimeState();
            drawPanelRect(bitmap, 0, 0, bitmap.width, bitmap.height, "rgba(14,18,25,0.95)", "rgba(255,255,255,0.55)");
            bitmap.fontSize = 20;
            bitmap.textColor = "#ffffff";
            bitmap.drawText("Debug", 14, 8, 80, 24, "left");
            bitmap.fontSize = 16;
            bitmap.textColor = "#dfe8ff";
            bitmap.drawText(config.name, 102, 10, bitmap.width - 116, 22, "left");
            bitmap.fontSize = 13;
            bitmap.textColor = "#91a0b8";
            bitmap.drawText(`Type: ${config.type}`, 14, 38, 170, 18, "left");
            bitmap.drawText(`Map ${this._target._mapId}  Event ${this._target.eventId()}`, 190, 38, bitmap.width - 204, 18, "right");
            bitmap.drawText("Q close  Click row/value or use arrows", 14, 58, bitmap.width - 28, 18, "left");

            let y = 84;
            if (config.enemy.enabled) {
                bitmap.fontSize = 14;
                bitmap.textColor = "#ffd7d7";
                bitmap.drawText(`Enemy HP: ${runtimeState.hp ?? config.enemy.hp}/${config.enemy.hp}`, 14, y, bitmap.width - 28, 18, "left");
                y += 22;
            }
            if (config.pickup.enabled) {
                const item = databaseObject(config.pickup.kind, config.pickup.itemId);
                bitmap.fontSize = 14;
                bitmap.textColor = "#d9f7d7";
                bitmap.drawText(`Pickup: ${item?.name || `${config.pickup.kind} ${config.pickup.itemId}`} x${config.pickup.count}`, 14, y, bitmap.width - 28, 18, "left");
                y += 22;
            }

            const specs = this._target.dstParamSpecs();
            if (!specs.length) {
                bitmap.fontSize = 16;
                bitmap.textColor = "#b5c0d1";
                bitmap.drawText("No custom params assigned yet.", 14, y + 18, bitmap.width - 28, 20, "left");
                bitmap.fontSize = 13;
                bitmap.textColor = "#7f8a9b";
                bitmap.drawText("Add <dstParam: ...> to the event note or comment.", 14, y + 44, bitmap.width - 28, 18, "left");
                return;
            }

            for (let i = 0; i < specs.length; i++) {
                const spec = specs[i];
                const rowY = this.rowRect(i).y;
                const selected = i === this._selectedIndex;
                drawPanelRect(
                    bitmap,
                    12,
                    rowY,
                    bitmap.width - 24,
                    24,
                    selected ? "rgba(42,78,128,0.95)" : "rgba(28,34,44,0.9)",
                    selected ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.16)"
                );
                bitmap.fontSize = 14;
                bitmap.textColor = "#ffffff";
                bitmap.drawText(spec.label, 20, rowY + 2, 160, 20, "left");
                bitmap.textColor = "#a9c8ff";
                bitmap.drawText(spec.type, 178, rowY + 2, 58, 20, "center");
                if (spec.type !== "string") {
                    bitmap.textColor = "#9cb8e6";
                    bitmap.drawText("-", 240, rowY + 2, 18, 20, "center");
                    bitmap.drawText("+", 342, rowY + 2, 18, 20, "center");
                    bitmap.textColor = "#ffffff";
                    bitmap.drawText(formatValue(this._target.dstParamValue(spec.key)), 260, rowY + 2, 80, 20, "center");
                } else {
                    bitmap.textColor = "#ffffff";
                    bitmap.drawText(formatValue(this._target.dstParamValue(spec.key)), 240, rowY + 2, 120, 20, "right");
                }
            }
        }
    }

    const _Sprite_Character_updatePosition = Sprite_Character.prototype.updatePosition;
    Sprite_Character.prototype.updatePosition = function() {
        _Sprite_Character_updatePosition.call(this);
        if (this._character?.dstElevationPixels) {
            this.y -= this._character.dstElevationPixels();
        }
    };

    const _Sprite_Character_update = Sprite_Character.prototype.update;
    Sprite_Character.prototype.update = function() {
        _Sprite_Character_update.call(this);
        this.dstUpdateOutlineVisuals();
        this.dstUpdateShadowVisual();
        this.dstUpdateHitFlash();
    };

    Sprite_Character.prototype.dstEnsureOutlineSprites = function() {
        if (this._dstOutlineSprites) {
            return;
        }
        this._dstOutlineSprites = [];
        for (const [offsetX, offsetY] of OUTLINE_OFFSETS) {
            const sprite = new Sprite();
            sprite.anchor.x = 0.5;
            sprite.anchor.y = 1;
            sprite.x = offsetX;
            sprite.y = offsetY;
            sprite.alpha = 0.75;
            sprite.visible = false;
            this.addChildAt(sprite, 0);
            this._dstOutlineSprites.push(sprite);
        }
    };

    Sprite_Character.prototype.dstSetOutlined = function(outlined) {
        this._dstOutlined = !!outlined;
    };

    Sprite_Character.prototype.dstUpdateOutlineVisuals = function() {
        this.dstEnsureOutlineSprites();
        const frame = this._frame;
        const visible = this._dstOutlined && this.visible && frame && frame.width > 0 && frame.height > 0;
        for (const sprite of this._dstOutlineSprites) {
            sprite.visible = visible;
            if (!visible) {
                continue;
            }
            sprite.bitmap = this.bitmap;
            sprite.scale.x = this.scale.x;
            sprite.scale.y = this.scale.y;
            sprite.alpha = Number.isFinite(this.alpha) ? this.alpha : 1;
            sprite.setFrame(frame.x, frame.y, frame.width, frame.height);
            sprite.setColorTone([255, 255, 255, 0]);
            sprite.setBlendColor([255, 255, 255, 255]);
        }
    };

    Sprite_Character.prototype.dstEnsureShadowSprite = function() {
        if (this._dstShadowSprite) {
            return;
        }
        this._dstShadowSprite = new Sprite(ImageManager.loadSystem("Shadow1"));
        this._dstShadowSprite.anchor.x = 0.5;
        this._dstShadowSprite.anchor.y = 0.5;
        this._dstShadowSprite.visible = false;
        this.addChildAt(this._dstShadowSprite, 0);
    };

    Sprite_Character.prototype.dstShadowSettings = function() {
        if (this._character === $gamePlayer) {
            return { visible: true, scale: 0.55, opacity: 140, elevation: 0 };
        }
        if (this._character instanceof Game_Follower) {
            return { visible: true, scale: 0.5, opacity: 120, elevation: 0 };
        }
        if (this._character instanceof Game_Event && this._character.dstIsConfigured()) {
            const config = this._character.dstConfig();
            return {
                visible: true,
                scale: config.shadowScale,
                opacity: config.shadowOpacity,
                elevation: config.elevation
            };
        }
        return { visible: false, scale: 0.5, opacity: 0, elevation: 0 };
    };

    Sprite_Character.prototype.dstUpdateShadowVisual = function() {
        this.dstEnsureShadowSprite();
        const settings = this.dstShadowSettings();
        const shadow = this._dstShadowSprite;
        if (!settings.visible || !this.visible) {
            shadow.visible = false;
            return;
        }
        shadow.visible = true;
        shadow.alpha = (Number.isFinite(settings.opacity) ? settings.opacity : 0) / 255;
        shadow.scale.x = settings.scale;
        shadow.scale.y = settings.scale * 0.6;
        shadow.y = settings.elevation + 4;
    };

    Sprite_Character.prototype.dstUpdateHitFlash = function() {
        if (this._character instanceof Game_Event) {
            const flashFrames = this._character.dstRuntimeState().hitFlashFrames;
            if (flashFrames > 0) {
                this.setBlendColor([255, 112, 112, 160]);
                return;
            }
        }
        this.setBlendColor([0, 0, 0, 0]);
    };

    Spriteset_Map.prototype.dstApplyOutlineTarget = function(targetEvent) {
        if (!this._characterSprites) {
            return;
        }
        for (const sprite of this._characterSprites) {
            sprite.dstSetOutlined(sprite._character === targetEvent);
        }
    };

    const _Scene_Map_createDisplayObjects = Scene_Map.prototype.createDisplayObjects;
    Scene_Map.prototype.createDisplayObjects = function() {
        _Scene_Map_createDisplayObjects.call(this);
        this.dstCreatePrototypeUi();
    };

    Scene_Map.prototype.dstCreatePrototypeUi = function() {
        this._dstPrompt = new Sprite_DSTPrompt();
        this._dstInventoryHud = new Sprite_DSTInventoryHud();
        this._dstHeldVisual = new Sprite_DSTHeldVisual();
        this._dstDebugPanel = new Sprite_DSTDebugPanel();
        this._dstHighlightEvent = null;
        this.addChild(this._dstPrompt);
        this.addChild(this._dstHeldVisual);
        this.addChild(this._dstInventoryHud);
        this.addChild(this._dstDebugPanel);
    };

    const _Scene_Map_update = Scene_Map.prototype.update;
    Scene_Map.prototype.update = function() {
        _Scene_Map_update.call(this);
        this.dstUpdatePrototypeSystems();
    };

    const _Scene_Map_updateCallMenu = Scene_Map.prototype.updateCallMenu;
    Scene_Map.prototype.updateCallMenu = function() {
        if ($gameTemp.dstIsDebugPanelOpen()) {
            this.menuCalling = false;
            return;
        }
        _Scene_Map_updateCallMenu.call(this);
    };

    Scene_Map.prototype.isMapTouchOk = function() {
        return false;
    };

    Scene_Map.prototype.dstUpdatePrototypeSystems = function() {
        if (!this._spriteset || !$gamePlayer) {
            return;
        }
        if ($gameMessage.isBusy()) {
            this._dstHighlightEvent = null;
            this._spriteset.dstApplyOutlineTarget(null);
            this._dstPrompt.setTarget(null);
            return;
        }
        this.dstUpdateHighlightTarget();
        this.dstHandlePrototypeInputs();
        this.dstUpdateEnemyAttacks();
    };

    Scene_Map.prototype.dstUpdateHighlightTarget = function() {
        if ($gameTemp.dstIsDebugPanelOpen() && this._dstDebugPanel.target()) {
            this._dstHighlightEvent = this._dstDebugPanel.target();
        } else {
            const candidates = $gameMap
                .events()
                .filter(event => event.dstIsInteractable())
                .filter(event => event.dstDistanceToPlayer() <= event.dstConfig().highlightRange)
                .sort((a, b) => a.dstDistanceToPlayer() - b.dstDistanceToPlayer());
            this._dstHighlightEvent = candidates[0] || null;
        }
        this._spriteset.dstApplyOutlineTarget(this._dstHighlightEvent);
        this._dstPrompt.setTarget(this._dstHighlightEvent);
    };

    Scene_Map.prototype.dstHandlePrototypeInputs = function() {
        if (Input.isTriggered("pageup")) {
            if (this._dstDebugPanel.isOpen()) {
                this._dstDebugPanel.close();
            } else if (this._dstHighlightEvent) {
                SoundManager.playOk();
                this._dstDebugPanel.open(this._dstHighlightEvent);
            }
            return;
        }
        if (this._dstDebugPanel.isOpen()) {
            return;
        }
        this.dstHandleHeldItemHotkeys();
        if (Input.isTriggered("dstInteract")) {
            this.dstTryInteract();
        }
        if (Input.isTriggered("dstAttack")) {
            $gamePlayer.dstTryAttack();
        }
    };

    Scene_Map.prototype.dstHandleHeldItemHotkeys = function() {
        if (Input.isTriggered("dstRelease")) {
            $gameSystem.dstSetHeldKey("");
            SoundManager.playCancel();
            return;
        }
        const visibleSlots = $gameSystem.dstVisibleSlots(INVENTORY_HUD_SLOTS);
        for (let i = 0; i < visibleSlots.length; i++) {
            if (Input.isTriggered(`dstSlot${i + 1}`)) {
                $gameSystem.dstSetHeldKey(visibleSlots[i].key);
                SoundManager.playEquip();
                return;
            }
        }
    };

    Scene_Map.prototype.dstTryInteract = function() {
        const target = this._dstHighlightEvent;
        if (!target) {
            SoundManager.playBuzzer();
            return false;
        }
        if (target.dstDistanceToPlayer() > target.dstConfig().interactRange) {
            SoundManager.playBuzzer();
            return false;
        }
        if (target.dstTryPickup()) {
            return true;
        }
        if (target.dstTryBuiltinInteract()) {
            return true;
        }
        if (target.page() && target.list().length > 1) {
            target.start();
            return true;
        }
        SoundManager.playBuzzer();
        return false;
    };

    Scene_Map.prototype.dstUpdateEnemyAttacks = function() {
        if ($gameTemp.dstIsDebugPanelOpen()) {
            return;
        }
        for (const event of $gameMap.events()) {
            event.dstTryAttackPlayer();
        }
    };
})();
