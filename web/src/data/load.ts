import type { Data } from "./format";
import { History } from "./history";

/**
 * The precomputed demo repositories, in web/public/data/<id>/. `commits` is
 * the first-parent count shown in the repository menu; keep it in step with
 * the pins in scripts/build-demo-data.sh.
 */
export const DEMOS = [
  { id: "alacritty", name: "alacritty/alacritty", commits: 2338 },
  { id: "ripgrep", name: "BurntSushi/ripgrep", commits: 2236 },
  { id: "compose", name: "docker/compose", commits: 3962 },
] as const;

export type DemoId = (typeof DEMOS)[number]["id"];
export const DEFAULT_DEMO: DemoId = "alacritty";

export function demoByName(name: string): DemoId | null {
  const d = DEMOS.find((d) => d.name.toLowerCase() === name.toLowerCase());
  return d ? d.id : null;
}

export function demoBase(id: DemoId): string {
  return `${import.meta.env.BASE_URL}data/${id}`;
}

const loaded = new Map<DemoId, Promise<History>>();

export function loadDemo(id: DemoId): Promise<History> {
  let p = loaded.get(id);
  if (!p) {
    p = fetch(`${demoBase(id)}/history.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`Could not load ${id} (${res.status})`);
        return res.json() as Promise<Data>;
      })
      .then((data) => new History(data));
    p.catch(() => loaded.delete(id));
    loaded.set(id, p);
  }
  return p;
}
