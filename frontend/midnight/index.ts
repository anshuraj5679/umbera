/**
 * Midnight Network — Frontend Module Index
 *
 * @module midnight
 */

export { isLaceAvailable, connectLace, isLaceEnabled, disconnectLace, type MidnightWalletState } from "./wallet";
export { getDefaultConfig, createMidnightProviders, type MidnightClientConfig } from "./client";
export { OrderStatus, BatchStatus, createUmbraContract, type UmbraContract, type OrderCommitment, type Nullifier, type SettlementRoot } from "./contract";
export { computeOrderCommitment, computeOrderNullifier, createPrivateOrder, generateSalt, PRIVACY_CLASSIFICATION, type PrivateOrderInput, type OrderPrivacyState } from "./privacy";
export { TDUST, TOKEN_A, TOKEN_B, DEFAULT_PAIR, formatAssetAmount, type MidnightAsset } from "./assets";
export { MidnightProvider, useMidnight } from "./provider";
