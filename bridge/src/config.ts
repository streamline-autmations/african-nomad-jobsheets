export interface BridgeConfig {
  port: number;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  qbwcUsername: string;
  qbwcPassword: string;
  /** Service item every client line is booked under (auto-created if missing). */
  itemName: string;
  /** 'line' adds a separate VAT line item per estimate; 'none' sends ex-VAT lines only. */
  vatMode: "line" | "none";
  vatItemName: string;
  /** Item name used for the Sibanye Stillwater discount line (negative rate), when one applies. */
  discountItemName: string;
  /** Income account for auto-created service items. Must exist in the company file. */
  incomeAccount: string;
  /** Expense account used for BillAdd lines (supplier bills, later phase). */
  expenseAccount: string;
  /**
   * qbXML spec version sent in every request. 13.0 is supported by every
   * QuickBooks Desktop Pro/Premier/Enterprise release since 2013, including
   * current trials, so trial -> Pro won't change behaviour.
   */
  qbxmlVersion: string;
  /**
   * QuickBooks Desktop always expects "." as the decimal separator in
   * qbXML, regardless of Windows regional settings — leave this as ".".
   * If QuickBooks rejects amounts with "There was an error when converting
   * the price ... in the field ...", the fix is changing the QUICKBOOKS
   * MACHINE's Windows decimal symbol to "." (Control Panel -> Region ->
   * Additional settings -> Numbers), not changing this value. Kept
   * configurable only as an escape hatch if a real-world deployment is ever
   * found that genuinely needs something else.
   */
  decimalSeparator: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BridgeConfig {
  return {
    port: Number(env.PORT ?? 8080),
    supabaseUrl: env.SUPABASE_URL ?? "",
    supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    qbwcUsername: env.QBWC_USERNAME ?? "",
    qbwcPassword: env.QBWC_PASSWORD ?? "",
    itemName: env.QBD_ITEM_NAME ?? "Job Sheet Line",
    vatMode: env.QBD_VAT_MODE === "none" ? "none" : "line",
    vatItemName: env.QBD_VAT_ITEM_NAME ?? "VAT @ 15%",
    discountItemName: env.QBD_DISCOUNT_ITEM_NAME ?? "Sibanye Discount",
    incomeAccount: env.QBD_INCOME_ACCOUNT ?? "Sales",
    expenseAccount: env.QBD_EXPENSE_ACCOUNT ?? "Job Expenses",
    qbxmlVersion: "13.0",
    decimalSeparator: env.QBD_DECIMAL_SEPARATOR ?? ".",
  };
}

export function configProblems(config: BridgeConfig): string[] {
  const problems: string[] = [];
  if (!config.supabaseUrl) problems.push("SUPABASE_URL is not set");
  if (!config.supabaseServiceRoleKey) problems.push("SUPABASE_SERVICE_ROLE_KEY is not set");
  if (!config.qbwcUsername) problems.push("QBWC_USERNAME is not set");
  if (!config.qbwcPassword) problems.push("QBWC_PASSWORD is not set");
  return problems;
}
