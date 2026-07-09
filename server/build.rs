use std::env;
use std::path::Path;

fn main() {
    let manifest = env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR not set");
    let prod = Path::new(&manifest)
        .parent()
        .unwrap()
        .join("prod-config.toml");
    // Tell the compiler to allow `cfg(has_prod_config)` checks and, if the
    // file exists, enable the `has_prod_config` cfg so tests can be
    // conditionally compiled.
    println!("cargo:rustc-check-cfg=cfg(has_prod_config)");
    // Only emit the missing-file warning when running `cargo test`.
    // Cargo sets `PROFILE=test` for test builds.
    let profile = env::var("PROFILE").unwrap_or_default();
    if prod.exists() {
        println!("cargo:rustc-cfg=has_prod_config");
    } else if profile == "test" {
        println!("cargo:warning=prod-config.toml not found; prod-config tests will be ignored at compile time");
    }
}
