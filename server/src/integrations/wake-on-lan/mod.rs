struct WakeOnLan {
}

impl Integration on WakeOnLan {
  pub fn new(id: String) -> WakeOnLan {
    WakeOnLan { id }
  }
}