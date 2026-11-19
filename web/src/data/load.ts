import type { Data } from "./format";
import { History } from "./history";

/** The precomputed demo repositories, in web/public/data/<id>/history.json. */
export const DEMOS = {
  alacritty: { name: "alacritty/alacritty" },
  ripgrep: { name: "BurntSushi/ripgrep" },
  compose: { name: "docker/compose" },
} as const;

export type DemoId = keyof typeof DEMOS;

export async function loadDemo(id: DemoId): Promise<History> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/${id}/history.json`);
  if (!res.ok) throw new Error(`Could not load ${DEMOS[id].name} (${res.status})`);
  return new History((await res.json()) as Data);
}
