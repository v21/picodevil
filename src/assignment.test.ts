import { describe, it, expect } from "vitest";
import { minCostAssignment } from "./assignment";

/** Brute-force optimal total cost, for cross-checking the solver on small inputs. */
function bruteForceMinCost(cost: number[][]): number {
  const R = cost.length;
  if (R === 0) return 0;
  const C = cost[0].length;
  const used = new Array(C).fill(false);
  let best = Infinity;
  const rec = (r: number, acc: number) => {
    if (acc >= best) return;
    if (r === R) { best = acc; return; }
    for (let c = 0; c < C; c++) {
      if (used[c]) continue;
      used[c] = true;
      rec(r + 1, acc + cost[r][c]);
      used[c] = false;
    }
  };
  rec(0, 0);
  return best;
}

function totalCost(cost: number[][], assignment: number[]): number {
  return assignment.reduce((sum, c, r) => sum + cost[r][c], 0);
}

describe("minCostAssignment", () => {
  it("returns empty for no rows", () => {
    expect(minCostAssignment([])).toEqual([]);
  });

  it("assigns a single row to its cheapest column", () => {
    expect(minCostAssignment([[5, 2, 8]])).toEqual([1]);
  });

  it("solves a 2x2 where the diagonal is worse than the swap", () => {
    // diagonal = 9+9 = 18; swap = 1+1 = 2
    const cost = [[9, 1], [1, 9]];
    expect(minCostAssignment(cost)).toEqual([1, 0]);
  });

  it("produces a valid permutation (distinct columns)", () => {
    const cost = [
      [4, 1, 3],
      [2, 0, 5],
      [3, 2, 2],
    ];
    const a = minCostAssignment(cost);
    expect(new Set(a).size).toBe(3);
    expect(a.every(c => c >= 0 && c < 3)).toBe(true);
  });

  it("matches brute force on random square matrices", () => {
    // Deterministic pseudo-random (no Math.random in this environment).
    let seed = 12345;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % 100; };
    for (let trial = 0; trial < 20; trial++) {
      const n = 1 + (trial % 5);
      const cost = Array.from({ length: n }, () => Array.from({ length: n }, rnd));
      const a = minCostAssignment(cost);
      expect(new Set(a).size).toBe(n); // valid permutation
      expect(totalCost(cost, a)).toBe(bruteForceMinCost(cost));
    }
  });

  it("handles rectangular R<C, leaving extra columns unassigned", () => {
    // 2 rows, 4 columns. Cheapest distinct pair.
    const cost = [
      [10, 1, 10, 10],
      [10, 10, 2, 10],
    ];
    const a = minCostAssignment(cost);
    expect(a).toEqual([1, 2]);
    expect(totalCost(cost, a)).toBe(bruteForceMinCost(cost));
  });

  it("is deterministic: identical input yields identical output", () => {
    const cost = [
      [1, 1, 1],
      [1, 1, 1],
      [1, 1, 1],
    ];
    const a = minCostAssignment(cost);
    const b = minCostAssignment(cost.map(row => [...row]));
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(3); // still a valid permutation
  });

  it("respects an epsilon tie-break baked into the cost", () => {
    // Two rows both want column 0 (cost 0); ties broken by a tiny id term so the
    // optimum is unique. Row 0 has the smaller id-perturbation on col 0.
    const EPS = 1e-6;
    const cost = [
      [0 + 0 * EPS, 5, 5],
      [0 + 1 * EPS, 5, 5],
      [5, 0, 0],
    ];
    // Optimal: row0->col0 (it's epsilon-cheaper there), row1 and row2 take 1/2.
    const a = minCostAssignment(cost);
    expect(a[0]).toBe(0);
    expect(new Set(a).size).toBe(3);
  });

  it("throws when there are fewer columns than rows", () => {
    expect(() => minCostAssignment([[1, 2], [3, 4], [5, 6]])).toThrow();
  });
});
