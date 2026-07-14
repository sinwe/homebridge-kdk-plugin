# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [1.1.0] - 2026-07-14

### Changed

- `engines.homebridge` now explicitly declares `^1.6.0 || ^2.0.0`, matching Homebridge's recommended idiom for the UI's "2.x ready" indicator, instead of the looser open-ended `>=1.3.0`.

## [1.0.6] - 2026-07-14

### Added

- `funding` field (GitHub Sponsors and PayPal) so Homebridge UI can show a Donate button.
- `.github/FUNDING.yml` to enable GitHub's native Sponsor button on the repo.

## [1.0.5] - 2026-07-12

### Fixed

- Config schema: moved the `fans[].name` required flag to the array item's `required` list — a boolean `required` on an individual property is invalid JSON Schema.
- `package.json`: moved `homebridge` from `peerDependencies` to `devDependencies`, since npm auto-installs peer dependencies.

## [1.0.4] - 2026-07-12

### Added

- Firmware revision is now cached on the accessory so it's shown immediately after a Homebridge restart, not just after the first successful poll.

### Fixed

- SSDP discovery socket now handles connection errors instead of potentially crashing Homebridge on a network error.

### Changed

- Firmware-related log lines are now `info`/`error` instead of `debug`, so issues are visible without debug logging enabled.
- Publishing to npm now uses Trusted Publishing (OIDC) instead of a long-lived npm token.

## [1.0.2] - 2026-05-23

### Added

- Query device firmware version (EPC 0x82) and display it in the HomeKit accessory info.
- Confirmed compatibility with Homebridge 2.x.

### Changed

- Require Node.js 18+; test against Node 18, 20, 22, and 24.

## [1.0.1] - 2026-05-03

### Added

- Unit test suite (Jest) and CI workflow running tests on every push.

## [1.0.0] - 2026-05-03

### Added

- Initial release: Homebridge platform plugin for KDK/Panasonic WiFi ceiling fans over ECHONET Lite.
- Fan control (speed, rotation direction) via the Fanv2 service.
- Light control (on/off, brightness, colour temperature) via the Lightbulb service.
- Dedicated Light on/off switch tile.
- Night Mode switch tile.
- SSDP auto-discovery of fans on the local network.
