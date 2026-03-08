/**
 * XFuel Protocol — Community Discord Bot
 *
 * Interactive Discord bot for XFuel community engagement.
 * Features:
 *   /vexf simulate  — Simulate veXF lock scenarios (amount, duration, voting power)
 *   /vexf apy       — Calculate estimated staking APY at different lock tiers
 *   /circuit info   — Display circuit details (gas costs, fees, ecosystem)
 *   /protocol stats — Show protocol-wide stats summary
 *   /fee calculate  — Calculate fee split for a given amount
 *
 * Setup:
 *   1. npm install discord.js
 *   2. Set DISCORD_TOKEN and DISCORD_CLIENT_ID in .env.local
 *   3. Run: node community/bot.js
 *
 * Per Discord.js v14:
 *   - Uses SlashCommandBuilder for interaction-based commands
 *   - GatewayIntentBits for client initialization
 *   - interaction.reply() for command responses
 *
 * veXF Model (from veXFGovernance.sol):
 *   - MIN_LOCK: 26 weeks (~6 months)
 *   - MAX_LOCK: 3 years (1095 days)
 *   - MAX_MULTIPLIER: 3x at max lock
 *   - Linear decay: multiplier = 3 * remaining / total
 *   - Voting power = amount * multiplier
 *
 * Revenue Split (from CoreRevenueSplitter.sol):
 *   - 30% Buyback-Burn (BBB)
 *   - 30% Liquidity Provision (LP)
 *   - 25% Staker Rewards (veXF)
 *   - 15% Treasury
 */

// ─── Discord.js v14 ──────────────────────────────────────────────────
// Uncomment the following line after installing discord.js:
// const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder } = require('discord.js');

// ─── veXF Simulation Engine ──────────────────────────────────────────

const VEXF_CONFIG = {
  MIN_LOCK_DAYS: 182,      // ~26 weeks
  MAX_LOCK_DAYS: 1095,     // 3 years
  MAX_MULTIPLIER: 3,
  TIERS: [
    { label: '6 months', days: 182,  multiplier: 1.0,  yieldBoost: '1x'   },
    { label: '1 year',   days: 365,  multiplier: 1.0,  yieldBoost: '1x'   },
    { label: '2 years',  days: 730,  multiplier: 2.0,  yieldBoost: '1.5x' },
    { label: '3 years',  days: 1095, multiplier: 3.0,  yieldBoost: '2x'   },
  ],
};

function simulateVeXF(amount, lockDays) {
  if (lockDays < VEXF_CONFIG.MIN_LOCK_DAYS) {
    return { error: `Minimum lock is ${VEXF_CONFIG.MIN_LOCK_DAYS} days (~6 months)` };
  }
  if (lockDays > VEXF_CONFIG.MAX_LOCK_DAYS) {
    return { error: `Maximum lock is ${VEXF_CONFIG.MAX_LOCK_DAYS} days (3 years)` };
  }

  const multiplier = VEXF_CONFIG.MAX_MULTIPLIER * (lockDays / VEXF_CONFIG.MAX_LOCK_DAYS);
  const votingPower = amount * multiplier;
  const yieldBoost = 1 + (multiplier - 1) * 0.5; // Linear interpolation

  // Decay simulation: voting power over time
  const decayPoints = [];
  for (let elapsed = 0; elapsed <= lockDays; elapsed += Math.max(Math.floor(lockDays / 6), 1)) {
    const remaining = lockDays - elapsed;
    const currentMult = VEXF_CONFIG.MAX_MULTIPLIER * (remaining / VEXF_CONFIG.MAX_LOCK_DAYS);
    const currentVP = amount * currentMult;
    decayPoints.push({ day: elapsed, votingPower: Math.round(currentVP * 100) / 100 });
  }

  return {
    amount,
    lockDays,
    multiplier: Math.round(multiplier * 100) / 100,
    votingPower: Math.round(votingPower * 100) / 100,
    yieldBoost: Math.round(yieldBoost * 100) / 100,
    decay: decayPoints,
  };
}

function calculateAPY(amount, lockDays, dailyProtocolRevenue) {
  const sim = simulateVeXF(amount, lockDays);
  if (sim.error) return sim;

  // Staker rewards = 25% of protocol revenue
  const dailyStakerRewards = dailyProtocolRevenue * 0.25;
  // Assume user has some share of total veXF (simplistic: 1% of total)
  const userSharePct = 1;
  const dailyUserRewards = dailyStakerRewards * (userSharePct / 100);
  const annualRewards = dailyUserRewards * 365;
  const apy = (annualRewards / amount) * 100;

  return {
    ...sim,
    dailyProtocolRevenue,
    dailyStakerRewards: Math.round(dailyStakerRewards * 100) / 100,
    estimatedAPY: Math.round(apy * 100) / 100,
    note: `Assumes ${userSharePct}% share of total veXF pool`,
  };
}

// ─── Fee Calculator ──────────────────────────────────────────────────

function calculateFeeSplit(totalFee) {
  return {
    total: totalFee,
    bbb:      Math.round(totalFee * 0.30 * 100) / 100,
    lp:       Math.round(totalFee * 0.30 * 100) / 100,
    stakers:  Math.round(totalFee * 0.25 * 100) / 100,
    treasury: Math.round(totalFee * 0.15 * 100) / 100,
  };
}

// ─── Circuit Database ────────────────────────────────────────────────

const CIRCUITS = {
  'tao-evm':          { name: 'TAO EVM',          ecosystem: 'Bittensor',    fee: '0.5%',  settleGas: '~68K',  deployGas: '~2.1M', purpose: 'AI marketplace, subnet inference routing' },
  'a2a':              { name: 'A2A',               ecosystem: 'Cross-chain',  fee: '0.1-0.5%', settleGas: '~71K', deployGas: '~2.2M', purpose: 'ZK agent communication, bidding, micropayments' },
  'theta-gpu':        { name: 'Theta GPU',         ecosystem: 'Theta',        fee: '0.5%',  settleGas: '~70K',  deployGas: '~2.3M', purpose: 'EdgeCloud GPU inference routing' },
  'zkml':             { name: 'zkML',              ecosystem: 'Universal',    fee: '0.75%', settleGas: '~82K',  deployGas: '~2.4M', purpose: 'Private model inference with weight privacy' },
  'akash':            { name: 'Akash',             ecosystem: 'Akash',        fee: '0.5%',  settleGas: '~85K',  deployGas: '~2.5M', purpose: 'DePIN GPU leasing via reverse auction' },
  'vaults':           { name: 'Autonomous Vaults', ecosystem: 'DeFi',         fee: '0.5%',  settleGas: '~292K', deployGas: '~2.6M', purpose: 'AI-driven yield strategies with ZK rebalancing' },
  'robotics':         { name: 'Agent Robotics',    ecosystem: 'Robotics',     fee: '1%',    settleGas: '~95K',  deployGas: '~2.5M', purpose: 'Sim-to-real trajectory verification' },
  'data-hubs':        { name: 'Data Hubs',         ecosystem: 'Vana/Grass',   fee: '0.5%',  settleGas: '~136K', deployGas: '~2.3M', purpose: 'Decentralized data DAOs with ZK provenance' },
  'yield':            { name: 'Yield Optimization',ecosystem: 'Osmosis',      fee: '0.5%',  settleGas: '~226K', deployGas: '~2.2M', purpose: 'Multi-pool CL-aware yield rebalancing' },
  'near-agents':      { name: 'NEAR Agents',       ecosystem: 'NEAR',         fee: '0.5%',  settleGas: '~200K', deployGas: '~2.4M', purpose: 'Autonomous agents with chain abstraction' },
  'solana-ai-bridge': { name: 'Solana AI Bridge',  ecosystem: 'Solana',       fee: '0.75%', settleGas: '~327K', deployGas: '~2.1M', purpose: 'Bridge to Render/io.net/Grass/SendAI' },
};

// ─── Formatters ──────────────────────────────────────────────────────

function formatVeXFEmbed(sim) {
  if (sim.error) return { content: `Error: ${sim.error}` };

  const decayStr = sim.decay
    .slice(0, 7)
    .map(d => `Day ${String(d.day).padStart(4)}: ${d.votingPower.toLocaleString()} veXF`)
    .join('\n');

  return {
    title: 'veXF Lock Simulation',
    color: 0x7C3AED,
    fields: [
      { name: 'Lock Amount',   value: `${sim.amount.toLocaleString()} XF`, inline: true },
      { name: 'Lock Duration', value: `${sim.lockDays} days`,              inline: true },
      { name: 'Multiplier',    value: `${sim.multiplier}x`,                inline: true },
      { name: 'Voting Power',  value: `${sim.votingPower.toLocaleString()} veXF`, inline: true },
      { name: 'Yield Boost',   value: `${sim.yieldBoost}x`,                inline: true },
      { name: 'Decay Curve',   value: `\`\`\`\n${decayStr}\n\`\`\`` },
    ],
    footer: { text: 'XFuel Protocol | veXF Governance' },
  };
}

function formatCircuitEmbed(id, c) {
  return {
    title: `Circuit: ${c.name}`,
    color: 0x10B981,
    fields: [
      { name: 'Ecosystem',   value: c.ecosystem,  inline: true },
      { name: 'Protocol Fee', value: c.fee,        inline: true },
      { name: 'Settle Gas',  value: c.settleGas,   inline: true },
      { name: 'Deploy Gas',  value: c.deployGas,   inline: true },
      { name: 'Purpose',     value: c.purpose },
    ],
    footer: { text: `Circuit ID: ${id}` },
  };
}

function formatFeeSplitEmbed(split) {
  return {
    title: 'Fee Split Calculator',
    color: 0xF59E0B,
    fields: [
      { name: 'Total Fee',   value: `$${split.total.toLocaleString()}` },
      { name: 'Buyback-Burn (30%)', value: `$${split.bbb.toLocaleString()}`,      inline: true },
      { name: 'Liquidity (30%)',    value: `$${split.lp.toLocaleString()}`,        inline: true },
      { name: 'Stakers (25%)',      value: `$${split.stakers.toLocaleString()}`,   inline: true },
      { name: 'Treasury (15%)',     value: `$${split.treasury.toLocaleString()}`,  inline: true },
    ],
    footer: { text: 'XFuel Protocol | CoreRevenueSplitter (30/30/25/15)' },
  };
}

// ─── Slash Command Definitions ───────────────────────────────────────

const COMMANDS = [
  {
    name: 'vexf',
    description: 'veXF governance simulator',
    options: [
      {
        name: 'simulate',
        description: 'Simulate a veXF lock (voting power, multiplier, decay curve)',
        type: 1, // SUB_COMMAND
        options: [
          { name: 'amount',   description: 'XF tokens to lock',     type: 10, required: true }, // NUMBER
          { name: 'days',     description: 'Lock duration in days (182-1095)', type: 4, required: true }, // INTEGER
        ],
      },
      {
        name: 'apy',
        description: 'Estimate staking APY for a veXF lock',
        type: 1,
        options: [
          { name: 'amount',  description: 'XF tokens to lock',               type: 10, required: true },
          { name: 'days',    description: 'Lock duration in days (182-1095)', type: 4,  required: true },
          { name: 'revenue', description: 'Daily protocol revenue in USD',    type: 10, required: false },
        ],
      },
      {
        name: 'tiers',
        description: 'Show all veXF lock tiers and multipliers',
        type: 1,
      },
    ],
  },
  {
    name: 'circuit',
    description: 'Circuit information',
    options: [
      {
        name: 'info',
        description: 'Show details about a specific circuit',
        type: 1,
        options: [
          {
            name: 'name', description: 'Circuit identifier', type: 3, required: true,
            choices: Object.keys(CIRCUITS).map(k => ({ name: CIRCUITS[k].name, value: k })),
          },
        ],
      },
      {
        name: 'list',
        description: 'List all 11 circuits',
        type: 1,
      },
    ],
  },
  {
    name: 'fee',
    description: 'Fee split calculator',
    options: [
      {
        name: 'calculate',
        description: 'Calculate fee distribution for a given amount',
        type: 1,
        options: [
          { name: 'amount', description: 'Total fee amount in USD', type: 10, required: true },
        ],
      },
    ],
  },
  {
    name: 'protocol',
    description: 'Protocol summary stats',
    options: [
      {
        name: 'stats',
        description: 'Show XFuel Protocol overview stats',
        type: 1,
      },
    ],
  },
];

// ─── Command Handlers ────────────────────────────────────────────────

function handleVeXF(subcommand, options) {
  if (subcommand === 'simulate') {
    const amount = options.get('amount').value;
    const days = options.get('days').value;
    const sim = simulateVeXF(amount, days);
    return formatVeXFEmbed(sim);
  }

  if (subcommand === 'apy') {
    const amount = options.get('amount').value;
    const days = options.get('days').value;
    const revenue = options.get('revenue')?.value || 10000;
    const result = calculateAPY(amount, days, revenue);
    if (result.error) return { content: `Error: ${result.error}` };
    const embed = formatVeXFEmbed(result);
    embed.fields.push(
      { name: 'Est. APY', value: `${result.estimatedAPY}%`, inline: true },
      { name: 'Daily Staker Pool', value: `$${result.dailyStakerRewards}`, inline: true },
    );
    embed.title = 'veXF APY Estimator';
    return embed;
  }

  if (subcommand === 'tiers') {
    const tiersStr = VEXF_CONFIG.TIERS.map(t =>
      `**${t.label}** — ${t.multiplier}x multiplier, ${t.yieldBoost} yield boost`
    ).join('\n');
    return {
      title: 'veXF Lock Tiers',
      color: 0x7C3AED,
      description: tiersStr + '\n\n*Multiplier decays linearly over time. Max 3x at 3-year lock.*',
      footer: { text: 'XFuel Protocol | veXFGovernance.sol' },
    };
  }
}

function handleCircuit(subcommand, options) {
  if (subcommand === 'info') {
    const id = options.get('name').value;
    const c = CIRCUITS[id];
    if (!c) return { content: `Unknown circuit: ${id}` };
    return formatCircuitEmbed(id, c);
  }

  if (subcommand === 'list') {
    const list = Object.entries(CIRCUITS)
      .map(([id, c]) => `**${c.name}** (${c.ecosystem}) — ${c.fee} fee, ${c.settleGas} gas`)
      .join('\n');
    return {
      title: 'XFuel Circuits (11)',
      color: 0x10B981,
      description: list,
      footer: { text: 'Each circuit is fully isolated — own state, events, pause, roles' },
    };
  }
}

function handleFee(subcommand, options) {
  if (subcommand === 'calculate') {
    const amount = options.get('amount').value;
    const split = calculateFeeSplit(amount);
    return formatFeeSplitEmbed(split);
  }
}

function handleProtocol(subcommand) {
  if (subcommand === 'stats') {
    return {
      title: 'XFuel Protocol — Overview',
      color: 0x3B82F6,
      fields: [
        { name: 'Circuits',        value: '11 (3 priority + 8 expansion)', inline: true },
        { name: 'Total Tests',     value: '224+',                          inline: true },
        { name: 'ZK Backend',      value: 'SP1 zkVM (Groth16)',            inline: true },
        { name: 'Settlement Gas',  value: '<100K (TAO: ~68K)',             inline: true },
        { name: 'Fee Model',       value: '30/30/25/15 split',            inline: true },
        { name: 'Governance',      value: 'veXF vote-escrowed',           inline: true },
        { name: 'Ecosystems', value: 'Bittensor, Theta, Solana, NEAR, Akash, Osmosis, Vana, Grass' },
        { name: 'Links', value: '[Website](https://xfuel.app) | [GitHub](https://github.com/XFuel-Lab/xfuel-protocol) | [Whitepaper](WHITEPAPER_v1.6_CORE.md)' },
      ],
      footer: { text: 'Pumping intelligence across AI ecosystems' },
    };
  }
}

// ─── Bot Initialization ──────────────────────────────────────────────

async function startBot() {
  // Dynamic import for ESM/CJS compatibility
  let discord;
  try {
    discord = require('discord.js');
  } catch (e) {
    console.log('Discord.js not installed. Install with: npm install discord.js');
    console.log('Running in simulation mode...\n');
    runSimulationMode();
    return;
  }

  const { Client, GatewayIntentBits, REST, Routes } = discord;

  const TOKEN = process.env.DISCORD_TOKEN;
  const CLIENT_ID = process.env.DISCORD_CLIENT_ID;

  if (!TOKEN || !CLIENT_ID) {
    console.log('Missing DISCORD_TOKEN or DISCORD_CLIENT_ID in .env.local');
    console.log('Running in simulation mode...\n');
    runSimulationMode();
    return;
  }

  // Register slash commands
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  try {
    console.log('Registering slash commands...');
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: COMMANDS });
    console.log('Slash commands registered.');
  } catch (e) {
    console.error('Failed to register commands:', e.message);
  }

  // Create client
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.on('ready', () => {
    console.log(`Bot logged in as ${client.user.tag}`);
    console.log(`Serving ${Object.keys(CIRCUITS).length} circuits across ${client.guilds.cache.size} servers`);
  });

  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;
    const sub = interaction.options.getSubcommand();

    let response;
    try {
      switch (commandName) {
        case 'vexf':    response = handleVeXF(sub, interaction.options);     break;
        case 'circuit': response = handleCircuit(sub, interaction.options);   break;
        case 'fee':     response = handleFee(sub, interaction.options);       break;
        case 'protocol': response = handleProtocol(sub);                     break;
        default: response = { content: 'Unknown command' };
      }
    } catch (e) {
      response = { content: `Error: ${e.message}` };
    }

    if (response.content) {
      await interaction.reply({ content: response.content, ephemeral: true });
    } else {
      const embed = new discord.EmbedBuilder()
        .setTitle(response.title)
        .setColor(response.color || 0x7C3AED);
      if (response.description) embed.setDescription(response.description);
      if (response.fields) response.fields.forEach(f => embed.addFields(f));
      if (response.footer) embed.setFooter(response.footer);
      await interaction.reply({ embeds: [embed] });
    }
  });

  await client.login(TOKEN);
}

// ─── Simulation Mode (no Discord token) ─────────────────────────────

function runSimulationMode() {
  console.log('═══ XFuel Discord Bot — Simulation Mode ═══\n');

  // veXF simulation
  console.log('▶ /vexf simulate amount:10000 days:730');
  const sim = simulateVeXF(10000, 730);
  console.log(`  Lock: ${sim.amount} XF for ${sim.lockDays} days`);
  console.log(`  Multiplier: ${sim.multiplier}x → Voting Power: ${sim.votingPower} veXF`);
  console.log(`  Yield Boost: ${sim.yieldBoost}x`);
  console.log(`  Decay curve:`);
  sim.decay.forEach(d => console.log(`    Day ${String(d.day).padStart(4)}: ${d.votingPower.toLocaleString()} veXF`));

  // APY estimation
  console.log('\n▶ /vexf apy amount:50000 days:1095 revenue:25000');
  const apy = calculateAPY(50000, 1095, 25000);
  console.log(`  Est. APY: ${apy.estimatedAPY}% (at 1% pool share)`);
  console.log(`  Daily staker rewards pool: $${apy.dailyStakerRewards}`);

  // Tiers
  console.log('\n▶ /vexf tiers');
  VEXF_CONFIG.TIERS.forEach(t => console.log(`  ${t.label}: ${t.multiplier}x multiplier, ${t.yieldBoost} yield boost`));

  // Fee split
  console.log('\n▶ /fee calculate amount:100000');
  const split = calculateFeeSplit(100000);
  console.log(`  BBB: $${split.bbb} | LP: $${split.lp} | Stakers: $${split.stakers} | Treasury: $${split.treasury}`);

  // Circuit info
  console.log('\n▶ /circuit info name:solana-ai-bridge');
  const c = CIRCUITS['solana-ai-bridge'];
  console.log(`  ${c.name} (${c.ecosystem}) — ${c.fee} fee, ${c.settleGas} settle gas`);
  console.log(`  Purpose: ${c.purpose}`);

  // Protocol stats
  console.log('\n▶ /protocol stats');
  console.log('  11 circuits | 224+ tests | SP1 zkVM | <100K gas | 30/30/25/15 split');

  console.log('\n═══ Simulation complete. Set DISCORD_TOKEN to run live. ═══');
}

// ─── Exports ─────────────────────────────────────────────────────────

module.exports = {
  simulateVeXF, calculateAPY, calculateFeeSplit,
  CIRCUITS, VEXF_CONFIG, COMMANDS,
  handleVeXF, handleCircuit, handleFee, handleProtocol,
  formatVeXFEmbed, formatCircuitEmbed, formatFeeSplitEmbed,
};

// Run if executed directly
if (require.main === module) {
  startBot().catch(console.error);
}
