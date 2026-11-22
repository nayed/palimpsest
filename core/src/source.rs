//! Where git objects come from.
//!
//! The history logic only needs four things from a repository: the head commit,
//! and commits, trees and blobs by id. Keeping that behind a trait means the same
//! code runs on a local clone (the command-line tool, through gitoxide), on a pack
//! file downloaded in the browser (WebAssembly), and on small in-memory fixtures
//! (the tests).

use std::fmt;

/// A SHA-1 object id.
#[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct Oid(pub [u8; 20]);

impl Oid {
    pub fn to_hex(&self) -> String {
        let mut s = String::with_capacity(40);
        for b in self.0 {
            s.push_str(&format!("{b:02x}"));
        }
        s
    }
}

impl fmt::Debug for Oid {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.to_hex()[..10])
    }
}

/// A commit as the history logic needs it. The author is already resolved
/// through the repository's mailmap, if it has one.
#[derive(Clone, Debug)]
pub struct RawCommit {
    pub id: Oid,
    pub tree: Oid,
    pub parents: Vec<Oid>,
    pub author_name: String,
    pub author_email: String,
    /// Committer time in seconds since the Unix epoch. The committer time is
    /// used rather than the author time because it follows the order commits
    /// landed on the branch.
    pub time: i64,
    pub message: String,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum EntryKind {
    Dir,
    File,
    /// Symbolic links and submodules. They are not tracked.
    Other,
}

#[derive(Clone, Debug)]
pub struct TreeEntry {
    pub name: String,
    pub kind: EntryKind,
    pub id: Oid,
}

pub type Error = Box<dyn std::error::Error + Send + Sync>;
pub type Result<T> = std::result::Result<T, Error>;

pub trait Source {
    fn head(&self) -> Result<Oid>;
    fn commit(&self, id: Oid) -> Result<RawCommit>;
    fn tree(&self, id: Oid) -> Result<Vec<TreeEntry>>;
    fn blob(&self, id: Oid) -> Result<Vec<u8>>;
    /// The repository's tags. A source without them has none.
    fn tags(&self) -> Result<Vec<crate::tags::RawTag>> {
        Ok(Vec::new())
    }
}
