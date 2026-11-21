# Palimpsest — project brief

Palimpsest is a git time machine for the web: open a public repository, then scrub through its history like a video. Every file is a track, colored by who was writing it, so you can watch code be born, change hands, move and disappear, then zoom in on any single line to see who wrote it, when, and why.

It is a static web app and a portfolio project. There is no account, no database and no application server. A demo repository is loaded and already playing when the page opens; any other public GitHub repository can be pasted in and is read inside the browser.

This file is the source of truth. Read it fully, look at the screens in `design/screens/`, then build the MVP described in [Scope of the MVP](#scope-of-the-mvp), in the order given in [Build order](#build-order).

Every decision below is marked one of two ways:

- **Decided**: agreed with the author (Nayed) during design.
- **Proposed**: the designer's recommendation, not yet confirmed by the author. Build it as written, keep it easy to change, and list these in your first summary so the author can overrule any of them.

---

## What's in this folder

| Path | What it is |
| --- | --- |
| `PALIMPSEST.md` | This brief. |
| `README-draft.md` | The approved intro for the repository README (the meaning of the name, the one-paragraph pitch). Use it as the top of `README.md`. |
| `design/screens/dark/*.png` | The approved designs in the dark theme, rendered at 2× (2880 × 1800; the phone screen is 780 × 1688). **Match these.** |
| `design/screens/light/*.png` | The same screens in the light theme. |
| `design/html/dark/*.html`, `design/html/light/*.html` | The same screens as static HTML. Open them to read exact sizes, spacing and colors. The view tabs and the sun and moon switch link the pages to each other. They are a visual reference, not code to copy: everything in them is HTML elements, while the real app draws the timeline on a canvas. |
| `design/author-colors.png`, `design/author-colors.html` | The reference sheet for the author palette in both themes. |
| `design/tokens.css` | Every color, font and size as CSS variables for both themes. Copy it to `web/src/styles/tokens.css`. |
| `design/icons/*.svg` | The nine icons used in the designs: play, pause, previous commit, next commit, sun, moon and three chevrons. They use `currentColor`. |

Not in this folder yet:

- The README hero illustration (`docs/images/Palimpsest.png`). `README-draft.md` references it; the author will provide it.
- A logo mark and a favicon. The designs use the wordmark only: PALIMPSEST in Barlow Condensed. None has been designed.

The screens. All are 1440 px wide pages except the phone screen (390 × 844).

| Screen | In the MVP | Shows |
| --- | --- | --- |
| `01-overview` | Yes | The whole repository: one track per folder, colored by who was writing, taller for bigger folders. Above it, the date, who wrote the code that exists on that day, and what the current commit changed. |
| `02-tracks` | Yes | The home screen: one track per file. Above it, the selected file as it was at the playhead, the date, and the history of the selected line. |
| `03-lines` | Yes | One file: one track per line of code, with the code as the row labels. Above it, the date and the selected line's history. |
| `04-playing` | Yes | Tracks while history plays: the code viewer is replaced by a feed of commits, the play button is a pause button, and the speed menu is open. |
| `05-repo-field-open` | Yes | The repository field focused, with its dropdown: suggested repositories, recently opened ones, and the paste hint. |
| `06-loading` | Yes | A pasted repository being read: progress, three steps, and tracks filling in from the right. |
| `07-too-big` | Yes, simplified | A repository over the commit limit, with two ways to load part of it. For the MVP the message and "Back to the demo repo" are required; the two partial-load options are a [later feature](#later-features-not-the-mvp). |
| `08-phone-tracks` | Yes | Tracks at phone width: file names above their tracks, no code viewer, controls pinned to the bottom. |

Three things about the screens to know before matching them:

- **The data in them is invented.** The repository `example/tidepool`, the authors Jonas Weber, Sara Lindqvist and Mira Okafor, the file names, commits, dates and percentages are all placeholders. The real demo repository is alacritty (see [Demo repositories](#demo-repositories)).
- **Only the dark theme is built for now (Decided).** The light screens stay in this folder as a reference, and the light values stay in `tokens.css`, so light can come back later as a token swap. Build each view once with CSS variables and never hard-code a color.
- **The legend shows three authors.** A real repository shows up to five, plus Others and Untouched, in the same row above the tracks.

---

## How it works for the user

1. They open the site. The demo repository is already loaded and **Tracks is already playing**: history is moving before they click anything.
2. They pause, drag the playhead, step commit by commit, and switch between three views of the same moment: **Overview** (folders), **Tracks** (files), **Lines** (one file's lines).
3. They drill down like zooming a map: clicking a folder in Overview opens its files in Tracks; clicking a file's track opens its lines in Lines.
4. They open the repository field, pick a suggestion or paste any public GitHub URL, and that repository loads in the browser with a visible progress state.
5. The address bar always holds the repository, the date and the view, so any moment in any repository is a link they can share.

The one idea that holds the product together: **the playhead is shared**. The date you have scrubbed to stays the same as you move between views, and the date display, the play controls and the time axis sit in the same place in all three.

---

## Tech stack

| Area | Choice | Status | Notes |
| --- | --- | --- | --- |
| App shell | **React + TypeScript + Vite** | Decided | Plain single-page app. Nothing needs server rendering. |
| Timeline drawing | **Canvas 2D** | Decided | Clips, silhouettes, the playhead and the future veil are drawn on a canvas, because a real repository means thousands of strips redrawn while scrubbing. The header, panels, menus, the ruler, the legend and the track labels stay ordinary React and DOM. |
| Playhead state | A small store outside React (Zustand or hand-rolled) | Decided | The playhead moves every frame. It must not live in React state, or the whole tree re-renders 60 times a second. The canvas subscribes to the store directly. |
| Styling | Plain CSS with custom properties | Decided | See `design/tokens.css`. No Tailwind. The canvas reads the same variables. |
| History logic | **Rust**, one core library compiled twice | Decided | Once as a native command-line tool (builds the demo data at build time) and once as **WebAssembly** (reads pasted repositories in a Web Worker). Same code, so the demo data and the live path cannot disagree. |
| Reading git objects | **gitoxide** (the `gix` crates) | Decided | Pure Rust. See the risk below about fetching inside WebAssembly. |
| Rust to JavaScript bridge | **wasm-bindgen**, typed arrays across the boundary | Decided | |
| Storing a cloned repository | The browser's private file system (OPFS), with computed history cached by repository and head commit | Decided | |
| CORS proxy | One **Cloudflare Worker** | Decided | GitHub does not allow cross-origin git fetches from a browser. The Worker forwards only git smart-HTTP requests to `github.com` and nothing else; it must not be usable as an open proxy. |
| Hosting | **Cloudflare Pages** | Decided | Static site plus that one Worker. In step 5, Cloudflare's tooling had folded Pages into Workers, so the site is deployed as Workers static assets (`web/wrangler.jsonc`) at palimpsest.nayed.workers.dev, with the proxy at palimpsest-git-proxy.nayed.workers.dev. |
| Tests | `cargo test` for the core, **Vitest** for the front end, **Playwright** for the views | Decided | The history logic is where the bugs will be. Test it hardest. |
| Package manager | **pnpm** | Decided | |
| Fonts | Barlow, Barlow Condensed and JetBrains Mono, bundled locally with `@fontsource` | Decided | No request to Google Fonts at runtime. |
| License | **MIT** | Decided | |

Three things to verify before relying on them. They were written from general knowledge during design and were not checked against current documentation:

1. **Fetching a repository from inside WebAssembly.** Parsing git data in WebAssembly is well-trodden; doing the network fetch from inside it may not be supported by gitoxide today. Settle this with a one-day experiment at the start of build step 4. The safe fallback is to let JavaScript download the pack file (a small hand-written smart-HTTP fetch, or isomorphic-git for transport only) and hand the bytes to Rust to parse.
   **Settled in step 4:** gitoxide does not compile for `wasm32-unknown-unknown` with its network features (gix-sec needs Unix file APIs). JavaScript downloads the pack with a small hand-written git protocol v2 client (`web/src/git`), and the core reads it with its own pack reader (`core/src/pack.rs`), so gitoxide is used natively only.
2. **WebAssembly build tooling.** The Rust and WebAssembly tooling was reorganized in the last couple of years. Look up the currently recommended way to build with wasm-bindgen and bundle with Vite; do not follow an older tutorial.
3. **Crate and package versions.** Before adding each dependency, check that it is still maintained and pick the current version.

Names: the project is Palimpsest. The wordmark in the interface is `Palimpsest` set in uppercase by CSS; in prose it is Palimpsest. Suggested crate names: `palimpsest-core`, `palimpsest-cli`, `palimpsest-wasm` (check they are free).

---

## Architecture foundations

Follow these from the first commit. They exist so the later features can be added without rewriting anything.

1. **One core, two builds.** All history logic lives in `core/`. The command-line tool and the WebAssembly wrapper are thin shells around it. Nothing about history is computed in TypeScript.
2. **One data format.** The core produces one format (see [Data the views need](#data-the-views-need)). The app loads it the same way whether it came from a static file or from the Worker. Give the format a version number.
3. **The views are pure functions of (data, playhead, selection).** No view fetches or computes history. This is what makes scrubbing cheap.
4. **Three views, one grammar.** A row is a thing (a folder, a file, a line), a colored strip is its life, the color is who was writing. Implement the track renderer once and feed it folders, files or lines.
5. **Author colors are assigned once per repository** and never change while scrubbing. See [Author colors](#author-colors).
6. **Colors only through CSS variables.** No hex values in components or in canvas code.
7. **Heavy work never runs on the main thread.** Cloning, parsing and line history run in a Web Worker and report progress.
8. **The URL is the state.** Repository, date, view, file and line live in the address. Loading a URL restores that moment.
9. **Static by default.** The only network requests at runtime are the site's own files, and, for pasted repositories, the proxy to GitHub.

Suggested layout:

```
palimpsest/
├── docs/                 # this folder
├── Cargo.toml            # workspace
├── core/                 # palimpsest-core: walk history, renames, clips, line history, the data format
├── cli/                  # palimpsest-cli: `build-data <path to a local clone> -o <file>`
├── wasm/                 # palimpsest-wasm: wasm-bindgen wrapper around the core
├── proxy/                # the Cloudflare Worker
└── web/
    ├── public/data/      # precomputed demo data, one folder per demo repository
    └── src/
        ├── app/          # routing from the URL, the header, theme
        ├── store/        # playhead, selection, playback (outside React)
        ├── data/         # loading the format, the Worker client, caches
        ├── timeline/     # the canvas track renderer, ruler, playhead, hit testing
        ├── views/        # Overview, Tracks, Lines, Playing feed, Loading, TooBig
        ├── components/   # RepoField, ViewTabs, ThemeSwitch, Transport, Legend, AuthorChip
        └── styles/       # tokens.css, base.css
```

---

## Data the views need

A starting point, not a contract. Design the real format in build step 1 and keep it compact (typed arrays, tables of ids, no repeated strings).

| Data | Used by |
| --- | --- |
| Repository: name, head commit, commit count, first and last commit dates | Header, date display, "Commit n of m" |
| Authors: name, initials, commit count, rank, whether it is a bot | Colors, legend, chips |
| Commits, oldest to newest: time, author, short hash, subject, and the body's first paragraph (the "why") | Date display, commit feed, line history |
| Per commit: the files it added, changed, deleted or renamed | "What this commit did", the feed, highlights on tracks |
| Files as identities that survive renames: each path it has had and when, when it was born and when it died | Track rows, clip labels such as "moved to parser/" |
| Per file: its clips (who was writing, from when to when) and its untouched stretches | Tracks |
| Per folder: its size over time and its clips | Overview |
| Per moment: the share of existing lines last written by each author | "Who wrote the code that exists on this day" |
| Per file, loaded on demand: every line that ever existed, when it was born and died, and each rewrite with its commit | Lines, and the line history panel |

Rules for deriving that data. All are **Decided** as starting points; put the numbers in constants and tune them on the three demo repositories.

- **Which history.** Walk the default branch's first-parent history so there is one linear sequence of commits to scrub. A merge commit on that line is credited to the author of the merged branch's last commit, not to whoever merged it, and a GitHub pull-request merge shows the pull request's title as its subject (Decided in step 1).
- **Clips.** Bucket commits by month. A month's color is the author who changed the most lines of that file in it. A month with no commits continues the previous clip. Merge neighboring months with the same author into one clip. An author's stretch shorter than 3 months is absorbed by its longer neighbor, so the busiest files show about 10 color changes instead of about 37 (Decided in step 1, `min_clip_months`).
- **Vendored files.** Vendored folders, lock files and generated code are flagged per file and left out of folder sizes and Overview (Decided in step 1).
- **Untouched.** A stretch of 12 months or more with no commit to the file is drawn as Untouched instead of continuing the last author's clip.
- **Renames.** Git does not record them. Start with exact matches (a path deleted and a path added in the same commit with identical content), then add similarity matching above a threshold, as `git log -M` does.
- **Lines.** Process one file's commits oldest to newest, diffing each version against the previous one, and keep an owner for every line. Inside a changed hunk, pair old and new lines in order when they are similar enough; a paired line continues with a new color, an unpaired one is a death and a birth.
- **Size.** Folder size is its line count. If counting lines for every commit is too slow in the browser, use bytes; decide by measuring in step 1.
- **Bots.** An author whose name ends in `[bot]`, or whose email is a known automation address, is a bot.

Precomputed demo data: one main file per repository, loaded on open, plus one small file per source file for line history, fetched when that file is opened in Lines. Line history for the whole repository must not be in the main file.

Reading a pasted repository happens in two passes, which is why the loading screen has three steps:

1. **Download** the repository.
2. **Read every commit**, newest first: metadata and changed files. This is enough to draw Tracks and Overview, and it fills the screen from the right as shown in `06-loading`.
3. **Line history**, worked out per file only when the user opens that file in Lines. The authorship share bar in Overview is computed in the background after step 2 and shows a quiet "working it out" state until it is ready.

---

## Scope of the MVP

### The header (every screen)

- Left to right: the wordmark, the repository field with its label, and the view tabs (Overview, Tracks, Lines). The theme switch shown at the far right of the mockups is not built for now.
- The view tabs are links. The current one is filled with `--active-bg`.
- **Theme (Decided):** dark only for now, with no theme switch. Set `data-theme="dark"` on the root element. **The theme never follows the system setting**; do not use `prefers-color-scheme`. If light comes back later, it returns as the sun and moon pill in the mockups, remembered in `localStorage`, with dark as the default.
- Everything interactive is at least 44 px tall.

### The transport bar and the timeline (every view)

- The transport bar sits between the upper half and the timeline: previous commit, play or pause (yellow-green, 64 × 44), next commit, and the speed button.
- Below it, the **legend row**: "Colored by who was writing", then a chip and name for each ranked author present, then Others if there are any, then Untouched.
- Then the timeline: a ruler with one label per year, centered in its year, and the rows.
- **The playhead** is a 2 px vertical line through the ruler and every row, with an 18 × 14 handle above the ruler. In dark it is yellow-green; in light the line is ink and the handle is yellow-green with a 2 px ink outline, because yellow-green is invisible as a thin line on a light background.
- **Everything to the right of the playhead is veiled** with `--future-veil`: the future exists, but you are not there yet.
- Dragging anywhere on the timeline scrubs. Scrubbing must hold 60 frames per second on the demo repositories.
- The date display (54 px Barlow Condensed, like a timecode) and "Commit n of m · hash" update live.

### Tracks (`02-tracks`): the home screen

- **Upper half, left:** the selected file's path, the caption "The file exactly as it was at the playhead", and the code. Each line has its number, a chip with the initials of whoever last wrote it in that author's color, and the code in JetBrains Mono. The selected line has the selected-row background and a 4 px mark at its left.
- **Upper half, right:** the date display, then "Line n has been touched k times" and one entry per change, newest first: author chip, the commit subject in semibold, then the date and the reason. The reason is the first paragraph of the commit body; if there is none, show the date only.
- **Timeline:** one row per file, 30 px tall, 4 px apart, with the path in a 168 px gutter on the left. The selected file's label is highlighted.
- **Clips** carry the author's initials. A clip can also carry a short note: the old path before a rename, "moved to parser/", "untouched for 2 years, then deleted".
- **A deleted file's** track ends with a small dashed cap, or a dashed box labeled "deleted" when there is room.
- **A file born in the current commit** shows "born in this commit" to the left of the playhead.
- **Which files are shown (Decided):** the files with the most commits in the current folder over the whole history, as many as fit. The list stays fixed while scrubbing so rows never jump. Files changed by the current commit are highlighted, not added. The user can pin other files. Coming from a folder in Overview sets the current folder.
- Clicking a track selects that file. Clicking it again, or pressing Enter, opens it in Lines.

### Overview (`01-overview`)

- **Upper half, left:** the date display, then "Who wrote the code that exists on this day": one horizontal bar split by author, each part labeled with initials and a percentage.
- **Upper half, right:** the current commit (author chip, subject, "This commit changed n files, added n and deleted n"), then one row per affected file: changed (links to Lines), born, or deleted with the path struck through.
- **Timeline:** one row per folder with the caption "Taller track, bigger folder". A row's height is proportional to the folder's size at the latest commit, never less than 44 px. Inside a row, a filled silhouette shows the folder's size over time, relative to its own maximum, colored by who was writing there. A chip marks where each author's stretch starts.
- **Which folders (Decided):** up to five rows. The largest folders, going one level deeper when a single folder holds most of the code, and "everything else" for the rest.
- **Notable moments** are dashed vertical lines with a short label above the rows: a folder appearing, a file moving between folders. For the MVP, generate them only for folder births and for renames that cross folders, and show at most two or three.
- Clicking a folder row opens Tracks for that folder.

### Lines (`03-lines`)

- **Upper half:** the date display and a button showing the file path that returns to Tracks; to its right, the selected line's history laid out in columns.
- **Timeline:** one row per line, 24 px tall, 3 px apart. The gutter is wide (44% of the width) and holds the line number, the author chip and the code itself.
- **A line that was deleted** before the playhead stays visible, struck through, with "deleted in <year>", and its track ends where it died.
- **A line not written yet** at the playhead appears muted with "not written yet", and its track starts to the right of the playhead.
- A track changes color at each rewrite of that line. A file move is a dashed vertical line with a label, since the lines themselves did not change.
- Clicking a row selects that line and shows its history above.
- The rows are a scrollable, virtualized list. Files can have thousands of lines.

### Playing (`04-playing`)

- **Decided:** while history plays, the code viewer is replaced by "Commits going by": a feed with the current commit on top and highlighted, older ones below and fading out. Each row has the date, the author chip, the subject, and the file changed or "n files". The caption reads "While history plays, this shows commits. Pause to read a file." Pausing brings the code viewer back.
- The play button becomes a pause button. The track being changed by the current commit gets a dot on the playhead and a highlighted label.
- **The speed menu** opens upward from the speed button: 1×, 2×, 4×, 8×, 16×, with the current one filled.
- **Speed (Decided):** playback follows calendar time, not commit count, so busy periods do not crawl. At the default 4× the whole demo repository plays in about 90 seconds; the other speeds scale from that. Tune by feel. The notes in the mockup's menu ("one commit a second", "a year in 20 seconds") are illustrative only.
- Reaching the latest commit stops playback.

### The repository field (`05-repo-field-open`)

- Focusing the field shows a 2 px focus outline and opens a dropdown under it:
  - "Try one of these": the demo repository first, marked "the demo, loads instantly", then the two suggestions with their commit counts.
  - "Recently opened": the last few repositories the user loaded, from `localStorage`, with how long ago.
  - "Or paste any public GitHub URL and press Enter."
- Accept `github.com/owner/repo`, a full `https://` URL, and `owner/repo`.
- Arrow keys move through the rows, Enter loads, Escape closes.

### Loading a pasted repository (`06-loading`)

- The Tracks layout stays in place. The upper half shows the progress: "1,240 OF 3,870 COMMITS" in the display type, "Reading history newest first. Back to September 2023 so far.", a progress bar, a "Stop loading" button and a "Back to the demo repo" link.
- To the right, the three steps with their state: "Download the repository" (done, with the size), "Read every commit" (the percentage, highlighted), "Work out line history" (when you open a file). Under them: "You can already scrub and play the part that has loaded."
- The tracks fill in from the right. The part not read yet is a dashed outline labeled "Not read yet", with a dashed marker "read back to here" at its edge.
- The legend reads "Authors found so far". Because final ranks are not known until every commit is read, every clip is drawn in the Others gray while loading, and author colors appear all at once when reading finishes (Decided).
- Scrubbing and playing work on the loaded part.
- Show real numbers. Never a bare spinner.

### Too big, and other failures (`07-too-big`)

- When a repository has more commits than the limit: the heading "Too big for one browser tab", then "This repository has <n> commits. Palimpsest reads history inside your browser, and it stops at <limit> so the tab stays responsive.", and a "Back to the demo repo" link. The play controls are disabled and the track area shows empty dashed rows with "Nothing is loaded yet. Tracks will appear here."
- **The limit is 50,000 commits (Decided).** Keep it in one constant; if measurements show a tab cannot handle it comfortably, tell the author. It counts every commit the default branch reaches, as GitHub's commit count does, read from the header of a commits-only pack, so a huge repository is refused in under a second without downloading it.
- The two partial-load options in the mockup (the last 2 years, one folder) are later features. Leave room for them in the layout.
- Reuse the same layout for the other failures, with one sentence each: the URL is not a repository, the repository is private or does not exist, the network or the proxy failed. Each offers the way back to the demo repository. Write these messages in the same plain voice.

### Phone (`08-phone-tracks`)

- At phone width, Tracks rearranges: the wordmark and a compact repository button on the first row; the view tabs and the theme switch on the second; the date, the commit count and the current commit; then the legend with first names; then the tracks, each with its file name above it instead of beside it; the play controls pinned to the bottom.
- There is no code viewer. Tapping a track opens its lines. Year labels shorten to two digits. A deleted or new file says so after its name.
- Only Tracks has a phone design. Overview and Lines must still be usable at phone width (rows stack, wide content scrolls sideways), but do not need a bespoke layout for the MVP.

### Keyboard (Decided)

| Key | Action |
| --- | --- |
| Space | Play or pause |
| ← → | Previous or next commit |
| Shift + ← → | Back or forward one month |
| 1 2 3 | Overview, Tracks, Lines |
| ↑ ↓ | Move the selection between rows |
| Enter | Open the selected folder or file in the next view down |
| Escape | Go back up one view, or close a menu |

Shortcuts are ignored while a text field has focus. Everything is also reachable with Tab, with a visible focus ring.

### The URL (Decided)

```
/<owner>/<repo>?at=2026-03-12&view=tracks&folder=src&file=src/parser/lexer.ts&line=43
```

`/` alone is the demo repository at its latest commit, in Tracks, playing. Update the address as the state changes, without adding a history entry for every frame of a scrub.

---

## Author colors

**Decided.** The reference sheet is `design/author-colors.png`.

| Rank | Hue | Dark | Light |
| --- | --- | --- | --- |
| 1st | Blue | `#6dabdf` | `#77ccff` |
| 2nd | Mint | `#9df3cc` | `#42be8f` |
| 3rd | Lilac | `#dfc1ff` | `#aa83d9` |
| 4th | Apricot | `#e3975a` | `#d0792a` |
| 5th | Pink | `#d078a0` | `#fd9ac6` |
| Others | Gray | `#6a676f` | `#8b857f` |
| Untouched | Hatched gray | see `--untouched` | see `--untouched` |
| Now | Yellow-green | `#e4f26b` | `#e4f26b` |

Rules:

1. Authors are ranked once per repository by commits over its whole history, so a person's color never changes while scrubbing.
2. The top five get a color, in this order. Everyone from sixth place down is Others.
3. Bots are never ranked. Their commits always go to Others.
4. Yellow-green is reserved for the playhead and the current selection. It is never an author.
5. Untouched is a hatched fill, not a solid gray, so it cannot be confused with Others.
6. There is deliberately no red, so nothing reads as an error.
7. Text on any author color is the dark ink `--on-author`, in both themes. It passes 4.5:1 on all five.
8. Color is never the only cue. Chips and clips carry the author's initials.

The lightness of each color was chosen so the five stay distinguishable under the three common kinds of color blindness, which is why they are not evenly bright. Do not "even them out". An earlier palette had a blue and a lilac that were nearly identical for people with deuteranopia.

Initials are the first letters of the first and last name. When two ranked authors share initials, use a third letter for the lower-ranked one.

---

## Design tokens

All values come from the designs and are in `design/tokens.css` with a comment on each. The essentials:

### Surfaces and text

| Variable | Used for | Dark | Light |
| --- | --- | --- | --- |
| `--bg` | Page, upper half | `#201c26` | `#eeece8` |
| `--panel` | Transport bar, timeline half | `#2a2531` | `#e3e0da` |
| `--well` | Code viewer, fields, menus, tab container | `#18151d` | `#f8f7f4` |
| `--lane` | Empty track behind clips | `#221e28` | `#d9d5ce` |
| `--line` | Dividers and quiet borders | `#3d3746` | `#cbc6bd` |
| `--line-strong` | Ruler ticks, outlined buttons | `#5a5366` | `#a8a297` |
| `--fg` | Text | `#f1edf5` | `#201d1a` |
| `--mute` | Secondary text | `#b3abc0` | `#5c564e` |
| `--active-bg` / `--active-fg` | Current tab, current theme, current speed | `#f1edf5` / `#16131b` | `#201d1a` / `#f8f7f4` |
| `--now` / `--on-now` | Play button, playhead handle | `#e4f26b` / `#1d2106` | same |
| `--playhead-line` | The playhead line | `#e4f26b` | `#201d1a` |
| `--selected-row` | Selected code or menu row | `#2f2a38` | `#eef59a` |

The background is never pure black or pure white. That was an explicit requirement.

Two deliberate differences between the themes, both for legibility:

- In light, yellow-green fills get a 2 px ink outline and the playhead line is ink.
- In dark, an inline highlight is yellow-green text; in light it is ink on a pale yellow-green background (`#eef59a`).

### Type

| Use | Font, size, weight |
| --- | --- |
| Interface text | Barlow, 14 px, line height 1.4. Captions and legends 13 px. |
| Headings inside panels | Barlow, 15 px, 600 |
| Wordmark | Barlow Condensed, 20 px, 600, uppercase, letter spacing 0.02em |
| Date display | Barlow Condensed, 54 px, 600, uppercase (44 px on the phone) |
| Year labels, clip labels | Barlow Condensed, 14 px, 500 |
| Author chips | Barlow Condensed, 12 px, 600 |
| Speed button | Barlow Condensed, 16 px, 600, uppercase |
| Paths, code, hashes | JetBrains Mono, 13 px (track labels 12 px) |

### Sizes

| Thing | Value |
| --- | --- |
| Interactive targets | at least 44 px tall |
| Page side padding | 20 px (16 px on the phone) |
| Header | 10 px vertical padding around 44 px controls |
| Play button | 64 × 44, 6 px radius (96 × 48 on the phone) |
| Track row, gap | 30 px, 4 px (Lines: 24 px, 3 px) |
| Track label gutter | 168 px (Lines: 44% of the width) |
| Ruler | 20 to 22 px tall, a tick at each year, labels centered in the year |
| Clip, lane, field, tab radius | 4 px |
| Author chip | at least 26 × 18, 3 px radius |
| Code row | 27 px |
| Playhead | 2 px line, 18 × 14 handle with 3 px radius |
| Menus | 8 px radius, `--shadow-menu` |

---

## Demo repositories

**Decided.**

| Role | Repository | Commits (GitHub, 12 Nov 2026) | Why |
| --- | --- | --- | --- |
| Opens by default, precomputed | `alacritty/alacritty` | 2,494 | Recognizable, a clear folder structure, maintainers who changed over the years, and a visible split into several crates. |
| Suggestion | `BurntSushi/ripgrep` | 2,287 | Overwhelmingly one author, so it tests a nearly one-color view. It has a large reorganization into `crates/`. |
| Suggestion | `docker/compose` | 6,319 | Many contributors, many moves between folders, and over a thousand renames. Its default branch's first-parent history starts in April 2020 with the Go version, so the Python-to-Go rewrite is not on it; kept anyway (Decided in step 1). |

- Precompute all three with the command-line tool and ship the files in `web/public/data/`. None of them is ever cloned in the browser.
- The expectations in the "Why" column (author mix, renames, the rewrite) come from general knowledge and were not measured. Check them when the data exists; if alacritty turns out to make a dull demo, tell the author.
- Check each repository's license before shipping derived data and credit the projects in the README. All three are expected to be permissively licensed.
- A repository with many authors needs the "top five and Others" rule from day one; ripgrep needs the app to look good in nearly one color; compose needs a sensible file selection when the whole file set changes.

Rough size bands for reading history in a browser tab. These are estimates, not measurements:

| Commits | Expectation |
| --- | --- |
| Under 5,000 | Feels instant |
| 5,000 to 30,000 | Fine, with the loading state |
| 30,000 to 100,000 | Slow and memory-heavy; where the limit belongs |
| Over 100,000 | Too big without a server |

---

## Build order

Build in small, working steps and commit each one.

1. **The Rust core as a command-line tool.** Point it at a local clone of alacritty and write the data file. Design the data format here, carefully: every later step depends on it. Include clips, renames and folder sizes; write tests on small fixture repositories.
2. **Tracks on that file.** React, the canvas track renderer, the playhead store, scrubbing, play and pause, the header, the dark theme. This is already a shippable demo with no WebAssembly.
3. **Overview and Lines** on the same data, including the per-file line history files and the drill-down between views. Then the playing state, the repository field with the two suggestions, the URL, the keyboard shortcuts and the phone layout.
4. **Pasted repositories.** First the one-day experiment on fetching inside WebAssembly. Then compile the core to WebAssembly, run it in a Worker, add the proxy, the loading screen, and the too-big and failure screens.
5. **Ship.** Deploy to Cloudflare Pages, write the README from `README-draft.md` with a short recording of the app playing.

The dark theme comes along from step 2. Light is not built for now.

---

## Later features (not the MVP)

Do not build these now.

- **Loading part of a big repository:** the last 2 years, or one folder with all of its history (`07-too-big`).
- ~~**Hover details** on a clip: who, which dates, how many commits.~~ Built after the MVP: a card beside the mouse in Tracks and Lines (not on phones). In Lines it also gives the reason of the commit that wrote the line.
- **An about panel** in the header: one sentence on what this is, a link to the source and to the author.
- **Bespoke phone layouts** for Overview and Lines.
- **Pinning and searching files** in Tracks beyond the basic pin.
- **Other colorings.** An early design had a "Color by" switch (age, author, churn). Only author survived; the renderer should not make another one impossible.
- **Release tags** as markers on the ruler.
- **Hosts other than GitHub**, and private repositories.
- **Merge-aware history** instead of first-parent only.
- ~~**A logo mark and favicon**, once designed.~~ Built after the MVP: the files are in `docs/logo/` (its README gives the geometry), the icons and web app manifest in `web/public/`, and the mark sits before the live-text wordmark in the header. Only the dark version exists.
- **The light theme** and the sun and moon switch, as in `design/screens/light/`.

---

## Decisions already made

| Topic | Decision | Status |
| --- | --- | --- |
| Name | Palimpsest: a manuscript scraped and written over, with the old text still faintly there. Rejected: "Back to the Future" (a film title, unsearchable) and Janus (sounds wrong in French). | Decided |
| Concept | Three views of one moment, all drawn as tracks: folders, files, lines. Earlier designs (a treemap dashboard, a stacked "strata" chart, a manuscript-style line view) were dropped in favor of this. | Decided |
| Home screen | Tracks, the view the author liked first and most. | Decided |
| Themes | Dark only for now, no theme switch. Light stays designed and in the tokens for later. Never the system setting. Backgrounds never pure black or white. | Decided |
| Colors | Author colors as specified. No red anywhere. Yellow-green means "now" and nothing else. | Decided |
| First open | A demo repository already loaded and already playing. Never an empty page with a URL box. | Decided |
| Demo repositories | alacritty by default; ripgrep and docker/compose as suggestions. All precomputed. | Decided |
| Back end | None. A static site plus one CORS proxy Worker. No database, no accounts. | Decided |
| Stack | React, TypeScript, Vite, Canvas 2D; Rust core compiled natively and to WebAssembly; gitoxide; Cloudflare. | Decided |
| Rust from day one | The author wants Rust and WebAssembly in this project as a goal in itself, not as a fallback for speed. | Decided |
| While playing | The code viewer becomes a commit feed. | Decided |
| Legend | In a row above the tracks, not in the header, so five authors, Others and Untouched fit. | Decided |
| Files shown in Tracks | Most-committed files in the folder, a fixed list while scrubbing. | Decided |
| Folders shown in Overview | Up to five, plus "everything else", with two or three notable moments. | Decided |
| Keyboard shortcuts | As listed above. | Decided |
| URL scheme | As listed above. | Decided |
| Playback speed | Calendar time; the whole demo in about 90 seconds at 4×. | Decided |
| Colors while loading | Others gray until every commit is read, then final colors at once. | Decided |
| Commit limit | 50,000. | Decided |
| Clip, untouched, rename and line-pairing rules | As listed under "Data the views need": monthly clips, 12 months for Untouched, similarity-based renames and line pairing, all tunable. | Decided |
| pnpm, bundled fonts, MIT | As listed in the stack. | Decided |

---

## Done means

- Opening the site shows alacritty in Tracks, already playing, with no clone and no spinner.
- Tracks, Overview and Lines look like their screens in `design/screens/dark/`, with real data in place of the invented data.
- Switching views keeps the date. Clicking a folder, then a file, then a line drills down; Escape goes back up.
- Dragging the playhead holds 60 frames per second on all three demo repositories.
- Playing swaps the code viewer for the commit feed, and pausing brings it back.
- The app is dark, with no theme switch, and the system setting has no effect.
- Up to five authors get their colors in rank order, the rest are Others, bots are Others, and Untouched is hatched.
- The selected line shows who touched it, when, and why, including across a rename.
- Copying the address and opening it in a new tab shows the same repository, date, view, file and line.
- Pasting a small public GitHub repository loads it with real progress numbers, and scrubbing works on the loaded part before it finishes.
- A repository over the limit, a wrong URL and a private repository each show a clear message and a way back to the demo.
- The ripgrep and docker/compose suggestions open instantly.
- Tracks works on a phone as in `08-phone-tracks`.
- Everything is reachable by keyboard with visible focus rings, and all text passes 4.5:1 contrast in the dark theme.
- The same Rust core produces the demo files and reads pasted repositories, and its tests pass.
- No network requests at runtime other than the site's own files and, for pasted repositories, the proxy.
