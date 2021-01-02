# homectl

🚧 WORK IN PROGRESS 🚧

Note: this project is still in very early stages, and I've only recently
started using it as my own "daily driver". This is also my first "real" Rust
project, which brings with it the usual caveats. Expect to find bugs and when
you do, please report them :-)

## Description

This project aims to unify home automation (HA) systems from different
brands, and does so by assuming complete control over the individual systems.
It brings some features that I felt are missing from consumer HA systems,
and also other similar solutions to homectl:

- A common interface for configuring everything in one place (plaintext config file for now).

  * (Hopefully) no more figuring out obscure schedule/rule/condition/action
    configuration that vary per HA supplier. (Instead you have homectl's
    obscure configuration file format for now, but this will be improved upon
    later! :-))

- Allow complete control of actions performed when sensors/buttons are triggered.

  * Because homectl only reads sensor values from HA systems, we are not
    limited by what actions can be programmed into the individual HA system
    controllers.

  * For example, you can put your computer to sleep/wake when you turn off/on
    the lights to your office.

  * Or you could start a robot vacuum when leaving your home between certain
    times of the day.

  * You can also control other manufacturers devices than the one that made the
    light switch you pressed

- Don't trust that the HA systems always do what you want

  * Some HA systems are not as reliable as you would hope, and may for example
    miss a command that you send them.

  * Or a device might simply forget its state due to an accidental power cycle.

  * Due to this, homectl will keep track of the expected state for each device,
    and actively poll devices for their current state, automatically correcting
    any incorrect state it might find.

- An advanced scenes system allow controlling a large amount of devices to preset states.

  * Because homectl keeps track of a device's active scene, we can perform
    certain actions only when a device is in a certain scene. For example, we
    can bind a light switch to multiple scenes and cycle between the scenes.
  
  * Scenes may "link" state from other devices: "go look up what the state of
    this device is and copy the state from there".

  * These devices can be "virtual" devices, such as a device that returns the
    approximate color of the sky.

  * Combine these facts and you can e.g. have your lights smoothly follow a
    circadian rhythm. These transitions will be so smooth that you won't
    notice them. Every time homectl polls your lights their expected state is
    calculated and compared against the actual state. If the difference is
    large enough (still imperceptibly small), then homectl will update the
    lights to match the expected state.

## Setup

- Install `docker` and `docker-compose`
- Clone this repo
- `cp Settings.toml.example Settings.toml`
- `$EDITOR Settings.toml`
- docker-compose up
