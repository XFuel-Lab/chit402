/**
 * What does Theta actually publish about price? Throwaway probe.
 */
import 'dotenv/config';

const base = (process.env.THETA_EDGECLOUD_BASE || 'https://ondemand.thetaedgecloud.com').replace(/\/$/, '');
const res = await fetch(`${base}/service/list`, { headers: { Accept: 'application/json' } });
if (!res.ok) {
  console.error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  process.exit(1);
}
const data = await res.json();
const services = data?.body?.services || data?.services || [];
console.log(`${services.length} services\n`);

for (const svc of services) {
  const predName = svc.default_prediction || Object.keys(svc.predictions || {})[0];
  const pred = svc.predictions?.[predName] || {};
  console.log(`── ${svc.alias}  (${predName})  tier=${pred.external_price_tier}`);
  console.log(`   cost:     ${JSON.stringify(pred.cost)}  divisor=${pred.cost_divisor}`);
  console.log(`   units:    ${pred.instructions || '(none)'}`);
  if (pred.cost_multipliers || pred.variant_costs) {
    console.log(`   mult:     ${JSON.stringify(pred.cost_multipliers)} variants=${JSON.stringify(pred.variant_costs)}`);
  }
}

// Full dump of one chat model so nothing price-shaped is missed.
const chat = services.find((s) => ['qwen3', 'glm_5_2'].includes(s.alias)) || services[0];
if (chat) {
  console.log(`\n═══ full record: ${chat.alias} ═══`);
  console.log(JSON.stringify(chat, null, 2).slice(0, 2500));
}
