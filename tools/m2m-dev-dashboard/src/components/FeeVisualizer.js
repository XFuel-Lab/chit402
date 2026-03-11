import React, { useState, useMemo } from 'react';
import {
  Box, Card, CardContent, Typography, TextField, Slider, Grid,
  Table, TableBody, TableCell, TableHead, TableRow, Divider, Chip,
} from '@mui/material';
import BarChartIcon from '@mui/icons-material/BarChart';
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { REVENUE_SPLIT, FEE_CONFIG, calculateTaskFee, calculateRelayFee } from '../utils/api';

// Simulated scenario data for chart comparisons
const SCENARIO_DATA = [
  { name: 'AI Inference\n(Akash)', gross: 1000000, feeBps: 50, type: 'ai' },
  { name: 'Compute Bid\n(TAO)', gross: 500000, feeBps: 75, type: 'ai' },
  { name: 'A2A Relay\n(250K escrow)', gross: 250000, feeBps: 10, type: 'a2a' },
  { name: 'Bridge Fwd\n(TFUEL)', gross: 2000000, feeBps: 50, type: 'bridge' },
  { name: 'Bridge Rev\n(ibcTFUEL)', gross: 1500000, feeBps: 50, type: 'bridge' },
];

const TYPE_COLORS = { ai: '#00e5ff', a2a: '#b388ff', bridge: '#69f0ae' };

export default function FeeVisualizer() {
  const [customAmount, setCustomAmount] = useState('1000000');
  const [customBps, setCustomBps] = useState(50);

  // Custom fee calculation
  const customFee = useMemo(() => {
    try {
      return calculateTaskFee(customAmount, customBps);
    } catch {
      return null;
    }
  }, [customAmount, customBps]);

  // Revenue split pie data
  const pieData = useMemo(() => {
    if (!customFee) return [];
    const feeNum = Number(customFee.feeAmount);
    return Object.values(REVENUE_SPLIT).map((s) => ({
      name: s.label,
      value: Math.round((feeNum * s.pct) / 100),
      pct: s.pct,
      color: s.color,
    }));
  }, [customFee]);

  // Scenario comparison bar chart data
  const barData = useMemo(() => {
    return SCENARIO_DATA.map((s) => {
      let feeAmt;
      if (s.type === 'a2a') {
        feeAmt = Number(calculateRelayFee(String(s.gross)));
      } else {
        const calc = calculateTaskFee(String(s.gross), s.feeBps);
        feeAmt = Number(calc.feeAmount);
      }
      return {
        name: s.name.replace('\n', ' '),
        gross: s.gross,
        fee: feeAmt,
        net: s.gross - feeAmt,
        type: s.type,
        color: TYPE_COLORS[s.type],
      };
    });
  }, []);

  // Fee comparison table
  const feeTable = useMemo(() => {
    const rows = [];
    for (let bps = FEE_CONFIG.minBps; bps <= FEE_CONFIG.maxBps; bps += 10) {
      const calc = calculateTaskFee(customAmount || '1000000', bps);
      rows.push({ bps, pct: (bps / 100).toFixed(1), ...calc });
    }
    return rows;
  }, [customAmount]);

  return (
    <Box>
      <Typography variant="body2" sx={{ mb: 2 }}>
        Visualize protocol fee breakdowns, revenue split distribution, and compare AI task fees
        vs. bridge yields across different scenarios.
      </Typography>

      <Grid container spacing={3}>
        {/* Calculator */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <BarChartIcon color="primary" /> Fee Calculator
              </Typography>

              <TextField
                fullWidth
                label="Gross Amount"
                value={customAmount}
                onChange={(e) => setCustomAmount(e.target.value)}
                sx={{ mb: 2 }}
              />

              <Typography variant="body2" gutterBottom>
                Fee Rate: {(customBps / 100).toFixed(1)}% ({customBps} BPS)
              </Typography>
              <Slider
                value={customBps}
                onChange={(_, v) => setCustomBps(v)}
                min={FEE_CONFIG.minBps}
                max={FEE_CONFIG.maxBps}
                step={5}
                marks={[
                  { value: 50, label: '0.5%' },
                  { value: 75, label: '0.75%' },
                  { value: 100, label: '1.0%' },
                ]}
                valueLabelDisplay="auto"
                valueLabelFormat={(v) => `${(v / 100).toFixed(2)}%`}
              />

              {customFee && (
                <Box sx={{ mt: 2 }}>
                  <Divider sx={{ mb: 1 }} />
                  <Row label="Gross" value={customFee.grossAmount} />
                  <Row label={`Fee (${customFee.feePct}%)`} value={customFee.feeAmount} highlight />
                  <Row label="Net to Provider" value={customFee.netAmount} />
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Pie Chart — Revenue Split */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="subtitle2" gutterBottom>
                Revenue Split (30/30/25/15)
              </Typography>
              {pieData.length > 0 && (
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={90}
                      innerRadius={50}
                      label={({ name, pct }) => `${pct}%`}
                      labelLine={false}
                    >
                      {pieData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value, name) => [value.toLocaleString(), name]}
                      contentStyle={{ backgroundColor: '#111827', border: '1px solid rgba(0,229,255,0.2)' }}
                    />
                    <Legend
                      formatter={(value) => <span style={{ color: '#9ca3af', fontSize: 12 }}>{value}</span>}
                    />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Bar Chart — Scenario Comparison */}
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Typography variant="subtitle2" gutterBottom>
                Fee Comparison: AI Tasks vs. A2A vs. Bridge
              </Typography>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={barData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="name" tick={{ fill: '#9ca3af', fontSize: 11 }} />
                  <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#111827', border: '1px solid rgba(0,229,255,0.2)' }}
                    formatter={(value) => value.toLocaleString()}
                  />
                  <Legend
                    formatter={(value) => <span style={{ color: '#9ca3af', fontSize: 12 }}>{value}</span>}
                  />
                  <Bar dataKey="net" name="Net to Provider" stackId="a" fill="#69f0ae" />
                  <Bar dataKey="fee" name="Protocol Fee" stackId="a" fill="#ffab40" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </Grid>

        {/* Fee Table — BPS Comparison */}
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Typography variant="subtitle2" gutterBottom>
                Fee Rate Comparison (amount: {Number(customAmount || 0).toLocaleString()})
              </Typography>
              <Box sx={{ overflowX: 'auto' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ color: '#9ca3af', borderColor: 'rgba(0,229,255,0.06)' }}>BPS</TableCell>
                      <TableCell sx={{ color: '#9ca3af', borderColor: 'rgba(0,229,255,0.06)' }}>Rate</TableCell>
                      <TableCell sx={{ color: '#9ca3af', borderColor: 'rgba(0,229,255,0.06)' }}>Fee</TableCell>
                      <TableCell sx={{ color: '#9ca3af', borderColor: 'rgba(0,229,255,0.06)' }}>Net</TableCell>
                      <TableCell sx={{ color: '#9ca3af', borderColor: 'rgba(0,229,255,0.06)' }}>BBB (30%)</TableCell>
                      <TableCell sx={{ color: '#9ca3af', borderColor: 'rgba(0,229,255,0.06)' }}>LP (30%)</TableCell>
                      <TableCell sx={{ color: '#9ca3af', borderColor: 'rgba(0,229,255,0.06)' }}>veXF (25%)</TableCell>
                      <TableCell sx={{ color: '#9ca3af', borderColor: 'rgba(0,229,255,0.06)' }}>Treasury (15%)</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {feeTable.map((row) => {
                      const fee = Number(row.feeAmount);
                      return (
                        <TableRow key={row.bps} sx={{ '&:hover': { bgcolor: 'rgba(0,229,255,0.04)' } }}>
                          <TableCell sx={{ borderColor: 'rgba(0,229,255,0.06)', fontSize: 12 }}>
                            <Chip size="small" label={row.bps} sx={{ fontSize: 11, height: 20 }} />
                          </TableCell>
                          <TableCell sx={{ borderColor: 'rgba(0,229,255,0.06)', fontSize: 12 }}>{row.pct}%</TableCell>
                          <TableCell sx={{ borderColor: 'rgba(0,229,255,0.06)', fontSize: 12, color: '#ffab40', fontWeight: 600 }}>
                            {fee.toLocaleString()}
                          </TableCell>
                          <TableCell sx={{ borderColor: 'rgba(0,229,255,0.06)', fontSize: 12 }}>
                            {Number(row.netAmount).toLocaleString()}
                          </TableCell>
                          <TableCell sx={{ borderColor: 'rgba(0,229,255,0.06)', fontSize: 12, color: '#ff5252' }}>
                            {Math.round(fee * 0.3).toLocaleString()}
                          </TableCell>
                          <TableCell sx={{ borderColor: 'rgba(0,229,255,0.06)', fontSize: 12, color: '#69f0ae' }}>
                            {Math.round(fee * 0.3).toLocaleString()}
                          </TableCell>
                          <TableCell sx={{ borderColor: 'rgba(0,229,255,0.06)', fontSize: 12, color: '#00e5ff' }}>
                            {Math.round(fee * 0.25).toLocaleString()}
                          </TableCell>
                          <TableCell sx={{ borderColor: 'rgba(0,229,255,0.06)', fontSize: 12, color: '#b388ff' }}>
                            {Math.round(fee * 0.15).toLocaleString()}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}

function Row({ label, value, highlight }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 0.3 }}>
      <Typography variant="body2" sx={{ color: '#9ca3af' }}>{label}</Typography>
      <Typography
        variant="body2"
        sx={{ fontWeight: highlight ? 700 : 500, color: highlight ? '#ffab40' : '#e0e0e0' }}
      >
        {Number(value).toLocaleString()}
      </Typography>
    </Box>
  );
}
