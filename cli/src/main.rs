//! `palimpsest build-data <clone> -o <file>`: builds the data file the app
//! loads, from a local clone. Used at build time for the demo repositories.

use std::path::{Path, PathBuf};
use std::time::Instant;

use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use palimpsest_core::{Options, build, git::GitSource};

#[derive(Parser)]
#[command(
    name = "palimpsest",
    version,
    about = "Builds Palimpsest data files from git clones"
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Read a local clone's first-parent history and write the data file.
    BuildData {
        /// Path to a local clone.
        repo: PathBuf,
        /// Where to write the JSON data file.
        #[arg(short, long)]
        out: PathBuf,
        /// "owner/name" shown in the app. Defaults to the clone's folder name.
        #[arg(long)]
        name: Option<String>,
        /// Indent the JSON, for reading it.
        #[arg(long)]
        pretty: bool,
        /// Absorb an author's stretch shorter than this many months.
        #[arg(long, default_value_t = Options::default().min_clip_months)]
        min_clip_months: i32,
    },
}

fn main() -> Result<()> {
    match Cli::parse().command {
        Command::BuildData {
            repo,
            out,
            name,
            pretty,
            min_clip_months,
        } => {
            let opts = Options {
                name: name.unwrap_or_else(|| folder_name(&repo)),
                min_clip_months,
                ..Default::default()
            };
            build_data(repo, out, opts, pretty)
        }
    }
}

fn folder_name(repo: &Path) -> String {
    let dir = repo.canonicalize().unwrap_or(repo.to_path_buf());
    dir.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn build_data(repo: PathBuf, out: PathBuf, opts: Options, pretty: bool) -> Result<()> {
    let started = Instant::now();
    let src = GitSource::open(&repo)
        .map_err(anyhow::Error::from_boxed)
        .with_context(|| format!("opening {}", repo.display()))?;
    let mut last = 0;
    let data = build(&src, &opts, &mut |done, total| {
        if done == total || done - last >= 250 {
            eprint!("\rReading commits: {done} of {total}");
            last = done;
        }
    })
    .map_err(anyhow::Error::from_boxed)?;
    eprintln!();

    let json = if pretty {
        serde_json::to_vec_pretty(&data)?
    } else {
        serde_json::to_vec(&data)?
    };
    if let Some(dir) = out.parent() {
        std::fs::create_dir_all(dir)?;
    }
    std::fs::write(&out, &json).with_context(|| format!("writing {}", out.display()))?;

    let ranked: Vec<String> = (1..=opts.ranked_authors as u8)
        .filter_map(|r| data.authors.rank.iter().position(|&x| x == r))
        .map(|a| {
            format!(
                "{} ({}, {} commits)",
                data.authors.name[a], data.authors.initials[a], data.authors.commits[a]
            )
        })
        .collect();
    let alive = data.files.died.iter().filter(|&&d| d < 0).count();
    let renames = data.changes.kind.iter().filter(|&&k| k == 3).count();
    eprintln!(
        "Wrote {} ({:.1} MB) in {:.1?}",
        out.display(),
        json.len() as f64 / 1e6,
        started.elapsed()
    );
    eprintln!(
        "  {} commits, {} authors ({} bots)",
        data.repo.commit_count,
        data.authors.name.len(),
        data.authors.bot.iter().filter(|&&b| b).count()
    );
    eprintln!("  ranked: {}", ranked.join(", "));
    eprintln!(
        "  {} files ever, {} today, {} renames, {} clips",
        data.files.born.len(),
        alive,
        renames,
        data.clips.from.len()
    );
    let rows: Vec<String> = data
        .overview
        .rows
        .iter()
        .map(|r| format!("{} {} lines (peak {})", r.label, r.lines, r.peak_lines))
        .collect();
    eprintln!("  overview: {}", rows.join(", "));
    for m in data.overview.moments.iter().take(3) {
        let when = &data.commits.hash[m.commit as usize];
        match &m.from {
            Some(from) => eprintln!(
                "  moment {when}: {} files moved {from}/ -> {}/",
                m.files, m.folder
            ),
            None => eprintln!("  moment {when}: {}/ appears", m.folder),
        }
    }
    Ok(())
}
