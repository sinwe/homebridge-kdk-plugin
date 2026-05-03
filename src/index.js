'use strict';

const { KDKCeilingFanPlatform, PLUGIN_NAME, PLATFORM_NAME } = require('./platform');

module.exports = (api) => {
  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, KDKCeilingFanPlatform);
};
