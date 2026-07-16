import { describe, expect, it } from "vitest";
import { parseSoapCall } from "./soap";

function envelope(inner: string): string {
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">` +
    `<soap:Body>${inner}</soap:Body></soap:Envelope>`
  );
}

describe("parseSoapCall", () => {
  it("extracts method name and string params from an authenticate call", () => {
    const body = envelope(
      `<authenticate xmlns="http://developer.intuit.com/">` +
        `<strUserName>an-jobsheets</strUserName>` +
        `<strPassword>secret</strPassword>` +
        `</authenticate>`,
    );
    const call = parseSoapCall(body);
    expect(call.method).toBe("authenticate");
    expect(call.params.strUserName).toBe("an-jobsheets");
    expect(call.params.strPassword).toBe("secret");
  });

  it("unescapes the qbXML response carried inside receiveResponseXML", () => {
    const body = envelope(
      `<receiveResponseXML xmlns="http://developer.intuit.com/">` +
        `<ticket>abc</ticket>` +
        `<response>&lt;QBXML&gt;&lt;/QBXML&gt;</response>` +
        `<hresult></hresult><message></message>` +
        `</receiveResponseXML>`,
    );
    const call = parseSoapCall(body);
    expect(call.method).toBe("receiveResponseXML");
    expect(call.params.ticket).toBe("abc");
    expect(call.params.response).toBe("<QBXML></QBXML>");
  });

  it("handles a no-argument method like serverVersion", () => {
    const body = envelope(`<serverVersion xmlns="http://developer.intuit.com/"/>`);
    const call = parseSoapCall(body);
    expect(call.method).toBe("serverVersion");
  });
});
