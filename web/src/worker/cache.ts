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
    // Older heads of the same repository are no longer needed.
    for await (const name of (dir as unknown as { keys(): AsyncIterable<string> }).keys()) {
      if (name !== `${head}.pack`) await dir.removeEntry(name);
    }
    const file = await dir.getFileHandle(`${head}.pack`, { create: true });
    const writable = await file.createWritable();
    await writable.write(pack as BufferSource);
    await writable.close();
  } catch {
    // Storage is full or unavailable: nothing to do.
  }
}
