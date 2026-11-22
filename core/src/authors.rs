//! Who wrote what: grouping commits by author, ranking, initials and bots.

use std::collections::HashMap;

use crate::format::Authors;
use crate::source::RawCommit;

/// Groups commits by author and ranks the authors. Returns the author id of
/// every commit and the author table.
///
/// Authors are matched by name, case-insensitively, after the mailmap, so one
/// person committing from several addresses counts once. They are ranked once
/// for the whole history by number of commits, ties going to whoever committed
/// first. The top `ranked` non-bots get ranks 1 to `ranked`; everyone else is 0
/// (Others).
pub fn collect(commits: &[RawCommit], ranked: usize) -> (Vec<u32>, Authors) {
    let (per_commit, authors, _) = collect_from(commits, ranked, 0);
    (per_commit, authors)
}

/// How authors are matched: by the name shown (the email when there is no
/// name), ignoring case.
pub fn key(name: &str, email: &str) -> String {
    if name.is_empty() { email } else { name }.to_lowercase()
}

/// Like [`collect`], leaving the first `skip` commits out of the table: their
/// entries in the returned list are `u32::MAX`, for the caller to fill. Also
/// returns each author's id by [`key`]. People a merge credits with files it
/// brings in (`RawCommit::credits`) are in the table too, and count one
/// commit for each merge crediting them.
pub fn collect_from(
    commits: &[RawCommit],
    ranked: usize,
    skip: usize,
) -> (Vec<u32>, Authors, HashMap<String, u32>) {
    let mut ids: HashMap<String, u32> = HashMap::new();
    let mut out = Authors::default();
    let mut first_seen = Vec::new();
    let mut per_commit = Vec::with_capacity(commits.len());

    let mut register = |name: &str,
                        email: &str,
                        i: usize,
                        out: &mut Authors,
                        first_seen: &mut Vec<usize>|
     -> u32 {
        let display = if name.is_empty() { email } else { name };
        let id = *ids.entry(key(name, email)).or_insert_with(|| {
            out.name.push(display.to_string());
            out.commits.push(0);
            out.bot.push(is_bot(name, email));
            first_seen.push(i);
            out.name.len() as u32 - 1
        });
        id
    };

    for (i, c) in commits.iter().enumerate() {
        if i < skip {
            per_commit.push(u32::MAX);
            continue;
        }
        let id = register(
            &c.author_name,
            &c.author_email,
            i,
            &mut out,
            &mut first_seen,
        );
        // Keep the latest spelling of the name.
        out.name[id as usize] = if c.author_name.is_empty() {
            c.author_email.clone()
        } else {
            c.author_name.clone()
        };
        out.commits[id as usize] += 1;
        per_commit.push(id);
        // Everyone else a merge credits counts once for it.
        let mut counted = vec![id];
        for (name, email) in c.credits.values() {
            let other = register(name, email, i, &mut out, &mut first_seen);
            if !counted.contains(&other) {
                counted.push(other);
                out.commits[other as usize] += 1;
            }
        }
    }
    drop(register);

    let mut order: Vec<usize> = (0..out.name.len()).filter(|&a| !out.bot[a]).collect();
    order.sort_by_key(|&a| (std::cmp::Reverse(out.commits[a]), first_seen[a]));
    out.rank = vec![0; out.name.len()];
    for (r, &a) in order.iter().take(ranked).enumerate() {
        out.rank[a] = r as u8 + 1;
    }

    out.initials = out.name.iter().map(|n| initials(n).0).collect();
    // Ranked authors must be told apart: a lower-ranked author whose initials
    // clash with a higher-ranked one gets a third letter.
    let mut taken: Vec<String> = Vec::new();
    for &a in order.iter().take(ranked) {
        let (two, third) = initials(&out.name[a]);
        let mut chosen = two.clone();
        if taken.contains(&chosen) {
            if let Some(c) = third {
                chosen = format!("{two}{c}");
            }
            let mut n = 2;
            while taken.contains(&chosen) {
                chosen = format!("{two}{n}");
                n += 1;
            }
        }
        taken.push(chosen.clone());
        out.initials[a] = chosen;
    }

    (per_commit, out, ids)
}

/// Two-letter initials: first letters of the first and last names, or the
/// first two letters of a single-word name. Also returns the letter to add
/// when two ranked authors clash.
fn initials(name: &str) -> (String, Option<char>) {
    let words: Vec<Vec<char>> = name
        .split(|c: char| c.is_whitespace() || c == '-' || c == '_' || c == '.')
        .map(|w| {
            w.chars()
                .filter(|c| c.is_alphanumeric())
                .collect::<Vec<_>>()
        })
        .filter(|w| !w.is_empty())
        .collect();
    let up = |c: char| c.to_uppercase().next().unwrap_or(c);
    match words.as_slice() {
        [] => ("?".into(), None),
        [one] => {
            let two: String = one.iter().take(2).map(|&c| up(c)).collect();
            (two, one.get(2).map(|&c| up(c)))
        }
        [first, .., last] => {
            let two = format!("{}{}", up(first[0]), up(last[0]));
            (two, last.get(1).map(|&c| up(c)))
        }
    }
}

/// An automated author. Bots are never ranked; their commits go to Others.
pub fn is_bot(name: &str, email: &str) -> bool {
    const KNOWN: &[&str] = &[
        "dependabot",
        "renovate",
        "github-actions",
        "greenkeeper",
        "mergify",
        "snyk-bot",
    ];
    // Merge bots named without a "[bot]" suffix, matched exactly.
    const EXACT: &[&str] = &[
        "bors",
        "homu",
        "bors-servo",
        "k8s-ci-robot",
        "copybara-service",
        "gitster-bot",
    ];
    let name = name.to_lowercase();
    let email = email.to_lowercase();
    name.ends_with("[bot]")
        || email.contains("[bot]@")
        || EXACT.contains(&name.as_str())
        || KNOWN
            .iter()
            .any(|k| name.starts_with(k) || email.starts_with(k))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::source::Oid;

    fn commit(name: &str) -> RawCommit {
        RawCommit {
            id: Oid([0; 20]),
            tree: Oid([0; 20]),
            parents: vec![],
            author_name: name.into(),
            author_email: format!("{}@example.com", name.replace(' ', ".")),
            time: 0,
            message: String::new(),
            credits: Default::default(),
        }
    }

    #[test]
    fn initials_from_names() {
        assert_eq!(initials("Jonas Weber").0, "JW");
        assert_eq!(initials("Mira van der Okafor").0, "MO");
        assert_eq!(initials("jwilm").0, "JW");
        assert_eq!(initials("Christian Duerr").0, "CD");
        assert_eq!(initials("").0, "?");
    }

    #[test]
    fn ranks_by_commits_and_leaves_bots_out() {
        let mut commits = vec![];
        for (name, n) in [
            ("Ann Lee", 3),
            ("dependabot[bot]", 9),
            ("Bo Kim", 5),
            ("ann lee", 1),
        ] {
            commits.extend((0..n).map(|_| commit(name)));
        }
        let (per_commit, a) = collect(&commits, 5);
        assert_eq!(a.name, ["ann lee", "dependabot[bot]", "Bo Kim"]);
        assert_eq!(a.commits, [4, 9, 5]);
        assert_eq!(a.bot, [false, true, false]);
        assert_eq!(a.rank, [2, 0, 1]);
        assert_eq!(per_commit[0], 0);
    }

    #[test]
    fn only_the_top_ones_are_ranked() {
        let commits: Vec<_> = (0..7)
            .flat_map(|i| (0..(10 - i)).map(move |_| commit(&format!("Person {i}"))))
            .collect();
        let (_, a) = collect(&commits, 5);
        assert_eq!(a.rank, [1, 2, 3, 4, 5, 0, 0]);
    }

    #[test]
    fn clashing_initials_get_a_third_letter() {
        let mut commits: Vec<_> = (0..3).map(|_| commit("Jonas Weber")).collect();
        commits.push(commit("Jane Wu"));
        let (_, a) = collect(&commits, 5);
        assert_eq!(a.initials, ["JW", "JWU"]);
    }

    #[test]
    fn detects_bots() {
        assert!(is_bot(
            "dependabot[bot]",
            "49699333+dependabot[bot]@users.noreply.github.com"
        ));
        assert!(is_bot("renovate-bot", "bot@renovateapp.com"));
        assert!(is_bot("bors", "bors@rust-lang.org"));
        assert!(!is_bot("Borsuk", "b@example.com"));
        assert!(!is_bot("Robert", "rob@example.com"));
    }
}
