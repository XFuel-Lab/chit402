/**
 * XFuel Protocol — Campaign Automation
 * X/Discord launch content, scheduling, and performance tracking.
 *
 * Usage:
 *   node community/campaign-automation.cjs --campaign partner --partner almanak
 *   node community/campaign-automation.cjs --campaign tvl --milestone 500M
 *   node community/campaign-automation.cjs --campaign launch --circuit ZKMLCircuit
 *   node community/campaign-automation.cjs --campaign governance --proposal XFP-003
 *   node community/campaign-automation.cjs --schedule
 *   node community/campaign-automation.cjs --metrics
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// ═══ Protocol Constants ══════════════════════════════════════════════

const PROTOCOL = {
  name: 'XFuel Protocol',
  handle: '@XFuelProtocol',
  website: 'https://xfuel.app',
  github: 'https://github.com/xfuel-protocol',
  discord: 'https://discord.gg/xfuel',
  circuits: 21,
  contracts: 25,
  tests: '700+',
  networks: ['Theta', 'Bittensor', 'Osmosis', 'Aptos', 'Sui'],
};

// ═══ Campaign Templates ══════════════════════════════════════════════

const TEMPLATES = {
  partner: {
    id: 'partner-announcement',
    type: 'partner',
    platforms: ['x', 'discord'],
    generateThread(opts) {
      const partner = opts.partner || 'Partner';
      const partnerCap = partner.charAt(0).toUpperCase() + partner.slice(1);
      return [
        `🤝 ${PROTOCOL.name} x ${partnerCap} — Partnership Announcement\n\nWe're thrilled to announce our integration with ${partnerCap}, bringing enhanced capabilities to the XFuel ecosystem.\n\nThread 🧵👇`,
        `What does this mean?\n\n${partnerCap} brings specialized infrastructure that plugs directly into our ${PROTOCOL.circuits}-circuit architecture.\n\nAll ZK-verified. All modular. All composable.`,
        `Technical integration:\n• Direct circuit-level hooks\n• Shared ZK verification layer (SP1)\n• Cross-chain settlement support\n• ${PROTOCOL.tests} tests covering integration paths`,
        `This partnership expands XFuel across ${PROTOCOL.networks.length} networks: ${PROTOCOL.networks.join(', ')}.\n\nMulti-chain AI infrastructure, verified end-to-end.`,
        `What's next:\n• Joint testnet deployment\n• Combined audit scope\n• Co-developed circuits\n• Community governance integration\n\n${PROTOCOL.website} | ${PROTOCOL.discord}`,
      ];
    },
    generateDiscordEmbed(opts) {
      const partner = opts.partner || 'Partner';
      const partnerCap = partner.charAt(0).toUpperCase() + partner.slice(1);
      return {
        title: `🤝 Partnership: ${PROTOCOL.name} x ${partnerCap}`,
        description: `We're integrating with ${partnerCap} to expand the XFuel ecosystem across ${PROTOCOL.networks.length} networks.`,
        color: 0x00d4aa,
        fields: [
          { name: 'Partner', value: partnerCap, inline: true },
          { name: 'Integration Type', value: 'Circuit-level hooks + ZK verification', inline: true },
          { name: 'Networks', value: PROTOCOL.networks.join(', '), inline: false },
          { name: 'Circuits', value: String(PROTOCOL.circuits), inline: true },
          { name: 'Tests', value: PROTOCOL.tests, inline: true },
        ],
        footer: { text: `${PROTOCOL.name} — ZK-Verified AI Infrastructure` },
        timestamp: new Date().toISOString(),
      };
    },
  },

  tvl: {
    id: 'tvl-milestone',
    type: 'tvl',
    platforms: ['x', 'discord'],
    milestones: ['$1M', '$10M', '$100M', '$500M'],
    generateThread(opts) {
      const milestone = opts.milestone || '$100M';
      const milestoneEmoji = {
        '1M': '🎯', '10M': '🚀', '100M': '💎', '500M': '👑',
      };
      const raw = milestone.replace('$', '');
      const emoji = milestoneEmoji[raw] || '📈';
      return [
        `${emoji} TVL MILESTONE: $${raw} Locked in XFuel Protocol!\n\nThe XFuel ecosystem has reached $${raw} in Total Value Locked across ${PROTOCOL.circuits} circuits and ${PROTOCOL.networks.length} networks.\n\nThread 🧵`,
        `How we got here:\n\n• ${PROTOCOL.circuits} modular circuits — each isolated and ZK-verified\n• ${PROTOCOL.contracts} deployed contracts\n• ${PROTOCOL.tests} tests ensuring security\n• Multi-net: ${PROTOCOL.networks.join(', ')}`,
        `TVL breakdown by category:\n• AI Compute: Akash, ThetaGPU, ZKML\n• DePIN: Wireless, Mapping, Uplink\n• Cross-Chain: Bridge, A2A, Solana\n• Data: DataHubs, Filecoin, Near\n• DeFi: Yield Optimization, Autonomous Vaults`,
        `Every dollar is ZK-verified through our SP1 proof layer.\n\nNo trust assumptions. No centralized oracles.\nJust math. ✓`,
        `Next target: the moon. 🌙\n\nJoin the ecosystem:\n${PROTOCOL.website}\n${PROTOCOL.discord}\n${PROTOCOL.github}`,
      ];
    },
    generateDiscordEmbed(opts) {
      const milestone = opts.milestone || '100M';
      return {
        title: `📈 TVL Milestone: $${milestone}`,
        description: `XFuel Protocol has reached **$${milestone}** in Total Value Locked!`,
        color: 0xffd700,
        fields: [
          { name: 'TVL', value: `$${milestone}`, inline: true },
          { name: 'Circuits', value: String(PROTOCOL.circuits), inline: true },
          { name: 'Networks', value: String(PROTOCOL.networks.length), inline: true },
          { name: 'Contracts', value: String(PROTOCOL.contracts), inline: true },
          { name: 'Tests', value: PROTOCOL.tests, inline: true },
          { name: 'ZK Verified', value: 'SP1 Groth16', inline: true },
        ],
        footer: { text: `${PROTOCOL.name} — ZK-Verified AI Infrastructure` },
        timestamp: new Date().toISOString(),
      };
    },
  },

  launch: {
    id: 'circuit-launch',
    type: 'launch',
    platforms: ['x', 'discord'],
    generateThread(opts) {
      const circuit = opts.circuit || 'NewCircuit';
      return [
        `⚡ NEW CIRCUIT DEPLOYED: ${circuit}\n\n${PROTOCOL.name} just shipped circuit #${PROTOCOL.circuits} — ${circuit} is live and ZK-verified.\n\nWhat does it do? 🧵👇`,
        `${circuit} adds a new capability to the XFuel modular architecture:\n\n• Fully isolated contract logic\n• SP1 ZK proof generation\n• On-chain Groth16 verification (~270K gas)\n• Cross-circuit composability via CoreRevenueSplitter`,
        `Integration points:\n• Settlement: ZKVerifierSP1 validates all proofs\n• Revenue: CoreRevenueSplitter distributes fees\n• Governance: veXF holders vote on circuit parameters\n• Cross-chain: Hyperlane mailbox for multi-net settlement`,
        `Current protocol stats:\n• ${PROTOCOL.circuits} circuits deployed\n• ${PROTOCOL.contracts} contracts\n• ${PROTOCOL.tests} tests passing\n• ${PROTOCOL.networks.length} networks: ${PROTOCOL.networks.join(', ')}`,
        `Try it now:\n${PROTOCOL.website}\n\nDocs: ${PROTOCOL.github}\nCommunity: ${PROTOCOL.discord}`,
      ];
    },
    generateDiscordEmbed(opts) {
      const circuit = opts.circuit || 'NewCircuit';
      return {
        title: `⚡ Circuit Launch: ${circuit}`,
        description: `**${circuit}** is now live on ${PROTOCOL.name}! Fully ZK-verified and ready for integration.`,
        color: 0x7c3aed,
        fields: [
          { name: 'Circuit', value: circuit, inline: true },
          { name: 'Verification', value: 'SP1 + Groth16', inline: true },
          { name: 'Total Circuits', value: String(PROTOCOL.circuits), inline: true },
          { name: 'Networks', value: PROTOCOL.networks.join(', '), inline: false },
        ],
        footer: { text: `${PROTOCOL.name} — ZK-Verified AI Infrastructure` },
        timestamp: new Date().toISOString(),
      };
    },
  },

  governance: {
    id: 'governance-vote',
    type: 'governance',
    platforms: ['x', 'discord'],
    generateThread(opts) {
      const proposal = opts.proposal || 'XFP-XXX';
      return [
        `🗳️ GOVERNANCE: ${proposal} is LIVE for voting\n\nveXF holders — your vote matters.\n\nDetails 🧵👇`,
        `${proposal} proposes changes to the XFuel Protocol.\n\nAll votes are weighted by veXF lock duration.\nLonger lock = stronger voice.\n\nThis is real on-chain governance.`,
        `How to vote:\n1. Lock XF tokens in veXFGovernance\n2. Navigate to the governance portal\n3. Review the proposal details\n4. Cast your vote (For / Against / Abstain)\n\nVoting period: 7 days`,
        `Current governance stats:\n• veXF active with weekly proposals\n• ${PROTOCOL.circuits} circuits under governance control\n• Circuit allocation, fee structures, and upgrade paths\n• All votes verified on-chain`,
        `Cast your vote:\n${PROTOCOL.website}/governance\n\nDiscuss: ${PROTOCOL.discord}\nProposal details: ${PROTOCOL.github}`,
      ];
    },
    generateDiscordEmbed(opts) {
      const proposal = opts.proposal || 'XFP-XXX';
      return {
        title: `🗳️ Governance Proposal: ${proposal}`,
        description: `**${proposal}** is now live for voting. veXF holders can cast their votes.`,
        color: 0x3b82f6,
        fields: [
          { name: 'Proposal', value: proposal, inline: true },
          { name: 'Voting Period', value: '7 days', inline: true },
          { name: 'Status', value: 'Active', inline: true },
          { name: 'Vote Weight', value: 'veXF lock-duration weighted', inline: false },
        ],
        footer: { text: `${PROTOCOL.name} — On-Chain Governance` },
        timestamp: new Date().toISOString(),
      };
    },
  },

  mainnet: {
    id: 'mainnet-launch',
    type: 'mainnet',
    platforms: ['x', 'discord'],
    generateThread(opts) {
      const network = opts.network || 'Multi-Net';
      return [
        `🌐 MAINNET LAUNCH: ${PROTOCOL.name} is LIVE on ${network}!\n\nAfter months of building, testing, and auditing — we're here.\n\n${PROTOCOL.circuits} circuits. ${PROTOCOL.contracts} contracts. ${PROTOCOL.tests} tests. ZK-verified.\n\n🧵👇`,
        `What's deployed:\n\n✓ Core Layer: ZKVerifierSP1, CoreRevenueSplitter, veXFGovernance\n✓ ${PROTOCOL.circuits} modular circuits spanning AI, DePIN, DeFi, and Cross-Chain\n✓ SP1 proof generation + Groth16 on-chain verification\n✓ Hyperlane cross-chain messaging`,
        `Networks live:\n${PROTOCOL.networks.map(n => `• ${n}`).join('\n')}\n\nOne protocol. Multiple chains. Unified ZK verification.`,
        `Security:\n• CertiK audit (Phases 1-4)\n• ${PROTOCOL.tests} automated tests\n• Formal verification on critical paths\n• Bug bounty program active`,
        `Join the ecosystem:\n🌐 ${PROTOCOL.website}\n💬 ${PROTOCOL.discord}\n📖 ${PROTOCOL.github}\n\nThe ZK-verified AI pumping station is open for business.`,
      ];
    },
    generateDiscordEmbed(opts) {
      const network = opts.network || 'Multi-Net';
      return {
        title: `🌐 MAINNET LAUNCH: ${PROTOCOL.name}`,
        description: `XFuel Protocol is **LIVE** on ${network}! ${PROTOCOL.circuits} circuits deployed and ZK-verified.`,
        color: 0x10b981,
        fields: [
          { name: 'Circuits', value: String(PROTOCOL.circuits), inline: true },
          { name: 'Contracts', value: String(PROTOCOL.contracts), inline: true },
          { name: 'Tests', value: PROTOCOL.tests, inline: true },
          { name: 'Networks', value: PROTOCOL.networks.join(', '), inline: false },
          { name: 'Website', value: PROTOCOL.website, inline: true },
          { name: 'Discord', value: PROTOCOL.discord, inline: true },
        ],
        footer: { text: `${PROTOCOL.name} — ZK-Verified AI Infrastructure` },
        timestamp: new Date().toISOString(),
      };
    },
  },
};

// ═══ Discord Webhook Integration ═════════════════════════════════════

function buildWebhookPayload(template, opts) {
  const embed = template.generateDiscordEmbed(opts);
  return {
    username: PROTOCOL.name,
    avatar_url: `${PROTOCOL.website}/logo.png`,
    content: `@everyone New ${template.type} announcement!`,
    embeds: [embed],
  };
}

function sendDiscordWebhook(webhookUrl, payload) {
  console.log('\n  Discord Webhook Payload:');
  console.log('  URL: ' + (webhookUrl || '<set DISCORD_WEBHOOK_URL env var>'));
  console.log('  ────────────────────────────────────');
  console.log(JSON.stringify(payload, null, 2));
  console.log('');

  if (!webhookUrl) {
    console.log('  ⚠ Set DISCORD_WEBHOOK_URL to send automatically.');
    console.log('  Payload saved to community/campaigns/ for manual posting.\n');
    return false;
  }

  console.log('  ✓ Webhook payload ready. Use curl or fetch to POST.\n');
  console.log(`  curl -X POST -H "Content-Type: application/json" -d @payload.json ${webhookUrl}\n`);
  return true;
}

// ═══ X/Twitter Thread Generator ══════════════════════════════════════

function generateXThread(template, opts) {
  const thread = template.generateThread(opts);

  console.log('\n  ════════════════════════════════════════════════');
  console.log(`  X/Twitter Thread: ${template.id}`);
  console.log('  ════════════════════════════════════════════════\n');

  thread.forEach((tweet, i) => {
    const charCount = tweet.length;
    const status = charCount <= 280 ? '✓' : `⚠ ${charCount}/280`;
    console.log(`  --- Tweet ${i + 1} (${status}) ---`);
    console.log('');
    tweet.split('\n').forEach(line => console.log('  ' + line));
    console.log('');
  });

  console.log(`  Total tweets: ${thread.length}`);
  console.log(`  Platform: X/Twitter (${PROTOCOL.handle})\n`);

  return thread;
}

// ═══ Campaign Runner ═════════════════════════════════════════════════

function runCampaign(campaignType, opts) {
  const template = TEMPLATES[campaignType];
  if (!template) {
    console.error(`Unknown campaign type: ${campaignType}`);
    console.error(`Available: ${Object.keys(TEMPLATES).join(', ')}`);
    process.exit(1);
  }

  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log(`║  Campaign: ${template.id.padEnd(46)}║`);
  console.log('╚════════════════════════════════════════════════════════════╝');

  const thread = generateXThread(template, opts);
  const webhookPayload = buildWebhookPayload(template, opts);

  const outDir = path.join(ROOT, 'community', 'campaigns');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const timestamp = Date.now();
  const threadFile = path.join(outDir, `${template.id}-thread-${timestamp}.json`);
  const webhookFile = path.join(outDir, `${template.id}-webhook-${timestamp}.json`);

  fs.writeFileSync(threadFile, JSON.stringify({ type: template.id, thread, generatedAt: new Date().toISOString() }, null, 2));
  fs.writeFileSync(webhookFile, JSON.stringify(webhookPayload, null, 2));

  console.log('  Files saved:');
  console.log(`    Thread: ${threadFile}`);
  console.log(`    Webhook: ${webhookFile}`);

  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  sendDiscordWebhook(webhookUrl, webhookPayload);

  trackCampaignMetrics(template.id, {
    type: campaignType,
    tweets: thread.length,
    platforms: template.platforms,
    generatedAt: new Date().toISOString(),
  });

  return { thread, webhookPayload };
}

// ═══ Campaign Scheduler ══════════════════════════════════════════════

const SCHEDULE_SLOTS = [
  { day: 'Monday',    time: '14:00 UTC', type: 'governance', label: 'Governance Monday' },
  { day: 'Tuesday',   time: '16:00 UTC', type: 'partner',    label: 'Partner Tuesday' },
  { day: 'Wednesday', time: '14:00 UTC', type: 'launch',     label: 'Circuit Wednesday' },
  { day: 'Thursday',  time: '16:00 UTC', type: 'tvl',        label: 'Metrics Thursday' },
  { day: 'Friday',    time: '18:00 UTC', type: 'mainnet',    label: 'Ecosystem Friday' },
];

function showSchedule() {
  console.log('\n  ════════════════════════════════════════════════');
  console.log('  Campaign Schedule (Weekly Cadence)');
  console.log('  ════════════════════════════════════════════════\n');

  const now = new Date();

  SCHEDULE_SLOTS.forEach(slot => {
    const template = TEMPLATES[slot.type];
    const platforms = template ? template.platforms.join(', ') : 'x, discord';
    console.log(`  [${slot.day.padEnd(9)}] ${slot.time} — ${slot.label}`);
    console.log(`    Type: ${slot.type} | Platforms: ${platforms}`);
    console.log('');
  });

  console.log('  Next 4 weeks of campaigns:\n');

  for (let week = 0; week < 4; week++) {
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() + (week * 7));
    const startStr = weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    console.log(`  Week ${week + 1} (starting ${startStr}):`);

    SCHEDULE_SLOTS.forEach(slot => {
      console.log(`    • ${slot.day} ${slot.time}: ${slot.label} [${slot.type}]`);
    });
    console.log('');
  }

  console.log('  Set DISCORD_WEBHOOK_URL env var for automatic posting.');
  console.log('  Run with --campaign [type] to generate specific content.\n');
}

// ═══ Performance Tracking ════════════════════════════════════════════

function trackCampaignMetrics(campaignId, data) {
  const metricsDir = path.join(ROOT, 'community', 'campaigns', 'metrics');
  if (!fs.existsSync(metricsDir)) fs.mkdirSync(metricsDir, { recursive: true });

  const metricsFile = path.join(metricsDir, 'campaign-metrics.json');
  let metrics = { campaigns: [], summary: {} };

  if (fs.existsSync(metricsFile)) {
    try {
      metrics = JSON.parse(fs.readFileSync(metricsFile, 'utf-8'));
    } catch (_) { /* start fresh */ }
  }

  const entry = {
    id: campaignId,
    ...data,
    impressionsEstimate: estimateImpressions(data.type),
    engagementEstimate: estimateEngagement(data.type),
  };

  metrics.campaigns.push(entry);
  metrics.summary = computeSummary(metrics.campaigns);
  metrics.lastUpdated = new Date().toISOString();

  fs.writeFileSync(metricsFile, JSON.stringify(metrics, null, 2));
}

function estimateImpressions(type) {
  const baselines = {
    partner: { min: 5000, max: 25000 },
    tvl: { min: 10000, max: 50000 },
    launch: { min: 3000, max: 15000 },
    governance: { min: 2000, max: 8000 },
    mainnet: { min: 20000, max: 100000 },
  };
  const range = baselines[type] || { min: 1000, max: 5000 };
  return `${(range.min / 1000).toFixed(0)}K-${(range.max / 1000).toFixed(0)}K`;
}

function estimateEngagement(type) {
  const rates = {
    partner: '3-5%',
    tvl: '4-7%',
    launch: '3-6%',
    governance: '5-8%',
    mainnet: '6-10%',
  };
  return rates[type] || '2-4%';
}

function computeSummary(campaigns) {
  const byType = {};
  campaigns.forEach(c => {
    if (!byType[c.type]) byType[c.type] = 0;
    byType[c.type]++;
  });

  return {
    totalCampaigns: campaigns.length,
    byType,
    totalTweets: campaigns.reduce((sum, c) => sum + (c.tweets || 0), 0),
    platforms: [...new Set(campaigns.flatMap(c => c.platforms || []))],
  };
}

function showMetrics() {
  const metricsFile = path.join(ROOT, 'community', 'campaigns', 'metrics', 'campaign-metrics.json');

  console.log('\n  ════════════════════════════════════════════════');
  console.log('  Campaign Performance Metrics');
  console.log('  ════════════════════════════════════════════════\n');

  if (!fs.existsSync(metricsFile)) {
    console.log('  No campaigns tracked yet. Run a campaign first:\n');
    console.log('    node community/campaign-automation.cjs --campaign partner --partner almanak\n');
    return;
  }

  const metrics = JSON.parse(fs.readFileSync(metricsFile, 'utf-8'));

  console.log('  Summary:');
  console.log(`    Total campaigns: ${metrics.summary.totalCampaigns}`);
  console.log(`    Total tweets generated: ${metrics.summary.totalTweets}`);
  console.log(`    Platforms: ${(metrics.summary.platforms || []).join(', ')}`);
  console.log('');

  if (metrics.summary.byType) {
    console.log('  By Type:');
    for (const [type, count] of Object.entries(metrics.summary.byType)) {
      console.log(`    ${type.padEnd(15)} ${count} campaign(s)`);
    }
    console.log('');
  }

  console.log('  Recent Campaigns:');
  const recent = metrics.campaigns.slice(-10);
  recent.forEach(c => {
    console.log(`    [${c.generatedAt || 'N/A'}] ${c.id}`);
    console.log(`      Tweets: ${c.tweets} | Est. Impressions: ${c.impressionsEstimate} | Est. Engagement: ${c.engagementEstimate}`);
  });
  console.log('');

  console.log(`  Last updated: ${metrics.lastUpdated}\n`);
}

// ═══ CLI ══════════════════════════════════════════════════════════════

const args = process.argv.slice(2);

function getArg(flag) {
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : null;
}

if (args.includes('--campaign')) {
  const campaignType = getArg('--campaign');
  if (!campaignType) {
    console.error('Usage: node community/campaign-automation.cjs --campaign [partner|tvl|launch|governance|mainnet]');
    process.exit(1);
  }

  const opts = {
    partner: getArg('--partner'),
    milestone: getArg('--milestone'),
    circuit: getArg('--circuit'),
    proposal: getArg('--proposal'),
    network: getArg('--network'),
  };

  runCampaign(campaignType, opts);
} else if (args.includes('--schedule')) {
  showSchedule();
} else if (args.includes('--metrics')) {
  showMetrics();
} else {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  XFuel Protocol — Campaign Automation                    ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  console.log('  Available campaigns:');
  for (const [key, tmpl] of Object.entries(TEMPLATES)) {
    console.log(`    ${key.padEnd(12)} ${tmpl.id} (${tmpl.platforms.join(', ')})`);
  }
  console.log('');
  console.log('  Usage:');
  console.log('    --campaign partner --partner almanak     Partner announcement');
  console.log('    --campaign tvl --milestone 500M          TVL milestone');
  console.log('    --campaign launch --circuit ZKMLCircuit  Circuit launch');
  console.log('    --campaign governance --proposal XFP-003 Governance vote');
  console.log('    --campaign mainnet --network Theta       Mainnet launch');
  console.log('    --schedule                               Show campaign schedule');
  console.log('    --metrics                                Show performance metrics');
  console.log('');
}
