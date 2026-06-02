/**
 * Minimum-cost assignment via the Hungarian (Kuhn–Munkres) algorithm, potentials
 * formulation. Assigns each of the R rows to a distinct column minimising the total
 * cost. Requires C >= R (at least as many columns as rows); surplus columns are left
 * unassigned. Runs in O(R^2 · C).
 *
 * Pure and deterministic: a given matrix always yields the same assignment. When the
 * optimum is not unique the specific choice is algorithm-defined, so callers that need
 * a particular tie-break should bake a tiny perturbation into the costs (see the matcher,
 * which adds an id-keyed epsilon) so the minimum is unique.
 *
 * @param cost  R×C matrix; cost[r][c] is the cost of assigning row r to column c.
 * @returns assignment of length R; assignment[r] is the column chosen for row r.
 */
export function minCostAssignment(cost: number[][]): number[] {
  const n = cost.length;
  if (n === 0) return [];
  const m = cost[0].length;
  if (m < n) throw new Error(`minCostAssignment: need columns (${m}) >= rows (${n})`);

  const INF = Infinity;
  // 1-indexed potentials and matching state (row/col 0 are sentinels).
  const u = new Array<number>(n + 1).fill(0); // row potentials
  const v = new Array<number>(m + 1).fill(0); // column potentials
  const p = new Array<number>(m + 1).fill(0); // p[j] = row matched to column j (0 = none)
  const way = new Array<number>(m + 1).fill(0); // back-pointers for augmenting path

  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0; // current column on the augmenting path (0 = the free virtual column)
    const minv = new Array<number>(m + 1).fill(INF);
    const used = new Array<boolean>(m + 1).fill(false);

    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = INF;
      let j1 = -1;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta; }
        else { minv[j] -= delta; }
      }
      j0 = j1;
    } while (p[j0] !== 0);

    // Augment along the path.
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0 !== 0);
  }

  const assignment = new Array<number>(n).fill(-1);
  for (let j = 1; j <= m; j++) {
    if (p[j] > 0) assignment[p[j] - 1] = j - 1;
  }
  return assignment;
}
