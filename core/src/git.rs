//! A [`Source`] backed by a git repository on disk, read with gitoxide.

use std::path::Path;

use crate::source::{EntryKind, Oid, RawCommit, Result, Source, TreeEntry};
use crate::tags::RawTag;

pub struct GitSource {
    repo: gix::Repository,
    mailmap: gix::mailmap::Snapshot,
}

impl GitSource {
    pub fn open(path: &Path) -> Result<Self> {
        let mut repo = gix::open(path)?;
        repo.object_cache_size_if_unset(64 << 20);
        let mailmap = repo.open_mailmap();
        Ok(Self { repo, mailmap })
    }
}

fn to_oid(id: &gix::oid) -> Oid {
    let mut bytes = [0u8; 20];
    bytes.copy_from_slice(id.as_bytes());
    Oid(bytes)
}

fn to_gix(id: Oid) -> gix::ObjectId {
    gix::ObjectId::from_bytes_or_panic(&id.0)
}

impl Source for GitSource {
    fn head(&self) -> Result<Oid> {
        let id = self.repo.head_id()?;
        Ok(to_oid(&id))
    }

    fn commit(&self, id: Oid) -> Result<RawCommit> {
        let commit = self.repo.find_commit(to_gix(id))?;
        let decoded = commit.decode()?;
        let author = self.mailmap.resolve(decoded.author()?.trim());
        let time = decoded.committer()?.seconds();
        Ok(RawCommit {
            id,
            tree: to_oid(&decoded.tree()),
            parents: decoded.parents().map(|p| to_oid(&p)).collect(),
            author_name: String::from_utf8_lossy(&author.name).trim().to_string(),
            author_email: String::from_utf8_lossy(&author.email).trim().to_string(),
            time,
            message: String::from_utf8_lossy(decoded.message).into_owned(),
            credits: Default::default(),
        })
    }

    fn tree(&self, id: Oid) -> Result<Vec<TreeEntry>> {
        let tree = self.repo.find_tree(to_gix(id))?;
        let decoded = tree.decode()?;
        Ok(decoded
            .entries
            .iter()
            .map(|e| TreeEntry {
                name: String::from_utf8_lossy(e.filename).into_owned(),
                kind: if e.mode.is_tree() {
                    EntryKind::Dir
                } else if e.mode.is_blob() {
                    EntryKind::File
                } else {
                    EntryKind::Other
                },
                id: to_oid(e.oid),
            })
            .collect())
    }

    fn blob(&self, id: Oid) -> Result<Vec<u8>> {
        let mut blob = self.repo.find_blob(to_gix(id))?;
        Ok(std::mem::take(&mut blob.data))
    }

    fn tags(&self) -> Result<Vec<RawTag>> {
        let mut out = Vec::new();
        for r in self.repo.references()?.tags()? {
            let Ok(mut r) = r else { continue };
            let name = r.name().shorten().to_string();
            // The tagger's date, when the tag is an annotated tag object.
            let time = r
                .target()
                .try_id()
                .and_then(|id| self.repo.find_object(id).ok())
                .and_then(|o| o.try_into_tag().ok())
                .and_then(|t| t.tagger().ok().flatten().map(|s| s.seconds()));
            let Ok(id) = r.peel_to_id() else { continue };
            out.push(RawTag {
                name,
                commit: to_oid(&id),
                time,
            });
        }
        Ok(out)
    }
}
