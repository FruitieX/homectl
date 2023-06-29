# Changelog

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
