'use strict';

const dgram = require('dgram');
const { EventEmitter } = require('events');

const ECHONET_PORT = 3610;
const SSDP_PORT = 50125;
const SSDP_ST = 'urn:schemas-upnp-org:device:PANA013Adevices:1';

// SEOJ: controller, DEOJ: KDK ceiling fan (class 0x013A)
const SEOJ = [0x05, 0xFF, 0x01];
const DEOJ = [0x01, 0x3A, 0x01];

const EPC = {
  FAN_POWER: 0x80,            // ON=0x30, OFF=0x31
  FAN_VOLUME: 0xF0,           // 0x31 (speed 1) – 0x3A (speed 10)
  FAN_DIRECTION: 0xF1,        // DOWN=0x41, UP=0x42
  FAN_FLUCTUATION: 0xF2,      // ON=0x30, OFF=0x31
  LIGHT_POWER: 0xF3,          // ON=0x30, OFF=0x31
  LIGHT_MODE: 0xF4,           // NORMAL=0x42, NIGHT=0x43
  LIGHT_BRIGHTNESS: 0xF5,     // 1–100
  LIGHT_COLOUR: 0xF6,         // 0–100 (0=warm, 100=cool)
  LIGHT_NIGHT_BRIGHTNESS: 0xF7, // 1–3
  OFF_TIMER: 0xF8,
  OFF_TIMER_REMAIN: 0xF9,
  ON_TIMER: 0xFA,
  ON_TIMER_REMAIN: 0xFB,
  BUZZER: 0xFC,               // ON=0x30 (prefix for SET)
  CTL_OPT: 0xFD,              // type=0x03 WiFi (prefix for SET)
  MELODY: 0xFE,               // level=0x40 (prefix for SET)
  ERROR_CODE: 0x86,
  ERROR_STATUS: 0x88,
  PRODUCT_CODE: 0x8C,
};

const VAL = {
  ON: 0x30,
  OFF: 0x31,
  NORMAL: 0x42,
  NIGHT: 0x43,
  DIR_DOWN: 0x41,
  DIR_UP: 0x42,
  SPEED_MIN: 0x31,
  SPEED_MAX: 0x3A,
};

// ESV codes
const ESV_GET = 0x62;
const ESV_SETC = 0x61;
const ESV_GET_RES = 0x72;
const ESV_SETC_RES = 0x71;

class EchonetController extends EventEmitter {
  constructor(log) {
    super();
    this.log = log;
    this.tid = 0;
    this.pending = new Map(); // tidKey -> { resolve, reject, timer }
    this.socket = null;
  }

  start() {
    return new Promise((resolve, reject) => {
      const sock = dgram.createSocket({ type: 'udp4', reusePort: true });

      sock.on('message', (msg) => {
        if (msg.length < 12) return;
        const tidKey = msg.slice(2, 4).toString('hex');
        const entry = this.pending.get(tidKey);
        if (entry) {
          clearTimeout(entry.timer);
          this.pending.delete(tidKey);
          entry.resolve(msg);
        }
      });

      sock.on('error', (err) => {
        this.log.error(`[ECHONET] socket error: ${err.message}`);
      });

      sock.bind(ECHONET_PORT, (err) => {
        if (err) return reject(err);
        this.socket = sock;
        this.log.debug(`[ECHONET] listening on port ${ECHONET_PORT}`);
        resolve();
      });
    });
  }

  stop() {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error('Controller stopped'));
    }
    this.pending.clear();
    if (this.socket) {
      try { this.socket.close(); } catch (_) {}
      this.socket = null;
    }
  }

  _nextTid() {
    this.tid = (this.tid % 0xFFFE) + 1;
    return this.tid;
  }

  _buildFrame(esv, epcs) {
    const tid = this._nextTid();
    const header = Buffer.from([
      0x10, 0x81,
      (tid >> 8) & 0xFF, tid & 0xFF,
      ...SEOJ,
      ...DEOJ,
      esv,
      epcs.length,
    ]);
    const body = Buffer.concat(epcs.map(e => Buffer.from(e)));
    return {
      frame: Buffer.concat([header, body]),
      tidKey: header.slice(2, 4).toString('hex'),
    };
  }

  _dispatch(ip, frame, tidKey, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(tidKey);
        reject(new Error(`ECHONET timeout (TID ${tidKey}) to ${ip}`));
      }, timeout);

      this.pending.set(tidKey, { resolve, reject, timer });

      this.socket.send(frame, ECHONET_PORT, ip, (err) => {
        if (err) {
          clearTimeout(timer);
          this.pending.delete(tidKey);
          reject(err);
        }
      });
    });
  }

  _parseResponse(msg) {
    if (!msg || msg.length < 12) return {};
    const esv = msg[10];
    if (esv !== ESV_GET_RES && esv !== ESV_SETC_RES) return {};
    const opc = msg[11];
    const result = {};
    let off = 12;
    for (let i = 0; i < opc && off + 1 < msg.length; i++) {
      const epc = msg[off];
      const pdc = msg[off + 1];
      result[epc] = (pdc > 0 && off + 2 < msg.length) ? msg[off + 2] : null;
      off += 2 + pdc;
    }
    return result;
  }

  async get(ip, epcList) {
    const epcs = epcList.map(epc => [epc, 0x00]);
    const { frame, tidKey } = this._buildFrame(ESV_GET, epcs);
    const resp = await this._dispatch(ip, frame, tidKey);
    return this._parseResponse(resp);
  }

  async set(ip, epcValues) {
    // epcValues: [[epc, val], ...]
    // Prepend the three mandatory control EPCs the fan expects
    const prefix = [
      [0xFD, 0x01, 0x03], // CtlOptSource: WiFi
      [0xFC, 0x01, 0x30], // BuzzerSet: ON
      [0xFE, 0x01, 0x40], // Melody: level 64
    ];
    const payload = epcValues.map(([epc, val]) => [epc, 0x01, val]);
    const { frame, tidKey } = this._buildFrame(ESV_SETC, [...prefix, ...payload]);
    const resp = await this._dispatch(ip, frame, tidKey);
    return this._parseResponse(resp);
  }

  // SSDP broadcast discovery — returns array of { ip, guid, commId, partId }
  discover(broadcastIp = '255.255.255.255', timeout = 5000) {
    return new Promise((resolve) => {
      const found = [];
      const seen = new Set();
      const sock = dgram.createSocket({ type: 'udp4', reusePort: true });

      sock.on('message', (msg) => {
        const text = msg.toString('utf8');
        const d = {};
        for (const line of text.split('\r\n')) {
          if (line.startsWith('LOCATION:')) d.ip = line.slice(9).trim();
          if (line.startsWith('HASHGUID=')) d.guid = line.slice(9).trim();
          if (line.startsWith('COMMID=')) d.commId = line.slice(7).trim();
          if (line.startsWith('PARTID=')) d.partId = line.slice(7).trim();
        }
        if (d.ip && !seen.has(d.ip)) {
          seen.add(d.ip);
          found.push(d);
          this.log.info(`[ECHONET] Discovered fan: ${d.partId || 'KDK'} at ${d.ip}`);
        }
      });

      sock.bind(0, () => {
        sock.setBroadcast(true);
        const msg = Buffer.from(
          `M-SEARCH * HTTP/1.1\r\nHOST:${broadcastIp}:${SSDP_PORT}\r\nMAN:"ssdp:discover"\r\nMX:3\r\nST:${SSDP_ST}\r\n\r\n`
        );
        sock.send(msg, SSDP_PORT, broadcastIp, (err) => {
          if (err) this.log.error(`[ECHONET] SSDP send error: ${err.message}`);
        });
      });

      setTimeout(() => {
        try { sock.close(); } catch (_) {}
        resolve(found);
      }, timeout);
    });
  }
}

module.exports = { EchonetController, EPC, VAL };
