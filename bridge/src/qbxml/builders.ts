import { escapeXml, qbdAmount, qbdDesc, qbdName, qbdQuantity } from "./xml";

/**
 * qbXML request builders. Each returns a complete qbXML document containing
 * exactly ONE request aggregate — the session machine sends one request per
 * Web Connector round-trip, which keeps response correlation trivial (the
 * requestID attribute round-trips through QBD untouched).
 *
 * onError="stopOnError" is the conventional setting; with a single Rq per
 * document it has no practical effect but QBD requires the attribute.
 */

function wrapQbxml(version: string, body: string): string {
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<?qbxml version="${version}"?>` +
    `<QBXML><QBXMLMsgsRq onError="stopOnError">` +
    body +
    `</QBXMLMsgsRq></QBXML>`
  );
}

export function buildCustomerAdd(version: string, requestId: string, name: string): string {
  return wrapQbxml(
    version,
    `<CustomerAddRq requestID="${escapeXml(requestId)}">` +
      `<CustomerAdd><Name>${escapeXml(qbdName(name))}</Name></CustomerAdd>` +
      `</CustomerAddRq>`,
  );
}

/** Look a customer up by exact name — used when CustomerAdd reports a duplicate (3100). */
export function buildCustomerQuery(version: string, requestId: string, name: string): string {
  return wrapQbxml(
    version,
    `<CustomerQueryRq requestID="${escapeXml(requestId)}">` +
      `<FullName>${escapeXml(qbdName(name))}</FullName>` +
      `</CustomerQueryRq>`,
  );
}

export function buildItemQuery(version: string, requestId: string, fullName: string): string {
  return wrapQbxml(
    version,
    `<ItemQueryRq requestID="${escapeXml(requestId)}">` +
      `<FullName>${escapeXml(qbdName(fullName))}</FullName>` +
      `</ItemQueryRq>`,
  );
}

/**
 * Create the service item transactions are booked under. SalesOrPurchase
 * (not SalesAndPurchase) marks it as sales-side only; the income account
 * must already exist in the company file.
 */
export function buildItemServiceAdd(
  version: string,
  requestId: string,
  name: string,
  incomeAccount: string,
): string {
  return wrapQbxml(
    version,
    `<ItemServiceAddRq requestID="${escapeXml(requestId)}">` +
      `<ItemServiceAdd>` +
      `<Name>${escapeXml(qbdName(name))}</Name>` +
      `<SalesOrPurchase>` +
      `<AccountRef><FullName>${escapeXml(incomeAccount)}</FullName></AccountRef>` +
      `</SalesOrPurchase>` +
      `</ItemServiceAdd>` +
      `</ItemServiceAddRq>`,
  );
}

export interface EstimateLineInput {
  description: string;
  qty: number;
  unitCost: number;
}

export interface EstimateAddInput {
  customerName: string;
  memo?: string;
  lines: EstimateLineInput[];
  itemName: string;
  /** When set, appended as an extra line so the estimate total includes VAT. */
  vatLine?: { itemName: string; amount: number };
}

function salesLinesXml(lineTag: string, input: EstimateAddInput): string {
  const lines = input.lines
    .map(
      (line) =>
        `<${lineTag}>` +
        `<ItemRef><FullName>${escapeXml(qbdName(input.itemName))}</FullName></ItemRef>` +
        `<Desc>${escapeXml(qbdDesc(line.description))}</Desc>` +
        `<Quantity>${qbdQuantity(line.qty)}</Quantity>` +
        `<Rate>${qbdAmount(line.unitCost)}</Rate>` +
        `</${lineTag}>`,
    )
    .join("");

  const vat = input.vatLine
    ? `<${lineTag}>` +
      `<ItemRef><FullName>${escapeXml(qbdName(input.vatLine.itemName))}</FullName></ItemRef>` +
      `<Desc>VAT at 15%</Desc>` +
      `<Quantity>1</Quantity>` +
      `<Rate>${qbdAmount(input.vatLine.amount)}</Rate>` +
      `</${lineTag}>`
    : "";

  return lines + vat;
}

export function buildEstimateAdd(
  version: string,
  requestId: string,
  input: EstimateAddInput,
): string {
  const memo = input.memo ? `<Memo>${escapeXml(qbdDesc(input.memo))}</Memo>` : "";
  return wrapQbxml(
    version,
    `<EstimateAddRq requestID="${escapeXml(requestId)}">` +
      `<EstimateAdd>` +
      `<CustomerRef><FullName>${escapeXml(qbdName(input.customerName))}</FullName></CustomerRef>` +
      memo +
      salesLinesXml("EstimateLineAdd", input) +
      `</EstimateAdd>` +
      `</EstimateAddRq>`,
  );
}

export interface InvoiceAddInput extends EstimateAddInput {
  /**
   * TxnID of the originating estimate. LinkedTxnID on InvoiceAdd links the
   * new invoice back to that estimate in QBD (per the SDK reference for
   * InvoiceAdd). Flagged for verification against a real company file when
   * the invoice flow is first exercised — no app path creates
   * create_invoice queue rows yet.
   */
  estimateTxnId?: string;
}

export function buildInvoiceAdd(
  version: string,
  requestId: string,
  input: InvoiceAddInput,
): string {
  const memo = input.memo ? `<Memo>${escapeXml(qbdDesc(input.memo))}</Memo>` : "";
  const link = input.estimateTxnId
    ? `<LinkedTxnID>${escapeXml(input.estimateTxnId)}</LinkedTxnID>`
    : "";
  return wrapQbxml(
    version,
    `<InvoiceAddRq requestID="${escapeXml(requestId)}">` +
      `<InvoiceAdd>` +
      `<CustomerRef><FullName>${escapeXml(qbdName(input.customerName))}</FullName></CustomerRef>` +
      memo +
      link +
      salesLinesXml("InvoiceLineAdd", input) +
      `</InvoiceAdd>` +
      `</InvoiceAddRq>`,
  );
}

export interface BillAddInput {
  vendorName: string;
  amount: number;
  memo?: string;
  expenseAccount: string;
}

export function buildBillAdd(version: string, requestId: string, input: BillAddInput): string {
  const memo = input.memo ? `<Memo>${escapeXml(qbdDesc(input.memo))}</Memo>` : "";
  return wrapQbxml(
    version,
    `<BillAddRq requestID="${escapeXml(requestId)}">` +
      `<BillAdd>` +
      `<VendorRef><FullName>${escapeXml(qbdName(input.vendorName))}</FullName></VendorRef>` +
      memo +
      `<ExpenseLineAdd>` +
      `<AccountRef><FullName>${escapeXml(input.expenseAccount)}</FullName></AccountRef>` +
      `<Amount>${qbdAmount(input.amount)}</Amount>` +
      `</ExpenseLineAdd>` +
      `</BillAdd>` +
      `</BillAddRq>`,
  );
}
