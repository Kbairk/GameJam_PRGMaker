# Survival Prototype MZ
## Управление

- `W A S D` — движение
- `E` — взаимодействие / подобрать предмет
- `F` — удар перед собой
- `Q` — открыть или закрыть Debug-панель объекта
- `1..5` — взять предмет из HUD-слота в руки
- `R` — убрать предмет из рук

## Как размечать объект

Тэги можно писать в `Note` события или в комментарии на активной странице события.

### Обычный объект

```text
<dstName: Workshop Door>
<dstType: door>
<dstHighlightRange: 1.8>
<dstInteractRange: 1.3>
<dstParam: openness|number|0|0|1|0.1|Open>
<dstParam: locked|boolean|false||||Locked>
<dstParam: material|string|oak||||Material>
```

### Предмет на земле

```text
<dstName: Stone>
<dstType: pickup>
<dstPickupType: item>
<dstPickupItemId: 1>
<dstPickupCount: 1>
<dstPickupTo: inventory>
```

### Сразу в руки

```text
<dstName: Axe>
<dstType: pickup>
<dstPickupType: item>
<dstPickupItemId: 2>
<dstPickupCount: 1>
<dstPickupTo: hands>
```

### Враг

```text
<dstName: Spider>
<dstType: enemy>
<dstEnemyHp: 45>
<dstEnemyDamage: 8>
<dstEnemyChaseRange: 5>
<dstEnemyAttackRange: 1.1>
<dstEnemyAttackCooldown: 45>
<dstParam: state|select|idle||||State|idle,alert,stunned>
<dstParam: aggression|number|1|0|10|1|Aggro>
```

## Параметры в Debug-панели

Формат:

```text
<dstParam: key|type|default|min|max|step|Label|options>
```

Поддерживаются типы:

- `number`
- `boolean`
- `string`
- `select`

`string` сейчас отображается как read-only. `number`, `boolean` и `select` можно менять прямо из `Q`-панели стрелками.

## Параметры предметов в руках

Их можно писать в `Note` у предметов базы данных `Items / Weapons / Armors`:

```text
<dstPower: 16>
<dstReach: 1.6>
<dstHoldOffsetX: 18>
<dstHoldOffsetY: -18>
```
