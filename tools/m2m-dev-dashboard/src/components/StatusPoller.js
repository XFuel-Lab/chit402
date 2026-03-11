import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  Box, Card, CardContent, Typography, TextField, Button, Alert,
  CircularProgress, Divider, Chip, Grid, Switch, FormControlLabel,
  Table, TableBody, TableCell, TableRow, LinearProgress,
} from '@mui/material';
import PollIcon from '@mui/icons-material/Poll';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useApi } from '../context/ApiContext';
import { getTaskStatus, getProveResult } from '../utils/api';

const PROOF_OUTCOME_COLORS = {
  valid: 'success',
  regenerable: 'warning',
  invalid: 'error',
  pending: 'default',
};

const POLL_INTERVAL = parseInt(process.env.REACT_APP_POLL_INTERVAL) || 5000;

export default function StatusPoller() {
  const { client } = useApi();

  const [queryType, setQueryType] = useState('task'); // 'task' | 'a2a'
  const [queryId, setQueryId] = useState('');
  const [statusData, setStatusData] = useState(null);
  const [proofData, setProofData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [polling, setPolling] = useState(false);
  const [pollCount, setPollCount] = useState(0);

  const pollRef = useRef(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const fetchStatus = useCallback(async () => {
    if (!queryId.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const params = queryType === 'task'
        ? { taskId: queryId.trim() }
        : { messageId: queryId.trim() };

      const data = await getTaskStatus(client, params);
      setStatusData(data);
      setPollCount((c) => c + 1);

      // Also try to fetch proof if task is completed
      if (queryType === 'task' && ['completed', 'fee_collected'].includes(data.status)) {
        try {
          const proof = await getProveResult(client, queryId.trim());
          setProofData(proof);
        } catch {
          // proof not available yet
        }
      }
    } catch (err) {
      const detail = err.response?.data;
      setError(detail?.message || err.message || 'Query failed');
      setStatusData(null);
    } finally {
      setLoading(false);
    }
  }, [client, queryId, queryType]);

  const togglePolling = () => {
    if (polling) {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
      setPolling(false);
    } else {
      fetchStatus();
      pollRef.current = setInterval(fetchStatus, POLL_INTERVAL);
      setPolling(true);
    }
  };

  const stopPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
    setPolling(false);
  };

  return (
    <Box>
      <Typography variant="body2" sx={{ mb: 2 }}>
        Query task or A2A message status. Supports real-time polling for ProofOutcome updates.
      </Typography>

      <Grid container spacing={3}>
        {/* Query Form */}
        <Grid item xs={12} md={5}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <PollIcon color="primary" /> Status Query
              </Typography>

              <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
                <Button
                  size="small"
                  variant={queryType === 'task' ? 'contained' : 'outlined'}
                  onClick={() => { setQueryType('task'); stopPolling(); setStatusData(null); setProofData(null); }}
                >
                  Task
                </Button>
                <Button
                  size="small"
                  variant={queryType === 'a2a' ? 'contained' : 'outlined'}
                  onClick={() => { setQueryType('a2a'); stopPolling(); setStatusData(null); setProofData(null); }}
                >
                  A2A Message
                </Button>
              </Box>

              <TextField
                fullWidth
                label={queryType === 'task' ? 'Task ID' : 'Message ID'}
                value={queryId}
                onChange={(e) => setQueryId(e.target.value)}
                placeholder={queryType === 'task' ? 'm2m-task-1-...' : 'a2a-...'}
                sx={{ mb: 2 }}
              />

              <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                <Button
                  variant="contained"
                  startIcon={loading ? <CircularProgress size={18} /> : <RefreshIcon />}
                  onClick={fetchStatus}
                  disabled={loading || !queryId.trim()}
                >
                  Query
                </Button>
                <FormControlLabel
                  control={
                    <Switch
                      checked={polling}
                      onChange={togglePolling}
                      color="primary"
                      disabled={!queryId.trim()}
                    />
                  }
                  label={
                    <Typography variant="caption">
                      Auto-poll ({POLL_INTERVAL / 1000}s)
                    </Typography>
                  }
                />
              </Box>

              {polling && (
                <Box sx={{ mt: 2 }}>
                  <LinearProgress color="primary" />
                  <Typography variant="caption" sx={{ color: '#9ca3af' }}>
                    Polls: {pollCount}
                  </Typography>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Results */}
        <Grid item xs={12} md={7}>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>
          )}

          {statusData && (
            <Card sx={{ mb: 2 }}>
              <CardContent>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                  <Typography variant="subtitle2" sx={{ color: 'primary.main' }}>
                    {queryType === 'task' ? 'Task Status' : 'A2A Message Status'}
                  </Typography>
                  <Chip
                    size="small"
                    label={statusData.proof_outcome || statusData.status}
                    color={PROOF_OUTCOME_COLORS[statusData.proof_outcome] || 'default'}
                  />
                </Box>

                <Table size="small">
                  <TableBody>
                    {Object.entries(statusData).map(([key, val]) => {
                      if (val === null || val === undefined || typeof val === 'object') return null;
                      return (
                        <TableRow key={key}>
                          <TableCell sx={{ color: '#9ca3af', borderColor: 'rgba(0,229,255,0.06)', py: 0.5, fontSize: 12 }}>
                            {key}
                          </TableCell>
                          <TableCell
                            sx={{
                              color: '#e0e0e0', borderColor: 'rgba(0,229,255,0.06)',
                              py: 0.5, fontSize: 12, fontFamily: 'monospace', wordBreak: 'break-all',
                            }}
                          >
                            {String(val)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>

                {/* SP1 Proof sub-section */}
                {statusData.sp1_proof && (
                  <Box sx={{ mt: 1 }}>
                    <Divider sx={{ my: 1 }} />
                    <Typography variant="caption" sx={{ color: 'secondary.main', fontWeight: 600 }}>
                      SP1 Proof Details
                    </Typography>
                    <Table size="small">
                      <TableBody>
                        {Object.entries(statusData.sp1_proof).map(([key, val]) => (
                          <TableRow key={key}>
                            <TableCell sx={{ color: '#9ca3af', borderColor: 'rgba(0,229,255,0.06)', py: 0.3, fontSize: 11 }}>
                              {key}
                            </TableCell>
                            <TableCell
                              sx={{
                                color: '#e0e0e0', borderColor: 'rgba(0,229,255,0.06)',
                                py: 0.3, fontSize: 11, fontFamily: 'monospace', wordBreak: 'break-all',
                              }}
                            >
                              {String(val ?? 'null')}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </Box>
                )}
              </CardContent>
            </Card>
          )}

          {/* Proof detail (for completed tasks) */}
          {proofData && (
            <Card>
              <CardContent>
                <Typography variant="subtitle2" gutterBottom sx={{ color: 'secondary.main' }}>
                  ZK Settlement Proof
                </Typography>
                <Table size="small">
                  <TableBody>
                    <TableRow>
                      <TableCell sx={{ color: '#9ca3af', fontSize: 11, py: 0.3, borderColor: 'rgba(0,229,255,0.06)' }}>Outcome</TableCell>
                      <TableCell sx={{ fontSize: 11, py: 0.3, borderColor: 'rgba(0,229,255,0.06)' }}>
                        <Chip size="small" label={proofData.proof_outcome} color={PROOF_OUTCOME_COLORS[proofData.proof_outcome] || 'default'} />
                      </TableCell>
                    </TableRow>
                    {proofData.fee && Object.entries(proofData.fee).map(([k, v]) => {
                      if (typeof v === 'object') return null;
                      return (
                        <TableRow key={k}>
                          <TableCell sx={{ color: '#9ca3af', fontSize: 11, py: 0.3, borderColor: 'rgba(0,229,255,0.06)' }}>{k}</TableCell>
                          <TableCell sx={{ fontSize: 11, py: 0.3, fontFamily: 'monospace', borderColor: 'rgba(0,229,255,0.06)' }}>{String(v)}</TableCell>
                        </TableRow>
                      );
                    })}
                    {proofData.fee?.revenue_split && (
                      <TableRow>
                        <TableCell sx={{ color: '#9ca3af', fontSize: 11, py: 0.3, borderColor: 'rgba(0,229,255,0.06)' }}>Split</TableCell>
                        <TableCell sx={{ fontSize: 11, py: 0.3, borderColor: 'rgba(0,229,255,0.06)' }}>
                          {Object.entries(proofData.fee.revenue_split).map(([k, v]) => (
                            <Chip key={k} size="small" label={`${v} ${k}`} sx={{ mr: 0.5, mb: 0.5, fontSize: 10, height: 20 }} />
                          ))}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </Grid>
      </Grid>
    </Box>
  );
}
