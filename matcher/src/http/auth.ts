import { ethers } from "ethers";
import type { Request, Response, NextFunction } from "express";

export function verifySignedHeader(matcherAddress: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const sig = req.header("x-signature");
      const msg = req.header("x-message");
      if (!sig || !msg) return res.status(401).json({ error: "missing sig" });
      const recovered = ethers.verifyMessage(msg, sig);
      if (recovered.toLowerCase() !== matcherAddress.toLowerCase()) return res.status(403).json({ error: "not matcher" });
      next();
    } catch (e) { res.status(401).json({ error: (e as Error).message }); }
  };
}
