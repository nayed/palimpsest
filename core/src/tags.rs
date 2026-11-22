//! Release tags, for markers on the timeline's ruler.
//!
//! Repositories tag more than releases: release candidates, and in workspaces
//! the releases of each library (`ignore-0.4.34` beside ripgrep's `15.2.0`).
//! Only finished versions are kept, and among those the project's own: the
//! bare ones (`15.2.0`, `v0.16.0`) when there are any, else the most common
//! prefix. A tag is placed at its date: the tagger's date for an annotated
//! tag, else its commit's. Releases are often tagged on a release branch, off
//! the first-parent history, so they are not tied to a commit of it.

use std::collections::{BTreeMap, HashSet};

use crate::format::Tags;
use crate::source::{Oid, Source};

/// A tag as read from the repository.
#[derive(Clone, Debug)]
pub struct RawTag {
    /// Without `refs/tags/`.
    pub name: String,
    /// The commit it points to, through any annotated tag objects.
    pub commit: Oid,
    /// The tagger's date for an annotated tag.
    pub time: Option<i64>,
}

/// A version tag split into what comes before the version and the version.
/// `None` when the name does not end in a finished version (`1.2`, `v0.16.0`,
/// `ignore-0.4.34`; not `v0.16.0-rc1` or `nightly`).
pub fn parse_version(name: &str) -> Option<(&str, Vec<u32>)> {
    let start = name
        .char_indices()
        .rev()
        .take_while(|(_, c)| c.is_ascii_digit() || *c == '.')
        .last()?
        .0;
    let (prefix, version) = name.split_at(start);
    let parts: Option<Vec<u32>> = version.split('.').map(|p| p.parse().ok()).collect();
    let parts = parts?;
    if !(2..=4).contains(&parts.len()) {
        return None;
    }
    // A prefix is a word ending in a separator, or "v": "ignore-", "release/",
    // "alacritty_terminal_v". Not "rc" or "beta.".
    let word = prefix.strip_suffix(['v', 'V']).unwrap_or(prefix);
    if !(word.is_empty() || word.ends_with(['-', '_', '/'])) {
        return None;
    }
    Some((prefix, parts))
}

/// The prefix group of a version tag: its prefix without a final "v".
fn group(prefix: &str) -> &str {
    prefix.strip_suffix(['v', 'V']).unwrap_or(prefix)
}

/// The tags that are the project's own finished releases, with their dates.
/// `time_of` gives a commit's time, or `None` when it is not known.
pub fn releases(
    tags: &[RawTag],
    time_of: &mut dyn FnMut(Oid) -> Option<i64>,
    start: i64,
    end: i64,
) -> Tags {
    let mut groups: BTreeMap<&str, Vec<&RawTag>> = BTreeMap::new();
    for t in tags {
        if let Some((prefix, _)) = parse_version(&t.name) {
            groups.entry(group(prefix)).or_default().push(t);
        }
    }
    let chosen = if groups.contains_key("") {
        ""
    } else {
        match groups.iter().max_by_key(|(_, v)| v.len()) {
            Some((k, _)) => *k,
            None => return Tags::default(),
        }
    };
    let mut seen = HashSet::new();
    let mut found: Vec<(i64, &str)> = groups[chosen]
        .iter()
        .filter(|t| seen.insert(t.name.as_str()))
        .filter_map(|t| Some((t.time.or_else(|| time_of(t.commit))?, t.name.as_str())))
        .filter(|(time, _)| (start..=end).contains(time))
        .collect();
    found.sort();
    Tags {
        name: found.iter().map(|(_, n)| n.to_string()).collect(),
        time: found.iter().map(|(t, _)| *t).collect(),
    }
}

/// The release tags of a repository, for a history running from `start` to `end`.
pub fn read_releases(src: &dyn Source, start: i64, end: i64) -> Tags {
    let Ok(tags) = src.tags() else {
        return Tags::default();
    };
    releases(&tags, &mut |id| src.commit(id).ok().map(|c| c.time), start, end)
}

/// The commits of release tags, for a source that has not got them all yet.
pub fn release_commits(tags: &[RawTag]) -> Vec<Oid> {
    let mut seen = HashSet::new();
    tags.iter()
        .filter(|t| t.time.is_none() && parse_version(&t.name).is_some())
        .map(|t| t.commit)
        .filter(|c| seen.insert(*c))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tag(name: &str, day: i64) -> RawTag {
        RawTag {
            name: name.into(),
            commit: Oid([0; 20]),
            time: Some(day * 86_400),
        }
    }

    #[test]
    fn reads_finished_versions_only() {
        assert_eq!(parse_version("v0.16.0"), Some(("v", vec![0, 16, 0])));
        assert_eq!(parse_version("15.2.0"), Some(("", vec![15, 2, 0])));
        assert_eq!(
            parse_version("ignore-0.4.34"),
            Some(("ignore-", vec![0, 4, 34]))
        );
        assert_eq!(
            parse_version("alacritty_terminal_v0.25.1"),
            Some(("alacritty_terminal_v", vec![0, 25, 1]))
        );
        for name in ["v0.16.0-rc1", "nightly", "v1", "1.2.3.4.5", "rc1.0", "0.1.0beta.2", "1..2"] {
            assert_eq!(parse_version(name), None, "{name}");
        }
    }

    #[test]
    fn keeps_the_projects_own_releases_in_order() {
        let tags = [
            tag("ignore-0.4.34", 30),
            tag("15.2.0", 40),
            tag("v14.0.0", 20),
            tag("15.2.0-rc1", 35),
            tag("1.0.0", 5),
        ];
        let r = releases(&tags, &mut |_| None, 10 * 86_400, 50 * 86_400);
        assert_eq!(r.name, ["v14.0.0", "15.2.0"]);
        assert_eq!(r.time, [20 * 86_400, 40 * 86_400]);
    }

    #[test]
    fn falls_back_to_the_most_common_prefix() {
        let tags = [tag("app-1.0", 1), tag("app-1.1", 2), tag("lib-0.1", 3)];
        let r = releases(&tags, &mut |_| None, 0, 10 * 86_400);
        assert_eq!(r.name, ["app-1.0", "app-1.1"]);
    }

    #[test]
    fn dates_lightweight_tags_by_their_commit() {
        let mut t = tag("v1.0", 0);
        t.time = None;
        let r = releases(&[t.clone()], &mut |_| Some(7), 0, 10);
        assert_eq!(r.time, [7]);
        assert!(releases(&[t], &mut |_| None, 0, 10).name.is_empty());
    }
}
