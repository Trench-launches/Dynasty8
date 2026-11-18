/**
 * Uniform random sample of up to `n` items, without replacement, from a READ-ONLY list.
 *
 * RPC results such as `Connection.getProgramAccounts` are typed `readonly [...]`, so they must
 * not be sorted or shuffled in place. This copies first, then runs a partial Fisher-Yates
 * shuffle (unbiased, unlike `sort(() => Math.random() - 0.5)`). `random` is injectable for tests.
 */
export function sampleWithoutReplacement<T>(items: readonly T[], n: number, random: () => number = Math.random): T[] {
  const copy = items.slice();
  const k = Math.max(0, Math.min(Math.floor(n), copy.length));
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(random() * (copy.length - i));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy.slice(0, k);
}
