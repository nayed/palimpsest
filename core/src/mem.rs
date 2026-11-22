//! An in-memory repository for tests and fixtures. Each commit is given as the
//! full set of files after it; trees and object ids are derived from content,
//! so identical files and folders share ids just as in git.

use std::collections::{BTreeMap, HashMap};

use crate::source::{EntryKind, Oid, RawCommit, Result, Source, TreeEntry};

#[derive(Default)]
pub struct MemRepo {
    commits: HashMap<Oid, RawCommit>,
    trees: HashMap<Oid, Vec<TreeEntry>>,
    blobs: HashMap<Oid, Vec<u8>>,
    head: Option<Oid>,
}

fn hash(kind: &str, parts: &[&[u8]]) -> Oid {
    // Two FNV-1a passes with different seeds: plenty for test fixtures.
    let mut out = [0u8; 20];
    for (k, seed) in [
        (0, 0xcbf2_9ce4_8422_2325u64),
        (8, 0x1000_0000_01b3u64 ^ 0xdead_beef),
    ] {
        let mut h = seed;
        for b in kind
            .bytes()
            .chain(parts.iter().flat_map(|p| p.iter().copied().chain([0xff])))
        {
            h ^= b as u64;
            h = h.wrapping_mul(0x0100_0000_01b3);
        }
        out[k..k + 8].copy_from_slice(&h.to_be_bytes());
    }
    Oid(out)
}

impl MemRepo {
    pub fn new() -> Self {
        Self::default()
    }

    /// Adds a commit on top of the head. `author` is "Name" or
    /// "Name <email>"; `files` maps paths to contents.
    pub fn commit(
        &mut self,
        author: &str,
        time: i64,
        message: &str,
        files: &BTreeMap<String, String>,
    ) -> Oid {
        let tree = self.write_tree(
            files
                .iter()
                .map(|(p, c)| (p.as_str(), c.as_bytes()))
                .collect(),
        );
        let (name, email) = match author.split_once(" <") {
            Some((n, e)) => (n.to_string(), e.trim_end_matches('>').to_string()),
            None => (
                author.to_string(),
                format!("{}@example.com", author.to_lowercase().replace(' ', ".")),
            ),
        };
        let parents: Vec<Oid> = self.head.into_iter().collect();
        let parent_bytes: Vec<u8> = parents.iter().flat_map(|p| p.0).collect();
        let id = hash(
            "commit",
            &[
                &tree.0,
                &parent_bytes,
                author.as_bytes(),
                &time.to_be_bytes(),
                message.as_bytes(),
            ],
        );
        self.commits.insert(
            id,
            RawCommit {
                id,
                tree,
                parents,
                author_name: name,
                author_email: email,
                time,
                message: message.to_string(),
            },
        );
        self.head = Some(id);
        id
    }

    fn write_tree(&mut self, files: Vec<(&str, &[u8])>) -> Oid {
        let mut here: BTreeMap<String, TreeEntry> = BTreeMap::new();
        let mut sub: BTreeMap<&str, Vec<(&str, &[u8])>> = BTreeMap::new();
        for (path, content) in files {
            match path.split_once('/') {
                Some((dir, rest)) => sub.entry(dir).or_default().push((rest, content)),
                None => {
                    let id = hash("blob", &[content]);
                    self.blobs.insert(id, content.to_vec());
                    here.insert(
                        path.to_string(),
                        TreeEntry {
                            name: path.to_string(),
                            kind: EntryKind::File,
                            id,
                        },
                    );
                }
            }
        }
        for (dir, files) in sub {
            let id = self.write_tree(files);
            here.insert(
                dir.to_string(),
                TreeEntry {
                    name: dir.to_string(),
                    kind: EntryKind::Dir,
                    id,
                },
            );
        }
        let entries: Vec<TreeEntry> = here.into_values().collect();
        let mut bytes = Vec::new();
        for e in &entries {
            bytes.extend_from_slice(e.name.as_bytes());
            bytes.push(e.kind as u8);
            bytes.extend_from_slice(&e.id.0);
        }
        let id = hash("tree", &[&bytes]);
        self.trees.insert(id, entries);
        id
    }
}

impl MemRepo {
    /// Drops a commit, as a shallow download leaves out what is older than
    /// its window: commits pointing to it then point to nothing.
    pub fn forget(&mut self, id: Oid) {
        self.commits.remove(&id);
    }
}

impl Source for MemRepo {
    fn head(&self) -> Result<Oid> {
        self.head.ok_or_else(|| "empty repository".into())
    }
    fn commit(&self, id: Oid) -> Result<RawCommit> {
        self.commits
            .get(&id)
            .cloned()
            .ok_or_else(|| format!("no commit {id:?}").into())
    }
    fn tree(&self, id: Oid) -> Result<Vec<TreeEntry>> {
        self.trees
            .get(&id)
            .cloned()
            .ok_or_else(|| format!("no tree {id:?}").into())
    }
    fn blob(&self, id: Oid) -> Result<Vec<u8>> {
        self.blobs
            .get(&id)
            .cloned()
            .ok_or_else(|| format!("no blob {id:?}").into())
    }
}
