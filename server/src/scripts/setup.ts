import { resetSISData } from './reset.js';
import { seedDatabase } from './seed.js';
import { cleanupSetupStudentAccounts } from './setupStudentAccounts.js';
import { assertSISLMSProject } from './projectGuard.js';

function assertConfirmation(): void {
  if (!process.argv.includes('--confirm')) {
    throw new Error(
      'This permanently deletes non-seeded SIS student accounts and resets SIS data before seeding. Re-run with: npm run setup:sis -- --confirm'
    );
  }
}

interface SetupSteps { cleanup: () => Promise<number>; reset: () => Promise<void>; seed: () => Promise<void>; }

export async function setupSISDatabase(steps: SetupSteps = {
  cleanup: cleanupSetupStudentAccounts, reset: resetSISData, seed: seedDatabase,
}): Promise<void> {
  assertConfirmation();
  assertSISLMSProject();
  console.log('Checking and removing non-seeded SIS student accounts...');
  await steps.cleanup();
  console.log('Resetting SIS-managed data...');
  await steps.reset();
  console.log('Seeding fresh SIS data...');
  await steps.seed();
  console.log('SIS setup complete.');
}

if (process.argv[1]?.endsWith('setup.ts') || process.argv[1]?.endsWith('setup.js')) {
  setupSISDatabase().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
