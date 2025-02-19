use clap::Parser;

#[derive(Clone, Parser)]
#[command(version, about, long_about = None)]
pub struct Cli {
    #[arg(long, required = false, default_value_t = false)]
    pub dry_run: bool,
}
