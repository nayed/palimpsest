//! Turning a file's (or folder's) commits into clips: stretches of time
//! colored by who was writing.
//!
//! Commits are bucketed by calendar month. A month belongs to the author who
//! changed the most lines in it. A month with no commits continues the
//! previous clip, and neighboring months with the same author are one clip.
//! A gap of `untouched_months` or more with no commits is an Untouched clip,
//! and an author's stretch shorter than `min_months` is absorbed by its neighbor.

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
///
/// An author's stretch shorter than `min_months` is absorbed by the longer
/// neighboring stretch, so a single busy month from someone else does not cut
/// a long stretch in three. Untouched stretches never absorb or get absorbed.
pub fn clips(
    born: i64,
    end: i64,
    touches: &[Touch],
    untouched_months: i32,
    min_months: i32,
) -> Vec<Clip> {
    let months = monthly_winners(touches);
    let Some(&(first_month, first_author)) = months.first() else {
        return vec![Clip {
            from: born,
            to: end,
            author: None,
        }]
        .into_iter()
        .filter(|c| c.to > c.from)
        .collect();
    };

    // Runs of months: (first month, author). Each run lasts until the next one.
    let mut runs: Vec<(i32, Option<u32>)> = vec![(first_month, Some(first_author))];
    let mut prev = first_month;
    for &(m, a) in &months[1..] {
        if m - prev > untouched_months {
            runs.push((prev + 1, None));
            runs.push((m, Some(a)));
        } else if runs.last().unwrap().1 != Some(a) {
            runs.push((m, Some(a)));
        }
        prev = m;
    }
    let end_month = month_of(end);
    if end_month - prev > untouched_months {
        runs.push((prev + 1, None));
    }
    smooth(&mut runs, end_month + 1, min_months);

    let mut out = Vec::with_capacity(runs.len());
    for (k, &(m, author)) in runs.iter().enumerate() {
        let from = if k == 0 { born } else { month_start(m) };
        let to = runs.get(k + 1).map_or(end, |&(next, _)| month_start(next));
        if to > from {
            out.push(Clip { from, to, author });
        }
    }
    out
}

/// Merges author runs shorter than `min_months` into their longer author
/// neighbor, shortest first, until none is left that can be merged.
fn smooth(runs: &mut Vec<(i32, Option<u32>)>, end_month: i32, min_months: i32) {
    let len = |runs: &[(i32, Option<u32>)], k: usize| {
        runs.get(k + 1).map_or(end_month, |r| r.0) - runs[k].0
    };
    loop {
        let candidate = (0..runs.len())
            .filter(|&k| runs[k].1.is_some() && len(runs, k) < min_months)
            .filter_map(|k| {
                let left = k.checked_sub(1).filter(|&j| runs[j].1.is_some());
                let right = Some(k + 1).filter(|&j| j < runs.len() && runs[j].1.is_some());
                let into = match (left, right) {
                    (Some(l), Some(r)) => Some(if len(runs, r) > len(runs, l) { r } else { l }),
                    (l, r) => l.or(r),
                }?;
                Some((len(runs, k), k, into))
            })
            .min();
        let Some((_, k, into)) = candidate else { break };
        runs[k].1 = runs[into].1;
        // Join neighbors that now share an author.
        let mut joined: Vec<(i32, Option<u32>)> = Vec::with_capacity(runs.len());
        for &r in runs.iter() {
            if joined.last().is_none_or(|l| l.1 != r.1) {
                joined.push(r);
            }
        }
        *runs = joined;
    }
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
            clips(mid(0), mid(10), &t, 12, 1),
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
            clips(mid(0), mid(8), &t, 12, 1),
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
            clips(mid(0), mid(15), &t, 12, 1),
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
            clips(mid(0), mid(13), &[touch(0, 1, 1), touch(12, 1, 1)], 12, 1).len(),
            1
        );
    }

    #[test]
    fn untouched_until_deleted() {
        let t = [touch(0, 1, 10)];
        assert_eq!(
            clips(mid(0), mid(30), &t, 12, 1),
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
        let c = clips(mid(0), mid(21), &t, 12, 1);
        assert_eq!(
            c.iter().map(|c| c.author).collect::<Vec<_>>(),
            [Some(1), None, Some(1)]
        );
    }

    #[test]
    fn short_stretches_are_absorbed() {
        // Ann for months 0-9, Bo wins month 4 only, Cy wins months 10-11.
        let mut t: Vec<Touch> = (0..10).map(|m| touch(m, 1, 5)).collect();
        t[4] = touch(4, 2, 50);
        t.push(touch(10, 3, 5));
        t.push(touch(11, 3, 5));
        let authors = |c: Vec<Clip>| c.iter().map(|c| c.author).collect::<Vec<_>>();
        assert_eq!(
            authors(clips(mid(0), mid(12), &t, 12, 1)),
            [Some(1), Some(2), Some(1), Some(3)]
        );
        assert_eq!(
            authors(clips(mid(0), mid(12), &t, 12, 3)),
            [Some(1), Some(3)]
        );
        let c = clips(mid(0), mid(12), &t, 12, 3);
        assert_eq!((c[0].from, c[0].to, c[1].to), (mid(0), start(10), mid(12)));
    }

    #[test]
    fn untouched_is_never_absorbed() {
        let t = [touch(0, 1, 1), touch(20, 2, 1)];
        let c = clips(mid(0), mid(21), &t, 12, 6);
        assert_eq!(
            c.iter().map(|c| c.author).collect::<Vec<_>>(),
            [Some(1), None, Some(2)]
        );
    }
}
