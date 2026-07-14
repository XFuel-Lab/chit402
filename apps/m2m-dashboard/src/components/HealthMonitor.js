import React, { useState, useCallback } from 'react';
import {
  Box, Card, CardContent, Typography, Grid, Chip, Alert,
  CircularProgress, Button, Table, TableBody, TableCell,
  TableRow, Divider, Switch, FormControlLabel,
} from '@mui/material';
import MonitorHeartIcon from '@mui/icons-material/MonitorHeart';
import RefreshIcon from '@mui/icons-material/Refresh';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import { useApi } from '../context/ApiContext';
import { getHealth } from '../utils/api';
import usePoller from '../hooks/usePoller';

export default function HealthMonitor() {
  const { client } = useApi();

  const [health, setHealth] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(null);

  const fetchHealth = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getHealth(client);
      setHealth(data);
      setLastUpdate(new Date());
    } catch (err) {
      setError(err.message || 'Failed to reach health endpoint');
    } finally {
      setLoading(false);
    }
  }, [client]);

  // Auto-poll every 10s
  usePoller(fetchHealth, 10000, autoRefresh);

  const isHealthy = health?.status === 'ok';

  return (
    <Box>
      <Typography variant="body2" sx={{ mb: 2 }}>
        Monitor M2M API server health, uptime, fee configuration, and AI listener status.
      </Typography>

      {/* Controls */}
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', mb: 3 }}>
        <Button
          variant="outlined"
          startIcon={loading ? <CircularProgress size={18} /> : <RefreshIcon />}
          onClick={fetchHealth}
          disabled={loading}
        >
          Refresh
        </Button>
        <FormControlLabel
          control={<Switch checked={autoRefresh} onChange={() => setAutoRefresh(!autoRefresh)} color="primary" />}
          label={<Typography variant="caption">Auto-refresh (10s)</Typography>}
        />
        {lastUpdate && (
          <Typography variant="caption" sx={{ color: '#9ca3af' }}>
            Last: {lastUpdate.toLocaleTimeString()}
          </Typography>
        )}
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {health && (
        <Grid container spacing={3}>
          {/* Status Card */}
          <Grid item xs={12} sm={6} md={3}>
            <Card>
              <CardContent sx={{ textAlign: 'center' }}>
                {isHealthy ? (
                  <CheckCircleIcon sx={{ fontSize: 48, color: 'success.main' }} />
                ) : (
                  <ErrorIcon sx={{ fontSize: 48, color: 'error.main' }} />
                )}
                <Typography variant="h6" sx={{ mt: 1 }}>
                  {health.status?.toUpperCase()}
                </Typography>
                <Typography variant="caption" sx={{ color: '#9ca3af' }}>
                  {health.server} v{health.version}
                </Typography>
              </CardContent>
            </Card>
          </Grid>

          {/* Uptime */}
          <Grid item xs={12} sm={6} md={3}>
            <Card>
              <CardContent sx={{ textAlign: 'center' }}>
                <Typography variant="h4" sx={{ color: 'primary.main', fontWeight: 700 }}>
                  {formatUptime(health.uptime_s)}
                </Typography>
                <Typography variant="caption" sx={{ color: '#9ca3af' }}>Uptime</Typography>
              </CardContent>
            </Card>
          </Grid>

          {/* A2A Messages */}
          <Grid item xs={12} sm={6} md={3}>
            <Card>
              <CardContent sx={{ textAlign: 'center' }}>
                <Typography variant="h4" sx={{ color: 'secondary.main', fontWeight: 700 }}>
                  {health.a2a_messages_total ?? 0}
                </Typography>
                <Typography variant="caption" sx={{ color: '#9ca3af' }}>A2A Messages (total)</Typography>
              </CardContent>
            </Card>
          </Grid>

          {/* Timestamp */}
          <Grid item xs={12} sm={6} md={3}>
            <Card>
              <CardContent sx={{ textAlign: 'center' }}>
                <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 11, color: '#e0e0e0' }}>
                  {health.timestamp}
                </Typography>
                <Typography variant="caption" sx={{ color: '#9ca3af' }}>Server Time</Typography>
              </CardContent>
            </Card>
          </Grid>

          {/* Fee Configuration */}
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="subtitle2" gutterBottom sx={{ color: 'primary.main' }}>
                  Fee Configuration
                </Typography>
                {health.fee_config && (
                  <Table size="small">
                    <TableBody>
                      {Object.entries(health.fee_config).map(([key, val]) => (
                        <TableRow key={key}>
                          <TableCell sx={{ color: '#9ca3af', borderColor: 'rgba(0,229,255,0.06)', py: 0.5, fontSize: 12 }}>
                            {key.replace(/_/g, ' ')}
                          </TableCell>
                          <TableCell sx={{ borderColor: 'rgba(0,229,255,0.06)', py: 0.5, fontSize: 12, fontFamily: 'monospace' }}>
                            {String(val)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </Grid>

          {/* Chains & Message Types */}
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="subtitle2" gutterBottom sx={{ color: 'primary.main' }}>
                  Supported Chains
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 2 }}>
                  {(health.chains || []).map((c) => (
                    <Chip key={c} size="small" label={c} color="primary" variant="outlined" />
                  ))}
                </Box>

                <Typography variant="subtitle2" gutterBottom sx={{ color: 'secondary.main' }}>
                  Message Types
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                  {(health.message_types || []).map((mt) => (
                    <Chip key={mt} size="small" label={mt} color="secondary" variant="outlined" />
                  ))}
                </Box>
              </CardContent>
            </Card>
          </Grid>

          {/* AI Listener Status */}
          {health.ai_listener && (
            <Grid item xs={12}>
              <Card>
                <CardContent>
                  <Typography variant="subtitle2" gutterBottom sx={{ color: 'primary.main' }}>
                    AI Listener Status
                  </Typography>
                  <Table size="small">
                    <TableBody>
                      {Object.entries(flattenObject(health.ai_listener)).map(([key, val]) => (
                        <TableRow key={key}>
                          <TableCell sx={{ color: '#9ca3af', borderColor: 'rgba(0,229,255,0.06)', py: 0.5, fontSize: 12 }}>
                            {key}
                          </TableCell>
                          <TableCell
                            sx={{
                              borderColor: 'rgba(0,229,255,0.06)', py: 0.5, fontSize: 12,
                              fontFamily: 'monospace', wordBreak: 'break-all',
                            }}
                          >
                            {String(val)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </Grid>
          )}
        </Grid>
      )}
    </Box>
  );
}

/** Format seconds into human-readable uptime */
function formatUptime(seconds) {
  if (!seconds && seconds !== 0) return '--';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** Flatten nested object for table display */
function flattenObject(obj, prefix = '') {
  const result = {};
  for (const [key, val] of Object.entries(obj || {})) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      Object.assign(result, flattenObject(val, fullKey));
    } else {
      result[fullKey] = val;
    }
  }
  return result;
}
