# Changelog

## [0.9.2](https://github.com/FruitieX/homectl-server/compare/v0.9.1...v0.9.2) (2024-02-16)


### Features

* set SetInternalState skip_external_update field as optional ([c3861f0](https://github.com/FruitieX/homectl-server/commit/c3861f0ce35ac8264d8a6ee567414c58fc791615))


### Miscellaneous Chores

* release 0.9.2 ([c6b828e](https://github.com/FruitieX/homectl-server/commit/c6b828ed56603f5fc3d8736b6c69456ae266013a))

## [0.9.1](https://github.com/FruitieX/homectl-server/compare/v0.9.0...v0.9.1) (2024-02-15)


### Features

* use device name in logs ([9576765](https://github.com/FruitieX/homectl-server/commit/95767650fcd9dfea617517ce0e40839703762666))


### Miscellaneous Chores

* release 0.9.1 ([557051f](https://github.com/FruitieX/homectl-server/commit/557051f53a0adc8096a9e79befc39470df94449d))

## [0.9.0](https://github.com/FruitieX/homectl-server/compare/v0.8.0...v0.9.0) (2024-02-15)


### Features

* expected state recomputed only when needed ([da23524](https://github.com/FruitieX/homectl-server/commit/da23524bc35451f6079c4fb2688db9594fbfd345))
* FullReadOnly mode for debugging managed devices ([8b75afb](https://github.com/FruitieX/homectl-server/commit/8b75afb513f8b40bca41c974c82ca0ac5da9ffd2))
* recompute scene device states when scene invalidated ([e961dda](https://github.com/FruitieX/homectl-server/commit/e961dda30b150d74532c99b57d1e228c6787dd13))


### Bug Fixes

* disable state transitions when activating scenes ([db8134f](https://github.com/FruitieX/homectl-server/commit/db8134f5ae03441530e0f8f8e76c4c0a0a9d60a0))

## [0.8.0](https://github.com/FruitieX/homectl-server/compare/v0.7.0...v0.8.0) (2024-02-12)


### Features

* support numeric sensor values ([81f01d1](https://github.com/FruitieX/homectl-server/commit/81f01d1a0036a8a69dc350b0260ef4602f99b470))
* support raw device values ([e37602f](https://github.com/FruitieX/homectl-server/commit/e37602f685da7a542ba8f6a389867611f77cab10))
* wait for devices to be discovered at launch ([de0af33](https://github.com/FruitieX/homectl-server/commit/de0af33bbd0092e28c306e61f5171a9c45f233cf))


### Bug Fixes

* **deps:** update rust crate chrono to v0.4.34 ([9b406b2](https://github.com/FruitieX/homectl-server/commit/9b406b278c09ba45242a3c7c88177fe6de6fa0e0))
* **deps:** update rust crate toml to v0.8.10 ([bca9d3e](https://github.com/FruitieX/homectl-server/commit/bca9d3e74442b8bf6b92ee86da1d37e3b828a618))

## [0.7.0](https://github.com/FruitieX/homectl-server/compare/v0.6.3...v0.7.0) (2024-02-05)


### ⚠ BREAKING CHANGES

* rename Action::DimAction to Action::Dim to make clippy happy

### Features

* avoid computing groups/scene structs on every state update ([997de4e](https://github.com/FruitieX/homectl-server/commit/997de4e6ba116800d1a41f7e6ac97d97be431463))
* cron integration ([3be926f](https://github.com/FruitieX/homectl-server/commit/3be926f4ac30abb39690c72590584a3c07879215))
* evalexpr support in rules and actions ([7453168](https://github.com/FruitieX/homectl-server/commit/74531680169a975fc59977e90d3ae19fcc8cab77))
* partially managed devices ([638e516](https://github.com/FruitieX/homectl-server/commit/638e516fd3b2074d8de1b7af998c1fa09e4adeac))
* ReadOnly managed mode ([48a3934](https://github.com/FruitieX/homectl-server/commit/48a39343a7c902072a1a5976539b6967a5b66192))
* **routines:** expressions in rules and actions ([9632c9f](https://github.com/FruitieX/homectl-server/commit/9632c9f57a42ba86a23746c2e444dc5f07904595))
* scene expressions ([e946d89](https://github.com/FruitieX/homectl-server/commit/e946d89a8a0f95934e284aa8586bc29be3d468e7))
* SetDeviceState action ([fd43901](https://github.com/FruitieX/homectl-server/commit/fd43901ef586a17cb4a0978f82c622a2db553980))
* support forcibly triggering routines ([65c2d77](https://github.com/FruitieX/homectl-server/commit/65c2d775c225b8abf28e8ec8433159d8d3e72e2f))


### Bug Fixes

* always convert color to preferred mode when sending ([c52155c](https://github.com/FruitieX/homectl-server/commit/c52155c6a9788a73c3619cb353a6727ed2acfbff))
* bypass config and use toml crate directly ([a219adb](https://github.com/FruitieX/homectl-server/commit/a219adb34e63b27fbbe918167c016d22aa4dd898))
* **deps:** pin dependencies ([6dd5fcc](https://github.com/FruitieX/homectl-server/commit/6dd5fccf59dfc8affce2fd43774d8175af9c9870))
* **deps:** pin rust crate croner to =2.0.4 ([c4413a1](https://github.com/FruitieX/homectl-server/commit/c4413a12348a2d2711618f8499e4302b67a1f6b4))
* **deps:** pin rust crate jsonptr to =0.4.4 ([bd20093](https://github.com/FruitieX/homectl-server/commit/bd20093018866ad8022beb4290fea578aa3b72f6))
* **deps:** pin rust crate serde-this-or-that to =0.4.2 ([21220ae](https://github.com/FruitieX/homectl-server/commit/21220aed92375bfb5fe08549f57e47fe24ab7ab7))
* **deps:** update rust crate async-trait to v0.1.75 ([18fb828](https://github.com/FruitieX/homectl-server/commit/18fb8282779021daffc46c84bc699dd98d7fd4c4))
* **deps:** update rust crate async-trait to v0.1.76 ([cbb0f3f](https://github.com/FruitieX/homectl-server/commit/cbb0f3fdbb92b0a74aea044dd4399409603a33c3))
* **deps:** update rust crate async-trait to v0.1.77 ([483da8c](https://github.com/FruitieX/homectl-server/commit/483da8c7c56edeb71ffd935a511970f367011484))
* **deps:** update rust crate cached to v0.48.0 ([3b73ce0](https://github.com/FruitieX/homectl-server/commit/3b73ce0eebd88d11271d0e791fd1a898b8888462))
* **deps:** update rust crate cached to v0.48.1 ([504c7c1](https://github.com/FruitieX/homectl-server/commit/504c7c1702ba017f8e566fbe55c0ab6c9cb50ba0))
* **deps:** update rust crate chrono to v0.4.32 ([56ea5b0](https://github.com/FruitieX/homectl-server/commit/56ea5b0fd83680ada64c2898bb0e05dfcd3c9687))
* **deps:** update rust crate chrono to v0.4.33 ([a6fcc3c](https://github.com/FruitieX/homectl-server/commit/a6fcc3c9ed287bb8a72fc3c746e6171c6daa47ec))
* **deps:** update rust crate config to v0.14.0 ([544d9ab](https://github.com/FruitieX/homectl-server/commit/544d9ab72bd7219fe1ce5f0f1ec985a10d8a67e1))
* **deps:** update rust crate eyre to v0.6.10 ([8abf002](https://github.com/FruitieX/homectl-server/commit/8abf002e1140fb5c604c62d0301e6e48bb5fe843))
* **deps:** update rust crate eyre to v0.6.11 ([c1f41c2](https://github.com/FruitieX/homectl-server/commit/c1f41c2041a38d5b69e7b0dab85838991c4f7324))
* **deps:** update rust crate eyre to v0.6.12 ([a54cf04](https://github.com/FruitieX/homectl-server/commit/a54cf04b70ea4caff142833deaf23bdcae4c962b))
* **deps:** update rust crate itertools to v0.12.1 ([a6be06e](https://github.com/FruitieX/homectl-server/commit/a6be06ecbd27c34ce5a23494feddf1ba32a6a038))
* **deps:** update rust crate once_cell to v1.19.0 ([c48f7b5](https://github.com/FruitieX/homectl-server/commit/c48f7b5e192a02e6f1cca176095bfcebc0e2bba9))
* **deps:** update rust crate palette to v0.7.4 ([4d4cf09](https://github.com/FruitieX/homectl-server/commit/4d4cf094c59cb107e9b087054093237a88eb3dc2))
* **deps:** update rust crate serde to v1.0.194 ([4da8780](https://github.com/FruitieX/homectl-server/commit/4da87804d8b7a9f6aa35b8a86b62307a2934a52c))
* **deps:** update rust crate serde to v1.0.195 ([d6baed3](https://github.com/FruitieX/homectl-server/commit/d6baed317a6ee35a0c96bf24e46e9c7ef395a3f7))
* **deps:** update rust crate serde to v1.0.196 ([c25c6bf](https://github.com/FruitieX/homectl-server/commit/c25c6bf8e48704ebfa16e00135db6b619307f94a))
* **deps:** update rust crate serde_json to v1.0.109 ([05a0e92](https://github.com/FruitieX/homectl-server/commit/05a0e92e6168563f54e66305f30cbca2d43872fe))
* **deps:** update rust crate serde_json to v1.0.110 ([b7f92ab](https://github.com/FruitieX/homectl-server/commit/b7f92aba4320b9f4f0b352d36a7d26ec8afdc68d))
* **deps:** update rust crate serde_json to v1.0.111 ([07fd30d](https://github.com/FruitieX/homectl-server/commit/07fd30d3668b83a8744a0247233914578cb816ab))
* **deps:** update rust crate serde_json to v1.0.112 ([aa72849](https://github.com/FruitieX/homectl-server/commit/aa7284937c7f34936c7de4e00dbd4126e00c1918))
* **deps:** update rust crate serde_json to v1.0.113 ([4dae8b3](https://github.com/FruitieX/homectl-server/commit/4dae8b3e1c29efe6e987c428f4f66d1c631ab589))
* **deps:** update rust crate serde_path_to_error to v0.1.15 ([8ecd7f4](https://github.com/FruitieX/homectl-server/commit/8ecd7f493c62a72806c34b22ecc59ecca0f5a5ec))
* **deps:** update rust crate tokio to v1.35.0 ([3c3962e](https://github.com/FruitieX/homectl-server/commit/3c3962e19e43335cdca355fe0b74fb0530b10a2e))
* **deps:** update rust crate tokio to v1.35.1 ([1633046](https://github.com/FruitieX/homectl-server/commit/16330462335ac83ee601fc957fd5d65c0f729212))
* **deps:** update rust crate tokio to v1.36.0 ([93c4479](https://github.com/FruitieX/homectl-server/commit/93c44790de31c6ffcd27c105104f4a6871cd4bdd))
* **deps:** update rust crate toml to v0.8.9 ([060f1e5](https://github.com/FruitieX/homectl-server/commit/060f1e5d288670ea9b0d257769293c41b08ec0a1))
* **deps:** update rust crate ts-rs to v7.1.0 ([40d1edf](https://github.com/FruitieX/homectl-server/commit/40d1edf6fefd3af01c6da92fa95b1cbe7dd93a7b))
* **deps:** update rust crate ts-rs to v7.1.1 ([72d0bb9](https://github.com/FruitieX/homectl-server/commit/72d0bb9feaa2474734955b93f31ddea83b531f9f))
* **deps:** update rust-futures monorepo to v0.3.30 ([2b396c9](https://github.com/FruitieX/homectl-server/commit/2b396c9cc1f959f0d802e3ab5a6bc59bca02f225))
* don't spawn new task for each message ([e6a6e89](https://github.com/FruitieX/homectl-server/commit/e6a6e897746a01ffc050b36373cd9523d55c0600))
* drop neato and wake_on_lan integrations ([161480d](https://github.com/FruitieX/homectl-server/commit/161480d5ad2bae09f7a07e0ae8c608c191c57b41))
* improve method of detecting written expr vars ([45125e8](https://github.com/FruitieX/homectl-server/commit/45125e8764d0cfe6cc05ed8649b138586274a289))
* make more use of cached flattened groups config ([b18d32c](https://github.com/FruitieX/homectl-server/commit/b18d32ceca258333acff13ee84222e771a6c8e76))
* websockets don't hold onto state lock forever ([360d804](https://github.com/FruitieX/homectl-server/commit/360d804bd144a585935f74f308c54ce9eef07a1a))


### Miscellaneous Chores

* release 0.7.0 ([ba4fca7](https://github.com/FruitieX/homectl-server/commit/ba4fca7478b02eb7014f2a93cc6303ae96b27430))
* rename Action::DimAction to Action::Dim to make clippy happy ([3851b92](https://github.com/FruitieX/homectl-server/commit/3851b927382c067c050b02cd3d627c8d5dc4dbf1))

## [0.6.3](https://github.com/FruitieX/homectl-server/compare/v0.6.2...v0.6.3) (2023-11-25)


### Bug Fixes

* always broadcast state updates to ws ([7bd6d70](https://github.com/FruitieX/homectl-server/commit/7bd6d70d622eae0139bde14d35878e771aae16e4))

## [0.6.2](https://github.com/FruitieX/homectl-server/compare/v0.6.1...v0.6.2) (2023-11-25)


### Bug Fixes

* core takes care of correct unmanaged msg type ([27e36d3](https://github.com/FruitieX/homectl-server/commit/27e36d365086d8a79d9cf97611d425543fc8a6c3))
* move the managed flag inside DeviceData::Controllable ([6bd7740](https://github.com/FruitieX/homectl-server/commit/6bd77409f793e9632313775a1f4b6d949c78fb47))

## [0.6.1](https://github.com/FruitieX/homectl-server/compare/v0.6.0...v0.6.1) (2023-11-25)


### Bug Fixes

* unmanaged device updates don't emit SendDeviceState ([2d2223e](https://github.com/FruitieX/homectl-server/commit/2d2223e4c384ff365b8159bf618fc07c09790bac))

## [0.6.0](https://github.com/FruitieX/homectl-server/compare/v0.5.1...v0.6.0) (2023-11-25)


### Features

* **mqtt:** unmanaged mqtt devices ([d2352e0](https://github.com/FruitieX/homectl-server/commit/d2352e043190face0357cb6d93e58f93057c65ff))


### Bug Fixes

* **deps:** update rust crate config to v0.13.4 ([3b9588c](https://github.com/FruitieX/homectl-server/commit/3b9588cfb74034605f66f82147c3e6ad543a69fc))
* **deps:** update rust crate eyre to v0.6.9 ([315456f](https://github.com/FruitieX/homectl-server/commit/315456f9bbd6920e9fda19bad7bf46bfb7476e64))
* **deps:** update rust crate itertools to v0.12.0 ([0865780](https://github.com/FruitieX/homectl-server/commit/086578010f7261edf6271c246b0b0f5e143d2bd1))
* **deps:** update rust crate serde to 1.0.190 ([8f81352](https://github.com/FruitieX/homectl-server/commit/8f81352b9298fe598857b244389959a1b0e82ddc))
* **deps:** update rust crate serde to v1.0.192 ([548d501](https://github.com/FruitieX/homectl-server/commit/548d5019dc658089ded210f4ecbd5ed4c659e3f5))
* **deps:** update rust crate serde to v1.0.193 ([504790e](https://github.com/FruitieX/homectl-server/commit/504790e8ce2093aad89e3670d77a64d9a11f237c))
* **deps:** update rust crate serde_json to v1.0.108 ([fb18f91](https://github.com/FruitieX/homectl-server/commit/fb18f914aad62c46544b2874846a7f5bb3176b7d))
* **deps:** update rust crate sqlx to v0.7.3 ([5db2ed9](https://github.com/FruitieX/homectl-server/commit/5db2ed9d87a3393c84a96fe08b52896ca807cb46))
* **deps:** update rust crate tokio to v1.34.0 ([45ad1de](https://github.com/FruitieX/homectl-server/commit/45ad1de6d7aa94cccb71c7b58af1c8506031298a))
* **deps:** update rust crate toml to 0.8.4 ([1115970](https://github.com/FruitieX/homectl-server/commit/1115970db6aa7eed2d1dec4c9a7ead797f81b5f3))
* **deps:** update rust crate toml to v0.8.5 ([8ce7c73](https://github.com/FruitieX/homectl-server/commit/8ce7c731106ace1ba1e579de87a647bf4c1c4c1c))
* **deps:** update rust crate toml to v0.8.6 ([71b03f1](https://github.com/FruitieX/homectl-server/commit/71b03f13b04367c342651ae231c949b25385ad86))
* **deps:** update rust crate toml to v0.8.8 ([9dbc604](https://github.com/FruitieX/homectl-server/commit/9dbc604e57294be4ff6bff4bd8a7e920ed755e7c))
* **deps:** update rust-futures monorepo to v0.3.29 ([2e87670](https://github.com/FruitieX/homectl-server/commit/2e876700db508decc08cbf221e8e4b20f8026355))
* perform db updates in separate task ([ff04147](https://github.com/FruitieX/homectl-server/commit/ff041479621d3263dc0acb628be1042c1904daa7))
* remove redundant device db update call ([23e985e](https://github.com/FruitieX/homectl-server/commit/23e985eeb9a1a461ad44a59e99ede7973e4b8442))
* warn if scenes table is busted ([6a8ed45](https://github.com/FruitieX/homectl-server/commit/6a8ed458a8789a1f8fd3e60c50579634c098f28b))

## [0.5.1](https://github.com/FruitieX/homectl-server/compare/v0.5.0...v0.5.1) (2023-10-20)


### Miscellaneous Chores

* release 0.5.1 ([1b97e07](https://github.com/FruitieX/homectl-server/commit/1b97e070d2193591a9c352d7b149bf10edadfe64))

## [0.5.0](https://github.com/FruitieX/homectl-server/compare/v0.4.5...v0.5.0) (2023-10-20)


### Features

* adds dim/brighten action for lights ([89382fa](https://github.com/FruitieX/homectl-server/commit/89382fa83371c3c4c8de9135109a12d9f28e9217))


### Bug Fixes

* **deps:** update all non-major dependencies ([6318096](https://github.com/FruitieX/homectl-server/commit/63180960410700a786631c4333d8e54c4d0911db))
* **deps:** update rust crate async-trait to 0.1.69 ([74b3985](https://github.com/FruitieX/homectl-server/commit/74b3985803e13fc600d0abdf5ab50ccd8dd53b02))
* **deps:** update rust crate json_value_merge to v2 ([7940e43](https://github.com/FruitieX/homectl-server/commit/7940e437fa8b7374b1292ae093ff496964a8f431))
* **deps:** update rust crate serde to 1.0.166 ([b38995b](https://github.com/FruitieX/homectl-server/commit/b38995bed70fc7d332707f8d0d61445f691ee8cb))
* **deps:** update rust crate ts-rs to v7 ([eedf5b8](https://github.com/FruitieX/homectl-server/commit/eedf5b84593622214ff57dacb642a1476970041d))
* MQTT client re-subscribes on reconnect ([7f1ef3d](https://github.com/FruitieX/homectl-server/commit/7f1ef3da3dfc72240fef37ebfb4a6309d7d1a6c6))

## [0.4.5](https://github.com/FruitieX/homectl-server/compare/v0.4.4...v0.4.5) (2023-06-29)


### Features

* don't convert Ct colors in API responses ([9d7142c](https://github.com/FruitieX/homectl-server/commit/9d7142c37e7c28b66235670da0957e312dc46274))
* improved error reporting with color_eyre ([ecb2163](https://github.com/FruitieX/homectl-server/commit/ecb21637b5b1fae06548abd7e716a408cd815001))


### Miscellaneous Chores

* release 0.4.5 ([75acffd](https://github.com/FruitieX/homectl-server/commit/75acffd3b9f5339a66858eb6db695bb512cc79f4))

## [0.4.4](https://github.com/FruitieX/homectl-server/compare/v0.4.3...v0.4.4) (2023-06-26)


### Features

* perform all logging via pretty_env_logger ([87a2290](https://github.com/FruitieX/homectl-server/commit/87a2290242136b5e50e648504f915f0e08453757))


### Bug Fixes

* attempt reconnecting to mqtt after failure ([c731799](https://github.com/FruitieX/homectl-server/commit/c731799df148d19c66b342312e90b6da567d0a91))
* **deps:** update rust crate itertools to 0.11.0 ([ce60f83](https://github.com/FruitieX/homectl-server/commit/ce60f8367aafa6dc1872dd14486ec4b1cee88c12))
* **deps:** update rust crate toml to 0.7.5 ([af7687f](https://github.com/FruitieX/homectl-server/commit/af7687fced4941102f5b6a0d1bc1ad33946f67bd))

## [0.4.3](https://github.com/FruitieX/homectl-server/compare/v0.4.2...v0.4.3) (2023-06-17)


### Bug Fixes

* don't set default brightness when power is false ([bfba94d](https://github.com/FruitieX/homectl-server/commit/bfba94d5de5b0970cc57cde9dd43758f73f116ff))

## [0.4.2](https://github.com/FruitieX/homectl-server/compare/v0.4.1...v0.4.2) (2023-06-16)


### Bug Fixes

* convert device state to Hs mode in api responses ([875e950](https://github.com/FruitieX/homectl-server/commit/875e950749284b42259573678ee116645b3f1def))

## [0.4.1](https://github.com/FruitieX/homectl-server/compare/v0.4.0...v0.4.1) (2023-06-16)


### Features

* support specifying color mode in get devices endpoint ([9397fea](https://github.com/FruitieX/homectl-server/commit/9397feaa89331f6019fb96bde2c1b2135fbf5692))


### Miscellaneous Chores

* release 0.4.1 ([907d8b0](https://github.com/FruitieX/homectl-server/commit/907d8b0615c663a68fbd73eeb780fff907214390))

## [0.4.0](https://github.com/FruitieX/homectl-server/compare/v0.2.0...v0.4.0) (2023-06-16)


### ⚠ BREAKING CHANGES

* removed hue, lifx, ping integrations in favor of mqtt integrations. Migrate to e.g. [hue-mqtt](https://github.com/FruitieX/hue-mqtt), [lifx-mqtt](https://github.com/FruitieX/lifx-mqtt) using the `mqtt` integration instead.
* the shape of device state has changed in API endpoints, config files, db rows. HSV colors are now represented as `color = { h = 42, s = 0.5 }`. Value is ignored, use brightness on the device instead.

### Features

* compare device color in preferred color format ([46f6c05](https://github.com/FruitieX/homectl-server/commit/46f6c050170504ee357530df9804f7dcc36e3eec))
* **dummy:** support all device types ([58d445e](https://github.com/FruitieX/homectl-server/commit/58d445e023894a8422666458331f5106424eef2b))
* **mqtt:** support publishing arbitrary messages ([611dbd2](https://github.com/FruitieX/homectl-server/commit/611dbd2dbafebf01b4da354c2130b2a72b77720d))
* **wol:** allow supplying broadcast SocketAddr ([7742221](https://github.com/FruitieX/homectl-server/commit/77422216739b12dda33d461d665758737023521c))


### Bug Fixes

* **deps:** update all non-major dependencies ([88dba85](https://github.com/FruitieX/homectl-server/commit/88dba856d5987b48e10734064a2e7e8422487be6))
* **deps:** update rust crate chrono to 0.4.26 ([9cb1006](https://github.com/FruitieX/homectl-server/commit/9cb1006205756327aa01c7e29c2fd076f4a88f41))
* **deps:** update rust crate log to 0.4.19 ([246487d](https://github.com/FruitieX/homectl-server/commit/246487d6633c48e7c1fc6cff42defab9fae6d773))
* **deps:** update rust crate once_cell to 1.18.0 ([f6fcd48](https://github.com/FruitieX/homectl-server/commit/f6fcd487f3e6c525a45dc535c29245188428f132))
* **deps:** update rust crate palette to 0.7.2 ([23499c7](https://github.com/FruitieX/homectl-server/commit/23499c7030b10b52a69f50ea84f00e3aa6620776))
* **deps:** update rust crate rumqttc to 0.22.0 ([3c38c8b](https://github.com/FruitieX/homectl-server/commit/3c38c8b5bc96a66a8f5edf85d4965c6b745906e7))
* **deps:** update rust crate serde to 1.0.164 ([2f5369b](https://github.com/FruitieX/homectl-server/commit/2f5369bee3832daacacecb00a58fb823cfc9ace1))
* **deps:** update rust crate sha2 to 0.10.7 ([c5f26b4](https://github.com/FruitieX/homectl-server/commit/c5f26b4566c302963ae3d4296d2f77694f8bd283))
* **deps:** update rust crate toml to 0.7.4 ([dd85f9b](https://github.com/FruitieX/homectl-server/commit/dd85f9b357d0694f378999ece785d5e487acbe8d))
* don't send device update upon restore from db ([ff265f6](https://github.com/FruitieX/homectl-server/commit/ff265f68c2c236d5407cae2428c20f23363c2035))
* improve formatting of printed state mismatch messages ([6749d45](https://github.com/FruitieX/homectl-server/commit/6749d45e55b222677d60a99ca4f8753ff83e1c74))
* incorrect put_device endpoint path ([65c7a45](https://github.com/FruitieX/homectl-server/commit/65c7a45762b59a2c1799463d480e34fcc67985f0))
* missing scene brightness bug ([6749d45](https://github.com/FruitieX/homectl-server/commit/6749d45e55b222677d60a99ca4f8753ff83e1c74))
* **neato:** check time of day even with force flag ([ed8c5a4](https://github.com/FruitieX/homectl-server/commit/ed8c5a4ec56d6307a68497ffb4b171669ec118cf))
* remove unused variable ([07b4b33](https://github.com/FruitieX/homectl-server/commit/07b4b33f89eb5b8819e6e63d5f561681c4fccad5))
* set default working directory in Dockerfile ([4ddd5ed](https://github.com/FruitieX/homectl-server/commit/4ddd5edb3bd59b63f77d67f7c2bf7db93f0ecce0))


### Code Refactoring

* remove outdated code ([d03cb8f](https://github.com/FruitieX/homectl-server/commit/d03cb8f5319578b10d6b4ba543e319bedfc49e92))
* simplify device structs ([d03cb8f](https://github.com/FruitieX/homectl-server/commit/d03cb8f5319578b10d6b4ba543e319bedfc49e92))


### Miscellaneous Chores

* release 0.4.0 ([6e7a0ee](https://github.com/FruitieX/homectl-server/commit/6e7a0ee4c13e2cb3fbf7b137548cdf7a9249d6d0))

## [0.3.0](https://github.com/FruitieX/homectl-server/compare/v0.2.0...v0.3.0) (2023-05-31)


### Features

* **dummy:** support all device types ([58d445e](https://github.com/FruitieX/homectl-server/commit/58d445e023894a8422666458331f5106424eef2b))
* **mqtt:** support publishing arbitrary messages ([611dbd2](https://github.com/FruitieX/homectl-server/commit/611dbd2dbafebf01b4da354c2130b2a72b77720d))
* **wol:** allow supplying broadcast SocketAddr ([7742221](https://github.com/FruitieX/homectl-server/commit/77422216739b12dda33d461d665758737023521c))


### Bug Fixes

* **deps:** update all non-major dependencies ([88dba85](https://github.com/FruitieX/homectl-server/commit/88dba856d5987b48e10734064a2e7e8422487be6))
* **deps:** update rust crate chrono to 0.4.26 ([9cb1006](https://github.com/FruitieX/homectl-server/commit/9cb1006205756327aa01c7e29c2fd076f4a88f41))
* **deps:** update rust crate palette to 0.7.2 ([23499c7](https://github.com/FruitieX/homectl-server/commit/23499c7030b10b52a69f50ea84f00e3aa6620776))
* **deps:** update rust crate toml to 0.7.4 ([dd85f9b](https://github.com/FruitieX/homectl-server/commit/dd85f9b357d0694f378999ece785d5e487acbe8d))
* don't send device update upon restore from db ([ff265f6](https://github.com/FruitieX/homectl-server/commit/ff265f68c2c236d5407cae2428c20f23363c2035))
* incorrect put_device endpoint path ([65c7a45](https://github.com/FruitieX/homectl-server/commit/65c7a45762b59a2c1799463d480e34fcc67985f0))
* **neato:** check time of day even with force flag ([ed8c5a4](https://github.com/FruitieX/homectl-server/commit/ed8c5a4ec56d6307a68497ffb4b171669ec118cf))
* remove unused variable ([07b4b33](https://github.com/FruitieX/homectl-server/commit/07b4b33f89eb5b8819e6e63d5f561681c4fccad5))

## 0.2.0 (2023-05-17)


### Miscellaneous Chores

* release 0.2.0 ([4bb7c5d](https://github.com/FruitieX/homectl-server/commit/4bb7c5d0e5a64e5265aff75802271cee92317b23))
