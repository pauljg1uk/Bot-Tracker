import { type Request, type Response, type NextFunction } from "express";

export function auth(req: Request, res: Response, next: NextFunction): void {
  let encoded: string | null = null;

  const authHeader = req.headers.authorization;
  if (authHeader) {
    encoded = authHeader.split(" ")[1] ?? null;
  } else if (typeof req.query.auth === "string" && req.query.auth) {
    encoded = req.query.auth;
  }

  if (!encoded) {
    res.status(401).json({ error: "Unauthorised" });
    return;
  }

  const decoded = Buffer.from(encoded, "base64").toString();
  const colonIndex = decoded.indexOf(":");
  const password = colonIndex >= 0 ? decoded.slice(colonIndex + 1) : "";

  if (password === process.env.DASHBOARD_PASSWORD) {
    next();
  } else {
    res.status(401).json({ error: "Invalid password" });
  }
}
