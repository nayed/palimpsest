//! What one commit did to the files, compared with its first parent.
//!
//! Each commit is diffed on its own, so commits can be processed in any order
//! (oldest first natively, newest first in the browser) and the cheap assembly
//! pass in `build` runs afterwards.

use std::collections::{BTreeMap, HashMap};

use crate::Options;
use crate::source::{EntryKind, Oid, Result, Source, TreeEntry};
use crate::text;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum ChangeKind {
    Added = 0,
    Modified = 1,
    Deleted = 2,
    /// Moved or renamed, possibly also edited.
    Renamed = 3,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FileChange {
    pub kind: ChangeKind,
    /// The path after the commit, or the deleted path for a deletion.
    pub path: String,
    /// The path before a rename.
    pub old_path: Option<String>,
    pub added: u32,
    pub deleted: u32,
    pub lines_before: u32,
    pub lines_after: u32,
}

enum Delta {
    Added { path: String, id: Oid },
    Deleted { path: String, id: Oid },
    Modified { path: String, old: Oid, new: Oid },
}

/// The file changes between two trees, with renames detected.
pub fn diff_commit(
    src: &dyn Source,
    parent_tree: Option<Oid>,
    tree: Oid,
    opts: &Options,
) -> Result<Vec<FileChange>> {
    let mut deltas = Vec::new();
    walk(src, "", parent_tree, Some(tree), &mut deltas)?;

    let mut blobs = BlobCache::new(src);
    let mut out = Vec::new();
    let mut added = Vec::new();
    let mut deleted = Vec::new();
    for delta in deltas {
        match delta {
            Delta::Modified { path, old, new } => {
                let (a, d) = blobs.diff_counts(old, new)?;
                out.push(FileChange {
                    kind: ChangeKind::Modified,
                    path,
                    old_path: None,
                    added: a,
                    deleted: d,
                    lines_before: blobs.lines(old)?,
                    lines_after: blobs.lines(new)?,
                });
            }
            Delta::Added { path, id } => added.push((path, id)),
            Delta::Deleted { path, id } => deleted.push((path, id)),
        }
    }

    for (old, new) in pair_renames(&mut blobs, &deleted, &added, opts)? {
        let (old_path, old_id) = &deleted[old];
        let (new_path, new_id) = &added[new];
        let (a, d) = if old_id == new_id {
            (0, 0)
        } else {
            blobs.diff_counts(*old_id, *new_id)?
        };
        out.push(FileChange {
            kind: ChangeKind::Renamed,
            path: new_path.clone(),
            old_path: Some(old_path.clone()),
            added: a,
            deleted: d,
            lines_before: blobs.lines(*old_id)?,
            lines_after: blobs.lines(*new_id)?,
        });
        deleted[old].0.clear();
        added[new].0.clear();
    }
    for (path, id) in added.into_iter().filter(|(p, _)| !p.is_empty()) {
        let lines = blobs.lines(id)?;
        out.push(FileChange {
            kind: ChangeKind::Added,
            path,
            old_path: None,
            added: lines,
            deleted: 0,
            lines_before: 0,
            lines_after: lines,
        });
    }
    for (path, id) in deleted.into_iter().filter(|(p, _)| !p.is_empty()) {
        let lines = blobs.lines(id)?;
        out.push(FileChange {
            kind: ChangeKind::Deleted,
            path,
            old_path: None,
            added: 0,
            deleted: lines,
            lines_before: lines,
            lines_after: 0,
        });
    }
    out.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(out)
}

/// Pairs deleted and added files that are the same file moved. Exact content
/// matches first, then the most similar pairs above the threshold, as
/// `git log -M` does. Returns (index in `deleted`, index in `added`).
fn pair_renames(
    blobs: &mut BlobCache,
    deleted: &[(String, Oid)],
    added: &[(String, Oid)],
    opts: &Options,
) -> Result<Vec<(usize, usize)>> {
    let mut pairs = Vec::new();
    if deleted.is_empty() || added.is_empty() {
        return Ok(pairs);
    }
    let mut used_old = vec![false; deleted.len()];
    let mut used_new = vec![false; added.len()];

    // Exact: the same blob deleted under one path and added under another.
    // When several candidates share content, prefer the same file name.
    let mut by_id: HashMap<Oid, Vec<usize>> = HashMap::new();
    for (i, (_, id)) in deleted.iter().enumerate() {
        by_id.entry(*id).or_default().push(i);
    }
    for (j, (path, id)) in added.iter().enumerate() {
        if let Some(candidates) = by_id.get(id) {
            let free = candidates.iter().copied().filter(|&i| !used_old[i]);
            let best = free.max_by_key(|&i| file_name(&deleted[i].0) == file_name(path));
            if let Some(i) = best {
                used_old[i] = true;
                used_new[j] = true;
                pairs.push((i, j));
            }
        }
    }

    // Similar: score every remaining pair, unless there are too many.
    let old_left: Vec<usize> = (0..deleted.len()).filter(|&i| !used_old[i]).collect();
    let new_left: Vec<usize> = (0..added.len()).filter(|&j| !used_new[j]).collect();
    if old_left.is_empty()
        || new_left.is_empty()
        || old_left.len() * new_left.len() > opts.rename_limit
    {
        return Ok(pairs);
    }
    let mut scored = Vec::new();
    for &i in &old_left {
        for &j in &new_left {
            let (a, b) = (blobs.lines(deleted[i].1)?, blobs.lines(added[j].1)?);
            // Two files cannot reach the threshold when one is much longer.
            if a == 0
                || b == 0
                || (a.min(b) as f64) * 2.0 / ((a + b) as f64) < opts.rename_similarity
            {
                continue;
            }
            let score = blobs.similarity(deleted[i].1, added[j].1)?;
            if score >= opts.rename_similarity {
                let same_name = file_name(&deleted[i].0) == file_name(&added[j].0);
                scored.push((score, same_name, i, j));
            }
        }
    }
    scored.sort_by(|a, b| {
        b.0.total_cmp(&a.0)
            .then(b.1.cmp(&a.1))
            .then((a.2, a.3).cmp(&(b.2, b.3)))
    });
    for (_, _, i, j) in scored {
        if !used_old[i] && !used_new[j] {
            used_old[i] = true;
            used_new[j] = true;
            pairs.push((i, j));
        }
    }
    Ok(pairs)
}

fn file_name(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

fn join(prefix: &str, name: &str) -> String {
    if prefix.is_empty() {
        name.to_string()
    } else {
        format!("{prefix}/{name}")
    }
}

/// Recursively compares two trees, skipping subtrees whose ids match.
fn walk(
    src: &dyn Source,
    prefix: &str,
    old: Option<Oid>,
    new: Option<Oid>,
    out: &mut Vec<Delta>,
) -> Result<()> {
    if old == new {
        return Ok(());
    }
    let old_entries = match old {
        Some(id) => src.tree(id)?,
        None => Vec::new(),
    };
    let new_entries = match new {
        Some(id) => src.tree(id)?,
        None => Vec::new(),
    };
    let mut both: BTreeMap<&str, (Option<&TreeEntry>, Option<&TreeEntry>)> = BTreeMap::new();
    for e in &old_entries {
        both.entry(&e.name).or_default().0 = Some(e);
    }
    for e in &new_entries {
        both.entry(&e.name).or_default().1 = Some(e);
    }
    for (name, (o, n)) in both {
        let path = join(prefix, name);
        let o = o.filter(|e| e.kind != EntryKind::Other);
        let n = n.filter(|e| e.kind != EntryKind::Other);
        match (o, n) {
            (Some(o), Some(n)) if o.kind == EntryKind::Dir && n.kind == EntryKind::Dir => {
                walk(src, &path, Some(o.id), Some(n.id), out)?;
            }
            (Some(o), Some(n)) if o.kind == EntryKind::File && n.kind == EntryKind::File => {
                if o.id != n.id {
                    out.push(Delta::Modified {
                        path,
                        old: o.id,
                        new: n.id,
                    });
                }
            }
            (o, n) => {
                if let Some(o) = o {
                    match o.kind {
                        EntryKind::Dir => walk(src, &path, Some(o.id), None, out)?,
                        _ => out.push(Delta::Deleted {
                            path: path.clone(),
                            id: o.id,
                        }),
                    }
                }
                if let Some(n) = n {
                    match n.kind {
                        EntryKind::Dir => walk(src, &path, None, Some(n.id), out)?,
                        _ => out.push(Delta::Added { path, id: n.id }),
                    }
                }
            }
        }
    }
    Ok(())
}

struct BlobCache<'a> {
    src: &'a dyn Source,
    data: HashMap<Oid, Vec<u8>>,
}

impl<'a> BlobCache<'a> {
    fn new(src: &'a dyn Source) -> Self {
        Self {
            src,
            data: HashMap::new(),
        }
    }

    fn get(&mut self, id: Oid) -> Result<&[u8]> {
        if !self.data.contains_key(&id) {
            let blob = self.src.blob(id)?;
            self.data.insert(id, blob);
        }
        Ok(&self.data[&id])
    }

    fn both(&mut self, a: Oid, b: Oid) -> Result<(&[u8], &[u8])> {
        self.get(a)?;
        self.get(b)?;
        Ok((&self.data[&a], &self.data[&b]))
    }

    fn diff_counts(&mut self, a: Oid, b: Oid) -> Result<(u32, u32)> {
        let (a, b) = self.both(a, b)?;
        Ok(text::diff_counts(a, b))
    }

    fn similarity(&mut self, a: Oid, b: Oid) -> Result<f64> {
        let (a, b) = self.both(a, b)?;
        Ok(text::similarity(a, b))
    }

    fn lines(&mut self, id: Oid) -> Result<u32> {
        Ok(text::line_count(self.get(id)?))
    }
}
