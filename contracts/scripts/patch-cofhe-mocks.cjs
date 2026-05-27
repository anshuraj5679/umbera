#!/usr/bin/env node
/* eslint-disable */
//
// Patches @fhenixprotocol/cofhe-mock-contracts@0.3.1 to be compatible with
// @fhenixprotocol/cofhe-contracts@0.1.3 (the version this project pins).
//
// The mock contracts package ships with code targeting a newer cofhe-contracts
// API that does not exist in 0.1.3:
//   • MockTaskManager.sol declares ITaskManager but is missing 7 stubs
//     (createRandomTask, isPubliclyAllowed, publish/verify DecryptResult*).
//   • TestBed.sol stores euint32.unwrap() (now bytes32) into a uint256 slot
//     and calls FHE.decrypt(...) which no longer exists.
//
// This script is idempotent: it checks for a sentinel before patching, so it
// is safe to re-run from a `postinstall` hook on every `npm/pnpm install`.
//
// If/when cofhe-mock-contracts is upgraded to match cofhe-contracts, delete
// this script and the corresponding `postinstall` entry in package.json.
//
const fs = require("fs");
const path = require("path");

const SENTINEL = "// DARKPOOL-PATCH-APPLIED-v1";

const ROOT = path.resolve(__dirname, "..");
const MOCK_DIR = path.join(
  ROOT,
  "node_modules",
  "@fhenixprotocol",
  "cofhe-mock-contracts"
);

function log(msg) {
  console.log(`[patch-cofhe-mocks] ${msg}`);
}

function patchFile(file, patcher) {
  const full = path.join(MOCK_DIR, file);
  if (!fs.existsSync(full)) {
    log(`skip ${file} (not found — package layout changed?)`);
    return;
  }
  let src = fs.readFileSync(full, "utf8");
  if (src.includes(SENTINEL)) {
    log(`skip ${file} (already patched)`);
    return;
  }
  const next = patcher(src);
  if (next === src) {
    log(`skip ${file} (no change)`);
    return;
  }
  fs.writeFileSync(full, next + (next.endsWith("\n") ? "" : "\n") + SENTINEL + "\n");
  log(`patched ${file}`);
}

// ─── MockTaskManager.sol ─────────────────────────────────────────────────────
patchFile("MockTaskManager.sol", (src) => {
  // Add the 7 missing ITaskManager stubs right before the contract closes.
  // We locate the final '}' of `contract TaskManager` by matching the very
  // last `isAllowedWithPermission(...)` function body which lives immediately
  // before the closing brace.
  const marker =
    "    function isAllowedWithPermission(\n" +
    "        Permission memory permission,\n" +
    "        uint256 handle\n" +
    "    ) public view returns (bool) {\n" +
    "        return acl.isAllowedWithPermission(permission, handle);\n" +
    "    }\n" +
    "}";

  const stubs =
    "    function isAllowedWithPermission(\n" +
    "        Permission memory permission,\n" +
    "        uint256 handle\n" +
    "    ) public view returns (bool) {\n" +
    "        return acl.isAllowedWithPermission(permission, handle);\n" +
    "    }\n" +
    "\n" +
    "    // ── DarkPool compatibility shim: missing ITaskManager stubs ──\n" +
    "    function createRandomTask(uint8 /*returnType*/, uint256 /*seed*/, int32 /*securityZone*/) external pure returns (uint256) {\n" +
    "        revert RandomFunctionNotSupported();\n" +
    "    }\n" +
    "    function isPubliclyAllowed(uint256 /*ctHash*/) external pure returns (bool) {\n" +
    "        return false;\n" +
    "    }\n" +
    "    function publishDecryptResult(uint256 ctHash, uint256 result, bytes calldata /*signature*/) external {\n" +
    "        _decryptResultReady[ctHash] = true;\n" +
    "        _decryptResult[ctHash] = result;\n" +
    "        _decryptResultReadyTimestamp[ctHash] = uint64(block.timestamp);\n" +
    "    }\n" +
    "    function publishDecryptResultBatch(uint256[] calldata ctHashes, uint256[] calldata results, bytes[] calldata /*signatures*/) external {\n" +
    "        for (uint256 i = 0; i < ctHashes.length; i++) {\n" +
    "            _decryptResultReady[ctHashes[i]] = true;\n" +
    "            _decryptResult[ctHashes[i]] = results[i];\n" +
    "            _decryptResultReadyTimestamp[ctHashes[i]] = uint64(block.timestamp);\n" +
    "        }\n" +
    "    }\n" +
    "    function verifyDecryptResult(uint256, uint256, bytes calldata) external pure returns (bool) {\n" +
    "        return true;\n" +
    "    }\n" +
    "    function verifyDecryptResultSafe(uint256, uint256, bytes calldata) external pure returns (bool) {\n" +
    "        return true;\n" +
    "    }\n" +
    "    function verifyDecryptResultBatch(uint256[] calldata, uint256[] calldata, bytes[] calldata) external pure returns (bool) {\n" +
    "        return true;\n" +
    "    }\n" +
    "    function verifyDecryptResultBatchSafe(uint256[] calldata ctHashes, uint256[] calldata, bytes[] calldata) external pure returns (bool[] memory) {\n" +
    "        bool[] memory out = new bool[](ctHashes.length);\n" +
    "        for (uint256 i = 0; i < ctHashes.length; i++) { out[i] = true; }\n" +
    "        return out;\n" +
    "    }\n" +
    "}";

  if (!src.includes(marker)) {
    log("WARN: MockTaskManager.sol marker not found — package layout may have changed; leaving file unmodified.");
    return src;
  }
  return src.replace(marker, stubs);
});

// ─── TestBed.sol ─────────────────────────────────────────────────────────────
patchFile("TestBed.sol", (src) => {
  let out = src;

  // (1) numberHash must be bytes32 (matches euint32.unwrap() in cofhe-contracts 0.1.x)
  out = out.replace(
    "    uint256 public numberHash;",
    "    bytes32 public numberHash;"
  );

  // (2) FHE.decrypt(eNumber) does not exist in 0.1.x — replace with a no-op
  //     (allowSender) so the mock still compiles. Tests that rely on real
  //     async decryption belong on a real cofhe network anyway.
  out = out.replace(
    "    function decrypt() public {\n        FHE.decrypt(eNumber);\n    }",
    "    function decrypt() public {\n        // DarkPool shim: FHE.decrypt() does not exist in cofhe-contracts 0.1.x\n        FHE.allowSender(eNumber);\n    }"
  );

  return out;
});

log("done.");
