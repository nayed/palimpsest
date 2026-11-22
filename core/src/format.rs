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
    /// Release tags, oldest first. Added after version 1 shipped, so older
    /// files have none.
    #[serde(default)]
    pub tags: Tags,
}

/// Release tags, for markers on the ruler: the project's own finished
/// versions, at their dates.
#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Tags {
    pub name: Vec<String>,
    pub time: Vec<i64>,
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
    /// Whether line history and `overview.share` are worked out. A repository
    /// read in the browser gets them in the background after its commits.
    pub line_history: bool,
    /// Set while a repository is still being read, newest first: only the
    /// commits from `read_from` on are in the file so far.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub partial: Option<Partial>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Partial {
    /// Time of the oldest commit read so far.
    pub read_from: i64,
    /// Commits in the whole first-parent history.
    pub total_commits: u32,
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
    /// Whether `lines/<file id>.json` holds the file's line history. False
    /// for vendored and binary files.
    pub has_lines: Vec<bool>,
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
    /// Who wrote the code that exists at the end of each month.
    pub share: Share,
}

/// For each month of `Overview::month_starts`, through `start`: the lines
/// alive at the end of the month, counted by the author who last wrote them.
/// Vendored and binary files are not counted.
#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Share {
    pub start: Vec<u32>,
    pub author: Vec<u32>,
    pub lines: Vec<u32>,
}

pub const LINES_FORMAT: &str = "palimpsest-lines";

/// One file's line history, in `lines/<file id>.json`, loaded when the file
/// is opened. Replaying the edits in order gives every line its identity:
/// new lines and new versions are numbered in the order edits create them.
#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LineFile {
    /// Always "palimpsest-lines".
    pub format: String,
    pub version: u32,
    pub file: u32,
    /// The commits that changed the file's lines, oldest first; the author of
    /// each new version is that commit's author.
    pub commits: Vec<u32>,
    /// Offsets into `ops`, one more than there are commits.
    pub ops_start: Vec<u32>,
    /// Pairs of (operation, count): 0 keep, 1 delete, 2 insert, 3 rewrite,
    /// applied to the lines from the top. Lines after the last pair are kept.
    pub ops: Vec<u32>,
    /// Text of each inserted or rewritten line, in the order the edits use them.
    pub texts: Vec<String>,
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
