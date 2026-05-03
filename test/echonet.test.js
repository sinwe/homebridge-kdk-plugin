'use strict';

const { EchonetController, EPC, VAL } = require('../src/echonet');

const mockLog = { debug: () => {}, info: () => {}, error: () => {} };

// Helper: build a minimal ECHONET Lite response message
const buildMsg = (esv, epcs) => Buffer.from([
  0x10, 0x81, 0x01, 0x01,   // header + TID
  0x01, 0x3A, 0x01,          // SEOJ (fan)
  0x05, 0xFF, 0x01,          // DEOJ (controller)
  esv,
  epcs.length,
  ...epcs.flat(),
]);

describe('EchonetController', () => {
  let ctrl;

  beforeEach(() => {
    ctrl = new EchonetController(mockLog);
  });

  // ------------------------------------------------------------------ _nextTid
  describe('_nextTid', () => {
    it('starts at 1', () => {
      expect(ctrl._nextTid()).toBe(1);
    });

    it('increments on each call', () => {
      ctrl._nextTid();
      expect(ctrl._nextTid()).toBe(2);
    });

    it('wraps from 0xFFFE back to 1', () => {
      ctrl.tid = 0xFFFE;
      expect(ctrl._nextTid()).toBe(1);
    });
  });

  // ---------------------------------------------------------------- _buildFrame
  describe('_buildFrame', () => {
    it('starts with ECHONET Lite magic bytes 0x10 0x81', () => {
      const { frame } = ctrl._buildFrame(0x62, []);
      expect(frame[0]).toBe(0x10);
      expect(frame[1]).toBe(0x81);
    });

    it('uses same byte twice for TID (KDK requirement)', () => {
      const { frame } = ctrl._buildFrame(0x62, []);
      expect(frame[2]).toBe(frame[3]);
      expect(frame[2]).toBeGreaterThan(0);
    });

    it('sets SEOJ to controller node [0x05, 0xFF, 0x01]', () => {
      const { frame } = ctrl._buildFrame(0x62, []);
      expect([...frame.slice(4, 7)]).toEqual([0x05, 0xFF, 0x01]);
    });

    it('sets DEOJ to KDK fan [0x01, 0x3A, 0x01]', () => {
      const { frame } = ctrl._buildFrame(0x62, []);
      expect([...frame.slice(7, 10)]).toEqual([0x01, 0x3A, 0x01]);
    });

    it('writes ESV at byte 10', () => {
      const { frame } = ctrl._buildFrame(0x61, []);
      expect(frame[10]).toBe(0x61);
    });

    it('sets OPC to number of EPCs', () => {
      const { frame } = ctrl._buildFrame(0x62, [[0x80, 0x00], [0xF0, 0x00]]);
      expect(frame[11]).toBe(2);
    });

    it('appends EPC bytes in body', () => {
      const { frame } = ctrl._buildFrame(0x62, [[0x80, 0x00]]);
      expect(frame[12]).toBe(0x80);
      expect(frame[13]).toBe(0x00);
    });

    it('tidKey matches frame TID bytes', () => {
      const { frame, tidKey } = ctrl._buildFrame(0x62, []);
      expect(tidKey).toBe(frame.slice(2, 4).toString('hex'));
    });

    it('tidKey changes between calls', () => {
      const { tidKey: a } = ctrl._buildFrame(0x62, []);
      const { tidKey: b } = ctrl._buildFrame(0x62, []);
      expect(a).not.toBe(b);
    });
  });

  // -------------------------------------------------------------- _parseResponse
  describe('_parseResponse', () => {
    it('returns {} for null input', () => {
      expect(ctrl._parseResponse(null)).toEqual({});
    });

    it('returns {} for message shorter than 12 bytes', () => {
      expect(ctrl._parseResponse(Buffer.alloc(8))).toEqual({});
    });

    it('returns {} for unrecognised ESV (e.g. SetC_SNA 0x51)', () => {
      const msg = buildMsg(0x51, [[0x80, 0x01, 0x30]]);
      expect(ctrl._parseResponse(msg)).toEqual({});
    });

    it('parses GET_RES (0x72) single EPC', () => {
      const msg = buildMsg(0x72, [[0x80, 0x01, 0x30]]);
      expect(ctrl._parseResponse(msg)).toEqual({ [EPC.FAN_POWER]: VAL.ON });
    });

    it('parses SETC_RES (0x71) single EPC', () => {
      const msg = buildMsg(0x71, [[0xF3, 0x01, 0x30]]);
      expect(ctrl._parseResponse(msg)).toEqual({ [EPC.LIGHT_POWER]: VAL.ON });
    });

    it('parses multiple EPCs', () => {
      const msg = buildMsg(0x72, [
        [EPC.FAN_POWER, 0x01, VAL.ON],
        [EPC.FAN_VOLUME, 0x01, 0x35],
      ]);
      expect(ctrl._parseResponse(msg)).toEqual({
        [EPC.FAN_POWER]: VAL.ON,
        [EPC.FAN_VOLUME]: 0x35,
      });
    });

    it('stores null for EPC with PDC=0 (no data byte)', () => {
      const msg = buildMsg(0x71, [[0x80, 0x00]]);
      expect(ctrl._parseResponse(msg)).toEqual({ [EPC.FAN_POWER]: null });
    });
  });

  // ---------------------------------------------------------- EPC/VAL constants
  describe('EPC and VAL constants', () => {
    it('FAN_POWER is 0x80', () => {
      expect(EPC.FAN_POWER).toBe(0x80);
    });

    it('LIGHT_POWER is 0xF3', () => {
      expect(EPC.LIGHT_POWER).toBe(0xF3);
    });

    it('ON and OFF are distinct values', () => {
      expect(VAL.ON).not.toBe(VAL.OFF);
    });

    it('DIR_DOWN and DIR_UP are distinct values', () => {
      expect(VAL.DIR_DOWN).not.toBe(VAL.DIR_UP);
    });

    it('NORMAL and NIGHT are distinct values', () => {
      expect(VAL.NORMAL).not.toBe(VAL.NIGHT);
    });

    it('SPEED_MIN is less than SPEED_MAX', () => {
      expect(VAL.SPEED_MIN).toBeLessThan(VAL.SPEED_MAX);
    });
  });
});
