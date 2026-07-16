import { describe, expect, it } from "vitest";
import { parseQbdResponse } from "./parsers";

function wrap(inner: string): string {
  return (
    `<?xml version="1.0" ?><QBXML><QBXMLMsgsRs>${inner}</QBXMLMsgsRs></QBXML>`
  );
}

describe("parseQbdResponse", () => {
  it("parses a successful CustomerAddRs and extracts ListID", () => {
    const xml = wrap(
      `<CustomerAddRs requestID="0" statusCode="0" statusSeverity="Info" statusMessage="Status OK">` +
        `<CustomerRet><ListID>80000001-1699999999</ListID><Name>Sibanye Stillwater</Name></CustomerRet>` +
        `</CustomerAddRs>`,
    );
    const r = parseQbdResponse(xml);
    expect(r.type).toBe("CustomerAddRs");
    expect(r.requestId).toBe("0");
    expect(r.statusCode).toBe(0);
    expect(r.listId).toBe("80000001-1699999999");
    expect(r.fullName).toBe("Sibanye Stillwater");
  });

  it("parses a duplicate-name error (3100) with no Ret aggregate", () => {
    const xml = wrap(
      `<CustomerAddRs requestID="0" statusCode="3100" statusSeverity="Error" ` +
        `statusMessage="The name &quot;Sibanye Stillwater&quot; is already in use."></CustomerAddRs>`,
    );
    const r = parseQbdResponse(xml);
    expect(r.statusCode).toBe(3100);
    expect(r.statusSeverity).toBe("Error");
    expect(r.listId).toBeUndefined();
    expect(r.statusMessage).toContain("already in use");
  });

  it("parses an EstimateAddRs and extracts TxnID (not ListID)", () => {
    const xml = wrap(
      `<EstimateAddRs requestID="2" statusCode="0" statusSeverity="Info" statusMessage="Status OK">` +
        `<EstimateRet><TxnID>90000005-1699999999</TxnID><TxnNumber>42</TxnNumber></EstimateRet>` +
        `</EstimateAddRs>`,
    );
    const r = parseQbdResponse(xml);
    expect(r.type).toBe("EstimateAddRs");
    expect(r.txnId).toBe("90000005-1699999999");
    expect(r.listId).toBeUndefined();
  });

  it("keeps QBD ids as strings (never number-coerces them)", () => {
    const xml = wrap(
      `<CustomerQueryRs requestID="1" statusCode="0" statusSeverity="Info" statusMessage="OK">` +
        `<CustomerRet><ListID>80000001-1699999999</ListID></CustomerRet>` +
        `</CustomerQueryRs>`,
    );
    const r = parseQbdResponse(xml);
    expect(typeof r.listId).toBe("string");
    expect(r.listId).toBe("80000001-1699999999");
  });

  it("takes the first Ret when a query returns several matches", () => {
    const xml = wrap(
      `<ItemQueryRs requestID="0" statusCode="0" statusSeverity="Info" statusMessage="OK">` +
        `<ItemServiceRet><ListID>10000001-1</ListID><FullName>Job Sheet Line</FullName></ItemServiceRet>` +
        `<ItemServiceRet><ListID>10000002-2</ListID><FullName>Other</FullName></ItemServiceRet>` +
        `</ItemQueryRs>`,
    );
    const r = parseQbdResponse(xml);
    expect(r.listId).toBe("10000001-1");
    expect(r.fullName).toBe("Job Sheet Line");
  });

  it("parses a not-found query result (statusCode 500, no Ret)", () => {
    const xml = wrap(
      `<ItemQueryRs requestID="0" statusCode="500" statusSeverity="Info" ` +
        `statusMessage="A query request did not find a matching object."></ItemQueryRs>`,
    );
    const r = parseQbdResponse(xml);
    expect(r.statusCode).toBe(500);
    expect(r.listId).toBeUndefined();
  });

  it("throws on non-qbXML input", () => {
    expect(() => parseQbdResponse("<html>not qbxml</html>")).toThrow();
  });
});
