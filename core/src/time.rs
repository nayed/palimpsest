//! Calendar months in UTC. Clips are bucketed by month, and a month is
//! numbered as months since January 1970.

const DAY: i64 = 86_400;

/// The month a Unix time falls in.
pub fn month_of(t: i64) -> i32 {
    let (y, m, _) = civil_from_days(t.div_euclid(DAY));
    (y - 1970) as i32 * 12 + (m as i32 - 1)
}

/// The Unix time at which a month starts.
pub fn month_start(month: i32) -> i64 {
    let y = 1970 + month.div_euclid(12) as i64;
    let m = month.rem_euclid(12) as u32 + 1;
    days_from_civil(y, m, 1) * DAY
}

// Howard Hinnant's algorithms, http://howardhinnant.github.io/date_algorithms.html

fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let m = m as i64;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d as i64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_dates() {
        // 2026-03-12T10:00:00Z
        let t = 1_773_309_600;
        assert_eq!(month_of(t), (2026 - 1970) * 12 + 2);
        assert_eq!(month_start(month_of(t)), 1_772_323_200); // 2026-03-01
        assert_eq!(month_of(0), 0);
        assert_eq!(month_start(0), 0);
        assert_eq!(month_of(-1), -1); // December 1969
    }

    #[test]
    fn round_trips_every_month_for_a_century() {
        for m in -120..1200 {
            let start = month_start(m);
            assert_eq!(month_of(start), m);
            assert_eq!(month_of(start - 1), m - 1);
            assert!(month_start(m + 1) - start >= 28 * DAY);
        }
    }
}
