//! Line counts and line diffs of file contents.
//!
//! A line is what imara-diff's byte tokenizer calls a line: a run ending in a
//! newline, plus a final run without one. Counting and diffing use the same
//! definition, so `lines_after == lines_before + added - deleted` always holds.

use imara_diff::{Algorithm, Diff, InternedInput};

/// Git treats a file as binary when its first 8000 bytes contain a NUL.
pub fn is_binary(data: &[u8]) -> bool {
    data[..data.len().min(8000)].contains(&0)
}

/// Number of lines, or 0 for a binary file.
pub fn line_count(data: &[u8]) -> u32 {
    if is_binary(data) {
        return 0;
    }
    let newlines = data.iter().filter(|&&b| b == b'\n').count();
    let trailing = !data.is_empty() && *data.last().unwrap() != b'\n';
    (newlines + trailing as usize) as u32
}

/// Lines added and deleted going from `old` to `new`. Binary files have no
/// lines, so a change to one counts as (0, 0).
pub fn diff_counts(old: &[u8], new: &[u8]) -> (u32, u32) {
    match (is_binary(old), is_binary(new)) {
        (true, true) => (0, 0),
        (true, false) => (line_count(new), 0),
        (false, true) => (0, line_count(old)),
        (false, false) => {
            let input = InternedInput::new(old, new);
            let diff = Diff::compute(Algorithm::Histogram, &input);
            (diff.count_additions(), diff.count_removals())
        }
    }
}

/// How alike two versions are, from 0 to 1: twice the lines they share over the
/// total number of lines. Used to guess renames.
pub fn similarity(old: &[u8], new: &[u8]) -> f64 {
    if old == new {
        return 1.0;
    }
    let (a, b) = (line_count(old), line_count(new));
    if a + b == 0 {
        return 0.0;
    }
    let (_, deleted) = diff_counts(old, new);
    let common = a - deleted;
    2.0 * common as f64 / (a + b) as f64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_lines_like_the_diff_tokenizer() {
        for text in ["", "a", "a\n", "a\nb", "a\nb\n", "\n\n", "a\n\nb\n\n"] {
            let input = InternedInput::new(text.as_bytes(), b"".as_slice());
            assert_eq!(
                line_count(text.as_bytes()) as usize,
                input.before.len(),
                "{text:?}"
            );
        }
    }

    #[test]
    fn diff_counts_balance_with_line_counts() {
        let old = b"one\ntwo\nthree\nfour\n";
        let new = b"one\n2\nthree\nfour\nfive";
        let (added, deleted) = diff_counts(old, new);
        assert_eq!((added, deleted), (2, 1));
        assert_eq!(line_count(old) + added - deleted, line_count(new));
    }

    #[test]
    fn binary_files_have_no_lines() {
        assert_eq!(line_count(b"ab\0cd\n"), 0);
        assert_eq!(diff_counts(b"\0", b"\0\0"), (0, 0));
    }

    #[test]
    fn similarity_bounds() {
        assert_eq!(similarity(b"a\nb\n", b"a\nb\n"), 1.0);
        assert_eq!(similarity(b"a\nb\n", b"c\nd\n"), 0.0);
        assert_eq!(similarity(b"a\nb\nc\nd\n", b"a\nb\nc\nX\n"), 0.75);
    }
}
