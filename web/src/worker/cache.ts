// Downloaded packs kept in this browser's private file system (OPFS), so
// opening a repository again skips the download when its head has not moved.
// Everything here is best effort: without storage, repositories are simply
// downloaded again.

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
    for (const name of names) if (name !== `${head}.pack`) await dir.removeEntry(name);
  } catch {
    // Storage is full or unavailable: nothing to do.
  }
}

export interface StoredRepo {
  /** "owner/name", lowercased as stored. */
  repo: string;
  bytes: number;
}

type Entries = { entries(): AsyncIterable<[string, FileSystemHandle]> };

/** The repositories kept in this browser, biggest first. Empty without storage. */
export async function listStored(): Promise<StoredRepo[]> {
  const out: StoredRepo[] = [];
  try {
    const root = await navigator.storage.getDirectory();
    const repos = await root.getDirectoryHandle("repos");
    for await (const [name, handle] of (repos as unknown as Entries).entries()) {
      if (handle.kind !== "directory") continue;
      let bytes = 0;
      for await (const [, file] of (handle as unknown as Entries).entries()) {
        if (file.kind === "file") bytes += (await (file as FileSystemFileHandle).getFile()).size;
      }
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
