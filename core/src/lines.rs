//! Line history: following every line of a file through its versions.
//!
//! Each change to a file is turned into a short edit script over its lines:
//! keep n, delete n, insert n, rewrite n. Inside a changed hunk, old and new
//! lines are paired in order when they are similar enough; a paired line is
//! the same line rewritten (its track changes color), an unpaired one is a
//! death or a birth. Replaying the scripts in order gives every line an
//! identity, its versions, and when it was born and died. New lines and new
//! versions are numbered in the order the scripts create them, so the scripts
//! only need to carry the text of each new version.

use imara_diff::{Algorithm, Diff, InternedInput};

use crate::text::is_binary;

/// Kinds of edit operation, as stored in the data file.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum Op {
    /// The next n lines are unchanged.
    Keep = 0,
    /// The next n lines die.
    Delete = 1,
    /// n new lines are born here.
    Insert = 2,
    /// The next n lines continue, with new text.
    Rewrite = 3,
}

/// One change to a file's lines.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct LineEdit {
    /// (operation, count) pairs. Trailing unchanged lines are not listed.
    pub ops: Vec<(Op, u32)>,
    /// Text of every inserted or rewritten line, in order.
    pub texts: Vec<String>,
}

impl LineEdit {
    fn push(&mut self, op: Op, n: u32) {
        if n == 0 {
            return;
        }
        match self.ops.last_mut() {
            Some((last, count)) if *last == op => *count += n,
            _ => self.ops.push((op, n)),
        }
    }

    /// Every line deleted.
    pub fn delete_all(lines: u32) -> Self {
        let mut e = Self::default();
        e.push(Op::Delete, lines);
        e
    }
}

/// Longest text kept for a line, in characters.
const MAX_LINE: usize = 240;
/// How far ahead pairing looks for a match before giving up on a line.
const LOOKAHEAD: usize = 4;

fn split_lines(data: &[u8]) -> Vec<&[u8]> {
    let mut out: Vec<&[u8]> = data.split_inclusive(|&b| b == b'\n').collect();
    if data.is_empty() {
        out.clear();
    }
    out
}

fn line_text(line: &[u8]) -> String {
    let s = String::from_utf8_lossy(line);
    let s = s.trim_end_matches(['\n', '\r']);
    let s = s.replace('\t', "    ");
    if s.chars().count() > MAX_LINE {
        let mut t: String = s.chars().take(MAX_LINE - 1).collect();
        t.push('…');
        t
    } else {
        s
    }
}

/// How alike two lines are, from 0 to 1: the Dice coefficient of their
/// character pairs, ignoring surrounding whitespace.
pub fn line_similarity(a: &[u8], b: &[u8]) -> f64 {
    // Only the start of a very long line matters (minified or generated
    // content), and comparing it whole would be slow.
    const MAX: usize = 512;
    let a = a.trim_ascii();
    let b = b.trim_ascii();
    if a == b {
        return 1.0;
    }
    let a = &a[..a.len().min(MAX)];
    let b = &b[..b.len().min(MAX)];
    if a.len() < 2 || b.len() < 2 {
        return 0.0;
    }
    let mut counts: std::collections::HashMap<[u8; 2], i32> = std::collections::HashMap::new();
    for w in a.windows(2) {
        *counts.entry([w[0], w[1]]).or_default() += 1;
    }
    let mut common = 0;
    for w in b.windows(2) {
        if let Some(n) = counts.get_mut(&[w[0], w[1]])
            && *n > 0
        {
            *n -= 1;
            common += 1;
        }
    }
    2.0 * common as f64 / (a.len() - 1 + b.len() - 1) as f64
}

/// The edit from `old` to `new`, or `None` for binary content.
pub fn line_edit(old: &[u8], new: &[u8], threshold: f64) -> Option<LineEdit> {
    if is_binary(old) || is_binary(new) {
        return None;
    }
    let old_lines = split_lines(old);
    let new_lines = split_lines(new);
    let mut edit = LineEdit::default();
    let input = InternedInput::new(old, new);
    let mut diff = Diff::compute(Algorithm::Histogram, &input);
    diff.postprocess_lines(&input);

    let mut pos = 0u32;
    for hunk in diff.hunks() {
        edit.push(Op::Keep, hunk.before.start - pos);
        pos = hunk.before.end;
        let removed = &old_lines[hunk.before.start as usize..hunk.before.end as usize];
        let added = &new_lines[hunk.after.start as usize..hunk.after.end as usize];
        pair_hunk(&mut edit, removed, added, threshold);
    }
    Some(edit)
}

/// Pairs removed and added lines in order, emitting the operations.
fn pair_hunk(edit: &mut LineEdit, removed: &[&[u8]], added: &[&[u8]], threshold: f64) {
    let (mut i, mut j) = (0, 0);
    let similar = |a: &[u8], b: &[u8]| line_similarity(a, b) >= threshold;
    let insert = |edit: &mut LineEdit, lines: &[&[u8]]| {
        edit.push(Op::Insert, lines.len() as u32);
        edit.texts.extend(lines.iter().map(|l| line_text(l)));
    };
    while i < removed.len() && j < added.len() {
        if similar(removed[i], added[j]) {
            edit.push(Op::Rewrite, 1);
            edit.texts.push(line_text(added[j]));
            i += 1;
            j += 1;
            continue;
        }
        // New lines inserted before the next rewrite?
        if let Some(k) =
            (j + 1..added.len().min(j + 1 + LOOKAHEAD)).find(|&k| similar(removed[i], added[k]))
        {
            insert(edit, &added[j..k]);
            j = k;
            continue;
        }
        // Old lines deleted before the next rewrite?
        if let Some(k) =
            (i + 1..removed.len().min(i + 1 + LOOKAHEAD)).find(|&k| similar(removed[k], added[j]))
        {
            edit.push(Op::Delete, (k - i) as u32);
            i = k;
            continue;
        }
        // Unrelated: one line dies and another is born.
        edit.push(Op::Delete, 1);
        insert(edit, &added[j..j + 1]);
        i += 1;
        j += 1;
    }
    edit.push(Op::Delete, (removed.len() - i) as u32);
    insert(edit, &added[j..]);
}

/// Who last wrote each line of a file, kept up to date by applying edits.
#[derive(Clone, Debug, Default)]
pub struct Owners(pub Vec<u32>);

impl Owners {
    /// Applies an edit made by `author`. Calls `moved(from, to, n)` for each
    /// change of ownership: `from` is `None` for a birth, `to` for a death.
    pub fn apply(
        &mut self,
        edit: &LineEdit,
        author: u32,
        mut moved: impl FnMut(Option<u32>, Option<u32>),
    ) {
        let mut out = Vec::with_capacity(self.0.len());
        let mut pos = 0usize;
        let len = self.0.len();
        for &(op, n) in &edit.ops {
            let n = n as usize;
            let range = pos.min(len)..(pos + n).min(len);
            match op {
                Op::Keep => out.extend_from_slice(&self.0[range]),
                Op::Delete => self.0[range].iter().for_each(|&a| moved(Some(a), None)),
                Op::Insert => {
                    out.extend(std::iter::repeat_n(author, n));
                    (0..n).for_each(|_| moved(None, Some(author)));
                    continue;
                }
                Op::Rewrite => {
                    self.0[range]
                        .iter()
                        .for_each(|&a| moved(Some(a), Some(author)));
                    out.extend(std::iter::repeat_n(author, n));
                }
            }
            pos += n;
        }
        out.extend_from_slice(&self.0[pos.min(self.0.len())..]);
        self.0 = out;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn edit(old: &str, new: &str) -> LineEdit {
        line_edit(old.as_bytes(), new.as_bytes(), 0.5).unwrap()
    }

    #[test]
    fn a_new_file_is_all_births() {
        let e = edit("", "a\nb\n");
        assert_eq!(e.ops, [(Op::Insert, 2)]);
        assert_eq!(e.texts, ["a", "b"]);
    }

    #[test]
    fn an_edited_line_is_rewritten_not_replaced() {
        let e = edit(
            "fn main() {\n    let x = 1;\n}\n",
            "fn main() {\n    let x = 2;\n}\n",
        );
        assert_eq!(e.ops, [(Op::Keep, 1), (Op::Rewrite, 1)]);
        assert_eq!(e.texts, ["    let x = 2;"]);
    }

    #[test]
    fn unrelated_lines_die_and_are_born() {
        let e = edit("keep\nalpha beta gamma\n", "keep\n0123456789\n");
        assert_eq!(e.ops, [(Op::Keep, 1), (Op::Delete, 1), (Op::Insert, 1)]);
    }

    #[test]
    fn pairs_in_order_around_insertions() {
        let e = edit(
            "start\nlet total = a + b;\nend\n",
            "start\n// a comment\nlet total = a + b + c;\nend\n",
        );
        assert_eq!(e.ops, [(Op::Keep, 1), (Op::Insert, 1), (Op::Rewrite, 1)]);
        assert_eq!(e.texts, ["// a comment", "let total = a + b + c;"]);
    }

    #[test]
    fn similarity() {
        assert_eq!(line_similarity(b"  same  ", b"same"), 1.0);
        assert!(line_similarity(b"let x = 1;", b"let x = 2;") > 0.7);
        assert!(line_similarity(b"let x = 1;", b"return None;") < 0.3);
    }

    #[test]
    fn owners_follow_edits() {
        let mut owners = Owners::default();
        let mut counts = [0i32; 3];
        let mut track = |from: Option<u32>, to: Option<u32>| {
            if let Some(f) = from {
                counts[f as usize] -= 1;
            }
            if let Some(t) = to {
                counts[t as usize] += 1;
            }
        };
        owners.apply(&edit("", "a\nb\nc\n"), 0, &mut track);
        owners.apply(&edit("a\nb\nc\n", "a\nb2\nc\nd\n"), 1, &mut track);
        owners.apply(&LineEdit::delete_all(4), 2, &mut track);
        assert!(owners.0.is_empty());
        assert_eq!(counts, [0, 0, 0]);

        let mut owners = Owners::default();
        owners.apply(&edit("", "a\nb\nc\n"), 0, |_, _| {});
        owners.apply(&edit("a\nb\nc\n", "a\nbb\nc\nd\n"), 1, |_, _| {});
        assert_eq!(owners.0, [0, 1, 0, 1]);
    }
}

/// Replays a file's line history and returns its lines' texts after the last
/// edit. The app does the same, to any commit, in TypeScript.
pub fn replay(file: &crate::format::LineFile) -> Vec<String> {
    let mut lines: Vec<&str> = Vec::new();
    let mut text = file.texts.iter();
    for k in 0..file.commits.len() {
        let ops = &file.ops[file.ops_start[k] as usize..file.ops_start[k + 1] as usize];
        let mut out = Vec::with_capacity(lines.len());
        let mut pos = 0usize;
        for pair in ops.chunks(2) {
            let n = pair[1] as usize;
            match pair[0] {
                0 => out.extend_from_slice(&lines[pos..pos + n]),
                1 => {}
                2 => {
                    out.extend((0..n).map(|_| text.next().unwrap().as_str()));
                    continue;
                }
                _ => out.extend((0..n).map(|_| text.next().unwrap().as_str())),
            }
            pos += n;
        }
        out.extend_from_slice(&lines[pos..]);
        lines = out;
    }
    lines.into_iter().map(str::to_string).collect()
}
