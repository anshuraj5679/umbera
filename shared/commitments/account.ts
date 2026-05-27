import { encodeAbiParameters, getAddress, keccak256, parseAbiParameters, type Hex } from "viem";

const OWNER_COMMITMENT_VERSION = "obsidian.account.owner.v1";
const ACCOUNT_COMMITMENT_VERSION = "obsidian.account.commitment.v1";
const ACCOUNT_NULLIFIER_VERSION = "obsidian.account.nullifier.v1";
const ACCOUNT_SALT_VERSION = "obsidian.account.salt.v1";

export type OwnerCommitmentInput = {
  chainId: number;
  dexAddress: `0x${string}`;
  ownerAddress: `0x${string}`;
  salt: Hex;
};

export type AccountCommitmentInput = {
  chainId: number;
  dexAddress: `0x${string}`;
  ownerCommitment: Hex;
  sessionPublicKey: Hex;
  salt: Hex;
};

const ownerCommitmentAbi = parseAbiParameters(
  "string version,uint256 chainId,address dexAddress,address ownerAddress,bytes32 salt",
);

const accountCommitmentAbi = parseAbiParameters(
  "string version,uint256 chainId,address dexAddress,bytes32 ownerCommitment,bytes sessionPublicKey,bytes32 salt",
);

const accountNullifierAbi = parseAbiParameters(
  "string version,bytes32 accountCommitment,bytes32 salt",
);

const accountSaltAbi = parseAbiParameters(
  "string version,uint256 chainId,address dexAddress,bytes32 ownerCommitment,bytes sessionPublicKey",
);

export function ownerCommitment(input: OwnerCommitmentInput): Hex {
  return keccak256(encodeAbiParameters(ownerCommitmentAbi, [
    OWNER_COMMITMENT_VERSION,
    BigInt(input.chainId),
    getAddress(input.dexAddress),
    getAddress(input.ownerAddress),
    normalizeBytes32(input.salt),
  ]));
}

export function accountSalt(input: Omit<AccountCommitmentInput, "salt">): Hex {
  return keccak256(encodeAbiParameters(accountSaltAbi, [
    ACCOUNT_SALT_VERSION,
    BigInt(input.chainId),
    getAddress(input.dexAddress),
    normalizeBytes32(input.ownerCommitment),
    normalizeHexBytes(input.sessionPublicKey),
  ]));
}

export function accountCommitment(input: AccountCommitmentInput): Hex {
  return keccak256(encodeAbiParameters(accountCommitmentAbi, [
    ACCOUNT_COMMITMENT_VERSION,
    BigInt(input.chainId),
    getAddress(input.dexAddress),
    normalizeBytes32(input.ownerCommitment),
    normalizeHexBytes(input.sessionPublicKey),
    normalizeBytes32(input.salt),
  ]));
}

export function accountNullifier(input: { accountCommitment: Hex; salt: Hex }): Hex {
  return keccak256(encodeAbiParameters(accountNullifierAbi, [
    ACCOUNT_NULLIFIER_VERSION,
    normalizeBytes32(input.accountCommitment),
    normalizeBytes32(input.salt),
  ]));
}

export function accountCommitmentAndNullifier(input: Omit<AccountCommitmentInput, "salt"> & { salt?: Hex }) {
  const salt = input.salt ?? accountSalt(input);
  const commitment = accountCommitment({ ...input, salt });
  return {
    commitment,
    nullifier: accountNullifier({ accountCommitment: commitment, salt }),
    salt,
  };
}

export function normalizeBytes32(value: Hex): Hex {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error("expected bytes32 hex value");
  }
  return value.toLowerCase() as Hex;
}

export function normalizeHexBytes(value: Hex): Hex {
  if (!/^0x([0-9a-fA-F]{2})+$/.test(value)) {
    throw new Error("expected non-empty even-length hex bytes");
  }
  return value.toLowerCase() as Hex;
}
