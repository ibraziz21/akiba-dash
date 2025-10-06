// lib/subgraph.ts
export const SUBGRAPH_URL =
  "https://api.studio.thegraph.com/query/115307/akiba-v-3/version/latest";

type GqlRes<T> = { data?: T; errors?: any };
export async function gqlFetch<T>(query: string, variables?: Record<string, any>): Promise<T> {
  const res = await fetch(SUBGRAPH_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  const json = (await res.json()) as GqlRes<T>;
  if (!res.ok || json.errors) throw new Error(JSON.stringify(json.errors || res.statusText));
  return json.data as T;
}
