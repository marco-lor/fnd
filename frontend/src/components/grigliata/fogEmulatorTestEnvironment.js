// Jest 27's Node environment does not expose Node's built-in fetch to the
// test realm, but @firebase/rules-unit-testing uses fetch to load rules into
// (and clear) the local Firestore emulator. This environment forwards the
// host's native fetch primitives; it adds no dependency.
const NodeEnvironment = require('jest-environment-node');

const FETCH_GLOBALS = ['fetch', 'Headers', 'Request', 'Response', 'FormData', 'AbortController', 'AbortSignal'];

class FogEmulatorTestEnvironment extends NodeEnvironment {
  constructor(config, context) {
    super(config, context);
    FETCH_GLOBALS.forEach((name) => {
      if (typeof this.global[name] === 'undefined' && typeof global[name] !== 'undefined') {
        this.global[name] = global[name];
      }
    });
  }
}

module.exports = FogEmulatorTestEnvironment;
