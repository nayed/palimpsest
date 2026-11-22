//! Reading a git pack file held in memory: the format GitHub sends a
//! repository in. Used in the browser, where there is no repository on disk.
//!
//! Indexing walks every entry once, inflating it and applying deltas, to
//! learn each object's id and kind. Reads then resolve objects again on
//! demand, keeping recently used ones in a small cache.

use std::cell::RefCell;
use std::collections::HashMap;

use miniz_oxide::inflate::TINFLStatus;
use miniz_oxide::inflate::core::{DecompressorOxide, decompress, inflate_flags};

use crate::source::{EntryKind, Oid, RawCommit, Result, Source, TreeEntry};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Commit,
    Tree,
    Blob,
    Tag,
}

impl Kind {
    fn name(self) -> &'static str {
        match self {
            Kind::Commit => "commit",
            Kind::Tree => "tree",
            Kind::Blob => "blob",
            Kind::Tag => "tag",
        }
    }
}

#[derive(Clone, Copy, Debug)]
enum Base {
    None,
    /// Index of the base entry.
    Entry(u32),
    /// A base named by id (REF_DELTA).
    Id(Oid),
}

#[derive(Clone, Copy, Debug)]
struct Entry {
    /// Start of the compressed data.
    data: u32,
    /// Size after inflating (for a delta, the size of the delta itself).
    size: u32,
    /// Known once indexed (deltas take their base's kind).
    kind: Option<Kind>,
    base: Base,
}

/// Bytes of resolved objects kept in the read cache.
const CACHE_BYTES: usize = 48 << 20;

pub struct Pack {
    data: Vec<u8>,
    entries: Vec<Entry>,
    ids: HashMap<Oid, u32>,
    cache: RefCell<Cache>,
}

#[derive(Default)]
struct Cache {
    objects: HashMap<u32, std::rc::Rc<Vec<u8>>>,
    order: std::collections::VecDeque<u32>,
    bytes: usize,
}

impl Cache {
    fn get(&self, e: u32) -> Option<std::rc::Rc<Vec<u8>>> {
        self.objects.get(&e).cloned()
    }

    fn put(&mut self, e: u32, data: std::rc::Rc<Vec<u8>>) {
        if self.objects.contains_key(&e) || data.len() > CACHE_BYTES / 4 {
            return;
        }
        self.bytes += data.len();
        self.objects.insert(e, data);
        self.order.push_back(e);
        while self.bytes > CACHE_BYTES {
            let Some(old) = self.order.pop_front() else {
                break;
            };
            if let Some(d) = self.objects.remove(&old) {
                self.bytes -= d.len();
            }
        }
    }
}

fn err(msg: impl Into<String>) -> crate::source::Error {
    msg.into().into()
}

/// Inflates zlib data starting at `input`, expecting `size` bytes out.
/// Returns the data and how many input bytes it used.
fn inflate(input: &[u8], size: usize) -> Result<(Vec<u8>, usize)> {
    let mut out = vec![0u8; size];
    let mut d = DecompressorOxide::new();
    let flags = inflate_flags::TINFL_FLAG_PARSE_ZLIB_HEADER
        | inflate_flags::TINFL_FLAG_USING_NON_WRAPPING_OUTPUT_BUF;
    let (status, used, written) = decompress(&mut d, input, &mut out, 0, flags);
    if status != TINFLStatus::Done || written != size {
        return Err(err(format!(
            "corrupt pack entry ({status:?}, {written} of {size} bytes)"
        )));
    }
    Ok((out, used))
}

fn varint(data: &[u8], pos: &mut usize) -> Result<usize> {
    let mut value = 0usize;
    let mut shift = 0;
    loop {
        let b = *data.get(*pos).ok_or_else(|| err("truncated delta"))?;
        *pos += 1;
        value |= ((b & 0x7f) as usize) << shift;
        shift += 7;
        if b & 0x80 == 0 {
            return Ok(value);
        }
    }
}

/// Applies a git delta to its base.
pub fn apply_delta(base: &[u8], delta: &[u8]) -> Result<Vec<u8>> {
    let mut pos = 0;
    let base_size = varint(delta, &mut pos)?;
    let size = varint(delta, &mut pos)?;
    if base_size != base.len() {
        return Err(err("delta base has the wrong size"));
    }
    let mut out = Vec::with_capacity(size);
    while pos < delta.len() {
        let op = delta[pos];
        pos += 1;
        if op & 0x80 != 0 {
            // Copy from the base.
            let mut offset = 0usize;
            let mut len = 0usize;
            for i in 0..4 {
                if op & (1 << i) != 0 {
                    offset |= (*delta.get(pos).ok_or_else(|| err("truncated delta"))? as usize)
                        << (8 * i);
                    pos += 1;
                }
            }
            for i in 0..3 {
                if op & (0x10 << i) != 0 {
                    len |= (*delta.get(pos).ok_or_else(|| err("truncated delta"))? as usize)
                        << (8 * i);
                    pos += 1;
                }
            }
            if len == 0 {
                len = 0x10000;
            }
            let chunk = base
                .get(offset..offset + len)
                .ok_or_else(|| err("delta copies past its base"))?;
            out.extend_from_slice(chunk);
        } else if op != 0 {
            // Insert literal bytes.
            let n = op as usize;
            let chunk = delta
                .get(pos..pos + n)
                .ok_or_else(|| err("truncated delta"))?;
            out.extend_from_slice(chunk);
            pos += n;
        } else {
            return Err(err("invalid delta opcode"));
        }
    }
    if out.len() != size {
        return Err(err("delta produced the wrong size"));
    }
    Ok(out)
}

fn object_id(kind: Kind, data: &[u8]) -> Oid {
    let mut h = sha1_smol::Sha1::new();
    h.update(kind.name().as_bytes());
    h.update(format!(" {}\0", data.len()).as_bytes());
    h.update(data);
    Oid(h.digest().bytes())
}

/// Indexes a pack a step at a time, so a caller with other work (the
/// browser's worker, answering messages) can do it in slices. Two passes over
/// the entries: their headers, then resolving each object for its id.
pub struct PackIndexer {
    pack: Pack,
    count: usize,
    /// Pass 1: the next entry, where its header starts, and entries by offset.
    next: usize,
    pos: usize,
    by_offset: HashMap<usize, u32>,
    /// Pass 2: entries left to resolve, the next one, those whose base (named
    /// by id) was not indexed yet, and how many are resolved.
    pending: Vec<u32>,
    cursor: usize,
    left: Vec<u32>,
    resolved: usize,
    done: bool,
}

impl PackIndexer {
    pub fn new(data: Vec<u8>) -> Result<PackIndexer> {
        if data.len() < 12 || &data[..4] != b"PACK" {
            return Err(err("not a pack file"));
        }
        let version = u32::from_be_bytes(data[4..8].try_into().unwrap());
        if version != 2 && version != 3 {
            return Err(err(format!("unsupported pack version {version}")));
        }
        let count = u32::from_be_bytes(data[8..12].try_into().unwrap()) as usize;
        Ok(PackIndexer {
            pack: Pack {
                data,
                entries: Vec::with_capacity(count),
                ids: HashMap::with_capacity(count),
                cache: RefCell::default(),
            },
            count,
            next: 0,
            pos: 12,
            by_offset: HashMap::with_capacity(count),
            pending: Vec::new(),
            cursor: 0,
            left: Vec::new(),
            resolved: 0,
            done: count == 0,
        })
    }

    /// (steps done, steps in all): each entry counts twice, once per pass.
    pub fn progress(&self) -> (usize, usize) {
        (self.next + self.resolved, self.count * 2)
    }

    pub fn is_done(&self) -> bool {
        self.done
    }

    /// Indexes up to `n` more entries. Returns whether indexing is finished.
    pub fn step(&mut self, n: usize) -> Result<bool> {
        for _ in 0..n {
            if self.done {
                break;
            }
            if self.next < self.count {
                self.header()?;
            } else {
                self.resolve_next()?;
            }
        }
        Ok(self.done)
    }

    /// The indexed pack. Call once [`PackIndexer::step`] says it is finished.
    pub fn finish(self) -> Result<Pack> {
        if !self.done {
            return Err(err("the pack is not indexed yet"));
        }
        Ok(self.pack)
    }

    /// Pass 1, one entry: its header, and where its data starts and ends.
    fn header(&mut self) -> Result<()> {
        let data = &self.pack.data;
        let i = self.next;
        let start = self.pos;
        let mut pos = self.pos;
        let mut b = *data.get(pos).ok_or_else(|| err("truncated pack"))?;
        pos += 1;
        let kind = (b >> 4) & 7;
        let mut size = (b & 0x0f) as usize;
        let mut shift = 4;
        while b & 0x80 != 0 {
            b = *data.get(pos).ok_or_else(|| err("truncated pack"))?;
            pos += 1;
            size |= ((b & 0x7f) as usize) << shift;
            shift += 7;
        }
        let (kind, base) = match kind {
            1 => (Some(Kind::Commit), Base::None),
            2 => (Some(Kind::Tree), Base::None),
            3 => (Some(Kind::Blob), Base::None),
            4 => (Some(Kind::Tag), Base::None),
            6 => {
                let mut b = *data.get(pos).ok_or_else(|| err("truncated pack"))?;
                pos += 1;
                let mut back = (b & 0x7f) as usize;
                while b & 0x80 != 0 {
                    b = *data.get(pos).ok_or_else(|| err("truncated pack"))?;
                    pos += 1;
                    back = ((back + 1) << 7) | (b & 0x7f) as usize;
                }
                let base_at = start
                    .checked_sub(back)
                    .ok_or_else(|| err("delta base before the pack"))?;
                let base = *self
                    .by_offset
                    .get(&base_at)
                    .ok_or_else(|| err("delta base not found"))?;
                (None, Base::Entry(base))
            }
            7 => {
                let id = data
                    .get(pos..pos + 20)
                    .ok_or_else(|| err("truncated pack"))?;
                pos += 20;
                (None, Base::Id(Oid(id.try_into().unwrap())))
            }
            k => return Err(err(format!("unknown pack entry type {k}"))),
        };
        // Skip the compressed data by inflating it.
        let (_, used) = inflate(&data[pos..], size)?;
        self.pack.entries.push(Entry {
            data: pos as u32,
            size: size as u32,
            kind,
            base,
        });
        self.by_offset.insert(start, i as u32);
        self.pos = pos + used;
        self.next += 1;
        if self.next == self.count {
            // On to pass 2.
            self.by_offset = HashMap::new();
            self.pending = (0..self.count as u32).collect();
        }
        Ok(())
    }

    /// Pass 2, one entry: resolve it to learn its kind and id. Bases named by
    /// id may come later in the pack, so entries left go round again until
    /// nothing changes.
    fn resolve_next(&mut self) -> Result<()> {
        if self.cursor == self.pending.len() {
            if self.left.is_empty() {
                self.done = true;
                return Ok(());
            }
            if self.left.len() == self.pending.len() {
                return Err(err("a delta's base is missing from the pack"));
            }
            self.pending = std::mem::take(&mut self.left);
            self.cursor = 0;
        }
        let e = self.pending[self.cursor];
        self.cursor += 1;
        match self.pack.resolve(e) {
            Ok((kind, obj)) => {
                self.pack.entries[e as usize].kind = Some(kind);
                self.pack.ids.insert(object_id(kind, &obj), e);
                self.resolved += 1;
            }
            Err(_) if matches!(self.pack.entries[e as usize].base, Base::Id(_)) => {
                self.left.push(e)
            }
            Err(e) => return Err(e),
        }
        if self.cursor == self.pending.len() && self.left.is_empty() {
            self.done = true;
        }
        Ok(())
    }
}

impl Pack {
    /// Indexes a pack in one go. `progress` is called with (steps done,
    /// steps in all). [`PackIndexer`] does the same a step at a time.
    pub fn index(data: Vec<u8>, progress: &mut dyn FnMut(usize, usize)) -> Result<Pack> {
        let mut ix = PackIndexer::new(data)?;
        while !ix.step(512)? {
            let (done, all) = ix.progress();
            progress(done, all);
        }
        let (_, all) = ix.progress();
        progress(all, all);
        ix.finish()
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn contains(&self, id: &Oid) -> bool {
        self.ids.contains_key(id)
    }

    /// The object at an entry, with deltas applied.
    fn resolve(&self, e: u32) -> Result<(Kind, std::rc::Rc<Vec<u8>>)> {
        // Walk down the delta chain to a cached object or a full one.
        let mut chain = Vec::new();
        let mut cur = e;
        let (mut kind, mut obj) = loop {
            if let Some(obj) = self.cache.borrow().get(cur) {
                break (self.entries[cur as usize].kind, obj);
            }
            let entry = self.entries[cur as usize];
            match entry.base {
                Base::None => {
                    let (obj, _) = inflate(&self.data[entry.data as usize..], entry.size as usize)?;
                    break (entry.kind, std::rc::Rc::new(obj));
                }
                Base::Entry(b) => {
                    chain.push(cur);
                    cur = b;
                }
                Base::Id(id) => {
                    let b = *self
                        .ids
                        .get(&id)
                        .ok_or_else(|| err("delta base not indexed yet"))?;
                    chain.push(cur);
                    cur = b;
                }
            }
            if chain.len() > 10_000 {
                return Err(err("delta chain too long"));
            }
        };
        // Then apply the deltas back up, caching the bases on the way.
        let mut base_entry = cur;
        while let Some(d) = chain.pop() {
            self.cache.borrow_mut().put(base_entry, obj.clone());
            let entry = self.entries[d as usize];
            let (delta, _) = inflate(&self.data[entry.data as usize..], entry.size as usize)?;
            obj = std::rc::Rc::new(apply_delta(&obj, &delta)?);
            kind = kind.or(self.entries[base_entry as usize].kind);
            base_entry = d;
        }
        let kind = kind
            .or(self.entries[e as usize].kind)
            .ok_or_else(|| err("object of unknown kind"))?;
        Ok((kind, obj))
    }

    /// The object with this id.
    pub fn get(&self, id: &Oid) -> Result<(Kind, std::rc::Rc<Vec<u8>>)> {
        let e = *self
            .ids
            .get(id)
            .ok_or_else(|| err(format!("object {id:?} is not in the pack")))?;
        let (kind, obj) = self.resolve(e)?;
        self.cache.borrow_mut().put(e, obj.clone());
        Ok((kind, obj))
    }
}

fn parse_hex(s: &[u8]) -> Result<Oid> {
    if s.len() != 40 {
        return Err(err("bad object id"));
    }
    let mut out = [0u8; 20];
    for (i, b) in out.iter_mut().enumerate() {
        let pair = std::str::from_utf8(&s[2 * i..2 * i + 2]).map_err(|_| err("bad object id"))?;
        *b = u8::from_str_radix(pair, 16).map_err(|_| err("bad object id"))?;
    }
    Ok(Oid(out))
}

pub fn oid_from_hex(s: &str) -> Result<Oid> {
    parse_hex(s.as_bytes())
}

/// "Name <email> 1700000000 +0100" → (name, email, seconds).
fn parse_signature(s: &[u8]) -> (String, String, i64) {
    let s = String::from_utf8_lossy(s);
    let (who, when) = match s.rfind('>') {
        Some(i) => (&s[..=i], &s[i + 1..]),
        None => (&s[..], ""),
    };
    let (name, email) = match who.find('<') {
        Some(i) => (
            who[..i].trim().to_string(),
            who[i + 1..].trim_end_matches('>').trim().to_string(),
        ),
        None => (who.trim().to_string(), String::new()),
    };
    let time = when
        .split_whitespace()
        .next()
        .and_then(|t| t.parse().ok())
        .unwrap_or(0);
    (name, email, time)
}

/// One .mailmap entry: who to show for an address (and optionally a name).
#[derive(Clone, Debug, Default)]
pub struct Mailmap {
    /// (commit email, commit name) → (proper name, proper email)
    entries: Vec<(String, Option<String>, Option<String>, Option<String>)>,
}

impl Mailmap {
    /// Parses the common forms of `.mailmap` lines.
    pub fn parse(text: &str) -> Self {
        let mut entries = Vec::new();
        for line in text.lines() {
            let line = line.split('#').next().unwrap_or("").trim();
            if line.is_empty() {
                continue;
            }
            // Split into "Name <email>" groups.
            let mut parts: Vec<(Option<String>, String)> = Vec::new();
            let mut rest = line;
            while let (Some(a), Some(b)) = (rest.find('<'), rest.find('>')) {
                if b < a {
                    break;
                }
                let name = rest[..a].trim();
                parts.push((
                    (!name.is_empty()).then(|| name.to_string()),
                    rest[a + 1..b].trim().to_lowercase(),
                ));
                rest = &rest[b + 1..];
            }
            match parts.as_slice() {
                [(name, email)] => entries.push((email.clone(), None, name.clone(), None)),
                [(proper_name, proper_email), (commit_name, commit_email)] => entries.push((
                    commit_email.clone(),
                    commit_name.clone(),
                    proper_name.clone(),
                    Some(proper_email.clone()),
                )),
                _ => {}
            }
        }
        Mailmap { entries }
    }

    pub fn resolve(&self, name: String, email: String) -> (String, String) {
        let lower = email.to_lowercase();
        let found = self
            .entries
            .iter()
            .filter(|(e, n, _, _)| {
                *e == lower && n.as_ref().is_none_or(|n| n.eq_ignore_ascii_case(&name))
            })
            .max_by_key(|(_, n, _, _)| n.is_some());
        match found {
            Some((_, _, proper_name, proper_email)) => (
                proper_name.clone().unwrap_or(name),
                proper_email.clone().unwrap_or(email),
            ),
            None => (name, email),
        }
    }
}

/// A [`Source`] over a pack in memory, for a repository read in the browser.
pub struct PackSource {
    pub pack: Pack,
    head: Oid,
    mailmap: Mailmap,
}

impl PackSource {
    pub fn new(pack: Pack, head: Oid) -> Result<Self> {
        let mut s = PackSource {
            pack,
            head,
            mailmap: Mailmap::default(),
        };
        // The mailmap of the newest commit, if there is one.
        if let Ok(commit) = s.commit(head)
            && let Ok(entries) = s.tree(commit.tree)
            && let Some(m) = entries
                .iter()
                .find(|e| e.name == ".mailmap" && e.kind == EntryKind::File)
            && let Ok(blob) = s.blob(m.id)
        {
            s.mailmap = Mailmap::parse(&String::from_utf8_lossy(&blob));
        }
        Ok(s)
    }
}

impl Source for PackSource {
    fn head(&self) -> Result<Oid> {
        Ok(self.head)
    }

    fn commit(&self, id: Oid) -> Result<RawCommit> {
        let (kind, data) = self.pack.get(&id)?;
        if kind != Kind::Commit {
            return Err(err("not a commit"));
        }
        parse_commit(id, &data, &self.mailmap)
    }

    fn tree(&self, id: Oid) -> Result<Vec<TreeEntry>> {
        let (kind, data) = self.pack.get(&id)?;
        if kind != Kind::Tree {
            return Err(err("not a tree"));
        }
        parse_tree(&data)
    }

    fn blob(&self, id: Oid) -> Result<Vec<u8>> {
        let (_, data) = self.pack.get(&id)?;
        Ok(data.as_ref().clone())
    }
}

pub fn parse_commit(id: Oid, data: &[u8], mailmap: &Mailmap) -> Result<RawCommit> {
    let split = data
        .windows(2)
        .position(|w| w == b"\n\n")
        .unwrap_or(data.len());
    let mut tree = None;
    let mut parents = Vec::new();
    let mut author = (String::new(), String::new(), 0);
    let mut committer_time = 0;
    for line in data[..split].split(|&b| b == b'\n') {
        if let Some(v) = line.strip_prefix(b"tree ") {
            tree = Some(parse_hex(v)?);
        } else if let Some(v) = line.strip_prefix(b"parent ") {
            parents.push(parse_hex(v)?);
        } else if let Some(v) = line.strip_prefix(b"author ") {
            author = parse_signature(v);
        } else if let Some(v) = line.strip_prefix(b"committer ") {
            committer_time = parse_signature(v).2;
        }
    }
    let (author_name, author_email) = mailmap.resolve(author.0, author.1);
    let message = data.get(split + 2..).unwrap_or(&[]);
    Ok(RawCommit {
        id,
        tree: tree.ok_or_else(|| err("commit without a tree"))?,
        parents,
        author_name,
        author_email,
        time: committer_time,
        message: String::from_utf8_lossy(message).into_owned(),
    })
}

pub fn parse_tree(data: &[u8]) -> Result<Vec<TreeEntry>> {
    let mut out = Vec::new();
    let mut pos = 0;
    while pos < data.len() {
        let space = data[pos..]
            .iter()
            .position(|&b| b == b' ')
            .ok_or_else(|| err("corrupt tree"))?
            + pos;
        let nul = data[space..]
            .iter()
            .position(|&b| b == 0)
            .ok_or_else(|| err("corrupt tree"))?
            + space;
        let mode = &data[pos..space];
        let name = String::from_utf8_lossy(&data[space + 1..nul]).into_owned();
        let id = data
            .get(nul + 1..nul + 21)
            .ok_or_else(|| err("corrupt tree"))?;
        let kind = match mode {
            b"40000" | b"040000" => EntryKind::Dir,
            b"100644" | b"100755" | b"100664" => EntryKind::File,
            _ => EntryKind::Other,
        };
        out.push(TreeEntry {
            name,
            kind,
            id: Oid(id.try_into().unwrap()),
        });
        pos = nul + 21;
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn applies_deltas() {
        // Base "hello world", result "hello there world": copy 6, insert
        // "there ", copy 5 from offset 6.
        let base = b"hello world";
        let delta = [
            11, 17, 0x91, 0, 6, 6, b't', b'h', b'e', b'r', b'e', b' ', 0x91, 6, 5,
        ];
        assert_eq!(apply_delta(base, &delta).unwrap(), b"hello there world");
    }

    #[test]
    fn hashes_like_git() {
        // `printf 'hello\n' | git hash-object --stdin`
        assert_eq!(
            object_id(Kind::Blob, b"hello\n").to_hex(),
            "ce013625030ba8dba906f756967f9e9ca394464a"
        );
    }

    #[test]
    fn parses_signatures_and_mailmaps() {
        assert_eq!(
            parse_signature(b"Ann Lee <ann@x.org> 1700000000 +0100"),
            ("Ann Lee".into(), "ann@x.org".into(), 1_700_000_000)
        );
        let m = Mailmap::parse(
            "Ann Lee <ann@x.org> <ann@work.example>\nBo Kim <bo@x.org>\n# comment\n",
        );
        assert_eq!(
            m.resolve("ann".into(), "ANN@work.example".into()),
            ("Ann Lee".into(), "ann@x.org".into())
        );
        assert_eq!(
            m.resolve("bo".into(), "bo@x.org".into()),
            ("Bo Kim".into(), "bo@x.org".into())
        );
        assert_eq!(
            m.resolve("Cy".into(), "cy@x.org".into()),
            ("Cy".into(), "cy@x.org".into())
        );
    }
}
