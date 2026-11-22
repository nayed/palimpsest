// Downloaded packs kept in this browser's private file system (OPFS), so
// opening a repository again skips the download when its head has not moved.
// Beside each pack: the finished data file and the line histories worked
// out so far, so a repository opened again shows at once instead of being
// read again. Those are stamped with the core that made them, so a newer
// core reads the pack afresh. Everything here is best effort: without
// storage, repositories are simply downloaded and read again.
//
//   repos/<owner>__<name>/<key>.pack                 the download
//   repos/<owner>__<name>/<key>.<core>.json          the finished data file
//   repos/<owner>__<name>/<key>.<core>.lines/<id>    line histories ("null": none)
//
// <key> is the head commit, with the window's start for a window of history.

async function repoDir(repo: string, create: boolean): Promise<FileSystemDirectoryHandle | null> {
  try {
    const root = await navigator.storage.getDirectory();
    const repos = await root.getDirectoryHandle("repos", { create });
    return await repos.getDirectoryHandle(repo.replace("/", "__").toLowerCase(), { create });
  } catch {
    return null;
  }
}

export async function readPack(repo: string, head: string): Promise<Uint8Array | null> {
  try {
    const dir = await repoDir(repo, false);
    const file = await dir?.getFileHandle(`${head}.pack`);
    return file ? new Uint8Array(await (await file.getFile()).arrayBuffer()) : null;
  } catch {
    return null;
  }
}

export async function writePack(repo: string, head: string, pack: Uint8Array): Promise<void> {
  try {
    const dir = await repoDir(repo, true);
    if (!dir) return;
    const file = await dir.getFileHandle(`${head}.pack`, { create: true });
    const writable = await file.createWritable();
    await writable.write(pack as BufferSource);
    await writable.close();
    // Older heads of the same repository are no longer needed. Removed only
    // once the new pack is written, so a write cut short (the tab closed or
    // moved on) leaves the old one rather than nothing.
    const names: string[] = [];
    for await (const name of (dir as unknown as { keys(): AsyncIterable<string> }).keys()) names.push(name);
    for (const name of names) if (!name.startsWith(`${head}.`)) await dir.removeEntry(name, { recursive: true });
  } catch {
    // Storage is full or unavailable: nothing to do.
  }
}

async function write(dir: FileSystemDirectoryHandle, name: string, text: string): Promise<void> {
  const file = await dir.getFileHandle(name, { create: true });
  const writable = await file.createWritable();
  await writable.write(text);
  await writable.close();
}

async function read(dir: FileSystemDirectoryHandle | null | undefined, name: string): Promise<string | null> {
  try {
    const file = await dir?.getFileHandle(name);
    return file ? await (await file.getFile()).text() : null;
  } catch {
    return null;
  }
}

/** The finished data file kept for a pack, made by core `core`, or null. */
export async function readData(repo: string, key: string, core: string): Promise<string | null> {
  return read(await repoDir(repo, false), `${key}.${core}.json`);
}

/** Keeps the finished data file for a pack; drops what older cores made for it. */
export async function writeData(repo: string, key: string, core: string, json: string): Promise<void> {
  try {
    const dir = await repoDir(repo, true);
    if (!dir) return;
    await write(dir, `${key}.${core}.json`, json);
    const names: string[] = [];
    for await (const name of (dir as unknown as { keys(): AsyncIterable<string> }).keys()) names.push(name);
    for (const name of names) {
      const ours = name === `${key}.pack` || name.startsWith(`${key}.${core}.`);
      if (name.startsWith(`${key}.`) && !ours) await dir.removeEntry(name, { recursive: true });
    }
  } catch {
    // Storage is full or unavailable.
  }
}

async function linesDir(repo: string, key: string, core: string, create: boolean) {
  try {
    const dir = await repoDir(repo, create);
    return (await dir?.getDirectoryHandle(`${key}.${core}.lines`, { create })) ?? null;
  } catch {
    return null;
  }
}

/** A file's kept line history: its JSON, "null" for none, or undefined when not kept. */
export async function readLines(repo: string, key: string, core: string, file: number): Promise<string | undefined> {
  return (await read(await linesDir(repo, key, core, false), String(file))) ?? undefined;
}

export async function writeLines(repo: string, key: string, core: string, file: number, json: string | null) {
  try {
    const dir = await linesDir(repo, key, core, true);
    if (dir) await write(dir, String(file), json ?? "null");
  } catch {
    // Storage is full or unavailable.
  }
}

/** Drops the line histories kept for a pack. */
export async function clearLines(repo: string, key: string, core: string): Promise<void> {
  try {
    await (await repoDir(repo, false))?.removeEntry(`${key}.${core}.lines`, { recursive: true });
  } catch {
    // None kept.
  }
}

export interface StoredRepo {
  /** "owner/name", lowercased as stored. */
  repo: string;
  bytes: number;
}

type Entries = { entries(): AsyncIterable<[string, FileSystemHandle]> };

async function sizeOf(dir: FileSystemDirectoryHandle): Promise<number> {
  let bytes = 0;
  for await (const [, h] of (dir as unknown as Entries).entries()) {
    bytes +=
      h.kind === "file" ? (await (h as FileSystemFileHandle).getFile()).size : await sizeOf(h as FileSystemDirectoryHandle);
  }
  return bytes;
}

/** The repositories kept in this browser, biggest first. Empty without storage. */
export async function listStored(): Promise<StoredRepo[]> {
  const out: StoredRepo[] = [];
  try {
    const root = await navigator.storage.getDirectory();
    const repos = await root.getDirectoryHandle("repos");
    for await (const [name, handle] of (repos as unknown as Entries).entries()) {
      if (handle.kind !== "directory") continue;
      const bytes = await sizeOf(handle as FileSystemDirectoryHandle);
      if (bytes > 0) out.push({ repo: name.replace("__", "/"), bytes });
    }
  } catch {
    // No storage, or nothing kept yet.
  }
  return out.sort((a, b) => b.bytes - a.bytes);
}

/** Deletes every repository kept in this browser. */
export async function clearStored(): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry("repos", { recursive: true });
  } catch {
    // Nothing to clear.
  }
}
