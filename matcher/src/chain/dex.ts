import { Contract, type Wallet, type WebSocketProvider } from "ethers";
import abi from "../../../shared/abi/DarkPoolDEX.json" with { type: "json" };

export function dexFor(addr: string, wallet: Wallet) {
  return new Contract(addr, (abi as any).abi, wallet);
}

export function dexEvents(addr: string, ws: WebSocketProvider) {
  return new Contract(addr, (abi as any).abi, ws);
}
