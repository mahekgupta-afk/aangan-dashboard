const VAANI_BASE = 'https://api.vaanivoice.ai/api/call-history';
const AGENT_NAME = 'aangan-phone-enquiry-agent';
// Engagement threshold: calls shorter than this are treated as hangups/misdials,
// not real enquiries, for the "engaged calls" proxy metric.
const ENGAGED_THRESHOLD_SEC = 45;
// Case 03: average project value cited as Rs 8-14 lakh; use the midpoint.
const AVG_PROJECT_VALUE_INR = 1100000;

async function fetchAllCalls(apiKey) {
  let page = 1;
  const pageSize = 200;
  let all = [];
  while (true) {
    const res = await fetch(`${VAANI_BASE}?page=${page}&page_size=${pageSize}`, {
      headers: { 'X-API-Key': apiKey },
    });
    if (!res.ok) {
      throw new Error(`Vaani API error ${res.status}`);
    }
    const json = await res.json();
    all = all.concat(json.data || []);
    if (!json.pagination?.has_next) break;
    page += 1;
    if (page > 20) break; // safety cap
  }
  return all;
}

module.exports = async (req, res) => {
  const apiKey = process.env.VAANI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'VAANI_API_KEY not configured' });
  }

  try {
    const all = await fetchAllCalls(apiKey);
    const calls = all.filter((c) => c.agent_name === AGENT_NAME);

    const totalCalls = calls.length;
    const totalCostInr = calls.reduce((sum, c) => sum + (c.call_cost || 0), 0);
    const avgCostInr = totalCalls ? totalCostInr / totalCalls : 0;

    const durationsSec = calls.map((c) => (c.duration_ms || 0) / 1000);
    const avgDurationSec = totalCalls
      ? durationsSec.reduce((a, b) => a + b, 0) / totalCalls
      : 0;

    const engagedCalls = calls.filter(
      (c) => (c.duration_ms || 0) / 1000 >= ENGAGED_THRESHOLD_SEC
    );
    const engagedCount = engagedCalls.length;
    const engagementRate = totalCalls ? engagedCount / totalCalls : 0;
    const pipelineValueInr = engagedCount * AVG_PROJECT_VALUE_INR;

    // Calls per day, last 14 days
    const days = [];
    const now = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      days.push(d.toISOString().slice(0, 10));
    }
    const byDay = Object.fromEntries(days.map((d) => [d, 0]));
    calls.forEach((c) => {
      const day = (c.Start_time || '').slice(0, 10);
      if (day in byDay) byDay[day] += 1;
    });
    const callsPerDay = days.map((d) => ({ date: d, count: byDay[d] }));

    const recentCalls = calls
      .slice()
      .sort((a, b) => new Date(b.Start_time) - new Date(a.Start_time))
      .slice(0, 10)
      .map((c) => ({
        call_id: c.call_id,
        start_time: c.Start_time,
        duration_sec: Math.round((c.duration_ms || 0) / 1000),
        cost_inr: c.call_cost || 0,
        status: c.call_status,
        caller_name: c.call_metadata?.name || c.call_entity?.name || null,
      }));

    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60');
    return res.status(200).json({
      totalCalls,
      totalCostInr,
      avgCostInr,
      avgDurationSec,
      engagedCount,
      engagementRate,
      pipelineValueInr,
      avgProjectValueInr: AVG_PROJECT_VALUE_INR,
      engagedThresholdSec: ENGAGED_THRESHOLD_SEC,
      callsPerDay,
      recentCalls,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
