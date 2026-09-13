import fs from 'node:fs';
import { config } from './config.js';
import { runAuthFlow } from './auth.js';
import { getMe, fetchHomeTimeline } from './xClient.js';
import { analyzeTimeline, printReport } from './analyze.js';

async function main() {
  const command = process.argv[2];

  if (command === 'auth') {
    await runAuthFlow();
    return;
  }

  if (command === 'analyze') {
    const me = await getMe();
    console.log(`Fetching home timeline for @${me.username} (up to ${config.maxPages * 100} tweets)...`);
    const { tweets, usersById } = await fetchHomeTimeline(me.id, config.maxPages);
    const report = analyzeTimeline(tweets, usersById);
    printReport(report);
    fs.writeFileSync(config.reportFile, JSON.stringify(report, null, 2));
    console.log(`Full report saved to ${config.reportFile}`);
    return;
  }

  console.log('Usage:');
  console.log('  npm run auth      # one-time OAuth login for your X account');
  console.log('  npm run analyze   # fetch + analyze your home timeline');
}

main().catch((err) => {
  console.error('\nError:', err.message);
  process.exit(1);
});
