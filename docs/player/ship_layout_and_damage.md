# Ship Layout And Damage

**Audience:** players, playtesters, curious readers
**Status:** current player-facing explainer
**Last updated:** 2026-04-24

This still describes the shipped duel build. `v0.2` did not change the underlying hit-layout model; it only improved presentation and workflow around it.

## What the SSD is supposed to mean

The Ship System Display is not just a pretty diagram.

The goal is that when you look at the ship schematic, you are looking at a simplified map of the ship's real internal layout:

- where the reactor is
- where the drive is
- where the bridge is
- where the weapon mounts are

That matters because damage is not meant to be purely abstract. A hit near the drive should *feel* different from a hit near the bridge.

## What "physical layout" means

Every major system has a real location on the ship.

That real location affects:

- what parts of the ship are more exposed
- what systems are more likely to be hit by local damage
- what the ship looks like on the SSD

In the common case, the system is drawn on the SSD where it really is on the ship.

## Example: centerline reactor

Imagine a ship with:

- reactor near the middle
- bridge forward of center
- drive aft
- railgun mount near the bow

That usually means:

- the reactor is somewhat protected by being central
- the drive is vulnerable to aft or flank punishment
- the forward gun is excellent at bow-on attacks but exposed up front

Even in `v0.1`, that kind of layout meaning is worth preserving.

## How hits work in `v0.1`

`v0.1` keeps the damage model simple, but not fake.

When a weapon hits:

1. the ship always takes hull damage
2. the game checks whether the impact landed near a major subsystem
3. if it did, that subsystem may also take local damage

So the first slice is already trying to answer:

- "You hit the ship" and
- "You hit *near the drive*" or
- "You hit *near the reactor*"

That is what makes the SSD matter mechanically.

## What subsystem damage means

Subsystems are not just "fine" or "gone."

The current direction is:

- `Operational`
- `Degraded`
- `Offline`

That means a hit can hurt you in ways that are very real without instantly deleting the entire ship.

Examples:

- a degraded drive may leave you with much less translational authority
- a degraded bridge may make shots less accurate
- a degraded weapon mount may reduce effective charge or fire-control quality
- a degraded reactor may reduce your available power pips for the next turn

That is the kind of gameplay the ship layout is meant to support.

## Why not make the SSD purely cosmetic

Because then it would stop earning its screen space.

If the SSD is only decorative, the player is really just watching:

- a hull bar
- a weapon button
- some nice ship art

That is not the game this project is trying to make.

The design goal is stronger:

- you should care where systems are
- you should notice what part of the ship is taking punishment
- future damage control and repair should feel anchored in a real layout

## What future customization could mean

The long-term idea is not just changing paint colors or icons. It is also eventually letting players experiment with real ship configuration.

Examples of future meaningful choices:

- move a weapon mount farther to port
- reinforce the reactor
- cluster systems tightly for compactness
- spread them out for survivability

Those choices should affect both:

- what the SSD looks like
- how the ship behaves and what gets hit

That is why the engine needs to stay smart about resolving hits by location.

## Cosmetic vs real changes

There are two very different kinds of "layout change."

### Cosmetic change

Example:

- move a bridge icon slightly to the right on the SSD so labels do not overlap

This should **not** change gameplay.

### Real ship configuration change

Example:

- move a weapon mount to a different physical location on the hull

This **should** change gameplay:

- firing geometry changes
- local vulnerability changes
- the SSD should update to match

That distinction is important for both players and developers.

## What to expect from the shipped duel

The shipped duel is still intentionally simple.

Do not expect:

- full compartment modeling
- intricate armor-zone simulation
- detailed crew routing
- advanced repair gameplay

But do expect the current build to lay the foundation:

- systems have locations
- hits can matter locally
- subsystem damage changes your tactical options

That is enough to make the SSD feel real from the beginning.

## Related docs

- [SSD layout](../design/ssd_layout.md)
- [Ship definition format](../design/ship_definition_format.md)
- [Resolver design](../design/resolver_design.md)
