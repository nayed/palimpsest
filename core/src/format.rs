//! The data format the app loads, version 1.
//!
//! One JSON document per repository. Tables are stored column by column
//! (`commits.time[i]`, `commits.author[i]`, ...) so they load straight into
//! typed arrays and no string is repeated: files point into `paths`, commits
//! and clips point into `authors`. Variable-length lists are flattened with a
//! `start` column of offsets: the entries of item `i` are `start[i]..start[i+1]`.
//!
//! Times are seconds since the Unix epoch, UTC.
//!
//! Not in version 1 yet: who wrote the code that exists at each moment, and the
//! per-file line history. Both come with the Lines view (build step 3).

use serde::{Deserialize, Serialize};

pub const FORMAT: &str = "palimpsest";
pub const VERSION: u32 = 1;

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Data {
    /// Always "palimpsest".
    pub format: String,
    pub version: u32,
    pub repo: Repo,
    pub authors: Authors,
    pub commits: Commits,
    /// Every path any file has had. Files refer to them by index.
    pub paths: Vec<String>,
    pub files: Files,
    pub changes: Changes,
    pub clips: Clips,
    pub overview: Overview,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Repo {
    /// "owner/name".
    pub name: String,
    /// Full id of the newest commit.
    pub head: String,
    pub commit_count: u32,
    /// Time of the first and the last commit.
    pub start: i64,
    pub end: i64,
}

/// Indexed by author id.
#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Authors {
    pub name: Vec<String>,
    pub initials: Vec<String>,
    /// Commits on the first-parent history.
    pub commits: Vec<u32>,
    /// 1 to 5 picks the author color; 0 is Others (sixth place down, and bots).
    pub rank: Vec<u8>,
    pub bot: Vec<bool>,
}

/// Indexed by commit, oldest first, along the first-parent history.
#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Commits {
    /// Committer time, made non-decreasing so the playhead only moves forward.
    pub time: Vec<i64>,
    pub author: Vec<u32>,
    /// Abbreviated id (7 characters).
    pub hash: Vec<String>,
    pub subject: Vec<String>,
    /// The first paragraph of the body: why the change was made. Often empty.
    pub why: Vec<String>,
}

/// Indexed by file id. A file keeps its id across renames; a path deleted and
/// added again later is a new file.
#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Files {
    /// The commit that created the file.
    pub born: Vec<u32>,
    /// The commit that deleted it, or -1 if it still exists.
    pub died: Vec<i32>,
    /// Number of commits that changed it, including its birth and death.
    pub commits: Vec<u32>,
    /// Line count at the newest commit, or just before it was deleted.
    pub lines: Vec<u32>,
    /// Vendored, generated or a lock file: left out of folder sizes, and best
    /// left out of the files Tracks picks.
    pub vendored: Vec<bool>,
    /// Offsets into `pathCommit` and `path`, one more than there are files.
    pub path_start: Vec<u32>,
    /// From this commit on, the file was at `paths[path[k]]`.
    pub path_commit: Vec<u32>,
    pub path: Vec<u32>,
}

/// Indexed through `start`, by commit: what each commit did to the files.
#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Changes {
    /// Offsets, one more than there are commits.
    pub start: Vec<u32>,
    pub file: Vec<u32>,
    /// 0 added, 1 modified, 2 deleted, 3 renamed (moved, maybe also edited).
    pub kind: Vec<u8>,
    pub added: Vec<u32>,
    pub deleted: Vec<u32>,
}

/// Indexed through `start`, by file: who was writing it, from when to when.
#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Clips {
    /// Offsets, one more than there are files.
    pub start: Vec<u32>,
    pub from: Vec<i64>,
    pub to: Vec<i64>,
    /// Author id, or -1 for Untouched.
    pub author: Vec<i32>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Overview {
    /// Up to five folders, biggest first, then "everything else" if any.
    pub rows: Vec<OverviewRow>,
    /// Calendar months covered by `rows[].sizes`.
    pub first_month_start: i64,
    /// Start time of each month, plus the end of the last one.
    pub month_starts: Vec<i64>,
    /// Folder births and moves between folders, most significant first.
    pub moments: Vec<Moment>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OverviewRow {
    /// "src/parser/", or "everything else".
    pub label: String,
    /// The folder path without a trailing slash; absent for "everything else".
    pub folder: Option<String>,
    pub born: i64,
    pub died: Option<i64>,
    /// Lines at the newest commit, and the most it ever had.
    pub lines: u32,
    pub peak_lines: u32,
    /// Lines at the end of each month.
    pub sizes: Vec<u32>,
    pub clips: Clips,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Moment {
    pub commit: u32,
    /// "folderBorn" or "move".
    pub kind: String,
    /// The folder born, or the folder files moved to.
    pub folder: String,
    /// For a move: the folder they moved from.
    pub from: Option<String>,
    /// For a move: how many files moved between these two folders (the commit
    /// may have moved more elsewhere), and the path of one of them. For a
    /// folder birth: how many files it started with.
    pub files: u32,
    pub example: Option<String>,
}
