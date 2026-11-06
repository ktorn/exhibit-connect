export {
  BEACON_PROTOCOL_VERSION,
  DEFAULT_BEACON_PORT,
  decodeBeacon,
  encodeBeacon,
  beaconToBuffer,
} from "./beacon.js";

export {
  PAIRING_CODE_LENGTH,
  PAIRING_TTL_MS,
  TABLET_IDLE_MS,
  tabletIdleMs,
  generatePairingCode,
  isTabletConnected,
  broadcastMode,
  verifyPairingCode,
  defaultPersistedState,
} from "./pairing.js";
