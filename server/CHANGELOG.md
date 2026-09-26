# Changelog

## [1.0.0](https://github.com/FruitieX/homectl/compare/homectl-server-v0.9.5...homectl-server-v1.0.0) (2026-09-26)


### ⚠ BREAKING CHANGES

* **floorplan:** store device positions in floorplan grids
* config refactor into sqlite

### Features

* add configuration diagnostics and streamline scene access ([04cdafa](https://github.com/FruitieX/homectl/commit/04cdafaed0c3fb26c00a12a4a46a29d4110eb411))
* add database-backed sensor catalog ([c3e284e](https://github.com/FruitieX/homectl/commit/c3e284e2c62f8da156842d59ac5d1356e793c010))
* add one-shot random color action ([5dc89c2](https://github.com/FruitieX/homectl/commit/5dc89c211dd096d24b615d17a1921e35004e7cb7))
* add per-device HSV color calibration ([e3f78e0](https://github.com/FruitieX/homectl/commit/e3f78e03b1c79772e99c432cff0010d39ccf9584))
* add raw rules and safer scene action controls ([9c79be3](https://github.com/FruitieX/homectl/commit/9c79be3945773e1000e26e45efcfe100005eac8f))
* add reference-based color calibration wizard ([8b0d2ce](https://github.com/FruitieX/homectl/commit/8b0d2ce5886a9d88c3e439388d53653e482cac5e))
* add routine history, floorplan controls, and dev experience improvements ([4df0051](https://github.com/FruitieX/homectl/commit/4df00513dd17fa3e10bfb18eb7f2f2a83cb68713))
* adds more configuration possibilies for the `random` integration: `min/max_brightness`, `min/max_saturation`, `transition` and `strobe_interval`. ([f56ddd5](https://github.com/FruitieX/homectl/commit/f56ddd562d0ee2ef570db212f4714d5f7636f7c7))
* **api,ui:** preview schedule trigger occurrences ([d35183a](https://github.com/FruitieX/homectl/commit/d35183a9360649431c91975afedab43181627933))
* **api:** persist and validate computed source definitions ([afc4839](https://github.com/FruitieX/homectl/commit/afc4839791e7343b202888e5fcea5d8da16f3670))
* apply scene transitions to automation and fix color drift loops ([5aef129](https://github.com/FruitieX/homectl/commit/5aef129c4884778d76fcc65e8924bab6e2582cf7))
* **assistant:** add a past-thread back button and restore applied state ([f06cff1](https://github.com/FruitieX/homectl/commit/f06cff194621aade9e313d1cc5a8b60ca3583029))
* **assistant:** answer questions from live state and recent logs ([cd160a7](https://github.com/FruitieX/homectl/commit/cd160a750047e53d86bf6311a28ecec6ea7fa98d))
* **assistant:** apply one-off light state requests from the floorplan ([e787f87](https://github.com/FruitieX/homectl/commit/e787f87f71a990e569aaaa794d5f387f533b6105))
* **assistant:** drop proposal expiry ([4c0a7f7](https://github.com/FruitieX/homectl/commit/4c0a7f7d6710862c8e750fd0d9b0a28c09cb87a9))
* **assistant:** keep proposed plans and actions in saved threads ([985563b](https://github.com/FruitieX/homectl/commit/985563b00763a6da8abafd440f4b7ad12c8406fc))
* **assistant:** persist conversations and list recent threads ([f98b405](https://github.com/FruitieX/homectl/commit/f98b4055c7800117ce07c308b4a14715e0d97599))
* **assistant:** rework proposal review and apply ([2cd7e1d](https://github.com/FruitieX/homectl/commit/2cd7e1da6cf43420a28aebec754ddf4a1721a02e))
* **assistant:** store provider settings in the database ([95d5e82](https://github.com/FruitieX/homectl/commit/95d5e822898efccb79c8cf51c3c5daaf9c06fe7e))
* **assistant:** unify AI panel with streaming, history, and light actions ([015afea](https://github.com/FruitieX/homectl/commit/015afeadb511445e62053fec20da0a2fd0eb65b2))
* **automation:** add actor-routed timer cancellation ([949a9e1](https://github.com/FruitieX/homectl/commit/949a9e184bd30ad7e0e77ec45c811fce55da1e1e))
* **automation:** add computed source model and circadian oracle ([e6b9449](https://github.com/FruitieX/homectl/commit/e6b944935921c926bc78ddee2a53e95eb89d063d))
* **automation:** add predicate deadline jobs to the timer store ([1656ddc](https://github.com/FruitieX/homectl/commit/1656ddc7837891183766e49549c05c06dab41d4c))
* **automation:** add schedule occurrence jobs to the timer store ([41aa1a1](https://github.com/FruitieX/homectl/commit/41aa1a1bbcacbad3efc23cd3a8a8100949cdac57))
* **automation:** add the legacy scene materializer worker API ([5405fd7](https://github.com/FruitieX/homectl/commit/5405fd7c0ae95fa67d3533e135c06c23d2e06710))
* **automation:** add the offline v1 to v2 routine converter ([404c496](https://github.com/FruitieX/homectl/commit/404c496dd8f6effd8bd13c9084051df2a4f9df08))
* **automation:** add the script ABI, contracts, and owner coordinator ([72c19ef](https://github.com/FruitieX/homectl/commit/72c19ef702d5f4372e2555c92a5c75f6ef3f6253))
* **automation:** add the v2 cycle-scenes action ([ed46deb](https://github.com/FruitieX/homectl/commit/ed46deb12a0b7411dde23facf4758caf428bc258))
* **automation:** add the v2 randomize-color action ([185d74e](https://github.com/FruitieX/homectl/commit/185d74eb90364152bedb84fe7bda1a54b836c9f7))
* **automation:** add v2 routine schema and pure definition compiler ([142b429](https://github.com/FruitieX/homectl/commit/142b429a156b527e7fe6046e8ae1b71378854a16))
* **automation:** allow zero-delay timers as queued events ([76a853d](https://github.com/FruitieX/homectl/commit/76a853dfff8864c09a44995a622b077213045f40))
* **automation:** arm sustained predicates from trigger frames ([52f01cb](https://github.com/FruitieX/homectl/commit/52f01cba21b9d5bd22a42cb434b6744f596cb360))
* **automation:** capture target intents for scheduled timers ([312744d](https://github.com/FruitieX/homectl/commit/312744d6a22903cda0c542b6848fdd8ef584db72))
* **automation:** carry rollout and activation options on v2 scenes ([4b11da0](https://github.com/FruitieX/homectl/commit/4b11da03b2ee942ce5234d7e4a13069e98860e6c))
* **automation:** collect coherent mutation frames with origins and causation ([9b60607](https://github.com/FruitieX/homectl/commit/9b606076555564f001f69c8b2415eb7102f61620))
* **automation:** convert cron schedules and timer actions ([37f9764](https://github.com/FruitieX/homectl/commit/37f97642ae957e0f448b143c25674da5b6ca4048))
* **automation:** evaluate queued updates against coherent event frames ([3be1a24](https://github.com/FruitieX/homectl/commit/3be1a24c645a73e6c3f0e29f91d6500c51e5c812))
* **automation:** evaluate v2 triggers and conditions natively ([d94f321](https://github.com/FruitieX/homectl/commit/d94f321379aab508f0e00931db55d97891244f5e))
* **automation:** execute v2 script programs off the actor ([8bc102b](https://github.com/FruitieX/homectl/commit/8bc102b75d67ecbd8b99e9bb6490eb92588a32a4))
* **automation:** expose armed trigger deadlines in routine status ([cbf784b](https://github.com/FruitieX/homectl/commit/cbf784b7413558617830b6c1d869c9f867f3c68d))
* **automation:** fire calendar schedules from the wakeup driver ([fef2649](https://github.com/FruitieX/homectl/commit/fef26493a82ce47b2acb6752442ed074afb510ac))
* **automation:** freeze group membership for captured intents ([dd3f4ee](https://github.com/FruitieX/homectl/commit/dd3f4ee58c5cf30cd65d4c6d5cdf63c11667829f))
* **automation:** generate civil-time schedule occurrences ([1ab524e](https://github.com/FruitieX/homectl/commit/1ab524e7e5e2b892984e16051e7666f9e8269354))
* **automation:** map v1 any-of-events and device scene rules ([73a7c37](https://github.com/FruitieX/homectl/commit/73a7c3753cbef00aa2f6e2761c67245cfb500c7f))
* **automation:** materialize scene scripts off the actor ([54f513e](https://github.com/FruitieX/homectl/commit/54f513e6f4a06f6a01f48bcfbe0e5516ddf285a1))
* **automation:** persist named timers across restarts ([5963675](https://github.com/FruitieX/homectl/commit/59636758286c0242c2dc2ff3603cc695240b5bc1))
* **automation:** plan and dispatch v2 actions with typed helpers ([d2746de](https://github.com/FruitieX/homectl/commit/d2746de49b2229569841186739f1c5a2ef69776e))
* **automation:** publish live timer status in the runtime snapshot ([233af43](https://github.com/FruitieX/homectl/commit/233af43b267d198a6d3e7b67a080d5f977f21cd2))
* **automation:** record why a matched routine did not run ([4c77851](https://github.com/FruitieX/homectl/commit/4c77851dcd76680531f40e3382f6e4138c706972))
* **automation:** refresh computed sources through a read-only device ([96b1ab1](https://github.com/FruitieX/homectl/commit/96b1ab1cf6e0ebcdca52a0031be4ad2efbc1fadb))
* **automation:** resolve computed sources in conditions ([5d6a48a](https://github.com/FruitieX/homectl/commit/5d6a48a71a80cfb8b4f2f81128ad073c53d7f444))
* **automation:** route v1 rule scripts through the worker ([2ac01d6](https://github.com/FruitieX/homectl/commit/2ac01d673b8cfb06c526a379719daec04c9fb807))
* **automation:** run computed sources through scripted presets ([3e9478f](https://github.com/FruitieX/homectl/commit/3e9478fe02125d91e33af403a610639d5229b3f0))
* **automation:** run scripts in a supervised worker process ([78220e5](https://github.com/FruitieX/homectl/commit/78220e5007dba6fc752d5391c380a8bdab051920))
* **automation:** schedule named timers off the actor ([d24f908](https://github.com/FruitieX/homectl/commit/d24f908e96fb75fb4def6acbb93821bea96dd6c7))
* **automation:** track script declarations and broad reads ([f136229](https://github.com/FruitieX/homectl/commit/f136229bde922a7e340bb6977e325a2848284bca))
* **automation:** validate calendar grammar and backlog policy ([3b6a3a8](https://github.com/FruitieX/homectl/commit/3b6a3a83a8c6ebeea43259b4bbed6a49f1d38f14))
* **automation:** validate routines and stop status refresh writing history ([0e9d1ff](https://github.com/FruitieX/homectl/commit/0e9d1ff093cea09d2c11572d38bcc61fed559247))
* **calibration:** calibrate brightness on its own channel ([b7c4954](https://github.com/FruitieX/homectl/commit/b7c495494506a091f93651c0b588880724070175))
* **calibration:** preview brightness on a dimmer with no colour support ([256b5fe](https://github.com/FruitieX/homectl/commit/256b5fe4645fb3396e4927106b8f9dbca1a58ba9))
* **calibration:** reports read back through the brightness curve ([65cd2a1](https://github.com/FruitieX/homectl/commit/65cd2a1164f2b5bdb145f2efed58ac65156b3d24))
* **calibration:** support editing light profiles ([2284406](https://github.com/FruitieX/homectl/commit/2284406fe9b85ec8a4e602061762628f8fcd9060))
* config refactor into sqlite ([6406ad3](https://github.com/FruitieX/homectl/commit/6406ad359f7844fe666c8a61d752b811adef0238))
* **config:** add dialog editors and device reference tools ([eae755e](https://github.com/FruitieX/homectl/commit/eae755eb986efca174cb032df4b233b9c04ba83a))
* **config:** add mirrored scene actions and raw payload previews ([e6cc43d](https://github.com/FruitieX/homectl/commit/e6cc43d0bd0e4b860cb9a109acc9e01a855c651a))
* **config:** switch runtime config to JSON and canonical device refs ([2c7e249](https://github.com/FruitieX/homectl/commit/2c7e24992e2d2ab86355e66ba1bdeb4fb55ae9fc))
* **dashboard:** add visual layout editor and widget-specific settings ([7578f06](https://github.com/FruitieX/homectl/commit/7578f06d3a7cbe3ee6a1793178d8a307221b36c3))
* health check api ([9698859](https://github.com/FruitieX/homectl/commit/96988596597b1c097b54ce6bc6c4feef91d6117e))
* improve configuration reliability and device command feedback ([9433e68](https://github.com/FruitieX/homectl/commit/9433e6829f892ee5a871d7ddd9b546b692f7afc5))
* improve dashboard usability and runtime safeguards ([e5f4466](https://github.com/FruitieX/homectl/commit/e5f4466a4ece396855290d53e9f59d99b0c9a362))
* **integrations:** add config schemas and paced outbound updates ([ec9e4de](https://github.com/FruitieX/homectl/commit/ec9e4dee07bdbc157403a38c0eef39f0dfa33c9f))
* make random colors repeatable and configurable ([6fad75e](https://github.com/FruitieX/homectl/commit/6fad75ecd888473bf1ee1f5edee5e0d765aed22a))
* make scene and configuration updates reliable ([6b19a6d](https://github.com/FruitieX/homectl/commit/6b19a6d8c91115988a71e3fc10924700f56e821d))
* migrate all references during device replacement ([a84d334](https://github.com/FruitieX/homectl/commit/a84d3346e2515d2ab10b2901c8dfe44a9783ac4c))
* migrate persistence to SeaORM with auto-created SQLite ([9100aad](https://github.com/FruitieX/homectl/commit/9100aad63892d5cb7e5e68d0678450be8c3c6a5a))
* **mqtt:** add configurable transition defaults ([874f115](https://github.com/FruitieX/homectl/commit/874f1158de9939f3bc202e3d6c4e6ef3290340f7))
* **mqtt:** add protocol profiles and simplify integration config ([0e0ebfd](https://github.com/FruitieX/homectl/commit/0e0ebfd0ccaeb1590a96f04dc77df0cef34890f8))
* **mqtt:** discover Zigbee2MQTT light capabilities ([d887e7f](https://github.com/FruitieX/homectl/commit/d887e7f2bfc3110bbf28cd051b701dffb6a35fed))
* **mqtt:** poll Zigbee2MQTT devices without reporting ([20abe21](https://github.com/FruitieX/homectl/commit/20abe21ba946593a7db0fecc5df363ca4f3e96fb))
* order scene targets and improve weather views ([7424a87](https://github.com/FruitieX/homectl/commit/7424a8761db97868fba09c2362cb0e6ee75fa7d2))
* refine device controls and floorplan reachability ([9ddaf2e](https://github.com/FruitieX/homectl/commit/9ddaf2e0bbc4e2b29527800637079a4537210782))
* **server,ui:** record and show v2 routine run history ([f3e6c05](https://github.com/FruitieX/homectl/commit/f3e6c055bc13dc8dfce922ccde691cbbc477b1d7))
* **server:** add AI assistant plan apply endpoint and all entity adapters ([70efde4](https://github.com/FruitieX/homectl/commit/70efde41a3c3f3610ae5d7f93be6f5ef6c1247a4))
* **server:** add AI assistant plan types, entity search, and plan endpoint ([852678b](https://github.com/FruitieX/homectl/commit/852678b4668710ee899c0ad37034e69f77259051))
* **server:** add opt-in assistant routine drafting ([00f91fa](https://github.com/FruitieX/homectl/commit/00f91fa0188f26645a5562bb0d3374ba2a975aea))
* **server:** enforce v2 execution policies ([68794de](https://github.com/FruitieX/homectl/commit/68794deb7a6d689af65dd6ed19c5e7dafcd90b4b))
* **server:** identify assistant requests to gateways ([56a9a3c](https://github.com/FruitieX/homectl/commit/56a9a3cbfbe10b45e030483d10464bb2899db3e7))
* **server:** Make database optional even when DATABASE_URL set ([0488e22](https://github.com/FruitieX/homectl/commit/0488e22a9262f8c3a3fdb99f534b72b10c0c062b))
* **server:** persist routine history across restarts ([78b5dea](https://github.com/FruitieX/homectl/commit/78b5dea83a6908e3b438115360757a7b6a233e27))
* **server:** support thinking models in the assistant ([cb8a7fc](https://github.com/FruitieX/homectl/commit/cb8a7fc4baa42695e6478e0364169385d212904d))
* **settings:** configure interactive and scene transitions ([7f10a95](https://github.com/FruitieX/homectl/commit/7f10a95f7d67b40dbc273dd7d917ef455f5a545e))
* **ui,api:** preview computed light profiles ([1ae7895](https://github.com/FruitieX/homectl/commit/1ae7895dd4f2e64a7e845904cca0c8dc00f02cd8))
* **ui,api:** stream helper values and add a mode widget ([6d61930](https://github.com/FruitieX/homectl/commit/6d61930a0d8c14f2bea80d0fb62c3be6a954a3a1))
* **ui:** add zoomed group floorplan previews and assistant plan discard ([3b3ebcd](https://github.com/FruitieX/homectl/commit/3b3ebcdc627764085d5d615aae6a333c6b0073ed))
* **ui:** improve dashboard controls and interactions ([71fc2f0](https://github.com/FruitieX/homectl/commit/71fc2f0a15a81bc64145f9b0212263fdcfe47451))
* **ui:** show device reachability and disable controls ([e9f4be9](https://github.com/FruitieX/homectl/commit/e9f4be9b97aaecf93e89f0c9f7a3199226e8898a))
* **ui:** show live v2 trigger and timer status on routines ([c9e5e87](https://github.com/FruitieX/homectl/commit/c9e5e873ded0930285a3f8ec83ab7ff84951090c))
* **ui:** simplify routine authoring and settings selection ([d3152dd](https://github.com/FruitieX/homectl/commit/d3152dd961d75da86bf311c8ee46c6da8bcb9e07))


### Bug Fixes

* **api:** delete devices without putting the device key in the URL path ([d55ee48](https://github.com/FruitieX/homectl/commit/d55ee48781bf1d556ab3b94ba53687ece5ca1931))
* **api:** keep config secrets out of responses and default exports ([0d0de3d](https://github.com/FruitieX/homectl/commit/0d0de3d9627202cc9197ccf13a2ed398e81b0314))
* **api:** restrict cross-origin requests to allowed origins ([d5c980d](https://github.com/FruitieX/homectl/commit/d5c980d9ce64065e14be2a12dc166596af86bf39))
* **assistant:** keep stored proposals applyable after a restart ([a8b84b0](https://github.com/FruitieX/homectl/commit/a8b84b0dd1761ecb0b048844da0794fc1111fc3c))
* **assistant:** let a plan reference what it creates ([cf4f03a](https://github.com/FruitieX/homectl/commit/cf4f03a0b738c2aaec6197b98aba5ee42cf9dd5f))
* **assistant:** let a plan reference what it creates ([8258aec](https://github.com/FruitieX/homectl/commit/8258aec5f49e05387dc2cfd2a299bab93f19de5d))
* **assistant:** tell the model which ids it may reference ([788b23b](https://github.com/FruitieX/homectl/commit/788b23be3c96a598c194ecec65375ed7bf1afee8))
* Attempt fixing websocket flooding issue ([3fd200a](https://github.com/FruitieX/homectl/commit/3fd200aa9a6a502fefd02ede412452a74b7db0e5))
* **automation:** publish v2 trigger rows before the first frame ([598f559](https://github.com/FruitieX/homectl/commit/598f55996ef34701be21ae23b9110edcbf37e3d6))
* avoid encoded slashes in device replacement ([b0165d9](https://github.com/FruitieX/homectl/commit/b0165d9b4c41d4c2935d797674fb6b4d58a3c0b3))
* calibrate colors independent of device format ([b67f512](https://github.com/FruitieX/homectl/commit/b67f5120b9d5efd5d33ffff653a98bd88696f6c1))
* **calibration:** preserve calibrated state on finish ([9adf63b](https://github.com/FruitieX/homectl/commit/9adf63b69daa872fc76cf7d7ec347bb5697c7347))
* **deps:** pin dependencies ([#891](https://github.com/FruitieX/homectl/issues/891)) ([7eec844](https://github.com/FruitieX/homectl/commit/7eec8449f0b81d067e5517080949e8cebcf3ebdd))
* **deps:** update rust crate bytes to v1.11.1 [security] ([#873](https://github.com/FruitieX/homectl/issues/873)) ([9a172d5](https://github.com/FruitieX/homectl/commit/9a172d593c9bd0adec6a8927a50036b7254adf8d))
* **deps:** update rust crate clap to v4.5.48 ([#775](https://github.com/FruitieX/homectl/issues/775)) ([2961d1b](https://github.com/FruitieX/homectl/commit/2961d1b5ec88d8d8267652cf00b12480aa976c6e))
* **deps:** update rust crate clap to v4.6.6 ([#845](https://github.com/FruitieX/homectl/issues/845)) ([9c65af9](https://github.com/FruitieX/homectl/commit/9c65af9e083f80b995c3944b8fa0e59cae30725d))
* **deps:** update rust crate clap to v4.6.7 ([#906](https://github.com/FruitieX/homectl/issues/906)) ([73278d0](https://github.com/FruitieX/homectl/commit/73278d0c1161b53719e9b854c897140269231af1))
* **deps:** update rust crate config to v0.15.17 ([#786](https://github.com/FruitieX/homectl/issues/786)) ([c9e8f78](https://github.com/FruitieX/homectl/commit/c9e8f7848e2aee18969b53e965ecc5ac1ade12a1))
* **deps:** update rust crate log to v0.4.34 ([#869](https://github.com/FruitieX/homectl/issues/869)) ([a0377cf](https://github.com/FruitieX/homectl/commit/a0377cf82c8824365d61b171c427a23324b34eca))
* **deps:** update rust crate ordered-float to v5.5.0 ([#814](https://github.com/FruitieX/homectl/issues/814)) ([60a84b6](https://github.com/FruitieX/homectl/commit/60a84b6868fa8bc59fce5ca0f25d831ac3a1785f))
* **deps:** update rust crate rand to v0.8.6 [security] ([#879](https://github.com/FruitieX/homectl/issues/879)) ([a01f65f](https://github.com/FruitieX/homectl/commit/a01f65f599e50960f375e772cf6df981882d8071))
* **deps:** update rust crate serde to v1.0.226 ([#776](https://github.com/FruitieX/homectl/issues/776)) ([3b83d2e](https://github.com/FruitieX/homectl/commit/3b83d2e18f2f572e1399faec982214397a521063))
* **deps:** update rust crate serde to v1.0.229 ([#791](https://github.com/FruitieX/homectl/issues/791)) ([c038cc9](https://github.com/FruitieX/homectl/commit/c038cc906e790ebce2f77392563ec3ee4c763ee3))
* **deps:** update rust crate tokio to v1.53.1 ([#848](https://github.com/FruitieX/homectl/issues/848)) ([346e472](https://github.com/FruitieX/homectl/commit/346e4725707ee37dd94057e9dce8b0fbfa4b4a1b))
* **deps:** update rust crate toml to v0.9.12 ([#835](https://github.com/FruitieX/homectl/issues/835)) ([b9ceaa4](https://github.com/FruitieX/homectl/commit/b9ceaa41322d48c2871d4682da96390bd1ffa1d2))
* **deps:** update rust crate toml to v0.9.7 ([#772](https://github.com/FruitieX/homectl/issues/772)) ([5dac2cc](https://github.com/FruitieX/homectl/commit/5dac2cc0dfdda42ace20307f4b102267b7c0c47e))
* **deps:** update rust crate ts-rs to v11.1.0 ([#847](https://github.com/FruitieX/homectl/issues/847)) ([a2dd0a0](https://github.com/FruitieX/homectl/commit/a2dd0a0e68d468129644c3a4d70396c16bb8ac4c))
* enhance state comparison by including scene_id in DeviceData ([d40a80a](https://github.com/FruitieX/homectl/commit/d40a80a0a2de229a00298b0e60c9528d703e42af))
* make display-name keys slash-safe ([768b5eb](https://github.com/FruitieX/homectl/commit/768b5eb8e998eaac426513f9f13c2a430ef49a34))
* **mqtt:** accept bridge metadata and expose device reports ([dbf8dd6](https://github.com/FruitieX/homectl/commit/dbf8dd623f3db0bcbc66a5018027cbbf4284891b))
* **mqtt:** handle ESPHome sparse state reports ([60b1445](https://github.com/FruitieX/homectl/commit/60b1445489b768e70cf1c98e746cb6c1443913e1))
* **mqtt:** name ESPHome lights after their node, not the "Light" placeholder ([23a7675](https://github.com/FruitieX/homectl/commit/23a767533329edc25191ed0bf19406b5a46152ee))
* **mqtt:** pace and coalesce Zigbee2MQTT readbacks ([b6792b0](https://github.com/FruitieX/homectl/commit/b6792b069eaa119e226599f59112b74f5a2659de))
* preserve device names during replacement ([8f6691b](https://github.com/FruitieX/homectl/commit/8f6691b06df7dd31f269d95fe6a6e2c82e43d945))
* **server:** apply scenes to unmanaged devices ([51a6cb0](https://github.com/FruitieX/homectl/commit/51a6cb0c9b3990f7c9f05492c3df6dbc192cf72e))
* **server:** broadcast device changes as targeted websocket patches ([e2d57e4](https://github.com/FruitieX/homectl/commit/e2d57e43c2c8a624e629c7fbaee12365e1cd1477))
* **server:** defer event side effects outside the state lock ([ce7733c](https://github.com/FruitieX/homectl/commit/ce7733c47d6341d00fce582f7e4d4b2543696d3f))
* **server:** keep the calibration gates green ([01aa709](https://github.com/FruitieX/homectl/commit/01aa70924ccb41bcf0d827ea1706f133fc857558))
* **server:** register helpers during startup seeding ([51421ca](https://github.com/FruitieX/homectl/commit/51421ca80f015aa664596273abc2b19f55577d7f))
* **server:** resolve computed-source aliases in config diagnostics ([acc195b](https://github.com/FruitieX/homectl/commit/acc195bf7b8477f8ea5636d205795229d22136fa))
* **server:** stop restoring devices of disabled integrations ([4144ba7](https://github.com/FruitieX/homectl/commit/4144ba705af4ebdf8d87c14cc34906a170d4ff94))
* **simulate:** read pre-v2 PostgreSQL sources with the legacy fallback ([bce657c](https://github.com/FruitieX/homectl/commit/bce657c3f99e45485243dee26acbf3effb84e1bd))
* stops the existing interval tick before a new one is started in case the random integration settings are changed when homectl-server is running. ([f56ddd5](https://github.com/FruitieX/homectl/commit/f56ddd562d0ee2ef570db212f4714d5f7636f7c7))
* test for random and `cargo fmt` ([c4c3e46](https://github.com/FruitieX/homectl/commit/c4c3e469c459df0196ae578e55cc9086791123b6))


### Performance Improvements

* **server:** only broadcast collections that actually changed ([39adb1f](https://github.com/FruitieX/homectl/commit/39adb1faf6f2f4f68ccb08bff954d4f63fe6608c))
* **state:** reduce end-to-end state update overhead ([bdbe237](https://github.com/FruitieX/homectl/commit/bdbe237a1fa6c91a1ef120c8dc8934f9dbf72455))
* **ws:** send routine statuses as per-routine deltas ([d325e05](https://github.com/FruitieX/homectl/commit/d325e0509c8e7463717b93ac1bedafa0acf50021))


### Code Refactoring

* **floorplan:** store device positions in floorplan grids ([429ab88](https://github.com/FruitieX/homectl/commit/429ab88799efb9cfa69894cb54e6b72ebe08e864))

## [0.9.5](https://github.com/FruitieX/homectl-server/compare/v0.9.4...v0.9.5) (2024-07-23)


### Bug Fixes

* fix scene list not refreshing after edits ([e027b2a](https://github.com/FruitieX/homectl-server/commit/e027b2a430ab7e04cc6824118c7c86c3b7575d2d))

## [0.9.4](https://github.com/FruitieX/homectl-server/compare/v0.9.3...v0.9.4) (2024-07-23)


### Bug Fixes

* **deps:** update rust crate async-trait to v0.1.78 ([0443b35](https://github.com/FruitieX/homectl-server/commit/0443b352c9df713b8db66063e158973a7c53b42a))
* **deps:** update rust crate async-trait to v0.1.79 ([9834234](https://github.com/FruitieX/homectl-server/commit/9834234162afba30db75bd8d13a98f9ab5581bf0))
* **deps:** update rust crate async-trait to v0.1.80 ([415c416](https://github.com/FruitieX/homectl-server/commit/415c416380d53088e6fecb9769359fa2ca058326))
* **deps:** update rust crate async-trait to v0.1.81 ([0e2adc1](https://github.com/FruitieX/homectl-server/commit/0e2adc15816549f34b3764f282d69778232636f4))
* **deps:** update rust crate bytes to v1.6.0 ([9886886](https://github.com/FruitieX/homectl-server/commit/9886886171a62341d27326a2aba6b05becb8c5a6))
* **deps:** update rust crate bytes to v1.6.1 ([ed2c1bc](https://github.com/FruitieX/homectl-server/commit/ed2c1bc32f0cb2b3bbeb91a77446553ef3215900))
* **deps:** update rust crate chrono to v0.4.37 ([d00431e](https://github.com/FruitieX/homectl-server/commit/d00431eae37be6e388ee77592fd9060d36d64cbc))
* **deps:** update rust crate chrono to v0.4.38 ([cc310ab](https://github.com/FruitieX/homectl-server/commit/cc310ab14ea411e582d65e9d01f0afd382f5d75b))
* **deps:** update rust crate color-eyre to v0.6.3 ([ac32494](https://github.com/FruitieX/homectl-server/commit/ac324944a5183ca1163181d35ca6b6a181ae2fc2))
* **deps:** update rust crate config to v0.14.0 ([473f589](https://github.com/FruitieX/homectl-server/commit/473f589c38e3264b755fb9b8c0e6712550199f0b))
* **deps:** update rust crate itertools to v0.13.0 ([9ce931a](https://github.com/FruitieX/homectl-server/commit/9ce931a461a82af2542485f4b8456cae92a7a300))
* **deps:** update rust crate jsonptr to v0.4.5 ([3bb9271](https://github.com/FruitieX/homectl-server/commit/3bb927179afc6888277d9e39542ddb9ed7985690))
* **deps:** update rust crate jsonptr to v0.4.6 ([2ca6342](https://github.com/FruitieX/homectl-server/commit/2ca6342bd538692996c78016de3d84024556c47f))
* **deps:** update rust crate jsonptr to v0.4.7 ([f5d8170](https://github.com/FruitieX/homectl-server/commit/f5d81705ad826b5bf60f5dcb88f04dd437e0755b))
* **deps:** update rust crate jsonptr to v0.5.1 ([376cf69](https://github.com/FruitieX/homectl-server/commit/376cf69f202500d955a97eb2389b95d0175366c3))
* **deps:** update rust crate log to v0.4.21 ([8c253cd](https://github.com/FruitieX/homectl-server/commit/8c253cd9db13b58b736a2e9abc59ef91e07ba159))
* **deps:** update rust crate log to v0.4.22 ([9af6b94](https://github.com/FruitieX/homectl-server/commit/9af6b943862ea14384d3155944cc904649fccd19))
* **deps:** update rust crate ordered-float to v4.2.1 ([6553962](https://github.com/FruitieX/homectl-server/commit/6553962b90772fe1d67946b81f72bd4421dfe0c6))
* **deps:** update rust crate palette to v0.7.5 ([3fc62b2](https://github.com/FruitieX/homectl-server/commit/3fc62b28e2d45a1f56b7b7bca56834cf3c2044ba))
* **deps:** update rust crate palette to v0.7.6 ([6acebee](https://github.com/FruitieX/homectl-server/commit/6acebee1c5b2c8e69458cadfc1ee35124c485a88))
* **deps:** update rust crate rumqttc to v0.24.0 ([52d886f](https://github.com/FruitieX/homectl-server/commit/52d886f19ebfa77dc0ca3feccd880b9846f6ee33))
* **deps:** update rust crate serde to v1.0.197 ([40fade7](https://github.com/FruitieX/homectl-server/commit/40fade720d4690af1bed86ce3edd030e679aeeae))
* **deps:** update rust crate serde to v1.0.198 ([a3ff611](https://github.com/FruitieX/homectl-server/commit/a3ff611151028ec6f06c26c1387baef10697d4af))
* **deps:** update rust crate serde to v1.0.199 ([75bcfd4](https://github.com/FruitieX/homectl-server/commit/75bcfd469152b0cbc6806dcb5524d86caf409eac))
* **deps:** update rust crate serde to v1.0.200 ([e9180f9](https://github.com/FruitieX/homectl-server/commit/e9180f9d18969a4dbc966c65f98b913e4b55c29c))
* **deps:** update rust crate serde to v1.0.201 ([6dab1ee](https://github.com/FruitieX/homectl-server/commit/6dab1ee08af4a9d2fb43af9eda63d270c982d630))
* **deps:** update rust crate serde to v1.0.202 ([9c68644](https://github.com/FruitieX/homectl-server/commit/9c686441ba9b9fa0f2594841ef8e5ad4140b8470))
* **deps:** update rust crate serde to v1.0.203 ([d0a37ec](https://github.com/FruitieX/homectl-server/commit/d0a37ec890ef3eec1c4d8dea9fc4bac4ebe7ebdf))
* **deps:** update rust crate serde to v1.0.204 ([fb6be70](https://github.com/FruitieX/homectl-server/commit/fb6be70c3c7df2b9d2683a21158f13d4489b6dcc))
* **deps:** update rust crate serde_json to v1.0.114 ([842f156](https://github.com/FruitieX/homectl-server/commit/842f156d9f4da25ff5fd2f85714eb514ac929265))
* **deps:** update rust crate serde_json to v1.0.115 ([70bf768](https://github.com/FruitieX/homectl-server/commit/70bf768ef105fbc346090f07c6630a35d3ce3d96))
* **deps:** update rust crate serde_json to v1.0.116 ([b7f40f6](https://github.com/FruitieX/homectl-server/commit/b7f40f692c6e26eae7beb14409cd5446ea3275e3))
* **deps:** update rust crate serde_json to v1.0.117 ([ab01f75](https://github.com/FruitieX/homectl-server/commit/ab01f75647adf2371c47ec282fce08a7b9dad73c))
* **deps:** update rust crate serde_json to v1.0.118 ([635d804](https://github.com/FruitieX/homectl-server/commit/635d804f1c2114887c03c51ddf231a5e6bc6e961))
* **deps:** update rust crate serde_json to v1.0.119 ([12bfd02](https://github.com/FruitieX/homectl-server/commit/12bfd02bf2970b48fab47f17772733d3cb7a687f))
* **deps:** update rust crate serde_json to v1.0.120 ([6a543c7](https://github.com/FruitieX/homectl-server/commit/6a543c7eedabdaeec8026c0425a148587924f1a6))
* **deps:** update rust crate serde_json_path to v0.6.6 ([bd10ce5](https://github.com/FruitieX/homectl-server/commit/bd10ce50bba6c71968c89d79cc926016329c5e43))
* **deps:** update rust crate serde_json_path to v0.6.7 ([74f0c29](https://github.com/FruitieX/homectl-server/commit/74f0c29b30b889aa028b98dd9ef12bb40bb47e10))
* **deps:** update rust crate serde_path_to_error to v0.1.16 ([735e147](https://github.com/FruitieX/homectl-server/commit/735e1471f399bdbd8bb824026e55aae8f67bda53))
* **deps:** update rust crate sqlx to v0.7.4 ([5f692b8](https://github.com/FruitieX/homectl-server/commit/5f692b8c81b8929ec3e58bb18e5e2697c8a890e0))
* **deps:** update rust crate sqlx to v0.8.0 ([d7af8fb](https://github.com/FruitieX/homectl-server/commit/d7af8fba83df571b00fe704010d51a1fc621cb23))
* **deps:** update rust crate tokio to v1.37.0 ([8816bda](https://github.com/FruitieX/homectl-server/commit/8816bdabad7a8f1121aeb401cd76133c60b47953))
* **deps:** update rust crate tokio to v1.38.0 ([7b5c620](https://github.com/FruitieX/homectl-server/commit/7b5c620a3036b91e81f863c312d717f8143e1e3c))
* **deps:** update rust crate tokio to v1.38.1 ([af48927](https://github.com/FruitieX/homectl-server/commit/af489274eedfcf8554341db3f7651be4388f9c39))
* **deps:** update rust crate tokio-stream to v0.1.15 ([1ad0680](https://github.com/FruitieX/homectl-server/commit/1ad06801542907e62f5ce6af78600f2f2bcbd972))
* **deps:** update rust crate toml to v0.8.11 ([3114c50](https://github.com/FruitieX/homectl-server/commit/3114c506168e8791db9c35adc338d6a512539ff2))
* **deps:** update rust crate toml to v0.8.12 ([5f8cc7d](https://github.com/FruitieX/homectl-server/commit/5f8cc7d4651a9abf519ab674f69c67c449de99e1))
* **deps:** update rust crate toml to v0.8.13 ([74989ae](https://github.com/FruitieX/homectl-server/commit/74989ae39421195ef162af232df22cd3b8a87a1d))
* **deps:** update rust crate toml to v0.8.14 ([d82ef95](https://github.com/FruitieX/homectl-server/commit/d82ef951834e83de0edfb95c28baeb591930c0c1))
* **deps:** update rust crate toml to v0.8.15 ([501a384](https://github.com/FruitieX/homectl-server/commit/501a3841f695478e5796d2d5a4ba78fd1d79d30c))
* **deps:** update rust crate ts-rs to v8 ([98dbbe3](https://github.com/FruitieX/homectl-server/commit/98dbbe38121e930f88f76d29714aed71fe4d88f4))
* **deps:** update rust crate ts-rs to v8.1.0 ([7170d5f](https://github.com/FruitieX/homectl-server/commit/7170d5f5ad0a894fd9f172fb3ea9b799b1b042d0))
* **deps:** update rust crate ts-rs to v9 ([c94f137](https://github.com/FruitieX/homectl-server/commit/c94f137171baa30f88326258c8cdd75f69894380))
* **deps:** update rust crate ts-rs to v9.0.1 ([88e84da](https://github.com/FruitieX/homectl-server/commit/88e84dab1b9b64f42fb53289718bbe6453981fe0))
* **deps:** update rust crate warp to v0.3.7 ([d024dbe](https://github.com/FruitieX/homectl-server/commit/d024dbeb7bc55c8d9bd461dadfd3c51788e683a5))
* fix not being able to set color after turning on light ([1d0d70c](https://github.com/FruitieX/homectl-server/commit/1d0d70c77f2ec30db4b8e9783980d7dd49919d55))

## [0.9.3](https://github.com/FruitieX/homectl-server/compare/v0.9.2...v0.9.3) (2024-02-19)


### Bug Fixes

* also filter scene expr devices by sd device/group keys ([4dfb3b8](https://github.com/FruitieX/homectl-server/commit/4dfb3b8c9c449aa5ed39cfecd6b6d9938465e50d))

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
