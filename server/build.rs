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
    if prod.exists() {
        println!("cargo:rustc-cfg=has_prod_config");
    } else {
        println!("cargo:warning=prod-config.toml not found; prod-config tests will be ignored at compile time");
    }
}
