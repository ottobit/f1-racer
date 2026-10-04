# Source: object-oriented programming principles (2026-10-04)

Asked by the user ("studiala, capiscila e applicala sempre quando parliamo
di sviluppo"), after #357 batched F1 and road cars in two different
builders instead of once per Vehicle. Summary of the canonical ideas, no
copied text:

- Core concepts: encapsulation, abstraction, inheritance, polymorphism.
- Design principles: encapsulate what varies; favour composition over
  inheritance; program to an interface, not an implementation; loose
  coupling.
- SOLID: single responsibility, open/closed, Liskov substitution,
  interface segregation, dependency inversion.
- Fowler, *Refactoring* — "Replace Conditional with Polymorphism": a type
  check repeated in several places becomes one method per subclass; a new
  variant is a new subclass, existing code untouched (open/closed). It
  follows "Tell, Don't Ask": tell the object what to do instead of reading
  its state and deciding for it.
- JavaScript specifics (MDN): `class`/`extends`; `#private` fields are not
  visible to subclasses and are not inherited.

Links:
- https://refactoring.guru/replace-conditional-with-polymorphism
- https://sourcemaking.com/replace-conditional-with-polymorphism
- https://developer.mozilla.org/docs/Web/JavaScript/Reference/Classes/Private_elements
- https://levelup.gitconnected.com/object-oriented-design-principles-bb6daf98b185

Synthesized in [wiki/f1-racer/oop.md](../wiki/f1-racer/oop.md).
