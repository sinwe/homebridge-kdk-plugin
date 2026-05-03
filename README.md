# homebridge-kdk-plugin

Homebridge platform plugin for **KDK / Panasonic ceiling fans** with WiFi (e.g. E48GP-MW).

Communicates with the fan locally over **ECHONET Lite (UDP port 3610)** — no cloud dependency.

## Features

Each fan appears in Apple Home as three accessories:

| Accessory | HomeKit service | Controls |
|-----------|-----------------|----------|
| Ceiling Fan | Fan (v2) | Power, speed (10 levels), oscillation, direction |
| Ceiling Fan Light | Lightbulb | Power, brightness (1–100%), colour temperature |
| Ceiling Fan Night Mode | Switch | Toggles nightlight mode; Brightness slider then controls 3 nightlight levels |

## Requirements

- Homebridge ≥ 1.3.0
- Node.js ≥ 14
- KDK / Panasonic WiFi ceiling fan on the same LAN
- **UFW rule** (if UFW is active on your Homebridge machine):
  ```
  sudo ufw allow from 192.168.1.0/24 to any port 3610 proto udp
  ```

## Installation

```bash
sudo npm install -g homebridge-kdk-plugin
```

Then restart Homebridge.

## Configuration

Add the platform to your `config.json`. The simplest setup — just provide a name and the fan's IP:

```json
{
  "platforms": [
    {
      "platform": "KDKCeilingFan",
      "name": "KDK Ceiling Fan",
      "broadcastAddress": "192.168.1.255",
      "fans": [
        {
          "name": "Living Room Fan",
          "ip": "192.168.1.152",
          "model": "E48GP-MW",
          "pollInterval": 30
        }
      ]
    }
  ]
}
```

### Multiple fans

```json
{
  "platform": "KDKCeilingFan",
  "name": "KDK Ceiling Fan",
  "broadcastAddress": "192.168.1.255",
  "fans": [
    { "name": "Living Room Fan", "ip": "192.168.1.152" },
    { "name": "Master Bedroom Fan", "ip": "192.168.1.153" }
  ]
}
```

### Auto-discovery (no IP)

Omit `ip` to auto-discover on startup. Optionally provide the fan's `guid` (from SSDP) to match a specific device:

```json
{
  "platform": "KDKCeilingFan",
  "name": "KDK Ceiling Fan",
  "broadcastAddress": "192.168.1.255",
  "fans": [
    {
      "name": "Living Room Fan",
      "guid": "81b03ac832951785a28c74f969a5fefe"
    }
  ]
}
```

### Configuration options

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `broadcastAddress` | No | auto | Subnet broadcast (e.g. `192.168.1.255`) |
| `localIp` | No | auto | IP of this machine on the same LAN as the fans |
| `fans[].name` | Yes | — | Display name in HomeKit |
| `fans[].ip` | No | — | Fan's static IP (recommended) |
| `fans[].guid` | No | — | HASHGUID for auto-discovery matching |
| `fans[].model` | No | — | Model string shown in HomeKit (e.g. `E48GP-MW`) |
| `fans[].pollInterval` | No | `30` | Seconds between status polls |

## How it works

The KDK Smart app communicates with the fan via **ECHONET Lite** (a Japanese IoT standard) over UDP port 3610. On startup this plugin:

1. Sends an **SSDP M-SEARCH** broadcast to discover fans on the local network
2. Opens a **UDP socket on port 3610** to send and receive ECHONET Lite frames
3. Polls the fan every `pollInterval` seconds to keep HomeKit state in sync

ECHONET Lite device class: `0x013A` (Panasonic ceiling fan)

## Tested with

- KDK E48GP-MW

## License

MIT
