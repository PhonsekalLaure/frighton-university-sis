export function assertSISLMSProject(): void {
  const expectedRef = process.env.SISLMS_SUPABASE_PROJECT_REF;
  if (!expectedRef) {
    throw new Error("Set SISLMS_SUPABASE_PROJECT_REF to the ref for sislms331-sudo's Project before running this command.");
  }

  const actualRef = new URL(process.env.SUPABASE_URL ?? '').hostname.split('.')[0];
  if (actualRef !== expectedRef) {
    throw new Error(`Refusing to run against project "${actualRef || 'unknown'}"; expected "${expectedRef}".`);
  }
}
