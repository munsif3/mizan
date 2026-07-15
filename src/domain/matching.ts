export interface MatchEdge<T> {
  left: string;
  right: string;
  cost: number;
  value: T;
}

interface ResidualEdge {
  to: number;
  reverse: number;
  capacity: number;
  cost: number;
  matchIndex?: number;
}

/**
 * Maximum-cardinality bipartite matching with minimum total cost among the
 * maximum matchings. Input order cannot change the selected pairs.
 */
export function maximumCardinalityMinCostMatch<T>(input: readonly MatchEdge<T>[]): T[] {
  const edges = [...input]
    .filter((edge) => Number.isFinite(edge.cost))
    .sort((a, b) => a.left.localeCompare(b.left) || a.right.localeCompare(b.right) || a.cost - b.cost);
  const leftKeys = [...new Set(edges.map((edge) => edge.left))].sort();
  const rightKeys = [...new Set(edges.map((edge) => edge.right))].sort();
  const source = 0;
  const leftOffset = 1;
  const rightOffset = leftOffset + leftKeys.length;
  const sink = rightOffset + rightKeys.length;
  const graph: ResidualEdge[][] = Array.from({ length: sink + 1 }, () => []);
  const leftNode = new Map(leftKeys.map((key, index) => [key, leftOffset + index]));
  const rightNode = new Map(rightKeys.map((key, index) => [key, rightOffset + index]));

  const addEdge = (from: number, to: number, capacity: number, cost: number, matchIndex?: number) => {
    const forward: ResidualEdge = { to, reverse: graph[to]!.length, capacity, cost, ...(matchIndex === undefined ? {} : { matchIndex }) };
    const reverse: ResidualEdge = { to: from, reverse: graph[from]!.length, capacity: 0, cost: -cost };
    graph[from]!.push(forward);
    graph[to]!.push(reverse);
  };

  for (const key of leftKeys) addEdge(source, leftNode.get(key)!, 1, 0);
  edges.forEach((edge, index) => addEdge(leftNode.get(edge.left)!, rightNode.get(edge.right)!, 1, edge.cost, index));
  for (const key of rightKeys) addEdge(rightNode.get(key)!, sink, 1, 0);

  while (true) {
    const distance = Array<number>(graph.length).fill(Number.POSITIVE_INFINITY);
    const previousNode = Array<number>(graph.length).fill(-1);
    const previousEdge = Array<number>(graph.length).fill(-1);
    distance[source] = 0;
    for (let pass = 0; pass < graph.length - 1; pass += 1) {
      let changed = false;
      for (let from = 0; from < graph.length; from += 1) {
        const fromDistance = distance[from]!;
        if (!Number.isFinite(fromDistance)) continue;
        for (let edgeIndex = 0; edgeIndex < graph[from]!.length; edgeIndex += 1) {
          const edge = graph[from]![edgeIndex]!;
          if (edge.capacity <= 0) continue;
          const candidate = fromDistance + edge.cost;
          if (candidate + 1e-9 >= distance[edge.to]!) continue;
          distance[edge.to] = candidate;
          previousNode[edge.to] = from;
          previousEdge[edge.to] = edgeIndex;
          changed = true;
        }
      }
      if (!changed) break;
    }
    if (previousNode[sink]! < 0) break;
    for (let node = sink; node !== source; node = previousNode[node]!) {
      const from = previousNode[node]!;
      const edge = graph[from]![previousEdge[node]!]!;
      edge.capacity -= 1;
      graph[node]![edge.reverse]!.capacity += 1;
    }
  }

  const selected: Array<{ left: string; right: string; value: T }> = [];
  for (const left of leftKeys) {
    for (const edge of graph[leftNode.get(left)!]!) {
      if (edge.matchIndex === undefined || edge.capacity !== 0) continue;
      const sourceEdge = edges[edge.matchIndex]!;
      selected.push({ left: sourceEdge.left, right: sourceEdge.right, value: sourceEdge.value });
    }
  }
  return selected
    .sort((a, b) => a.left.localeCompare(b.left) || a.right.localeCompare(b.right))
    .map((match) => match.value);
}
