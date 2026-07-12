'use strict';

jest.useFakeTimers();

const { KDKFanAccessory } = require('../src/accessory');
const { EPC, VAL } = require('../src/echonet');

// ------------------------------------------------------------------ mock factory
function buildMocks() {
  const makeChar = () => {
    const c = {
      onGet: jest.fn(), onSet: jest.fn(),
      setProps: jest.fn(), updateCharacteristic: jest.fn(),
    };
    c.onGet.mockReturnValue(c);
    c.onSet.mockReturnValue(c);
    c.setProps.mockReturnValue(c);
    return c;
  };

  const makeSvc = () => {
    const s = {
      getCharacteristic: jest.fn(() => makeChar()),
      setCharacteristic: jest.fn(),
      updateCharacteristic: jest.fn(),
    };
    s.setCharacteristic.mockReturnValue(s);
    return s;
  };

  const services = {
    info: makeSvc(),
    fan: makeSvc(),
    light: makeSvc(),
    lightPower: makeSvc(),
    night: makeSvc(),
  };

  const Characteristic = {
    Manufacturer: 'Manufacturer', Model: 'Model', SerialNumber: 'SerialNumber',
    Active: 'Active', RotationSpeed: 'RotationSpeed', SwingMode: 'SwingMode',
    RotationDirection: 'RotationDirection', On: 'On', Brightness: 'Brightness',
    ColorTemperature: 'ColorTemperature', Name: 'Name',
  };

  const Service = {
    AccessoryInformation: 'AI', Fanv2: 'Fan', Lightbulb: 'Light', Switch: 'Switch',
  };

  const accessory = {
    getService: jest.fn(t => {
      if (t === 'AI') return services.info;
      if (t === 'Fan') return services.fan;
      if (t === 'Light') return services.light;
      return null;
    }),
    getServiceById: jest.fn(() => null),
    addService: jest.fn((t, name, sub) => {
      if (sub === 'light-power') return services.lightPower;
      if (sub === 'night-mode') return services.night;
      return makeSvc();
    }),
    removeService: jest.fn(),
    context: {},
  };

  const controller = {
    get: jest.fn().mockResolvedValue({}),
    set: jest.fn().mockResolvedValue({}),
  };

  const platform = {
    log: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    api: { hap: { Service, Characteristic } },
    controller,
  };

  const config = { name: 'Test Fan', ip: '192.168.1.100', pollInterval: 30 };

  return { platform, accessory, controller, services, config, Characteristic };
}

// ------------------------------------------------------------------ test suites
describe('KDKFanAccessory', () => {
  let fan, mocks;

  beforeEach(() => {
    mocks = buildMocks();
    fan = new KDKFanAccessory(mocks.platform, mocks.config, mocks.accessory);
  });

  afterEach(() => {
    fan.destroy();
    jest.clearAllMocks();
  });

  // ---------------------------------------------------- colour/mireds conversion
  describe('_colourToMireds', () => {
    it('colour 0 (warmest) → 500 mireds', () => {
      expect(fan._colourToMireds(0)).toBe(500);
    });

    it('colour 100 (coolest) → 153 mireds', () => {
      expect(fan._colourToMireds(100)).toBe(153);
    });

    it('colour 50 → midpoint between 500 and 153', () => {
      expect(fan._colourToMireds(50)).toBe(Math.round(500 - 0.5 * (500 - 153)));
    });
  });

  describe('_miredsToColour', () => {
    it('500 mireds → colour 0', () => {
      expect(fan._miredsToColour(500)).toBe(0);
    });

    it('153 mireds → colour 100', () => {
      expect(fan._miredsToColour(153)).toBe(100);
    });

    it('round-trips through _colourToMireds for boundary and midpoint values', () => {
      for (const c of [0, 25, 50, 75, 100]) {
        expect(fan._miredsToColour(fan._colourToMireds(c))).toBe(c);
      }
    });
  });

  // --------------------------------------------------------------- _set helpers
  describe('_set', () => {
    it('updates state optimistically before the network call completes', async () => {
      let stateWhenCalled;
      mocks.controller.set.mockImplementation(() => {
        stateWhenCalled = fan.state.fanOn;
        return Promise.resolve({});
      });
      await fan._set('fanOn', true, [[EPC.FAN_POWER, VAL.ON]]);
      expect(stateWhenCalled).toBe(true);
    });

    it('keeps new state on success', async () => {
      await fan._set('fanOn', true, [[EPC.FAN_POWER, VAL.ON]]);
      expect(fan.state.fanOn).toBe(true);
    });

    it('rolls back to old state on controller error', async () => {
      fan.state.fanOn = false;
      mocks.controller.set.mockRejectedValueOnce(new Error('timeout'));
      await fan._set('fanOn', true, [[EPC.FAN_POWER, VAL.ON]]);
      expect(fan.state.fanOn).toBe(false);
    });

    it('logs an error on failure', async () => {
      mocks.controller.set.mockRejectedValueOnce(new Error('timeout'));
      await fan._set('fanOn', true, [[EPC.FAN_POWER, VAL.ON]]);
      expect(mocks.platform.log.error).toHaveBeenCalled();
    });

    it('calls controller.set with the configured IP and provided EPCs', async () => {
      const epcs = [[EPC.FAN_POWER, VAL.ON], [EPC.FAN_VOLUME, 0x35]];
      await fan._set('fanOn', true, epcs);
      expect(mocks.controller.set).toHaveBeenCalledWith('192.168.1.100', epcs);
    });
  });

  // ------------------------------------------------------------- _applyState
  describe('_applyState', () => {
    it('updates fanOn from FAN_POWER ON', () => {
      fan._applyState({ [EPC.FAN_POWER]: VAL.ON });
      expect(fan.state.fanOn).toBe(true);
    });

    it('updates fanOn from FAN_POWER OFF', () => {
      fan.state.fanOn = true;
      fan._applyState({ [EPC.FAN_POWER]: VAL.OFF });
      expect(fan.state.fanOn).toBe(false);
    });

    it('converts FAN_VOLUME byte to 1-based fanSpeed', () => {
      fan._applyState({ [EPC.FAN_VOLUME]: VAL.SPEED_MIN + 4 }); // speed 5
      expect(fan.state.fanSpeed).toBe(5);
    });

    it('sets fanDirection 0 for DIR_DOWN', () => {
      fan._applyState({ [EPC.FAN_DIRECTION]: VAL.DIR_DOWN });
      expect(fan.state.fanDirection).toBe(0);
    });

    it('sets fanDirection 1 for DIR_UP', () => {
      fan._applyState({ [EPC.FAN_DIRECTION]: VAL.DIR_UP });
      expect(fan.state.fanDirection).toBe(1);
    });

    it('updates lightOn from LIGHT_POWER', () => {
      fan._applyState({ [EPC.LIGHT_POWER]: VAL.ON });
      expect(fan.state.lightOn).toBe(true);
    });

    it('sets nightMode true for LIGHT_MODE NIGHT', () => {
      fan._applyState({ [EPC.LIGHT_MODE]: VAL.NIGHT });
      expect(fan.state.nightMode).toBe(true);
    });

    it('sets nightMode false for LIGHT_MODE NORMAL', () => {
      fan.state.nightMode = true;
      fan._applyState({ [EPC.LIGHT_MODE]: VAL.NORMAL });
      expect(fan.state.nightMode).toBe(false);
    });

    it('updates brightness from LIGHT_BRIGHTNESS when not in night mode', () => {
      fan.state.nightMode = false;
      fan._applyState({ [EPC.LIGHT_BRIGHTNESS]: 75 });
      expect(fan.state.brightness).toBe(75);
    });

    it('does NOT update brightness from LIGHT_BRIGHTNESS when in night mode', () => {
      fan.state.nightMode = true;
      fan.state.brightness = 50;
      fan._applyState({ [EPC.LIGHT_BRIGHTNESS]: 75 });
      expect(fan.state.brightness).toBe(50);
    });

    it('updates colour from LIGHT_COLOUR', () => {
      fan._applyState({ [EPC.LIGHT_COLOUR]: 70 });
      expect(fan.state.colour).toBe(70);
    });

    it('updates nightBrightness from LIGHT_NIGHT_BRIGHTNESS when in night mode', () => {
      fan.state.nightMode = true;
      fan._applyState({ [EPC.LIGHT_NIGHT_BRIGHTNESS]: 2 });
      expect(fan.state.nightBrightness).toBe(2);
    });

    it('does NOT update nightBrightness from LIGHT_NIGHT_BRIGHTNESS when not in night mode', () => {
      fan.state.nightMode = false;
      fan.state.nightBrightness = 1;
      fan._applyState({ [EPC.LIGHT_NIGHT_BRIGHTNESS]: 3 });
      expect(fan.state.nightBrightness).toBe(1);
    });

    it('calls updateCharacteristic on fan service for FAN_POWER', () => {
      fan._applyState({ [EPC.FAN_POWER]: VAL.ON });
      expect(mocks.services.fan.updateCharacteristic).toHaveBeenCalledWith('Active', 1);
    });

    it('calls updateCharacteristic on light service for LIGHT_POWER', () => {
      fan._applyState({ [EPC.LIGHT_POWER]: VAL.ON });
      expect(mocks.services.light.updateCharacteristic).toHaveBeenCalledWith('On', true);
    });

    it('also updates lightPower switch service for LIGHT_POWER', () => {
      fan._applyState({ [EPC.LIGHT_POWER]: VAL.ON });
      expect(mocks.services.lightPower.updateCharacteristic).toHaveBeenCalledWith('On', true);
    });

    it('ignores null values without changing state', () => {
      const prev = fan.state.fanSpeed;
      fan._applyState({ [EPC.FAN_VOLUME]: null });
      expect(fan.state.fanSpeed).toBe(prev);
    });

    it('ignores empty response without changing state', () => {
      const prev = { ...fan.state };
      fan._applyState({});
      expect(fan.state).toEqual(prev);
    });
  });

  // ------------------------------------------------------------------- destroy
  describe('destroy', () => {
    it('clears the polling timer', () => {
      const spy = jest.spyOn(global, 'clearInterval');
      const timerId = fan._pollTimer;
      fan.destroy();
      expect(spy).toHaveBeenCalledWith(timerId);
    });
  });
});
