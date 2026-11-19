//! Files that are not written by the project's authors: vendored dependencies,
//! lock files and generated code. Counting them would let a `vendor/` folder or
//! a lock file dwarf the real code in Overview.

const VENDOR_DIRS: &[&str] = &[
    "vendor",
    "vendors",
    "third_party",
    "third-party",
    "thirdparty",
    "node_modules",
    "bower_components",
];

const LOCK_FILES: &[&str] = &[
    "cargo.lock",
    "package-lock.json",
    "npm-shrinkwrap.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "bun.lockb",
    "go.sum",
    "poetry.lock",
    "pipfile.lock",
    "uv.lock",
    "composer.lock",
    "gemfile.lock",
    "flake.lock",
    "mix.lock",
    "pubspec.lock",
    "podfile.lock",
];

pub fn is_vendored(path: &str) -> bool {
    let lower = path.to_lowercase();
    let (dirs, name) = match lower.rsplit_once('/') {
        Some((d, n)) => (d, n),
        None => ("", lower.as_str()),
    };
    dirs.split('/').any(|d| VENDOR_DIRS.contains(&d))
        || LOCK_FILES.contains(&name)
        || name.ends_with(".min.js")
        || name.ends_with(".min.css")
        || name.ends_with(".pb.go")
        || name.ends_with("_pb2.py")
        || name.starts_with("zz_generated")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vendored_paths() {
        for p in [
            "vendor/golang.org/x/sys/unix.go",
            "web/node_modules/a/index.js",
            "Cargo.lock",
            "app/go.sum",
            "static/jquery.min.js",
            "api/v1/types.pb.go",
        ] {
            assert!(is_vendored(p), "{p}");
        }
        for p in [
            "src/vendor.rs",
            "src/main.rs",
            "docs/lockfiles.md",
            "Cargo.toml",
            "vendored/x.rs",
        ] {
            assert!(!is_vendored(p), "{p}");
        }
    }
}
