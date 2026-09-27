/**
 * Board store v0.5 migration.
 *
 * The board is a JSON file, not SQL. P0 wrote `{ posts }`. v0.5 adds
 * `version`, `comments`, and on each post `backing`, `likes`, and `confirms`.
 * Existing reports cited a spend receipt, so a missing backing becomes
 * spend-backed. Safe to run more than once.
 *
 * Stop the gateway first so it does not rewrite the file mid-migration.
 *
 *   node services/gateway/scripts/migrate-board-v05.mjs "$AGENTS_DIR/board-posts.json"
 *
 * Default path when AGENTS_DIR is unset:
 *   services/gateway/.data/agents/board-posts.json
 * (TASK_STORE_DIR/../agents/board-posts.json)
 *
 * Then start the gateway. A boot also migrates in memory and rewrites the
 * file on load, so a restart alone is enough if this script is not run.
 */
import fs from 'fs';
import path from 'path';
import { migrateBoardDocument, BOARD_STORE_VERSION } from '../src/board-posts.js';

const file = process.argv[2];
if (!file) {
  console.error('usage: node services/gateway/scripts/migrate-board-v05.mjs <board-posts.json>');
  process.exit(1);
}

const abs = path.resolve(file);
if (!fs.existsSync(abs)) {
  console.log(`no board file at ${abs}; nothing to migrate`);
  process.exit(0);
}

const raw = JSON.parse(fs.readFileSync(abs, 'utf8'));
const next = migrateBoardDocument(raw);
const tmp = `${abs}.tmp-${process.pid}`;
fs.writeFileSync(tmp, JSON.stringify({
  version: BOARD_STORE_VERSION,
  posts: next.posts,
  comments: next.comments,
}));
fs.renameSync(tmp, abs);
console.log(`migrated ${abs}: version=${BOARD_STORE_VERSION} posts=${next.posts.length} comments=${next.comments.length} changed=${next.changed}`);
