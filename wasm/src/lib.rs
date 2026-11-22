//! Palimpsest's history logic for the browser. A Web Worker downloads a
//! repository's pack through the proxy and hands it here; this reads the
//! history newest first, a batch at a time, so the app can draw what has been
//! read while the rest is still coming. Same core as the command-line tool.

use palimpsest_core::build::{attribute_merges, first_parent_chain, history_cut, line_file};
use palimpsest_core::diff::{FileChange, diff_commit, line_edit_for};
use palimpsest_core::format::Partial;
use std::collections::HashMap;

use palimpsest_core::pack::{Kind, Mailmap, Pack, PackSource, oid_from_hex, parse_commit};
use palimpsest_core::source::{Oid, RawCommit, Source};
use palimpsest_core::tags::{RawTag, release_commits, releases};
use palimpsest_core::{Options, Output, assemble_all};
use wasm_bindgen::prelude::*;

fn js<E: std::fmt::Display>(e: E) -> JsError {
    JsError::new(&e.to_string())
}

fn report(progress: &js_sys::Function, done: usize, total: usize) {
    let _ = progress.call2(
        &JsValue::NULL,
        &(done as f64).into(),
        &(total as f64).into(),
    );
}

fn open(pack: Vec<u8>, head: &str, progress: &js_sys::Function) -> Result<PackSource, JsError> {
    let pack = Pack::index(pack, &mut |d, t| report(progress, d, t)).map_err(js)?;
    PackSource::new(pack, oid_from_hex(head).map_err(js)?).map_err(js)
}

#[wasm_bindgen]
pub struct Reader {
    opts: Options,
    src: Option<PackSource>,
    /// First-parent commits, oldest first.
    chain: Vec<RawCommit>,
    diffs: Vec<Vec<FileChange>>,
    /// Index of the oldest commit read so far (`chain.len()` before any).
    first_read: usize,
    /// The last snapshot, and the index of the oldest commit it covers:
    /// reading may have gone further back since.
    output: Option<(Output, usize)>,
    /// Commits whose line history is worked out, oldest first.
    lines_done: usize,
    /// The repository's tags, and the times of their commits found so far.
    tags: Vec<RawTag>,
    tag_times: HashMap<Oid, i64>,
}

#[wasm_bindgen]
impl Reader {
    /// `name` is "owner/repo".
    #[wasm_bindgen(constructor)]
    pub fn new(name: String) -> Reader {
        Reader {
            opts: Options {
                name,
                line_history: false,
                ..Options::default()
            },
            src: None,
            chain: Vec::new(),
            diffs: Vec::new(),
            first_read: 0,
            output: None,
            lines_done: 0,
            tags: Vec::new(),
            tag_times: HashMap::new(),
        }
    }

    /// Indexes the repository's pack and lists its first-parent commits.
    /// Returns how many there are. `progress(done, total)` follows indexing.
    /// `tag_names` and `tag_commits` (hex ids, peeled) are the repository's tags.
    pub fn load(
        &mut self,
        pack: Vec<u8>,
        head: &str,
        tag_names: Vec<String>,
        tag_commits: Vec<String>,
        progress: &js_sys::Function,
    ) -> Result<u32, JsError> {
        let src = open(pack, head, progress)?;
        self.tags = tag_names
            .into_iter()
            .zip(tag_commits)
            .filter_map(|(name, hex)| {
                let commit = oid_from_hex(&hex).ok()?;
                Some(RawTag {
                    name,
                    commit,
                    time: None,
                })
            })
            .collect();
        for id in release_commits(&self.tags) {
            if let Ok(c) = src.commit(id) {
                self.tag_times.insert(id, c.time);
            }
        }
        self.chain = first_parent_chain(&src).map_err(js)?;
        // Merges go to whoever wrote the merged branch, as in the demo data.
        attribute_merges(&src, &mut self.chain).map_err(js)?;
        self.diffs = vec![Vec::new(); self.chain.len()];
        self.first_read = self.chain.len();
        self.src = Some(src);
        Ok(self.chain.len() as u32)
    }

    /// Reads up to `n` more commits, newest first. Returns how many have
    /// been read in all.
    pub fn read(&mut self, n: u32) -> Result<u32, JsError> {
        let src = self
            .src
            .as_ref()
            .ok_or_else(|| JsError::new("nothing loaded"))?;
        for _ in 0..n {
            if self.first_read == 0 {
                break;
            }
            let i = self.first_read - 1;
            let parent = (i > 0).then(|| self.chain[i - 1].tree);
            self.diffs[i] = diff_commit(src, parent, self.chain[i].tree, &self.opts).map_err(js)?;
            self.first_read = i;
        }
        Ok((self.chain.len() - self.first_read) as u32)
    }

    /// The data file for the commits read so far, as JSON.
    pub fn snapshot(&mut self) -> Result<String, JsError> {
        let k = self.first_read;
        if k == self.chain.len() {
            return Err(JsError::new("no commits read yet"));
        }
        // A window of history starts at a cut, which matters once reading
        // has reached its first commit (diffed against nothing).
        let opts = Options {
            history_cut: k == 0 && history_cut(&self.chain),
            ..self.opts.clone()
        };
        let mut out = assemble_all(&self.chain[k..], &self.diffs[k..], &opts);
        let repo = &mut out.data.repo;
        if k > 0 {
            // The timeline still spans the whole history; the part before
            // `read_from` is drawn as not read yet.
            repo.partial = Some(Partial {
                read_from: repo.start,
                total_commits: self.chain.len() as u32,
            });
            repo.start = repo.start.min(self.chain[0].time);
        }
        let (start, end) = (repo.start, repo.end);
        out.data.tags = releases(
            &self.tags,
            &mut |id| self.tag_times.get(&id).copied(),
            start,
            end,
        );
        let json = serde_json::to_string(&out.data).map_err(js)?;
        self.output = Some((out, k));
        Ok(json)
    }

    /// Release tag commits the pack does not hold (tagged on a branch that was
    /// never merged), as hex ids, to fetch with [`Reader::add_tag_commits`].
    #[wasm_bindgen(js_name = missingTagCommits)]
    pub fn missing_tag_commits(&self) -> Vec<String> {
        release_commits(&self.tags)
            .into_iter()
            .filter(|id| !self.tag_times.contains_key(id))
            .map(|id| id.to_hex())
            .collect()
    }

    /// Reads the times of tag commits from a pack of commits.
    #[wasm_bindgen(js_name = addTagCommits)]
    pub fn add_tag_commits(&mut self, pack: Vec<u8>) -> Result<(), JsError> {
        let pack = Pack::index(pack, &mut |_, _| {}).map_err(js)?;
        let mailmap = Mailmap::default();
        for id in release_commits(&self.tags) {
            if let Ok((Kind::Commit, data)) = pack.get(&id)
                && let Ok(c) = parse_commit(id, &data, &mailmap)
            {
                self.tag_times.insert(id, c.time);
            }
        }
        Ok(())
    }

    /// One file's line history as JSON, worked out now, or undefined when it
    /// has none (binary or vendored).
    pub fn lines(&self, file: u32) -> Result<Option<String>, JsError> {
        let (Some(src), Some((out, k))) = (&self.src, &self.output) else {
            return Ok(None);
        };
        // File ids are those of the last snapshot, so use its commits.
        let lf = line_file(src, &self.diffs[*k..], out, file, &self.opts).map_err(js)?;
        lf.map(|lf| serde_json::to_string(&lf).map_err(js))
            .transpose()
    }

    /// Works out the line history of up to `n` more commits, for who wrote
    /// the code that exists on each day. Returns how many commits are done;
    /// call [`Reader::finish_lines`] when that reaches the commit count.
    #[wasm_bindgen(js_name = workLines)]
    pub fn work_lines(&mut self, n: u32) -> Result<u32, JsError> {
        let src = self
            .src
            .as_ref()
            .ok_or_else(|| JsError::new("nothing loaded"))?;
        let end = (self.lines_done + n as usize).min(self.diffs.len());
        for diff in &mut self.diffs[self.lines_done..end] {
            for ch in diff.iter_mut().filter(|c| c.lines.is_none()) {
                ch.lines = line_edit_for(src, ch, &self.opts).map_err(js)?;
            }
        }
        self.lines_done = end;
        Ok(end as u32)
    }

    /// The complete data file, with line history, as JSON.
    #[wasm_bindgen(js_name = finishLines)]
    pub fn finish_lines(&mut self) -> Result<String, JsError> {
        self.opts.line_history = true;
        self.snapshot()
    }
}
