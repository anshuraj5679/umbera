import { JsonRpcProvider, WebSocketProvider, Wallet } from "ethers";

export type Chain = {
  provider: JsonRpcProvider;
  wsProvider: WebSocketProvider;
  wallet: Wallet;
};

export function makeChain(rpcUrl: string, wsUrl: string, privateKey: string): Chain {
  const provider = new JsonRpcProvider(rpcUrl);
  const wsProvider = new WebSocketProvider(wsUrl);
  const wallet = new Wallet(privateKey, provider);
  return { provider, wsProvider, wallet };
}
