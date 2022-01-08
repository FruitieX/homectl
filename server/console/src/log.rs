// from https://rustwasm.github.io/wasm-bindgen/examples/console-log.html
#[macro_export]
macro_rules! log {
    // no idea why this needs to be wrapped in unsafe {} for rust-analyzer to be
    // happy
    ($($t:tt)*) => (unsafe {
        web_sys::console::log_1(&format_args!($($t)*).to_string().into())
    })
}

#[macro_export]
macro_rules! eprintln {
    // no idea why this needs to be wrapped in unsafe {} for rust-analyzer to be
    // happy
    ($($t:tt)*) => (unsafe {
      web_sys::console::error_1(&format_args!($($t)*).to_string().into())
    })
}

#[macro_export]
macro_rules! dbg {
    // NOTE: We cannot use `concat!` to make a static string as a format argument
    // of `eprintln!` because `file!` could contain a `{` or
    // `$val` expression could be a block (`{ .. }`), in which case the `eprintln!`
    // will be malformed.
    () => {
        $crate::eprintln!("[{}:{}]", file!(), line!());
    };
    ($val:expr $(,)?) => {
        // Use of `match` here is intentional because it affects the lifetimes
        // of temporaries - https://stackoverflow.com/a/48732525/1063961
        match $val {
            tmp => {
                $crate::eprintln!("[{}:{}] {} = {:#?}",
                    file!(), line!(), stringify!($val), &tmp);
                tmp
            }
        }
    };
    ($($val:expr),+ $(,)?) => {
        ($($crate::dbg!($val)),+,)
    };
}
