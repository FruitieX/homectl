// https://doc.rust-lang.org/std/sync/mpsc/fn.channel.html

use super::device::{Device, DeviceKind};

pub trait Integration {
    // rustc --explain E0038
    fn new(id: String) -> Self
    where
        Self: Sized;

    fn register(&self) {}

    fn get_devices(&self) -> Vec<Device<DeviceKind>> {
        Vec::new()
    }
}
