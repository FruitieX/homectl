The `backend/src/integrations` folder would be a good place to start looking
around if you want to create a new integration, there's a `dummy` integration
that does the bare minimum things needed from a valid integration.

Also worth looking at some other integrations for more complete examples, such
as the `hue` Philips Hue integration that manages most of my smart lights.

In summary, the associated functions expected by the Integration trait are:

## new:
Returns a new instance of the integration. Good place to deserialize your integration's configuration from homectl's configuration file. The function parameter `config` contains your integration's part of the homectl config, just in an unknown config::Value type which you must deserialize before use

## register:
When homectl starts up, it first runs a "registration" pass for all configured integrations. During this invocation, the integration is supposed to asynchronously discover any devices present in your setup, if possible. The `hue` integration does this, but for example, the `lifx` integration cannot. Lifx devices are discovered over UDP broadcast, so there's no good way to discover those without waiting for some unspecified (probably short, but still) time.

A third option which is the worst from a usability point of view is if the smart device doesn't support any form of discovery, such as the `tuya` integration. Here I have to manually list all information of my devices in the config (IP addresses, ID numbers, various other junk)

In the end, the consequences of not discovering all devices here aren't too severe. In your case with MQTT you might not need to do anything at all here.

## start:
After homectl has finished running the registration pass for all integrations, it runs the `start` associated function of each integration. A good place to start listening for incoming events from your devices, or if you need to do polling, start the polling loops here. Last chance to run some code before homectl core starts running the main loop, basically.

## set_integration_device_state:
Called by homectl core when it wants to update the state of one of your integration's devices. Unpack this message from the parameter you get passed to the function using pattern matching, and forward an appropriate message to your physical device.

## run_integration_action:
Called by homectl core when it wants to run an "action" on one of your integration's devices. Basically I made this escape hatch for state updates that don't map cleanly to this concept of a device having some state, which it should maintain until homectl says otherwise. For example I have a `neato` integration which uses this to start my robot vacuums after some specific conditions. The issue with using "normal" device state, is that the robot vacuum eventually finishes cleaning, and I don't want homectl to think this means it somehow forgot its state, and try to start it again over and over :-)
