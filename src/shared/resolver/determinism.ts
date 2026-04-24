// Deterministic unit-interval sampler: FNV-1a hash over seed plus caller-supplied parts, scaled to [0, 1).
// Depends on: nothing. Consumed by: resolver/combat.
// Invariant: identical inputs must always return identical outputs across client and server.

export function sampleUnitInterval(seed: string, ...parts: Array<string | number>): number {
  const input = [seed, ...parts].join("|");
  let hash = 2166136261;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0) / 4294967296;
}
