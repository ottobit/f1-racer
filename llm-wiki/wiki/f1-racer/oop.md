# Object-oriented design — how we write code here

Standing rule (user, 2026-10-04): apply this page whenever we develop.
Source: [2026-10-04-oop-principles.md](../../sources/2026-10-04-oop-principles.md).

## The idea in one line

A concept that comes in variants (vehicle, series, championship...) is an
object with one interface; code *tells* the object what to do and each
variant answers in its own way. Nobody outside it asks "which kind are
you?" to decide.

## Rules

1. **One concept, one class family.** Variants are subclasses of a small
   base (`Vehicle` → `F1Car`, `RoadCar`; `Series` → `F1Series`,
   `ClassicSeries`). The base declares the interface; a method every
   variant must implement throws `not implemented` in the base.
2. **No type switches outside the family.** `if (kind === "f1")`,
   `id === ...` or `series === SERIES.f1` in caller code is a smell:
   move the difference into a method or a property of the object
   (Replace Conditional with Polymorphism). A lookup table keyed on
   `kind` is acceptable only at one factory point (e.g. `BUILDERS` in
   `vehicle-view.js`).
3. **A rule shared by every variant lives once, at the common entry
   point**, not copied into each variant. Example #357: draw-call batching
   of low-detail cars sits in `buildVehicleModel()`, so every Vehicle kind
   gets it, present and future.
4. **New variant = new subclass, existing code untouched** (open/closed).
   If adding a car/series forces edits in race, garage or menu, the
   interface is missing a method.
5. **Single responsibility, split by layer.** Data + physics objects stay
   free of three.js/DOM (`vehicle.js` runs in Node); 3D views are separate
   (`vehicle-view.js`); pages only wire objects together.
6. **Composition over deep inheritance.** At most base + one level.
   Shared helpers (`mesh-batch.js`, `lite-materials.js`) are composed, not
   inherited. Do not subclass three.js classes.
7. **Encapsulate state.** An object owns its data and its persistence
   (`loadGarage()`, `paint()`); callers don't read storage keys or poke at
   internals. Use `#private` fields when state must not leak (remember: not
   visible to subclasses).
8. **Pure functions are fine** for stateless maths (physics steps, track
   geometry). OOP is for concepts with variants or owned state, not a
   reason to wrap every function in a class.

## Checklist before writing code

- Which concept does this touch, and is there already an object for it?
- Am I about to branch on a type/id? → add a method instead.
- Does this behaviour apply to all variants? → put it at the common entry
  point, once.
- Would a new variant need changes here? → the interface is incomplete.

## Current state

- Done: `Vehicle` (#339), `Series` (#341), `Championship`, vehicle
  batching in `buildVehicleModel` (#357).
- Open (known debt): `core/client/home/menu.js` still compares
  `series === SERIES.f1 / SERIES.classic` for tab state, the championship
  wording and the page scroll — candidates for `Series` properties.
