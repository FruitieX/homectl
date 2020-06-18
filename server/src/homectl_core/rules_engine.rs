use super::{
    device::Device,
    devices_manager::DevicesState,
    events::{Message, TxEventChannel},
    rule::{Action, Actions, Routine, RoutinesConfig},
};

pub struct RulesEngine {
    config: RoutinesConfig,
    sender: TxEventChannel,
}

impl RulesEngine {
    pub fn new(config: RoutinesConfig, sender: TxEventChannel) -> Self {
        RulesEngine { config, sender }
    }

    pub fn handle_device_update(
        &self,
        old_state: DevicesState,
        new_state: DevicesState,
        old: Option<Device>,
        new: Device,
    ) {
        match old {
            Some(old) => {
                println!("device_updated {:?} (was: {:?})", new, old);

                let matching_actions = self.find_matching_actions();

                for action in matching_actions {
                    self.run_action(&action);
                }
            }
            None => {}
        }
    }

    fn run_action(&self, action: &Action) {
        match action {
            Action::ActivateScene(action) => {
                self.sender
                    .send(Message::ActivateScene(action.clone()))
                    .unwrap();
            }
        }
    }

    fn find_matching_actions(&self) -> Actions {
        // TODO
        panic!()
    }
}

fn is_routine_triggered(routine: &Routine) {
    // TODO
    panic!()
}
