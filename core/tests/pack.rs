//! A pack made by `git pack-objects`, read from memory, gives the same data as
//! reading the repository on disk.

#![cfg(feature = "git")]

use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

use palimpsest_core::git::GitSource;
use palimpsest_core::pack::{Pack, PackIndexer, PackSource, oid_from_hex};
use palimpsest_core::{Options, build_all};

fn git(dir: &Path, args: &[&str], day: u32) -> String {
    let date = format!("2022-02-{day:02}T12:00:00Z");
    let out = Command::new("git")
        .args(args)
        .current_dir(dir)
        .env("GIT_AUTHOR_NAME", if day % 2 == 0 { "Ann" } else { "Bo" })
        .env(
            "GIT_AUTHOR_EMAIL",
            if day % 2 == 0 {
                "ann@example.com"
            } else {
                "bo@example.com"
            },
        )
        .env("GIT_COMMITTER_NAME", "Ann")
        .env("GIT_COMMITTER_EMAIL", "ann@example.com")
        .env("GIT_AUTHOR_DATE", &date)
        .env("GIT_COMMITTER_DATE", &date)
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8(out.stdout).unwrap().trim().to_string()
}

pub fn pack_of(dir: &Path) -> Vec<u8> {
    let mut child = Command::new("git")
        .args(["pack-objects", "--stdout", "--revs", "--delta-base-offset"])
        .current_dir(dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    child.stdin.take().unwrap().write_all(b"HEAD\n").unwrap();
    let out = child.wait_with_output().unwrap();
    assert!(out.status.success());
    out.stdout
}

#[test]
fn a_pack_reads_like_the_repository() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path();
    git(dir, &["init", "-q", "-b", "main"], 1);
    // Enough similar versions that git stores deltas.
    let mut text = String::new();
    for day in 1..=20u32 {
        for i in 0..30 {
            text.push_str(&format!(
                "line {i} of version {day} with some shared text\n"
            ));
        }
        std::fs::create_dir_all(dir.join("src")).unwrap();
        std::fs::write(dir.join("src/big.txt"), &text).unwrap();
        std::fs::write(dir.join(format!("f{}.txt", day % 4)), format!("{day}\n")).unwrap();
        if day == 10 {
            std::fs::rename(dir.join("src/big.txt"), dir.join("big.txt")).unwrap();
            std::fs::remove_dir_all(dir.join("src")).unwrap();
            std::fs::write(dir.join(".mailmap"), "Bo Kim <bo@example.com>\n").unwrap();
        }
        git(dir, &["add", "-A"], day);
        git(dir, &["commit", "-q", "-m", &format!("Version {day}")], day);
    }
    let head = git(dir, &["rev-parse", "HEAD"], 1);

    let opts = Options {
        name: "t/r".into(),
        ..Default::default()
    };
    let from_disk = build_all(&GitSource::open(dir).unwrap(), &opts, &mut |_, _| {}).unwrap();
    let pack = Pack::index(pack_of(dir), &mut |_, _| {}).unwrap();
    let src = PackSource::new(pack, oid_from_hex(&head).unwrap()).unwrap();
    let from_pack = build_all(&src, &opts, &mut |_, _| {}).unwrap();

    assert_eq!(from_pack.data, from_disk.data);
    assert_eq!(from_pack.lines, from_disk.lines);
    assert!(from_pack.data.authors.name.contains(&"Bo Kim".to_string()));

    // Indexed a few entries at a time, as the browser does, it is the same.
    let mut ix = PackIndexer::new(pack_of(dir)).unwrap();
    let mut steps = 0;
    let mut last = 0;
    while !ix.step(3).unwrap() {
        let (done, all) = ix.progress();
        assert!(done > last && done <= all, "progress moves forward");
        last = done;
        steps += 1;
    }
    assert!(steps > 10, "indexed in many steps");
    let stepped = PackSource::new(ix.finish().unwrap(), oid_from_hex(&head).unwrap()).unwrap();
    assert_eq!(
        build_all(&stepped, &opts, &mut |_, _| {}).unwrap().data,
        from_disk.data
    );
}
