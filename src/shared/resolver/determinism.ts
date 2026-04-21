export function sampleUnitInterval(seed: string, ...parts: Array<string | number>): number {
  const input = [seed, ...parts].join("|");
  let hash = 2166136261;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0) / 4294967296;
}
