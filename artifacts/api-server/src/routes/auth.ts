import { type Request, type Response, type NextFunction } from "express";

export function auth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.status(401).json({ error: "Unauthorised" });
    return;
  }
  const base64 = authHeader.split(" ")[1];
  if (!base64) {
    res.status(401).json({ error: "Unauthorised" });
    return;
  }
  const decoded = Buffer.from(base64, "base64").toString();
  const colonIndex = decoded.indexOf(":");
  const password = colonIndex >= 0 ? decoded.slice(colonIndex + 1) : "";
  if (password === process.env.DASHBOARD_PASSWORD) {
    next();
  } else {
    res.status(401).json({ error: "Invalid password" });
  }
}
