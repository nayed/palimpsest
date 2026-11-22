//! From a repository to the data file.
//!
//! Two passes. The expensive one diffs every commit against its first parent
//! (`diff::diff_commit`). The cheap one, [`assemble`], walks those diffs oldest
//! first to give files identities that survive renames, cut clips, and size
//! the Overview folders. `assemble` is a pure function, which is what the tests
//! exercise most.

use std::collections::{BTreeMap, HashMap};

use crate::clips::{Clip, Touch, clips};
use crate::diff::{ChangeKind, FileChange, diff_commit, line_edit_for};
use crate::format::{
    self, Changes, Clips, Commits, Data, Files, LineFile, Moment, Overview, OverviewRow, Repo,
    Share,
};
use crate::lines::Owners;
use crate::source::{RawCommit, Result, Source};
use crate::time::{month_of, month_start};
use crate::vendored::is_vendored;
use crate::{Options, authors};

/// The rank of the stand-in author for code from before a window of history.
pub const EARLIER_RANK: u8 = 6;

/// The main data file and the per-file line histories.
pub struct Output {
    pub data: Data,
    pub lines: Vec<LineFile>,
    /// For each entry of `data.changes`: (commit, index in that commit's diff).
    pub change_refs: Vec<(u32, u32)>,
}

/// Reads the whole first-parent history of `src` and builds the data file.
/// `progress` is called with (commits done, commits in total).
pub fn build(
    src: &dyn Source,
    opts: &Options,
    progress: &mut dyn FnMut(usize, usize),
) -> Result<Data> {
    Ok(build_all(src, opts, progress)?.data)
}

/// Like [`build`], also returning each file's line history.
pub fn build_all(
    src: &dyn Source,
    opts: &Options,
    progress: &mut dyn FnMut(usize, usize),
) -> Result<Output> {
    let mut chain = first_parent_chain(src)?;
    attribute_merges(src, &mut chain)?;
    let mut diffs = Vec::with_capacity(chain.len());
    for (i, c) in chain.iter().enumerate() {
        let parent_tree = if i == 0 {
            None
        } else {
            Some(chain[i - 1].tree)
        };
        diffs.push(diff_commit(src, parent_tree, c.tree, opts)?);
        progress(i + 1, chain.len());
    }
    let opts = Options {
        history_cut: history_cut(&chain),
        ..opts.clone()
    };
    let mut out = assemble_all(&chain, &diffs, &opts);
    out.data.tags = crate::tags::read_releases(src, out.data.repo.start, out.data.repo.end);
    Ok(out)
}

/// The commits from the root to the head following first parents, oldest
/// first. A shallow download (a window of recent history) stops before the
/// root: the walk ends at the first commit whose parent is not there, and the
/// chain's first commit then still lists a parent (see [`history_cut`]).
pub fn first_parent_chain(src: &dyn Source) -> Result<Vec<RawCommit>> {
    let mut chain = Vec::new();
    let mut c = src.commit(src.head()?)?;
    loop {
        let parent = c.parents.first().copied();
        chain.push(c);
        match parent.map(|p| src.commit(p)) {
            Some(Ok(p)) => c = p,
            // No parent: the root. A missing one: the edge of the window.
            _ => break,
        }
    }
    chain.reverse();
    Ok(chain)
}

/// Whether a first-parent chain starts at a cut rather than at the root.
pub fn history_cut(chain: &[RawCommit]) -> bool {
    chain.first().is_some_and(|c| !c.parents.is_empty())
}

/// A merge commit on the first-parent line brings in someone else's branch.
/// It is credited to the author of that branch's last commit rather than to
/// whoever merged it; otherwise a project that merges pull requests would
/// credit its maintainers with everyone's code.
pub fn attribute_merges(src: &dyn Source, chain: &mut [RawCommit]) -> Result<()> {
    for c in chain.iter_mut() {
        // In a window of history, a branch whose last commit is older than
        // the window is not there: the merge keeps its own author.
        if let Some(&merged) = c.parents.get(1)
            && let Ok(tip) = src.commit(merged)
        {
            c.author_name = tip.author_name;
            c.author_email = tip.author_email;
        }
    }
    Ok(())
}

struct FileAcc {
    born: u32,
    died: Option<u32>,
    commits: u32,
    lines: u32,
    paths: Vec<(u32, u32)>,
    touches: Vec<Touch>,
    lines_file: Option<LineFile>,
    owners: Owners,
    /// Line history was lost (the file became binary): none is kept.
    lines_lost: bool,
}

fn touch_weight(c: &FileChange) -> u32 {
    (c.added + c.deleted).max(1)
}

/// Every folder containing `path`: "a/b/c.rs" gives "a" and "a/b".
fn folders_of(path: &str) -> impl Iterator<Item = &str> {
    path.match_indices('/').map(move |(i, _)| &path[..i])
}

pub fn assemble(commits: &[RawCommit], diffs: &[Vec<FileChange>], opts: &Options) -> Data {
    assemble_all(commits, diffs, opts).data
}

pub fn assemble_all(commits: &[RawCommit], diffs: &[Vec<FileChange>], opts: &Options) -> Output {
    assert_eq!(commits.len(), diffs.len());
    let mut data = Data {
        format: format::FORMAT.into(),
        version: format::VERSION,
        ..Default::default()
    };
    if commits.is_empty() {
        data.repo.name = opts.name.clone();
        return Output {
            data,
            lines: vec![],
            change_refs: vec![],
        };
    }

    // Commit times, made non-decreasing.
    let mut times = Vec::with_capacity(commits.len());
    for c in commits {
        let prev = times.last().copied().unwrap_or(i64::MIN);
        times.push(c.time.max(prev));
    }
    let (start, end) = (times[0], *times.last().unwrap());

    // A window of history: the first commit's files were already there, so
    // their lines go to a stand-in for whoever wrote them before the window,
    // and that commit's own author is not credited with them.
    let skip = usize::from(opts.history_cut);
    let (mut commit_author, author_table) =
        authors::collect_from(commits, opts.ranked_authors, skip);
    data.authors = author_table;
    let earlier_author = opts.history_cut.then(|| {
        let a = &mut data.authors;
        a.name.push("Earlier history".into());
        a.initials.push(String::new());
        a.commits.push(0);
        a.rank.push(EARLIER_RANK);
        a.bot.push(false);
        let id = a.name.len() as u32 - 1;
        commit_author[0] = id;
        id
    });

    data.repo = Repo {
        name: opts.name.clone(),
        head: commits.last().unwrap().id.to_hex(),
        commit_count: commits.len() as u32,
        start,
        end,
        line_history: opts.line_history,
        partial: None,
        earlier_author,
    };

    data.commits = Commits::default();
    for (i, c) in commits.iter().enumerate() {
        let (subject, why) = split_message(&c.message);
        data.commits.time.push(times[i]);
        data.commits.author.push(commit_author[i]);
        data.commits.hash.push(c.id.to_hex()[..7].to_string());
        data.commits.subject.push(subject);
        data.commits.why.push(why);
    }

    // Files, paths and changes.
    let mut path_ids: HashMap<String, u32> = HashMap::new();
    let mut intern = |paths: &mut Vec<String>, p: &str| -> u32 {
        *path_ids.entry(p.to_string()).or_insert_with(|| {
            paths.push(p.to_string());
            paths.len() as u32 - 1
        })
    };
    let mut files: Vec<FileAcc> = Vec::new();
    let mut live: HashMap<String, usize> = HashMap::new();
    let mut folder_lines: HashMap<String, i64> = HashMap::new();
    let mut folder_peak: HashMap<String, i64> = HashMap::new();
    let mut changes = Changes {
        start: vec![0],
        ..Default::default()
    };
    // Lines alive now, by who last wrote them; sampled at the end of each month.
    let first_month = month_of(start);
    let month_count = (month_of(end) - first_month + 1) as usize;
    let mut owned = vec![0i64; data.authors.name.len()];
    let mut share_months: Vec<Option<Vec<(u32, u32)>>> = vec![None; month_count];

    let mut change_refs = Vec::new();
    for (i, diff) in diffs.iter().enumerate() {
        let ci = i as u32;
        for (j, ch) in diff.iter().enumerate() {
            let mut new_file = |files: &mut Vec<FileAcc>, paths: &mut Vec<String>| {
                files.push(FileAcc {
                    born: ci,
                    died: None,
                    commits: 0,
                    lines: 0,
                    paths: vec![(ci, intern(paths, &ch.path))],
                    touches: Vec::new(),
                    lines_file: None,
                    owners: Owners::default(),
                    lines_lost: false,
                });
                files.len() - 1
            };
            let id = match ch.kind {
                ChangeKind::Added | ChangeKind::Modified => match live.get(&ch.path) {
                    Some(&id) => id,
                    None => {
                        let id = new_file(&mut files, &mut data.paths);
                        live.insert(ch.path.clone(), id);
                        id
                    }
                },
                ChangeKind::Renamed => {
                    let old = ch.old_path.as_deref().unwrap_or_default();
                    let id = match live.remove(old) {
                        Some(id) => {
                            let p = intern(&mut data.paths, &ch.path);
                            files[id].paths.push((ci, p));
                            id
                        }
                        None => new_file(&mut files, &mut data.paths),
                    };
                    live.insert(ch.path.clone(), id);
                    id
                }
                ChangeKind::Deleted => match live.remove(&ch.path) {
                    Some(id) => {
                        files[id].died = Some(ci);
                        id
                    }
                    None => continue,
                },
            };
            let f = &mut files[id];
            f.commits += 1;
            if ch.kind != ChangeKind::Deleted {
                f.lines = ch.lines_after;
                f.touches.push(Touch {
                    time: times[i],
                    author: commit_author[i],
                    weight: touch_weight(ch),
                });
            }

            let mut moved = |from: Option<u32>, to: Option<u32>| {
                if let Some(a) = from {
                    owned[a as usize] -= 1;
                }
                if let Some(a) = to {
                    owned[a as usize] += 1;
                }
            };
            match &ch.lines {
                Some(edit) if !f.lines_lost => {
                    f.owners.apply(edit, commit_author[i], &mut moved);
                    let lf = f.lines_file.get_or_insert_with(|| LineFile {
                        format: format::LINES_FORMAT.into(),
                        version: format::VERSION,
                        file: id as u32,
                        ops_start: vec![0],
                        ..Default::default()
                    });
                    lf.commits.push(ci);
                    for &(op, n) in &edit.ops {
                        lf.ops.push(op as u32);
                        lf.ops.push(n);
                    }
                    lf.ops_start.push(lf.ops.len() as u32);
                    lf.texts.extend(edit.texts.iter().cloned());
                }
                None if f.lines_file.is_some() && !f.lines_lost => {
                    for &a in &f.owners.0 {
                        moved(Some(a), None);
                    }
                    f.owners.0.clear();
                    f.lines_file = None;
                    f.lines_lost = true;
                }
                _ => {}
            }

            let before = ch.old_path.as_deref().unwrap_or(&ch.path);
            if ch.kind != ChangeKind::Added && !is_vendored(before) {
                for d in folders_of(before) {
                    *folder_lines.entry(d.to_string()).or_default() -= ch.lines_before as i64;
                }
            }
            if ch.kind != ChangeKind::Deleted && !is_vendored(&ch.path) {
                for d in folders_of(&ch.path) {
                    let n = folder_lines.entry(d.to_string()).or_default();
                    *n += ch.lines_after as i64;
                    let peak = folder_peak.entry(d.to_string()).or_default();
                    *peak = (*peak).max(*n);
                }
            }

            change_refs.push((ci, j as u32));
            changes.file.push(id as u32);
            changes.kind.push(ch.kind as u8);
            changes.added.push(ch.added);
            changes.deleted.push(ch.deleted);
        }
        changes.start.push(changes.file.len() as u32);
        let m = (month_of(times[i]) - first_month) as usize;
        share_months[m] = Some(
            owned
                .iter()
                .enumerate()
                .filter(|(_, n)| **n > 0)
                .map(|(a, n)| (a as u32, *n as u32))
                .collect(),
        );
    }
    data.changes = changes;

    data.files = Files {
        path_start: vec![0],
        ..Default::default()
    };
    data.clips = Clips {
        start: vec![0],
        ..Default::default()
    };
    let mut head_lines = 0i64;
    for f in &files {
        let latest = &data.paths[f.paths.last().unwrap().1 as usize];
        let vendored = is_vendored(latest);
        if f.died.is_none() && !vendored {
            head_lines += f.lines as i64;
        }
        data.files.vendored.push(vendored);
        data.files.has_lines.push(f.lines_file.is_some());
        data.files.born.push(f.born);
        data.files.died.push(f.died.map_or(-1, |d| d as i32));
        data.files.commits.push(f.commits);
        data.files.lines.push(f.lines);
        for &(c, p) in &f.paths {
            data.files.path_commit.push(c);
            data.files.path.push(p);
        }
        data.files.path_start.push(data.files.path.len() as u32);
        let to = f.died.map_or(end, |d| times[d as usize]);
        push_clips(
            &mut data.clips,
            &clips(
                times[f.born as usize],
                to,
                &f.touches,
                opts.untouched_months,
                opts.min_clip_months,
            ),
        );
    }

    data.overview = overview(
        diffs,
        &times,
        &commit_author,
        &folder_lines,
        &folder_peak,
        head_lines,
        opts,
    );

    let mut share = Share {
        start: vec![0],
        ..Default::default()
    };
    let mut current: Vec<(u32, u32)> = Vec::new();
    for month in share_months {
        if let Some(m) = month {
            current = m;
        }
        for &(a, n) in &current {
            share.author.push(a);
            share.lines.push(n);
        }
        share.start.push(share.author.len() as u32);
    }
    data.overview.share = share;

    let lines = files.into_iter().filter_map(|f| f.lines_file).collect();
    Output {
        data,
        lines,
        change_refs,
    }
}

/// One file's line history, working out any line edits not known yet (a
/// repository read in the browser computes them only when a file is opened).
/// `diffs` and `out` must come from the same [`assemble_all`].
pub fn line_file(
    src: &dyn Source,
    diffs: &[Vec<FileChange>],
    out: &Output,
    file: u32,
    opts: &Options,
) -> Result<Option<LineFile>> {
    let mut lf = LineFile {
        format: format::LINES_FORMAT.into(),
        version: format::VERSION,
        file,
        ops_start: vec![0],
        ..Default::default()
    };
    for (k, &f) in out.data.changes.file.iter().enumerate() {
        if f != file {
            continue;
        }
        let (i, j) = out.change_refs[k];
        let ch = &diffs[i as usize][j as usize];
        let edit = match &ch.lines {
            Some(e) => Some(e.clone()),
            None => line_edit_for(src, ch, opts)?,
        };
        let Some(edit) = edit else {
            // Binary, or it became binary: no line history, as in assemble.
            if lf.commits.is_empty() {
                continue;
            }
            return Ok(None);
        };
        lf.commits.push(i);
        for &(op, n) in &edit.ops {
            lf.ops.push(op as u32);
            lf.ops.push(n);
        }
        lf.ops_start.push(lf.ops.len() as u32);
        lf.texts.extend(edit.texts);
    }
    Ok((!lf.commits.is_empty()).then_some(lf))
}

fn push_clips(out: &mut Clips, clips: &[Clip]) {
    for c in clips {
        out.from.push(c.from);
        out.to.push(c.to);
        out.author.push(c.author.map_or(-1, |a| a as i32));
    }
    out.start.push(out.from.len() as u32);
}

/// Picks the Overview folders: the biggest ones, going one level deeper while a
/// single folder holds most of today's code. Folders are ranked by the most
/// lines they ever had, so a folder that was rewritten away can still show.
/// Vendored, generated and lock files are not counted.
fn choose_folders(
    peak: &HashMap<String, i64>,
    head: &HashMap<String, i64>,
    head_total: i64,
    opts: &Options,
) -> Vec<String> {
    let children = |dir: Option<&str>| -> Vec<String> {
        let mut c: Vec<String> = peak
            .keys()
            .filter(|k| match dir {
                None => !k.contains('/'),
                Some(d) => k
                    .strip_prefix(d)
                    .and_then(|r| r.strip_prefix('/'))
                    .is_some_and(|r| !r.contains('/')),
            })
            .cloned()
            .collect();
        c.sort();
        c
    };
    let size = |d: &String| peak.get(d).copied().unwrap_or(0);
    let now = |d: &String| head.get(d).copied().unwrap_or(0);

    let mut chosen = children(None);
    loop {
        let Some(biggest) = chosen.iter().max_by_key(|d| now(d)).cloned() else {
            break;
        };
        let kids = children(Some(&biggest));
        if (now(&biggest) as f64) < opts.descend_share * head_total.max(1) as f64 || kids.is_empty()
        {
            break;
        }
        chosen.retain(|d| *d != biggest);
        chosen.extend(kids);
    }
    chosen.retain(|d| size(d) > 0);
    chosen.sort_by_key(|d| (std::cmp::Reverse(size(d)), d.clone()));
    chosen.truncate(opts.overview_rows);
    chosen
}

struct RowAcc {
    lines: i64,
    peak: i64,
    born: Option<i64>,
    /// The commit the folder appeared in, and how many files arrived with it.
    born_commit: u32,
    born_files: u32,
    /// Files added or moved into the folder by the current commit.
    arrivals: u32,
    emptied: Option<i64>,
    sizes: Vec<u32>,
    touches: Vec<Touch>,
}

fn overview(
    diffs: &[Vec<FileChange>],
    times: &[i64],
    commit_author: &[u32],
    folder_lines: &HashMap<String, i64>,
    folder_peak: &HashMap<String, i64>,
    head_lines: i64,
    opts: &Options,
) -> Overview {
    let folders = choose_folders(folder_peak, folder_lines, head_lines, opts);
    let row_of = |path: &str| -> usize {
        folders
            .iter()
            .enumerate()
            .filter(|(_, f)| {
                path.strip_prefix(f.as_str())
                    .is_some_and(|r| r.starts_with('/'))
            })
            .max_by_key(|(_, f)| f.len())
            .map_or(folders.len(), |(i, _)| i)
    };

    let (start, end) = (times[0], *times.last().unwrap());
    let first_month = month_of(start);
    let month_count = (month_of(end) - first_month + 1) as usize;
    let mut rows: Vec<RowAcc> = (0..=folders.len())
        .map(|_| RowAcc {
            lines: 0,
            peak: 0,
            born: None,
            born_commit: 0,
            born_files: 0,
            arrivals: 0,
            emptied: None,
            sizes: vec![0; month_count],
            touches: vec![],
        })
        .collect();

    // Moves between folders, grouped per commit.
    let mut moves: BTreeMap<(u32, String, String), (u32, String)> = BTreeMap::new();

    for (i, diff) in diffs.iter().enumerate() {
        for ch in diff {
            let before = ch.old_path.as_deref().unwrap_or(&ch.path);
            if ch.kind != ChangeKind::Added && !is_vendored(before) {
                let r = &mut rows[row_of(before)];
                r.lines -= ch.lines_before as i64;
            }
            if ch.kind != ChangeKind::Deleted && !is_vendored(&ch.path) {
                let r = &mut rows[row_of(&ch.path)];
                r.lines += ch.lines_after as i64;
                if matches!(ch.kind, ChangeKind::Added | ChangeKind::Renamed) {
                    r.arrivals += 1;
                }
                r.touches.push(Touch {
                    time: times[i],
                    author: commit_author[i],
                    weight: touch_weight(ch),
                });
            }
            if let (ChangeKind::Renamed, Some(old)) = (ch.kind, &ch.old_path)
                && !is_vendored(old)
                && !is_vendored(&ch.path)
            {
                let (from, to) = (parent(old), parent(&ch.path));
                if from != to {
                    let e = moves
                        .entry((i as u32, from.to_string(), to.to_string()))
                        .or_insert((0, ch.path.clone()));
                    e.0 += 1;
                }
            }
        }
        let m = (month_of(times[i]) - first_month) as usize;
        for r in &mut rows {
            r.peak = r.peak.max(r.lines);
            if r.lines > 0 {
                if r.born.is_none() {
                    r.born = Some(times[i]);
                    r.born_commit = i as u32;
                    r.born_files = r.arrivals;
                }
                r.emptied = None;
            } else if r.born.is_some() && r.emptied.is_none() {
                r.emptied = Some(times[i]);
            }
            // Carry this commit's size forward to the end of the timeline; later
            // commits overwrite the months they reach.
            let n = r.lines.max(0) as u32;
            r.sizes[m..].iter_mut().for_each(|s| *s = n);
            r.arrivals = 0;
        }
    }

    let mut out = Overview {
        first_month_start: month_start(first_month),
        month_starts: (0..=month_count as i32)
            .map(|k| month_start(first_month + k))
            .collect(),
        ..Default::default()
    };
    let mut births = Vec::new();
    for (k, r) in rows.into_iter().enumerate() {
        let Some(born) = r.born else { continue };
        if let Some(folder) = folders.get(k).filter(|_| r.born_commit > 0) {
            births.push((r.born_commit, folder.clone(), r.born_files));
        }
        let folder = folders.get(k).cloned();
        let to = r.emptied.unwrap_or(end);
        let mut row_clips = Clips {
            start: vec![0],
            ..Default::default()
        };
        push_clips(
            &mut row_clips,
            &clips(
                born,
                to,
                &r.touches,
                opts.untouched_months,
                opts.min_clip_months,
            ),
        );
        out.rows.push(OverviewRow {
            label: folder
                .as_ref()
                .map_or("everything else".into(), |f| format!("{f}/")),
            folder,
            born,
            died: r.emptied,
            lines: r.lines.max(0) as u32,
            peak_lines: r.peak.max(0) as u32,
            sizes: r.sizes,
            clips: row_clips,
        });
    }

    // Notable moments: an Overview folder appearing after the first commit, and
    // files moving between folders. The more files involved, the more notable;
    // one moment per commit, so a single reorganization is not listed five times,
    // and a move wins a tie because it says more.
    let mut moments = Vec::new();
    // A reorganization moves files between many pairs of folders in one
    // commit: it scores the total, and is labeled with its biggest pair.
    let mut moved_in_commit: HashMap<u32, u32> = HashMap::new();
    for ((commit, _, _), (files, _)) in &moves {
        *moved_in_commit.entry(*commit).or_default() += files;
    }
    for ((commit, from, to), (files, example)) in moves {
        moments.push((
            moved_in_commit[&commit],
            Moment {
                commit,
                kind: "move".into(),
                folder: to,
                from: Some(from),
                files,
                example: Some(example),
            },
        ));
    }
    for (commit, folder, files) in births {
        moments.push((
            files,
            Moment {
                commit,
                kind: "folderBorn".into(),
                folder,
                from: None,
                files,
                example: None,
            },
        ));
    }
    moments.sort_by_key(|(score, m)| {
        use std::cmp::Reverse;
        (
            Reverse(*score),
            m.commit,
            m.kind != "move",
            Reverse(m.files),
        )
    });
    let mut seen = std::collections::HashSet::new();
    out.moments = moments
        .into_iter()
        .filter(|(_, m)| seen.insert(m.commit))
        .take(opts.max_moments)
        .map(|(_, m)| m)
        .collect();
    out
}

fn parent(path: &str) -> &str {
    path.rfind('/').map_or("", |i| &path[..i])
}

/// The subject (first paragraph, on one line) and the why (the body's first
/// paragraph, unless it is only trailers such as "Signed-off-by:"). For a
/// GitHub "Merge pull request #n from ..." commit, the pull request's title,
/// which GitHub puts in the body, is the subject.
fn split_message(message: &str) -> (String, String) {
    let message = message.replace("\r\n", "\n");
    let mut paragraphs = message
        .trim()
        .split("\n\n")
        .map(str::trim)
        .filter(|p| !p.is_empty());
    let one_line = |p: &str| p.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut subject = paragraphs.next().map(one_line).unwrap_or_default();
    if subject.starts_with("Merge pull request #")
        && let Some(title) = paragraphs.next()
    {
        subject = one_line(title);
    }
    let why = paragraphs
        .next()
        .filter(|p| !is_trailers(p))
        .map(one_line)
        .unwrap_or_default();
    (subject, truncate(why, 400))
}

fn is_trailers(paragraph: &str) -> bool {
    paragraph.lines().all(|l| {
        l.split_once(": ").is_some_and(|(k, _)| {
            !k.is_empty() && k.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
        })
    })
}

fn truncate(s: String, max: usize) -> String {
    if s.chars().count() <= max {
        return s;
    }
    let cut: String = s.chars().take(max - 1).collect();
    format!("{}…", cut.trim_end())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn subject_and_why() {
        let (s, w) = split_message(
            "Fix the lexer\n\nIt hung on files with\nno trailing newline.\n\nMore.\n",
        );
        assert_eq!(s, "Fix the lexer");
        assert_eq!(w, "It hung on files with no trailing newline.");
        let (_, w) = split_message("Bump\n\nSigned-off-by: A <a@b.c>\nCo-authored-by: B <b@c.d>\n");
        assert_eq!(w, "");
        assert_eq!(split_message("").0, "");
        let (s, w) =
            split_message("Merge pull request #12 from a/b\n\nFix watch paths\n\nThey broke.");
        assert_eq!((s.as_str(), w.as_str()), ("Fix watch paths", "They broke."));
        let (s, _) = split_message("Merge pull request #12 from a/b");
        assert_eq!(s, "Merge pull request #12 from a/b");
    }

    #[test]
    fn folders_of_a_path() {
        assert_eq!(folders_of("a/b/c.rs").collect::<Vec<_>>(), ["a", "a/b"]);
        assert_eq!(folders_of("c.rs").count(), 0);
    }

    #[test]
    fn descends_into_a_folder_that_holds_most_of_the_code() {
        let peak: HashMap<String, i64> = [
            ("crates", 900),
            ("crates/core", 500),
            ("crates/cli", 300),
            ("crates/cli/src", 300),
            ("docs", 60),
            ("ci", 40),
        ]
        .into_iter()
        .map(|(k, v)| (k.to_string(), v))
        .collect();
        let opts = Options::default();
        assert_eq!(
            choose_folders(&peak, &peak, 1000, &opts),
            ["crates/core", "crates/cli", "docs", "ci"]
        );
        let opts = Options {
            overview_rows: 2,
            ..Options::default()
        };
        assert_eq!(
            choose_folders(&peak, &peak, 1000, &opts),
            ["crates/core", "crates/cli"]
        );
        // Not when the folder holds less than 60% of today's code.
        assert_eq!(
            choose_folders(&peak, &peak, 2000, &Options::default()),
            ["crates", "docs", "ci"]
        );
    }
}
