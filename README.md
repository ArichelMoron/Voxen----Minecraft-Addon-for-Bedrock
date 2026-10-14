# Voxen Addon

A Minecraft Bedrock addon featuring block selection and editing tools. With the **Editing Staff**, you can mark two points in the world and use commands to fill the selected area, replace one type of block, or create shapes. You can also save block palettes and use them in the same operations.

## Showcase Videos

Videos are listed in the order provided. Visit the creator's YouTube channel: [@arichel_moron](https://www.youtube.com/@arichel_moron).

1. [Watch Showcase Video 1](https://youtu.be/FohrNh6S_cc?si=evIvOcY_-mNyYB2L)
2. [Watch Showcase Video 2](https://youtu.be/3ZoNddedm1Y?si=hkCuviEY3froemmU)
3. [Watch Showcase Video 3](https://youtu.be/q-bZd2yJdxY?si=9oiToPSe0gkcAUlV)
4. [Watch Showcase Video 4](https://youtu.be/XZcJyiyI1ps?si=A7E_sWVhiZ_xb0TQ)

## Language Support

The addon is intended to support two languages:

1. Portuguese (PT)
2. English (US)

## Requirements and Installation

The addon contains a Behavior Pack and a Resource Pack. The manifest declares Minecraft Bedrock 1.21.0 as the minimum version; the installed game version must also be compatible with the Script APIs used by the packs.

1. Back up your world before installing the addon or testing operations in important areas.
2. Import both **Voxen Behavior** and **Voxen Resource** into Minecraft. If installing the files manually, place each folder in its corresponding development directory: `development_behavior_packs` and `development_resource_packs`.
3. In the world settings, enable both packs. The Resource Pack depends on the Behavior Pack.
4. Enter the world and obtain the selection tool:

   ```mcfunction
   /give @s voxen:edit_staff
   ```

The commands below are custom addon commands and must be run by a player inside the world.

## Getting Started: Selecting an Area

1. Hold the **Editing Staff** in your main hand.
2. Interact with the block that will be the first corner of the area. The addon records **Position 1** and displays its coordinates.
3. Interact with another block to record **Position 2**.
4. After both points have been marked, a particle box displays the selection outline. It updates while you remain in the same dimension.
5. Run the desired editing command.

The two points can be marked in any order: the addon automatically calculates the minimum and maximum X, Y, and Z values to form the area. Positions are inclusive, meaning the blocks at the selected corners are also included in the operation.

When you complete a new selection, the cycle starts again from Position 1. If you change dimensions before finishing the selection, the previous positions are discarded when you mark points again. Operations are also rejected if the current selection belongs to another dimension.

To clear the current selection, use:

```mcfunction
/clearselection
```

## Available Commands

| Command                                                | Description                                                                        |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `/replace <destination-block> [action] [source-block]` | Fills the selection, replaces one type of block, or creates a shape using a block. |
| `/replacepalette <palette> [action] [source-block]`    | Performs the same operations, but uses blocks from a palette.                      |
| `/complementary palette <action> <name> [blocks...]`   | Creates, updates, or removes block palettes.                                       |
| `/clearselection`                                      | Clears both points of the current selection.                                       |

Block names can be supplied with a namespace, such as `minecraft:stone`. In palette management commands, block names without a namespace are treated as `minecraft:` blocks. These commands require a player as the command source; they cannot be run directly from the server console.

## Filling Areas, Replacing Blocks, and Creating Shapes

### Fill an Entire Area

Omitting the action fills the entire volume between the two selected positions:

```mcfunction
/replace minecraft:stone
```

To use a palette instead of a single block:

```mcfunction
/replacepalette construction
```

### Replace Only One Type of Block

Use the `in` action and specify the block to find as the final argument. Only blocks of that type inside the selection will be changed:

```mcfunction
/replace minecraft:glass in minecraft:dirt
```

This example replaces dirt with glass without changing the other blocks in the area. You can also use a palette as the destination:

```mcfunction
/replacepalette construction in minecraft:dirt
```

The source block can only be used with the `in` action. If the action is omitted, the destination block (or palette) is applied to the entire volume.

### Boxes and Spheres

| Action          | Result                                                        |
| --------------- | ------------------------------------------------------------- |
| `outline_box`   | Builds only the 12 edges of the box defined by the selection. |
| `hollow_box`    | Builds a hollow box with faces one block thick.               |
| `filled_sphere` | Fills a sphere or ellipsoid sized to the selected area.       |
| `hollow_sphere` | Builds the hollow surface of a sphere or ellipsoid.           |

Examples:

```mcfunction
/replace minecraft:glass outline_box
/replace minecraft:stone hollow_box
/replace minecraft:gold_block filled_sphere
/replace minecraft:diamond_block hollow_sphere
```

A selection with different measurements along each axis produces an ellipsoid for sphere actions.

### Cylinders

The suffix indicates the cylinder's longitudinal axis: `x`, `y`, or `z`. Use `filled_` for a solid cylinder or `hollow_` for a hollow cylinder.

```text
filled_cylinder_x     hollow_cylinder_x
filled_cylinder_y     hollow_cylinder_y
filled_cylinder_z     hollow_cylinder_z
```

Example:

```mcfunction
/replace minecraft:stone hollow_cylinder_y
```

### Pyramids

The action name specifies whether the pyramid is filled or hollow, the axis it points along, and whether it points in the positive (`positive`) or negative (`negative`) direction:

```text
filled_pyramid_x_positive    filled_pyramid_x_negative
filled_pyramid_y_positive    filled_pyramid_y_negative
filled_pyramid_z_positive    filled_pyramid_z_negative
hollow_pyramid_x_positive    hollow_pyramid_x_negative
hollow_pyramid_y_positive    hollow_pyramid_y_negative
hollow_pyramid_z_positive    hollow_pyramid_z_negative
```

Example of a pyramid pointing upward:

```mcfunction
/replace minecraft:stone filled_pyramid_y_positive
```

### Cones

Cones use the same axis and direction convention as pyramids:

```text
filled_cone_x_positive    filled_cone_x_negative
filled_cone_y_positive    filled_cone_y_negative
filled_cone_z_positive    filled_cone_z_negative
hollow_cone_x_positive    hollow_cone_x_negative
hollow_cone_y_positive    hollow_cone_y_negative
hollow_cone_z_positive    hollow_cone_z_negative
```

Example:

```mcfunction
/replace minecraft:glass hollow_cone_z_negative
```

### Rings and Toroids

The `ring_x`, `ring_y`, and `ring_z` actions create a ring in the plane perpendicular to the specified axis:

| Action   | Ring plane |
| -------- | ---------- |
| `ring_x` | YZ         |
| `ring_y` | XZ         |
| `ring_z` | XY         |

Toroids are oriented along the specified axis. Each orientation has a filled and a hollow version:

```text
filled_toroid_x    hollow_toroid_x
filled_toroid_y    hollow_toroid_y
filled_toroid_z    hollow_toroid_z
```

Examples:

```mcfunction
/replace minecraft:gold_block ring_y
/replace minecraft:stone hollow_toroid_x
```

### Complete Editing Command Syntax

```text
/replace <destination-block> [action] [source-block]
/replacepalette <palette-name> [action] [source-block]
```

For both commands, the action can be omitted to fill the selection. To filter by a source block, use `in <source-block>`. To create a shape, specify one of the actions listed above and do not provide a source block.

## Managing Block Palettes

Palettes store a list of blocks in the world and can be used with `/replacepalette`. Palette names are case-insensitive when searching; the original name is retained for display in messages.

### Create a Palette

Provide at least two different blocks:

```mcfunction
/complementary palette create construction minecraft:stone minecraft:andesite minecraft:deepslate
```

You can provide up to five blocks when creating a palette. Duplicate blocks are ignored. The command rejects names that already exist.

### Add Blocks

Use `add` to add blocks to an existing palette:

```mcfunction
/complementary palette add construction minecraft:granite minecraft:tuff
```

You can provide up to five blocks per command. Blocks already in the palette are not duplicated, and a palette cannot contain more than eight different blocks.

### Remove a Palette

Use `remove` to delete an entire palette:

```mcfunction
/complementary palette remove construction
```

### Use a Palette for an Editing Operation

Without an action, the palette fills the entire selection:

```mcfunction
/replacepalette construction
```

It can also be used to build a shape:

```mcfunction
/replacepalette construction hollow_box
```

Or to replace only one type of block:

```mcfunction
/replacepalette construction in minecraft:dirt
```

When a palette contains multiple blocks, the addon distributes them in a repeatable spatial pattern organized into 4-block cells. A palette containing only one block applies that block throughout the entire area.

## Limits and Tips

- Each axis of the selection must measure between 1 and 500 blocks. This limit is checked during editing operations.
- The selection is a rectangular volume defined by its corners, even when the shape created inside it is curved.
- Operations on large areas may take time. The addon processes regions in stages and may report progress.
- If an operation is interrupted or fails in a large area, check that the chunks are available, that ticking areas have sufficient capacity, and that the selection is within the world's limits.
- Carefully verify both points before filling or replacing blocks. These operations modify blocks in the world, and an undo command has not been implemented.
- The selection is kept in memory while the world is running; palettes are stored as world dynamic properties.

## Troubleshooting

### The Command Says a Selection Is Required

Hold the Editing Staff and mark both points again. An operation requires Position 1 and Position 2.

### The Selection Is Visible, but the Operation Is Rejected

Make sure you are still in the same dimension where you marked the points and that each axis of the selection is no longer than 500 blocks.

### A Palette Cannot Be Found

Check the spelling and use the same name supplied when running `create`. Names are normalized to lowercase when saved and searched.

### The Operation Stops Halfway or Takes Too Long

Allow the operation time to finish. If the addon reports a failure or interruption, try a smaller selection and check chunk availability, world limits, and ticking-area capacity.

### The Item or Commands Do Not Appear

Make sure both **Voxen Behavior** and **Voxen Resource** are enabled in the world and that your Minecraft version is compatible with the packs. To obtain the tool again, run `/give @s voxen:edit_staff` as a player.
