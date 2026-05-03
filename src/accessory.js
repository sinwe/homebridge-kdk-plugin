'use strict';

const { EPC, VAL } = require('./echonet');

const SPEED_MIN_EPC = VAL.SPEED_MIN; // 0x31 = speed 1
const MIREDS_WARM = 500;             // colour 0 → warmest
const MIREDS_COOL = 153;             // colour 100 → coolest

class KDKFanAccessory {
  constructor(platform, config, platformAccessory) {
    this.platform = platform;
    this.log = platform.log;
    this.api = platform.api;
    this.controller = platform.controller;

    this.name = config.name;
    this.ip = config.ip;
    this.model = config.model || 'KDK Ceiling Fan';
    this.pollMs = Math.max(10, config.pollInterval || 30) * 1000;

    this.state = {
      fanOn: false,
      fanSpeed: 5,         // 1–10
      fanDirection: 0,     // 0=DOWN/CW, 1=UP/CCW
      fanOscillation: false,
      lightOn: false,
      nightMode: false,
      brightness: 100,     // 1–100
      colour: 50,          // 0–100
      nightBrightness: 1,  // 1–3
    };

    this.accessory = platformAccessory;
    this._setupServices();
    this._pollStatus();
    this._pollTimer = setInterval(() => this._pollStatus(), this.pollMs);
  }

  _setupServices() {
    const { Service, Characteristic } = this.api.hap;

    // --- Accessory Information ---
    this.accessory.getService(Service.AccessoryInformation)
      .setCharacteristic(Characteristic.Manufacturer, 'KDK / Panasonic')
      .setCharacteristic(Characteristic.Model, this.model)
      .setCharacteristic(Characteristic.SerialNumber, this.ip);

    // --- Fan (Fanv2) ---
    this.fanSvc = this.accessory.getService(Service.Fanv2)
      || this.accessory.addService(Service.Fanv2, this.name, 'fan');

    this.fanSvc.getCharacteristic(Characteristic.Active)
      .onGet(() => this.state.fanOn ? 1 : 0)
      .onSet(val => {
        const on = val === 1;
        const epcs = [[EPC.FAN_POWER, on ? VAL.ON : VAL.OFF]];
        if (on) epcs.push([EPC.FAN_VOLUME, SPEED_MIN_EPC + this.state.fanSpeed - 1]);
        return this._set('fanOn', on, epcs);
      });

    this.fanSvc.getCharacteristic(Characteristic.RotationSpeed)
      .setProps({ minValue: 0, maxValue: 100, minStep: 10 })
      .onGet(() => this.state.fanOn ? this.state.fanSpeed * 10 : 0)
      .onSet(async val => {
        if (val === 0) {
          return this._set('fanOn', false, [[EPC.FAN_POWER, VAL.OFF]]);
        }
        const speed = Math.max(1, Math.min(10, Math.round(val / 10)));
        const oldSpeed = this.state.fanSpeed;
        const wasOn = this.state.fanOn;
        this.state.fanSpeed = speed;
        this.state.fanOn = true;
        try {
          await this.controller.set(this.ip, [
            [EPC.FAN_POWER, VAL.ON],
            [EPC.FAN_VOLUME, SPEED_MIN_EPC + speed - 1],
          ]);
          this.fanSvc.updateCharacteristic(Characteristic.Active, 1);
        } catch (e) {
          this.state.fanSpeed = oldSpeed;
          this.state.fanOn = wasOn;
          this.log.error(`[${this.name}] set fanSpeed failed: ${e.message}`);
        }
      });

    this.fanSvc.getCharacteristic(Characteristic.SwingMode)
      .onGet(() => this.state.fanOscillation ? 1 : 0)
      .onSet(val => this._set('fanOscillation', val === 1, [
        [EPC.FAN_POWER, this.state.fanOn ? VAL.ON : VAL.OFF],
        [EPC.FAN_FLUCTUATION, val === 1 ? VAL.ON : VAL.OFF],
      ]));

    this.fanSvc.getCharacteristic(Characteristic.RotationDirection)
      .onGet(() => this.state.fanDirection)
      .onSet(val => this._set('fanDirection', val, [
        [EPC.FAN_POWER, this.state.fanOn ? VAL.ON : VAL.OFF],
        [EPC.FAN_DIRECTION, val === 0 ? VAL.DIR_DOWN : VAL.DIR_UP],
      ]));

    // --- Light (Lightbulb) ---
    this.lightSvc = this.accessory.getService(Service.Lightbulb)
      || this.accessory.addService(Service.Lightbulb, `${this.name} Light`, 'light');

    this.lightSvc.getCharacteristic(Characteristic.On)
      .onGet(() => this.state.lightOn)
      .onSet(val => {
        const on = !!val;
        const epcs = [[EPC.LIGHT_POWER, on ? VAL.ON : VAL.OFF]];
        if (on) {
          if (this.state.nightMode) {
            epcs.push([EPC.LIGHT_MODE, VAL.NIGHT]);
            epcs.push([EPC.LIGHT_NIGHT_BRIGHTNESS, this.state.nightBrightness]);
          } else {
            epcs.push([EPC.LIGHT_MODE, VAL.NORMAL]);
            epcs.push([EPC.LIGHT_BRIGHTNESS, this.state.brightness]);
          }
        }
        return this._set('lightOn', on, epcs);
      });

    this.lightSvc.getCharacteristic(Characteristic.Brightness)
      .setProps({ minValue: 1, maxValue: 100 })
      .onGet(() => {
        if (this.state.nightMode) {
          return Math.round((this.state.nightBrightness / 3) * 100);
        }
        return this.state.brightness;
      })
      .onSet(async val => {
        if (this.state.nightMode) {
          const level = val <= 33 ? 1 : val <= 66 ? 2 : 3;
          const oldLevel = this.state.nightBrightness;
          const wasOn = this.state.lightOn;
          this.state.nightBrightness = level;
          this.state.lightOn = true;
          try {
            await this.controller.set(this.ip, [
              [EPC.LIGHT_POWER, VAL.ON],
              [EPC.LIGHT_MODE, VAL.NIGHT],
              [EPC.LIGHT_NIGHT_BRIGHTNESS, level],
            ]);
            this.lightSvc.updateCharacteristic(Characteristic.On, true);
          } catch (e) {
            this.state.nightBrightness = oldLevel;
            this.state.lightOn = wasOn;
            this.log.error(`[${this.name}] set nightBrightness failed: ${e.message}`);
          }
          return;
        }
        const oldBrightness = this.state.brightness;
        const wasOn = this.state.lightOn;
        this.state.brightness = val;
        this.state.lightOn = true;
        try {
          await this.controller.set(this.ip, [
            [EPC.LIGHT_POWER, VAL.ON],
            [EPC.LIGHT_MODE, VAL.NORMAL],
            [EPC.LIGHT_BRIGHTNESS, val],
          ]);
          this.lightSvc.updateCharacteristic(Characteristic.On, true);
        } catch (e) {
          this.state.brightness = oldBrightness;
          this.state.lightOn = wasOn;
          this.log.error(`[${this.name}] set brightness failed: ${e.message}`);
        }
      });

    this.lightSvc.getCharacteristic(Characteristic.ColorTemperature)
      .setProps({ minValue: MIREDS_COOL, maxValue: MIREDS_WARM })
      .onGet(() => this._colourToMireds(this.state.colour))
      .onSet(async val => {
        const colour = this._miredsToColour(val);
        const oldColour = this.state.colour;
        const wasOn = this.state.lightOn;
        this.state.colour = colour;
        this.state.lightOn = true;
        try {
          await this.controller.set(this.ip, [
            [EPC.LIGHT_POWER, VAL.ON],
            [EPC.LIGHT_MODE, VAL.NORMAL],
            [EPC.LIGHT_COLOUR, colour],
          ]);
          this.lightSvc.updateCharacteristic(Characteristic.On, true);
        } catch (e) {
          this.state.colour = oldColour;
          this.state.lightOn = wasOn;
          this.log.error(`[${this.name}] set colour failed: ${e.message}`);
        }
      });

    // --- Night Mode (Switch) ---
    const nightName = `${this.name} Night Mode`;
    this.nightSvc = this.accessory.getServiceById(Service.Switch, 'night-mode')
      || this.accessory.addService(Service.Switch, nightName, 'night-mode');
    this.nightSvc.setCharacteristic(Characteristic.Name, nightName);

    this.nightSvc.getCharacteristic(Characteristic.On)
      .onGet(() => this.state.nightMode)
      .onSet(async (val) => {
        const epcs = val ? [
          [EPC.LIGHT_POWER, VAL.ON],
          [EPC.LIGHT_MODE, VAL.NIGHT],
          [EPC.LIGHT_NIGHT_BRIGHTNESS, this.state.nightBrightness],
        ] : [
          [EPC.LIGHT_POWER, this.state.lightOn ? VAL.ON : VAL.OFF],
          [EPC.LIGHT_MODE, VAL.NORMAL],
          [EPC.LIGHT_BRIGHTNESS, this.state.brightness],
        ];
        try {
          await this.controller.set(this.ip, epcs);
          this.state.nightMode = !!val;
          if (val) {
            this.state.lightOn = true;
            this.lightSvc.updateCharacteristic(Characteristic.On, true);
          }
        } catch (e) {
          this.log.error(`[${this.name}] setNightMode error: ${e.message}`);
        }
      });

  }

  _colourToMireds(colour) {
    // colour 0=warm(500 mireds) → 100=cool(153 mireds)
    return Math.round(MIREDS_WARM - (colour / 100) * (MIREDS_WARM - MIREDS_COOL));
  }

  _miredsToColour(mireds) {
    return Math.round((MIREDS_WARM - mireds) / (MIREDS_WARM - MIREDS_COOL) * 100);
  }

  async _set(stateKey, newValue, epcPairs) {
    const old = this.state[stateKey];
    this.state[stateKey] = newValue;
    try {
      await this.controller.set(this.ip, epcPairs);
    } catch (e) {
      this.state[stateKey] = old;
      this.log.error(`[${this.name}] set ${stateKey} failed: ${e.message}`);
    }
  }

  async _pollStatus() {
    try {
      const resp = await this.controller.get(this.ip, [
        EPC.FAN_POWER, EPC.FAN_VOLUME, EPC.FAN_DIRECTION, EPC.FAN_FLUCTUATION,
        EPC.LIGHT_POWER, EPC.LIGHT_MODE, EPC.LIGHT_BRIGHTNESS,
        EPC.LIGHT_COLOUR, EPC.LIGHT_NIGHT_BRIGHTNESS,
      ]);
      this._applyState(resp);
    } catch (e) {
      this.log.debug(`[${this.name}] poll failed: ${e.message}`);
    }
  }

  _applyState(resp) {
    const { Characteristic } = this.api.hap;

    const update = (svc, char, val) => svc.updateCharacteristic(char, val);

    if (resp[EPC.FAN_POWER] != null) {
      this.state.fanOn = resp[EPC.FAN_POWER] === VAL.ON;
      update(this.fanSvc, Characteristic.Active, this.state.fanOn ? 1 : 0);
    }
    if (resp[EPC.FAN_VOLUME] != null) {
      this.state.fanSpeed = resp[EPC.FAN_VOLUME] - SPEED_MIN_EPC + 1;
      update(this.fanSvc, Characteristic.RotationSpeed, this.state.fanSpeed * 10);
    }
    if (resp[EPC.FAN_DIRECTION] != null) {
      this.state.fanDirection = resp[EPC.FAN_DIRECTION] === VAL.DIR_DOWN ? 0 : 1;
      update(this.fanSvc, Characteristic.RotationDirection, this.state.fanDirection);
    }
    if (resp[EPC.FAN_FLUCTUATION] != null) {
      this.state.fanOscillation = resp[EPC.FAN_FLUCTUATION] === VAL.ON;
      update(this.fanSvc, Characteristic.SwingMode, this.state.fanOscillation ? 1 : 0);
    }
    if (resp[EPC.LIGHT_POWER] != null) {
      this.state.lightOn = resp[EPC.LIGHT_POWER] === VAL.ON;
      update(this.lightSvc, Characteristic.On, this.state.lightOn);
    }
    if (resp[EPC.LIGHT_MODE] != null) {
      this.state.nightMode = resp[EPC.LIGHT_MODE] === VAL.NIGHT;
      update(this.nightSvc, Characteristic.On, this.state.nightMode);
    }
    if (resp[EPC.LIGHT_BRIGHTNESS] != null && !this.state.nightMode) {
      this.state.brightness = resp[EPC.LIGHT_BRIGHTNESS];
      update(this.lightSvc, Characteristic.Brightness, this.state.brightness);
    }
    if (resp[EPC.LIGHT_COLOUR] != null) {
      this.state.colour = resp[EPC.LIGHT_COLOUR];
      update(this.lightSvc, Characteristic.ColorTemperature, this._colourToMireds(this.state.colour));
    }
    if (resp[EPC.LIGHT_NIGHT_BRIGHTNESS] != null && this.state.nightMode) {
      this.state.nightBrightness = resp[EPC.LIGHT_NIGHT_BRIGHTNESS];
      update(this.lightSvc, Characteristic.Brightness, Math.round((this.state.nightBrightness / 3) * 100));
    }
  }

  destroy() {
    clearInterval(this._pollTimer);
  }
}

module.exports = { KDKFanAccessory };
