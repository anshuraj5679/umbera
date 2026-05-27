export const wrapperAbi = [
  { type: "function", name: "wrap", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "setOperator", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "deadline", type: "uint256" }], outputs: [] },
  { type: "function", name: "isOperator", stateMutability: "view", inputs: [{ name: "holder", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "encryptedBalanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
] as const;
