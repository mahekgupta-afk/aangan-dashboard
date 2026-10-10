// Case 03: average project value cited as Rs 8-14 lakh; use the midpoint.
const AVG_PROJECT_VALUE_INR = 1100000;

async function fetchAllCalls(supabaseUrl, serviceKey) {
  const res = await fetch(
    `${supabaseUrl}/rest/v1/calls?select=*&order=created_at.desc&limit=1000`,
    {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
    }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase error ${res.status}: ${body}`);
  }
  return res.json();
}

module.exports = async (req, res) => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  try {
    const calls = await fetchAllCalls(supabaseUrl, serviceKey);

    const totalCalls = calls.length;
    const qualifiedCalls = calls.filter((c) => c.qualified_status === 'Qualified');
    const needsReviewCalls = calls.filter((c) => c.qualified_status === 'Needs Review');
    const declinedCalls = calls.filter((c) => c.qualified_status === 'Declined');
    const bookedCalls = calls.filter((c) => c.consultation_booked);

    const qualifiedCount = qualifiedCalls.length;
    const qualifiedRate = totalCalls ? qualifiedCount / totalCalls : 0;
    const bookedCount = bookedCalls.length;
    const pipelineValueInr = qualifiedCount * AVG_PROJECT_VALUE_INR;

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
      const day = (c.created_at || '').slice(0, 10);
      if (day in byDay) byDay[day] += 1;
    });
    const callsPerDay = days.map((d) => ({ date: d, count: byDay[d] }));

    const recentCalls = calls.slice(0, 10).map((c) => ({
      id: c.id,
      created_at: c.created_at,
      caller_name: c.caller_name,
      project_type: c.project_type,
      location: c.location,
      qualified_status: c.qualified_status,
      consultation_booked: c.consultation_booked,
      consultation_datetime: c.consultation_datetime,
    }));

    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=30');
    return res.status(200).json({
      totalCalls,
      qualifiedCount,
      qualifiedRate,
      needsReviewCount: needsReviewCalls.length,
      declinedCount: declinedCalls.length,
      bookedCount,
      pipelineValueInr,
      avgProjectValueInr: AVG_PROJECT_VALUE_INR,
      callsPerDay,
      recentCalls,
      isSampleData: false,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
