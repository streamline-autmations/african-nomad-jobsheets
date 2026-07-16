import express from "express";
import type { SessionManager } from "./session";
import { buildWsdl, handleSoapCall } from "./soap";

/**
 * Builds the Express app around a SessionManager. Split out from server.ts so
 * tests / smoke scripts can mount it with an in-memory store instead of the
 * real Supabase-backed one.
 */
export function createApp(manager: SessionManager): express.Express {
  const app = express();
  app.use(express.text({ type: ["text/xml", "application/soap+xml", "*/*"], limit: "5mb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: manager.serverVersion() });
  });

  const endpointUrl = (req: express.Request): string => {
    const proto = (req.headers["x-forwarded-proto"] as string) ?? req.protocol;
    return `${proto}://${req.get("host")}/qbwc`;
  };

  app.get("/qbwc", (req, res) => {
    res.type("text/xml").send(buildWsdl(endpointUrl(req)));
  });

  app.post("/qbwc", async (req, res) => {
    try {
      const responseXml = await handleSoapCall(manager, req.body as string);
      res.type("text/xml").send(responseXml);
    } catch (err) {
      console.error("SOAP handler error:", err);
      res
        .status(500)
        .type("text/xml")
        .send(
          `<?xml version="1.0" encoding="utf-8"?>` +
            `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">` +
            `<soap:Body><soap:Fault><faultcode>soap:Server</faultcode>` +
            `<faultstring>${(err as Error).message}</faultstring>` +
            `</soap:Fault></soap:Body></soap:Envelope>`,
        );
    }
  });

  return app;
}
