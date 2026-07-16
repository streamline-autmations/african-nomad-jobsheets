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
    incomeAccount: env.QBD_INCOME_ACCOUNT ?? "Sales",
    expenseAccount: env.QBD_EXPENSE_ACCOUNT ?? "Job Expenses",
    qbxmlVersion: "13.0",
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
