'use strict';

const { networkInterfaces } = require('os');
const { EchonetController } = require('./echonet');
const { KDKFanAccessory } = require('./accessory');

const PLUGIN_NAME = 'homebridge-kdk-plugin';
const PLATFORM_NAME = 'KDKCeilingFan';

class KDKCeilingFanPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config || {};
    this.api = api;
    this.accessories = [];      // cached platform accessories from Homebridge
    this.fanAccessories = [];   // our KDKFanAccessory instances

    if (!api) return;
    this.api.on('didFinishLaunching', () => this._init().catch(e => this.log.error('Init failed:', e.message)));
  }

  // Called by Homebridge for each cached accessory on startup
  configureAccessory(accessory) {
    this.accessories.push(accessory);
  }

  async _init() {
    const localIp = this.config.localIp || this._detectLocalIp();
    this.log.info(`Using local IP: ${localIp}`);

    this.controller = new EchonetController(this.log);
    await this.controller.start();
    this.log.info('ECHONET Lite controller started on port 3610');

    const fanConfigs = Array.isArray(this.config.fans) ? this.config.fans : [];

    // Auto-discover fans that have no IP configured
    const needsDiscovery = fanConfigs.some(f => !f.ip);
    if (needsDiscovery || fanConfigs.length === 0) {
      const broadcast = this.config.broadcastAddress || this._broadcastAddress(localIp);
      this.log.info(`Discovering KDK fans on ${broadcast}...`);
      const discovered = await this.controller.discover(broadcast, 5000);
      this.log.info(`Found ${discovered.length} fan(s) via SSDP`);

      if (fanConfigs.length === 0) {
        // No fans configured — auto-create one entry per discovered fan
        for (const d of discovered) {
          fanConfigs.push({
            name: `KDK Fan ${d.partId || d.ip}`,
            ip: d.ip,
            model: d.partId,
            guid: d.guid,
          });
        }
      } else {
        // Match discovered devices to configured fans missing an IP
        for (const cfg of fanConfigs.filter(f => !f.ip)) {
          const match = cfg.guid
            ? discovered.find(d => d.guid && d.guid.startsWith(cfg.guid.slice(0, 16)))
            : discovered[0];
          if (match) {
            cfg.ip = match.ip;
            cfg.model = cfg.model || match.partId;
            this.log.info(`Resolved "${cfg.name}" → ${cfg.ip}`);
          } else {
            this.log.warn(`Could not discover IP for fan "${cfg.name}" — skipping`);
          }
        }
      }
    }

    const uuidsInConfig = new Set();

    for (const cfg of fanConfigs.filter(f => f.ip)) {
      const uuid = this.api.hap.uuid.generate(`${PLUGIN_NAME}:${cfg.ip}`);
      uuidsInConfig.add(uuid);

      const existing = this.accessories.find(a => a.UUID === uuid);
      let platformAccessory;

      if (existing) {
        platformAccessory = existing;
        this.log.info(`Restoring fan: "${cfg.name}" (${cfg.ip})`);
      } else {
        platformAccessory = new this.api.platformAccessory(cfg.name, uuid);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [platformAccessory]);
        this.log.info(`Registering new fan: "${cfg.name}" (${cfg.ip})`);
      }

      this.fanAccessories.push(new KDKFanAccessory(this, cfg, platformAccessory));
    }

    // Remove cached accessories that are no longer in config
    const stale = this.accessories.filter(a => !uuidsInConfig.has(a.UUID));
    if (stale.length > 0) {
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, stale);
      this.log.info(`Removed ${stale.length} stale accessory(ies)`);
    }
  }

  _detectLocalIp() {
    for (const ifaces of Object.values(networkInterfaces())) {
      for (const iface of ifaces) {
        if (!iface.internal && iface.family === 'IPv4') return iface.address;
      }
    }
    return '0.0.0.0';
  }

  _broadcastAddress(localIp) {
    // Derive broadcast from the local IP assuming /24 — good enough for home networks
    const parts = localIp.split('.');
    if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}.255`;
    return '255.255.255.255';
  }
}

module.exports = { KDKCeilingFanPlatform, PLUGIN_NAME, PLATFORM_NAME };
