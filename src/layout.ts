/**
 * The one comparator every layout check uses: a recomputed mine layout against a served one, as a
 * SET (the API returns the set; the declaration's layoutRepresentation.orderMatters is false).
 * Step 5 scores the primary population with it, steps 10, 17, 21 and 22 their subsets, and step 16
 * runs it on a deliberately corrupted layout as the negative control that shows it can say no.
 */
export function sameLayout(computedSorted: number[], served: number[]): boolean {
  const actual = [...served].sort((a, b) => a - b);
  return computedSorted.length === actual.length && computedSorted.every((v, i) => v === actual[i]);
}
