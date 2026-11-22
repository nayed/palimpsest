//! Turning a file's (or folder's) commits into clips: stretches of time
//! colored by who was writing.
//!
//! Commits are bucketed by a unit of time: calendar months for a history of
//! years, weeks or fortnights for a shorter one (a window of recent history),
//! so a track has a few dozen units whatever the span (see [`Unit`]). A unit
//! belongs to the author who changed the most lines in it. A unit with no
//! commits continues the previous clip, and neighboring units with the same
//! author are one clip. A gap of `untouched_months` or more with no commits
//! (in real time, whatever the unit) is an Untouched clip, and an author's
//! stretch shorter than `min_units` is absorbed by its neighbor.

use crate::time::{month_of, month_start};

const DAY: i64 = 86_400;

/// The unit clips are bucketed by.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Unit {
    /// Weeks starting on Monday (UTC).
    Week,
    /// Two of those weeks.
    Fortnight,
    Month,
}

/// The longest history bucketed by weeks, and by fortnights: about 15 and 30
/// months, so a track spans roughly 30 to 65 units. Longer ones use months,
/// which suits years of history (the demos).
const WEEKS_UP_TO_DAYS: i64 = 456;
const FORTNIGHTS_UP_TO_DAYS: i64 = 913;

/// Weeks since the Monday before the Unix epoch (a Thursday).
fn week_of(t: i64) -> i32 {
    (t.div_euclid(DAY) + 3).div_euclid(7) as i32
}

fn week_start(week: i32) -> i64 {
    (week as i64 * 7 - 3) * DAY
}

impl Unit {
    /// The unit for a history running from `start` to `end`.
    pub fn for_span(start: i64, end: i64) -> Unit {
        let days = (end - start) / DAY;
        if days <= WEEKS_UP_TO_DAYS {
            Unit::Week
        } else if days <= FORTNIGHTS_UP_TO_DAYS {
            Unit::Fortnight
        } else {
            Unit::Month
        }
    }

    /// The unit a time falls in, numbered from the Unix epoch.
    pub fn of(self, t: i64) -> i32 {
        match self {
            Unit::Week => week_of(t),
            Unit::Fortnight => week_of(t).div_euclid(2),
            Unit::Month => month_of(t),
        }
    }

    /// How many of these units make `months` months, rounded.
    pub fn from_months(self, months: i32) -> i32 {
        match self {
            Unit::Week => (months as f64 * 30.44 / 7.0).round() as i32,
            Unit::Fortnight => (months as f64 * 30.44 / 14.0).round() as i32,
            Unit::Month => months,
        }
    }

    /// When a unit starts.
    pub fn start(self, u: i32) -> i64 {
        match self {
            Unit::Week => week_start(u),
            Unit::Fortnight => week_start(u * 2),
            Unit::Month => month_start(u),
        }
    }
}

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

/// Clips covering `born` to `end`, by month. See [`clips_in`].
pub fn clips(
    born: i64,
    end: i64,
    touches: &[Touch],
    untouched_months: i32,
    min_months: i32,
) -> Vec<Clip> {
    clips_in(
        Unit::Month,
        born,
        end,
        touches,
        untouched_months,
        min_months,
        None,
    )
}

/// Clips covering `born` to `end`, bucketed by `unit`. `touches` must be
/// sorted by time; the commit that deletes a file is not a touch (deleting is
/// not writing), but `end` is its time.
///
/// An author's stretch shorter than `min_units` is absorbed by the longer
/// neighboring stretch, so a single busy unit from someone else does not cut
/// a long stretch in three. Untouched stretches never absorb or get absorbed,
/// and neither do those of `fixed`: the stand-in for code from before a
/// window of history, whose stretch should last only until someone changes
/// the file.
pub fn clips_in(
    unit: Unit,
    born: i64,
    end: i64,
    touches: &[Touch],
    untouched_months: i32,
    min_units: i32,
    fixed: Option<u32>,
) -> Vec<Clip> {
    let untouched_months = unit.from_months(untouched_months);
    let min_months = min_units;
    let months = winners(unit, touches);
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
    let end_month = unit.of(end);
    if end_month - prev > untouched_months {
        runs.push((prev + 1, None));
    }
    smooth(&mut runs, end_month + 1, min_months, fixed);

    let mut out = Vec::with_capacity(runs.len());
    for (k, &(m, author)) in runs.iter().enumerate() {
        let from = if k == 0 { born } else { unit.start(m) };
        let to = runs.get(k + 1).map_or(end, |&(next, _)| unit.start(next));
        if to > from {
            out.push(Clip { from, to, author });
        }
    }
    out
}

/// Merges author runs shorter than `min_months` into their longer author
/// neighbor, shortest first, until none is left that can be merged.
fn smooth(runs: &mut Vec<(i32, Option<u32>)>, end_month: i32, min_months: i32, fixed: Option<u32>) {
    let len = |runs: &[(i32, Option<u32>)], k: usize| {
        runs.get(k + 1).map_or(end_month, |r| r.0) - runs[k].0
    };
    // Untouched and `fixed` stretches stay as they are.
    let movable = |runs: &[(i32, Option<u32>)], k: usize| runs[k].1.is_some() && runs[k].1 != fixed;
    loop {
        let candidate = (0..runs.len())
            .filter(|&k| movable(runs, k) && len(runs, k) < min_months)
            .filter_map(|k| {
                let left = k.checked_sub(1).filter(|&j| movable(runs, j));
                let right = Some(k + 1).filter(|&j| j < runs.len() && movable(runs, j));
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

/// (unit, author who changed the most lines in it), in order. A tie goes to
/// whoever touched it last in the unit.
fn winners(unit: Unit, touches: &[Touch]) -> Vec<(i32, u32)> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < touches.len() {
        let m = unit.of(touches[i].time);
        let mut weights: Vec<(u32, u64, usize)> = Vec::new(); // author, weight, last index
        while i < touches.len() && unit.of(touches[i].time) == m {
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
mod unit_tests {
    use super::*;

    #[test]
    fn the_unit_follows_the_span() {
        let year = 365 * DAY;
        assert_eq!(Unit::for_span(0, year / 4), Unit::Week);
        assert_eq!(Unit::for_span(0, year), Unit::Week);
        assert_eq!(Unit::for_span(0, 2 * year), Unit::Fortnight);
        assert_eq!(Unit::for_span(0, 10 * year), Unit::Month);
    }

    #[test]
    fn weeks_start_on_monday() {
        // 2026-11-18 is a Wednesday; its week starts on Monday 16 November.
        let wednesday = 1_794_960_000 + 12 * 3600;
        let start = Unit::Week.start(Unit::Week.of(wednesday));
        assert_eq!(start, 1_794_787_200);
        assert_eq!((start / DAY + 3) % 7, 0, "a Monday");
        for u in [Unit::Week, Unit::Fortnight, Unit::Month] {
            for k in -50..50 {
                assert_eq!(u.of(u.start(k)), k, "{u:?} {k}");
                assert_eq!(u.of(u.start(k) - 1), k - 1, "{u:?} {k}");
            }
        }
    }

    #[test]
    fn a_short_history_gets_weekly_clips() {
        // Three months of three people taking turns a month each: by month,
        // every stretch is under 3 months and they all merge into one; by
        // week, each keeps its own.
        let t0 = Unit::Week.start(Unit::Week.of(1_767_225_600)); // a Monday, January 2026
        let touch = |day: i64, author: u32| Touch {
            time: t0 + day * DAY + 3600,
            author,
            weight: 10,
        };
        let touches: Vec<Touch> = (0..90)
            .step_by(3)
            .map(|d| touch(d, (d / 30) as u32))
            .collect();
        let end = t0 + 90 * DAY;
        let unit = Unit::for_span(t0, end);
        assert_eq!(unit, Unit::Week);
        let by_month = clips(t0, end, &touches, 12, 3);
        let by_week = clips_in(unit, t0, end, &touches, 12, 3, None);
        assert_eq!(by_month.len(), 1);
        let authors: Vec<Option<u32>> = by_week.iter().map(|c| c.author).collect();
        assert_eq!(authors, [Some(0), Some(1), Some(2)]);
    }
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
