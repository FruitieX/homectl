use super::integration::Integration;
use crate::integrations::dummy::Dummy;
use std::collections::HashMap;

fn load_integration(
    module_name: &String,
    id: &String,
    config: String,
) -> Result<Box<dyn Integration>, String> {
    match module_name.as_str() {
        "dummy" => Ok(Box::new(Dummy::new(id.clone()))),
        _ => Err(format!("Unknown module name {}!", module_name)),
    }
}

pub struct IntegrationsManager {
    integrations: HashMap<String, Box<dyn Integration>>,
}

impl IntegrationsManager {
    pub fn new() -> Self {
        IntegrationsManager {
            integrations: HashMap::new(),
        }
    }

    pub fn load(&mut self, module_name: &String, id: &String) -> Result<(), String> {
        let integration = load_integration(module_name, id, "".into())?;
        self.integrations.insert(id.clone(), integration);

        Ok(())
    }

    pub fn register(&self) {
        // for (_id, integration) in self.integrations {
        //     integration.register();
        // }
    }

    pub fn start(&self) {}
}
