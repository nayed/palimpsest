#!/usr/bin/env bash
# Builds web/public/data/<repo>/history.json for the three demo repositories,
# each from a pinned commit so the data only changes when the pins do.
# Clones go to .cache/repos/ (not committed).
set -euo pipefail
cd "$(dirname "$0")/.."

cargo build --release --quiet -p palimpsest-cli

build() {
    local dir=$1 url=$2 name=$3 commit=$4
    local clone=.cache/repos/$dir
    if [ ! -d "$clone" ]; then
        git clone --quiet "$url" "$clone"
    fi
    if ! git -C "$clone" cat-file -e "$commit^{commit}" 2>/dev/null; then
        git -C "$clone" fetch --quiet origin
    fi
    git -C "$clone" checkout --quiet --detach "$commit"
    echo "$name at ${commit:0:7}"
    ./target/release/palimpsest build-data "$clone" -o "web/public/data/$dir/history.json" --name "$name"
}

build alacritty https://github.com/alacritty/alacritty alacritty/alacritty 791efff6d74c66bee390c259e322626ca93aadb6
build ripgrep https://github.com/BurntSushi/ripgrep BurntSushi/ripgrep 6670aede458f62440fc8a9aab753230902860e0e
build compose https://github.com/docker/compose docker/compose 469ab94d72326565c6dfdf304a72882115011800
