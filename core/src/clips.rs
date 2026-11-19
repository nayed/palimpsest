//! Turning a file's (or folder's) commits into clips: stretches of time
//! colored by who was writing.
//!
//! Commits are bucketed by calendar month. A month belongs to the author who
//! changed the most lines in it. A month with no commits continues the
//! previous clip, and neighboring months with the same author are one clip.
//! A gap of `untouched_months` or more with no commits is an Untouched clip.

use crate::time::{month_of, month_start};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Touch {
    pub time: i64,
    pub author: u32,
    /// Lines added plus lines deleted, at least 1.
    pub weight: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Clip {
    pub from: i64,
    pub to: i64,
    /// `None` is Untouched.
    pub author: Option<u32>,
}

/// Clips covering `born` to `end`. `touches` must be sorted by time; the
/// commit that deletes a file is not a touch (deleting is not writing), but
/// `end` is its time.
pub fn clips(born: i64, end: i64, touches: &[Touch], untouched_months: i32) -> Vec<Clip> {
    let mut out: Vec<Clip> = Vec::new();
    let mut push = |from: i64, to: i64, author: Option<u32>| {
        if to <= from {
            return;
        }
        match out.last_mut() {
            Some(last) if last.author == author && last.to == from => last.to = to,
            _ => out.push(Clip { from, to, author }),
        }
    };

    let months = monthly_winners(touches);
    let Some(&(first_month, first_author)) = months.first() else {
        push(born, end, None);
        return out;
    };

    let mut from = born;
    let mut author = first_author;
    let mut prev = first_month;
    for &(m, a) in &months[1..] {
        if m - prev > untouched_months {
            push(from, month_start(prev + 1), Some(author));
            push(month_start(prev + 1), month_start(m), None);
            from = month_start(m);
            author = a;
        } else if a != author {
            push(from, month_start(m), Some(author));
            from = month_start(m);
            author = a;
        }
        prev = m;
    }
    if month_of(end) - prev > untouched_months {
        push(from, month_start(prev + 1), Some(author));
        push(month_start(prev + 1), end, None);
    } else {
        push(from, end, Some(author));
    }
    out
}

/// (month, author who changed the most lines that month), in order. A tie goes
/// to whoever touched it last in the month.
fn monthly_winners(touches: &[Touch]) -> Vec<(i32, u32)> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < touches.len() {
        let m = month_of(touches[i].time);
        let mut weights: Vec<(u32, u64, usize)> = Vec::new(); // author, weight, last index
        while i < touches.len() && month_of(touches[i].time) == m {
            let t = touches[i];
            match weights.iter_mut().find(|w| w.0 == t.author) {
                Some(w) => {
                    w.1 += t.weight as u64;
                    w.2 = i;
                }
                None => weights.push((t.author, t.weight as u64, i)),
            }
            i += 1;
        }
        let best = weights.iter().max_by_key(|w| (w.1, w.2)).unwrap();
        out.push((m, best.0));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Noon on the 15th of a month, counted from January 2020.
    fn mid(month: i32) -> i64 {
        month_start(month_of(1_577_836_800) + month) + 14 * 86_400 + 43_200
    }
    fn start(month: i32) -> i64 {
        month_start(month_of(1_577_836_800) + month)
    }
    fn touch(month: i32, author: u32, weight: u32) -> Touch {
        Touch {
            time: mid(month),
            author,
            weight,
        }
    }

    #[test]
    fn one_author_is_one_clip() {
        let t = [touch(0, 1, 10), touch(3, 1, 5), touch(4, 1, 1)];
        assert_eq!(
            clips(mid(0), mid(10), &t, 12),
            [Clip {
                from: mid(0),
                to: mid(10),
                author: Some(1)
            }]
        );
    }

    #[test]
    fn a_month_goes_to_whoever_changed_the_most_lines() {
        let t = [
            touch(0, 1, 10),
            touch(2, 1, 3),
            touch(2, 2, 8),
            touch(2, 1, 4),
            touch(5, 1, 1),
        ];
        assert_eq!(
            clips(mid(0), mid(8), &t, 12),
            [
                Clip {
                    from: mid(0),
                    to: start(2),
                    author: Some(1)
                },
                Clip {
                    from: start(2),
                    to: start(5),
                    author: Some(2)
                },
                Clip {
                    from: start(5),
                    to: mid(8),
                    author: Some(1)
                },
            ]
        );
    }

    #[test]
    fn long_gaps_are_untouched() {
        let t = [touch(0, 1, 10), touch(14, 2, 3)];
        assert_eq!(
            clips(mid(0), mid(15), &t, 12),
            [
                Clip {
                    from: mid(0),
                    to: start(1),
                    author: Some(1)
                },
                Clip {
                    from: start(1),
                    to: start(14),
                    author: None
                },
                Clip {
                    from: start(14),
                    to: mid(15),
                    author: Some(2)
                },
            ]
        );
        // Eleven empty months are not enough.
        assert_eq!(
            clips(mid(0), mid(13), &[touch(0, 1, 1), touch(12, 1, 1)], 12).len(),
            1
        );
    }

    #[test]
    fn untouched_until_deleted() {
        let t = [touch(0, 1, 10)];
        assert_eq!(
            clips(mid(0), mid(30), &t, 12),
            [
                Clip {
                    from: mid(0),
                    to: start(1),
                    author: Some(1)
                },
                Clip {
                    from: start(1),
                    to: mid(30),
                    author: None
                },
            ]
        );
    }

    #[test]
    fn same_author_after_a_gap_stays_separate_from_untouched() {
        let t = [touch(0, 1, 1), touch(20, 1, 1)];
        let c = clips(mid(0), mid(21), &t, 12);
        assert_eq!(
            c.iter().map(|c| c.author).collect::<Vec<_>>(),
            [Some(1), None, Some(1)]
        );
    }
}
