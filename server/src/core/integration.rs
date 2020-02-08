// https://doc.rust-lang.org/std/sync/mpsc/fn.channel.html

use crate::core::device;

pub trait Integration {
  fn new(id: String) -> Self;

  fn get_devices() -> Vec<device::Device> {
    Vec::new()
  }
}
