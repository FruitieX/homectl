mod core;

fn main() {
  let settings = core::config::read_config();

  println!("Hello, world!");
  println!("{:#?}", settings);
}
