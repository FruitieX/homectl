# homectl

Discord: https://discord.gg/xP2s6EY8rd

🚧 WORK IN PROGRESS 🚧

Note: this project is still in quite early stages. Regardless, I've been using
this as a daily driver for over a year now. This is also my first "real" Rust
project, which brings with it the usual caveats. The architecture isn't
necessarily the best, but luckily refactoring Rust code is a fairly pleasant
experience.

If you're not ready to get your hands dirty with Rust code, I would suggest
trying out other alternatives for now.

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



- Copy `backend/Settings.toml.example` into `backend/Settings.toml`, edit it to match your setup. TODO: Better documentation over this process. If you need help/tips, you can ping me on Discord.
- Setup PostgreSQL on your host.

NOTE: If you use the [Nix package manager](https://nixos.org/download.html) there's a default.nix shell in the repo root. You shouldn't need any other setup. If not, continue:

- Install the Rust toolchain using [`rustup`](https://rustup.rs/)
- Run `./start-backend.sh`
- Optional: Run `./start-frontend.sh`
