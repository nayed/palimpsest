//! Reads a real repository, made with the `git` command, through gitoxide.

#![cfg(feature = "git")]

use std::path::Path;
use std::process::Command;

use palimpsest_core::git::GitSource;
use palimpsest_core::{Options, build};

fn git(dir: &Path, args: &[&str], author: &str, day: u32) {
    let (name, email) = author.split_once(' ').unwrap();
    let date = format!("2021-01-{day:02}T12:00:00Z");
    let status = Command::new("git")
        .args(args)
        .current_dir(dir)
        .env("GIT_AUTHOR_NAME", name)
        .env("GIT_AUTHOR_EMAIL", email)
        .env("GIT_AUTHOR_DATE", &date)
        .env("GIT_COMMITTER_NAME", name)
        .env("GIT_COMMITTER_EMAIL", email)
        .env("GIT_COMMITTER_DATE", &date)
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .status()
        .expect("git is installed");
    assert!(status.success(), "git {args:?}");
}

fn write(dir: &Path, path: &str, content: &[u8]) {
    let p = dir.join(path);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, content).unwrap();
}

#[test]
fn reads_a_real_repository() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path();
    let ann = "Ann ann@example.com";
    let ann_work = "ann ann@work.example";
    let bo = "Bo bo@example.com";

    git(dir, &["init", "-q", "-b", "main"], ann, 1);
    write(dir, "src/core/lexer.rs", b"fn lex() {}\n// one\n// two\n");
    write(dir, "logo.png", b"\x89PNG\0\0binary");
    write(
        dir,
        ".mailmap",
        b"Ann <ann@example.com> <ann@work.example>\n",
    );
    std::os::unix::fs::symlink("src", dir.join("link")).unwrap();
    git(dir, &["add", "-A"], ann, 1);
    git(dir, &["commit", "-q", "-m", "Start\n\nBecause."], ann, 1);

    git(
        dir,
        &["mv", "src/core/lexer.rs", "src/parser.rs"],
        ann_work,
        2,
    );
    git(dir, &["commit", "-q", "-m", "Move the lexer"], ann_work, 2);

    // A side branch merged with a merge commit: only the merge is on the
    // first-parent history, and it carries the branch's changes.
    git(dir, &["checkout", "-q", "-b", "side"], bo, 3);
    write(dir, "src/new.rs", b"fn new() {}\n");
    git(dir, &["add", "-A"], bo, 3);
    git(dir, &["commit", "-q", "-m", "Side work"], bo, 3);
    git(dir, &["checkout", "-q", "main"], bo, 4);
    git(
        dir,
        &["merge", "-q", "--no-ff", "-m", "Merge side", "side"],
        bo,
        4,
    );

    let src = GitSource::open(dir).unwrap();
    let d = build(
        &src,
        &Options {
            name: "t/r".into(),
            ..Default::default()
        },
        &mut |_, _| {},
    )
    .unwrap();

    assert_eq!(d.commits.subject, ["Start", "Move the lexer", "Merge side"]);
    assert_eq!(d.commits.why[0], "Because.");
    // The mailmap folds Ann's work address into one author.
    assert_eq!(d.authors.name, ["Ann", "Bo"]);
    assert_eq!(d.commits.author, [0, 0, 1]);
    assert_eq!(d.commits.time[0], 1_609_502_400);

    // Each file's paths over time, looked up by any of its paths.
    let paths_of = |path: &str| -> Vec<&str> {
        let p = d.paths.iter().position(|x| x == path).unwrap() as u32;
        let f = (0..d.files.born.len())
            .find(|&f| {
                d.files.path[d.files.path_start[f] as usize..d.files.path_start[f + 1] as usize]
                    .contains(&p)
            })
            .unwrap();
        d.files.path[d.files.path_start[f] as usize..d.files.path_start[f + 1] as usize]
            .iter()
            .map(|&p| d.paths[p as usize].as_str())
            .collect()
    };

    // The symlink is not tracked; the binary file is, with no lines.
    assert!(!d.paths.iter().any(|p| p == "link"));
    assert_eq!(
        d.files.born.len(),
        4,
        ".mailmap, logo.png, the lexer, new.rs"
    );
    let logo = d
        .files
        .path
        .iter()
        .position(|&p| d.paths[p as usize] == "logo.png")
        .unwrap();
    assert_eq!(d.files.lines[logo], 0);

    // The move kept the file's identity.
    assert_eq!(
        paths_of("src/parser.rs"),
        ["src/core/lexer.rs", "src/parser.rs"]
    );
    let c1 = d.changes.start[1] as usize..d.changes.start[2] as usize;
    assert_eq!(d.changes.kind[c1], [3]);

    // The merge added src/new.rs.
    let c2 = d.changes.start[2] as usize..d.changes.start[3] as usize;
    assert_eq!(d.changes.kind[c2], [0]);
    assert_eq!(paths_of("src/new.rs"), ["src/new.rs"]);
    assert_eq!(d.repo.head.len(), 40);
}
