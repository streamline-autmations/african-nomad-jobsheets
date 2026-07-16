import { XMLParser } from "fast-xml-parser";

export interface QbdResponse {
  /** e.g. "CustomerAddRs", "EstimateAddRs" */
  type: string;
  requestId: string;
  statusCode: number;
  statusSeverity: string;
  statusMessage: string;
  /** ListID for list objects (customers, items). */
  listId?: string;
  /** TxnID for transactions (estimates, invoices, bills). */
  txnId?: string;
  fullName?: string;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  // Keep everything as strings — QBD IDs like "80000001-1234" must not be
  // number-coerced, and status codes are parsed explicitly below.
  parseTagValue: false,
  parseAttributeValue: false,
  removeNSPrefix: true,
});

function firstOf<T>(value: T | T[] | undefined): T | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Parse a qbXML response document from QBD. Assumes one response aggregate
 * per document (matching how the builders emit one request per document);
 * if QBD ever returns several, the first is used.
 */
export function parseQbdResponse(xml: string): QbdResponse {
  const doc = parser.parse(xml);
  const msgs = doc?.QBXML?.QBXMLMsgsRs;
  if (!msgs || typeof msgs !== "object") {
    throw new Error("Response is not a qbXML document (missing QBXML/QBXMLMsgsRs)");
  }

  const rsKey = Object.keys(msgs).find((key) => key.endsWith("Rs"));
  if (!rsKey) {
    throw new Error("qbXML response contains no *Rs aggregate");
  }

  const rs = firstOf<Record<string, unknown>>(msgs[rsKey] as never);
  if (!rs) {
    throw new Error(`qbXML ${rsKey} aggregate is empty`);
  }

  const result: QbdResponse = {
    type: rsKey,
    requestId: String(rs["@_requestID"] ?? ""),
    statusCode: Number(rs["@_statusCode"] ?? -1),
    statusSeverity: String(rs["@_statusSeverity"] ?? ""),
    statusMessage: String(rs["@_statusMessage"] ?? ""),
  };

  // The *Ret aggregate (CustomerRet, EstimateRet, ItemServiceRet, …) holds
  // the created/fetched object. Queries can return arrays; take the first.
  const retKey = Object.keys(rs).find((key) => key.endsWith("Ret"));
  if (retKey) {
    const ret = firstOf<Record<string, unknown>>(rs[retKey] as never);
    if (ret) {
      if (ret.ListID !== undefined) result.listId = String(ret.ListID);
      if (ret.TxnID !== undefined) result.txnId = String(ret.TxnID);
      if (ret.FullName !== undefined) result.fullName = String(ret.FullName);
      else if (ret.Name !== undefined) result.fullName = String(ret.Name);
    }
  }

  return result;
}

/** QBD status codes the session machine treats specially. */
export const QBD_STATUS = {
  OK: 0,
  /** "The name ... is already in use" — list object already exists. */
  DUPLICATE_NAME: 3100,
  /** Query matched nothing ("did not find"). */
  NOT_FOUND: 500,
} as const;
