import { resetSISData } from './reset.js';
import { seedDatabase } from './seed.js';

function assertConfirmation(): void {
  if (!process.argv.includes('--confirm')) {
    throw new Error(
      'This permanently resets SIS data before seeding. Re-run with: npm run setup:sis -- --confirm'
    );
  }
}

export async function setupSISDatabase(): Promise<void> {
  assertConfirmation();
  console.log('Resetting SIS-managed data...');
  await resetSISData();
  console.log('Seeding fresh SIS data...');
  await seedDatabase();
  console.log('SIS setup complete.');
}

if (process.argv[1]?.endsWith('setup.ts') || process.argv[1]?.endsWith('setup.js')) {
  setupSISDatabase().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
