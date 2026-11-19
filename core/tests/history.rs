//! End-to-end tests on small in-memory repositories.

use std::collections::BTreeMap;

use palimpsest_core::format::Data;
use palimpsest_core::mem::MemRepo;
use palimpsest_core::{Options, build};

/// Noon UTC, `n` days after 1 January 2020.
fn day(n: i64) -> i64 {
    1_577_836_800 + n * 86_400 + 43_200
}

/// A repository built one commit at a time from the full file set.
struct Fixture {
    repo: MemRepo,
    files: BTreeMap<String, String>,
}

impl Fixture {
    fn new() -> Self {
        Self {
            repo: MemRepo::new(),
            files: BTreeMap::new(),
        }
    }
    fn write(&mut self, path: &str, content: &str) -> &mut Self {
        self.files.insert(path.into(), content.into());
        self
    }
    fn remove(&mut self, path: &str) -> &mut Self {
        self.files.remove(path);
        self
    }
    fn mv(&mut self, from: &str, to: &str) -> &mut Self {
        let c = self.files.remove(from).unwrap();
        self.files.insert(to.into(), c);
        self
    }
    fn commit(&mut self, author: &str, day_n: i64, message: &str) -> &mut Self {
        self.repo.commit(author, day(day_n), message, &self.files);
        self
    }
    fn build(&self) -> Data {
        let data = build(
            &self.repo,
            &Options {
                name: "test/repo".into(),
                ..Default::default()
            },
            &mut |_, _| {},
        )
        .unwrap();
        check_invariants(&data);
        data
    }
}

fn lines(n: usize, tag: &str) -> String {
    (0..n).map(|i| format!("{tag} line {i}\n")).collect()
}

fn file_id(d: &Data, path: &str) -> usize {
    let p = d.paths.iter().position(|x| x == path).expect(path) as u32;
    (0..d.files.born.len())
        .rev()
        .find(|&f| {
            let s = d.files.path_start[f] as usize..d.files.path_start[f + 1] as usize;
            d.files.path[s].contains(&p)
        })
        .unwrap()
}

fn file_paths(d: &Data, f: usize) -> Vec<&str> {
    let s = d.files.path_start[f] as usize..d.files.path_start[f + 1] as usize;
    d.files.path[s]
        .iter()
        .map(|&p| d.paths[p as usize].as_str())
        .collect()
}

/// (author name or "untouched") for each clip of a file.
fn clip_authors(d: &Data, f: usize) -> Vec<String> {
    let s = d.clips.start[f] as usize..d.clips.start[f + 1] as usize;
    d.clips.author[s]
        .iter()
        .map(|&a| {
            if a < 0 {
                "untouched".into()
            } else {
                d.authors.name[a as usize].clone()
            }
        })
        .collect()
}

/// Structural rules every data file must follow.
fn check_invariants(d: &Data) {
    let n = d.repo.commit_count as usize;
    assert_eq!(d.commits.time.len(), n);
    assert!(
        d.commits.time.windows(2).all(|w| w[0] <= w[1]),
        "times go forward"
    );
    assert_eq!(d.changes.start.len(), n + 1);
    let files = d.files.born.len();
    assert_eq!(d.files.path_start.len(), files + 1);
    assert_eq!(d.clips.start.len(), files + 1);
    for f in 0..files {
        let born = d.commits.time[d.files.born[f] as usize];
        let end = match d.files.died[f] {
            -1 => d.repo.end,
            c => d.commits.time[c as usize],
        };
        let s = d.clips.start[f] as usize..d.clips.start[f + 1] as usize;
        if end > born {
            assert!(!s.is_empty(), "file {f} has clips");
            assert_eq!(d.clips.from[s.start], born, "clips start at birth");
            assert_eq!(d.clips.to[s.end - 1], end, "clips end at death or now");
        }
        for k in s.clone() {
            assert!(d.clips.from[k] < d.clips.to[k]);
            if k + 1 < s.end {
                assert_eq!(d.clips.to[k], d.clips.from[k + 1], "clips touch");
                assert_ne!(d.clips.author[k], d.clips.author[k + 1], "neighbors differ");
            }
        }
    }
    for row in &d.overview.rows {
        assert_eq!(row.sizes.len() + 1, d.overview.month_starts.len());
        assert_eq!(*row.sizes.last().unwrap(), row.lines);
    }
}

#[test]
fn files_are_born_changed_and_deleted() {
    let mut fx = Fixture::new();
    fx.write("a.txt", &lines(3, "a"))
        .write("b.txt", &lines(2, "b"))
        .commit("Ann Lee", 0, "Start\n\nWhy we start.\n");
    fx.write("a.txt", "a line 0\nchanged\na line 2\nextra\n")
        .commit("Bo Kim", 1, "Edit a");
    fx.remove("b.txt").commit("Bo Kim", 2, "Drop b");
    let d = fx.build();

    assert_eq!(d.repo.commit_count, 3);
    assert_eq!(d.commits.subject, ["Start", "Edit a", "Drop b"]);
    assert_eq!(d.commits.why, ["Why we start.", "", ""]);
    assert_eq!(d.authors.name, ["Ann Lee", "Bo Kim"]);
    assert_eq!(d.authors.rank, [2, 1]);

    let (a, b) = (file_id(&d, "a.txt"), file_id(&d, "b.txt"));
    assert_eq!((d.files.born[a], d.files.died[a]), (0, -1));
    assert_eq!((d.files.born[b], d.files.died[b]), (0, 2));
    assert_eq!(d.files.lines[a], 4);
    assert_eq!(d.files.commits[a], 2);

    // Commit 1 changed a.txt: one line rewritten, one added.
    let c1 = d.changes.start[1] as usize..d.changes.start[2] as usize;
    assert_eq!(d.changes.file[c1.clone()], [a as u32]);
    assert_eq!(d.changes.kind[c1.clone()], [1]);
    assert_eq!(
        (d.changes.added[c1.start], d.changes.deleted[c1.start]),
        (2, 1)
    );
    // Commit 2 deleted b.txt.
    let c2 = d.changes.start[2] as usize;
    assert_eq!(
        (
            d.changes.file[c2],
            d.changes.kind[c2],
            d.changes.deleted[c2]
        ),
        (b as u32, 2, 2)
    );
}

#[test]
fn a_moved_file_keeps_its_identity() {
    let mut fx = Fixture::new();
    fx.write("src/core/lexer.rs", &lines(20, "lex"))
        .write("src/core/engine.rs", &lines(30, "eng"));
    fx.commit("Ann Lee", 0, "Add lexer");
    fx.mv("src/core/lexer.rs", "src/parser/lexer.rs")
        .commit("Bo Kim", 40, "Move lexer to parser/");
    let d = fx.build();

    assert_eq!(d.files.born.len(), 2, "no new file for the move");
    let f = file_id(&d, "src/parser/lexer.rs");
    assert_eq!(
        file_paths(&d, f),
        ["src/core/lexer.rs", "src/parser/lexer.rs"]
    );
    assert_eq!(d.files.path_commit[d.files.path_start[f] as usize + 1], 1);
    let c1 = d.changes.start[1] as usize;
    assert_eq!(
        (
            d.changes.kind[c1],
            d.changes.added[c1],
            d.changes.deleted[c1]
        ),
        (3, 0, 0)
    );

    let moves: Vec<_> = d
        .overview
        .moments
        .iter()
        .filter(|m| m.kind == "move")
        .collect();
    assert_eq!(moves.len(), 1);
    assert_eq!(
        (
            moves[0].from.as_deref(),
            moves[0].folder.as_str(),
            moves[0].commit
        ),
        (Some("src/core"), "src/parser", 1)
    );
}

#[test]
fn a_moved_and_edited_file_is_still_a_rename() {
    let mut fx = Fixture::new();
    fx.write("old.rs", &lines(10, "x"))
        .commit("Ann Lee", 0, "Add");
    let mut edited = lines(10, "x");
    edited = edited
        .replacen("x line 3", "y line 3", 1)
        .replacen("x line 7", "y line 7", 1);
    fx.remove("old.rs")
        .write("new.rs", &edited)
        .commit("Ann Lee", 1, "Rename and edit");
    let d = fx.build();

    assert_eq!(d.files.born.len(), 1);
    let c1 = d.changes.start[1] as usize;
    assert_eq!(
        (
            d.changes.kind[c1],
            d.changes.added[c1],
            d.changes.deleted[c1]
        ),
        (3, 2, 2)
    );
}

#[test]
fn a_rewrite_is_a_death_and_a_birth() {
    let mut fx = Fixture::new();
    fx.write("main.py", &lines(10, "python"))
        .commit("Ann Lee", 0, "Python");
    fx.remove("main.py")
        .write("main.go", &lines(10, "golang"))
        .commit("Bo Kim", 1, "Rewrite in Go");
    let d = fx.build();

    assert_eq!(d.files.born.len(), 2);
    assert_eq!(d.files.died[file_id(&d, "main.py")], 1);
    assert_eq!(d.files.born[file_id(&d, "main.go")], 1);
}

#[test]
fn a_path_added_again_is_a_new_file() {
    let mut fx = Fixture::new();
    fx.write("a.txt", "one\n").commit("Ann Lee", 0, "Add");
    fx.remove("a.txt")
        .write("keep", "k\n")
        .commit("Ann Lee", 1, "Remove");
    fx.write("a.txt", "two\n").commit("Ann Lee", 2, "Add again");
    let d = fx.build();

    assert_eq!(d.files.born.len(), 3);
    assert_eq!(
        d.paths.iter().filter(|p| *p == "a.txt").count(),
        1,
        "the path string is shared"
    );
}

#[test]
fn clips_follow_who_was_writing() {
    let mut fx = Fixture::new();
    fx.write("f.rs", &lines(10, "a"))
        .write("other.rs", "o\n")
        .commit("Ann Lee", 0, "Add");
    fx.write("f.rs", &(lines(10, "a") + &lines(5, "b")))
        .commit("Bo Kim", 100, "Bo writes");
    // Over a year with no commit to f.rs, then Ann deletes it.
    fx.write("other.rs", "o2\n")
        .commit("Ann Lee", 300, "Unrelated");
    fx.remove("f.rs").commit("Ann Lee", 600, "Delete f");
    let d = fx.build();

    let f = file_id(&d, "f.rs");
    assert_eq!(clip_authors(&d, f), ["Ann Lee", "Bo Kim", "untouched"]);
    let o = file_id(&d, "other.rs");
    assert_eq!(clip_authors(&d, o), ["Ann Lee"]);
}

#[test]
fn overview_rows_size_folders_over_time() {
    let mut fx = Fixture::new();
    fx.write("src/a.rs", &lines(50, "a"))
        .write("docs/x.md", &lines(10, "d"))
        .write("README", "r\n");
    fx.commit("Ann Lee", 0, "Start");
    fx.write("src/b.rs", &lines(30, "b"))
        .commit("Bo Kim", 45, "More code");
    fx.write("tests/t.rs", &lines(5, "t"))
        .commit("Bo Kim", 100, "Tests");
    let d = fx.build();

    let labels: Vec<&str> = d.overview.rows.iter().map(|r| r.label.as_str()).collect();
    assert_eq!(labels, ["src/", "docs/", "tests/", "everything else"]);
    let src = &d.overview.rows[0];
    assert_eq!((src.lines, src.peak_lines), (80, 80));
    assert_eq!(src.sizes[0], 50, "January");
    assert_eq!(src.sizes[2], 80, "March");
    assert_eq!(d.overview.rows[3].lines, 1);
    assert_eq!(d.overview.rows[3].folder, None);

    let born: Vec<_> = d
        .overview
        .moments
        .iter()
        .filter(|m| m.kind == "folderBorn")
        .map(|m| m.folder.as_str())
        .collect();
    assert_eq!(born, ["tests"]);
}

#[test]
fn the_format_serializes_with_camel_case_keys() {
    let mut fx = Fixture::new();
    fx.write("a", "1\n").commit("Ann Lee", 0, "One");
    let d = fx.build();
    let json = serde_json::to_string(&d).unwrap();
    assert!(json.starts_with(r#"{"format":"palimpsest","version":1,"#));
    assert!(json.contains(r#""commitCount":1"#));
    assert!(json.contains(r#""pathStart":[0,1]"#));
    let back: Data = serde_json::from_str(&json).unwrap();
    assert_eq!(back, d);
}
