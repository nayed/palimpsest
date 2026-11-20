//! Palimpsest's history logic: walk a repository's first-parent history and
//! turn it into the tracks the app draws.
//!
//! The same code runs natively (the command-line tool builds the demo data) and
//! as WebAssembly (reading pasted repositories in the browser).

pub mod authors;
pub mod build;
pub mod clips;
pub mod diff;
pub mod format;
pub mod lines;
pub mod mem;
pub mod source;
pub mod text;
pub mod time;
pub mod vendored;

#[cfg(feature = "git")]
pub mod git;

pub use build::{Output, assemble, assemble_all, build, build_all};
pub use format::Data;
pub use source::Source;

/// Tunable rules. The defaults are the starting points from the project brief;
/// tune them on the demo repositories.
#[derive(Clone, Debug)]
pub struct Options {
    /// "owner/name", written into the data file.
    pub name: String,
    /// Authors who get a color. Everyone else is Others.
    pub ranked_authors: usize,
    /// A stretch with no commit this long, in months, is drawn as Untouched.
    pub untouched_months: i32,
    /// An author's stretch shorter than this, in months, is absorbed by the
    /// longer neighboring stretch. 1 keeps every month as it is.
    pub min_clip_months: i32,
    /// Follow individual lines (line history and who wrote today's code).
    pub line_history: bool,
    /// How alike an old and a new line must be to count as the same line
    /// rewritten rather than one line dying and another being born (0 to 1).
    pub line_similarity: f64,
    /// How alike a deleted and an added file must be to count as a rename (0 to 1).
    pub rename_similarity: f64,
    /// Skip similarity matching when a commit has more deleted × added file
    /// pairs than this (exact renames are still found).
    pub rename_limit: usize,
    /// Folder rows in Overview, not counting "everything else".
    pub overview_rows: usize,
    /// Overview goes one level deeper while one folder holds this share of the code.
    pub descend_share: f64,
    /// Notable moments kept for Overview. The app shows two or three.
    pub max_moments: usize,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            name: String::new(),
            ranked_authors: 5,
            untouched_months: 12,
            min_clip_months: 3,
            line_history: true,
            line_similarity: 0.5,
            rename_similarity: 0.5,
            rename_limit: 10_000,
            overview_rows: 5,
            descend_share: 0.6,
            max_moments: 10,
        }
    }
}
