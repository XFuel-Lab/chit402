import React, { useState, useCallback } from 'react';
import {
  Box, Card, CardContent, Typography, TextField, MenuItem, Button,
  Alert, CircularProgress, Divider, Chip, Grid, Paper, Collapse,
} from '@mui/material';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import CalculateIcon from '@mui/icons-material/Calculate';
import { useApi } from '../context/ApiContext';
import {
  MESSAGE_TYPES, CHAIN_IDS, FEE_CONFIG, REVENUE_SPLIT,
  calculateTaskFee, submitTaskRequest,
} from '../utils/api';

const MSG_TYPE_OPTIONS = Object.entries(MESSAGE_TYPES).map(([key, value]) => ({
  value,
  label: key.replace(/_/g, ' '),
}));

const CHAIN_OPTIONS = Object.entries(CHAIN_IDS).map(([key, value]) => ({
  value,
  label: key.charAt(0) + key.slice(1).toLowerCase(),
}));

export default function TaskSimulator() {
  const { client } = useApi();

  const [form, setForm] = useState({
    message_type: MESSAGE_TYPES.INFERENCE_REQUEST,
    chain_id: CHAIN_IDS.AKASH,
    amount: '1000000',
    sender: '0xYourAgentAddress',
    fee_bps: FEE_CONFIG.defaultBps,
    model_id: '',
    input_hash: '',
    output_hash: '',
    subnet_id: '',
    theta_recipient: '',
    max_gpu_hours: '',
    memo: '',
  });

  const [feePreview, setFeePreview] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleChange = (field) => (e) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
    setError(null);
  };

  const handlePreviewFee = useCallback(() => {
    try {
      const preview = calculateTaskFee(form.amount, Number(form.fee_bps));
      setFeePreview(preview);
    } catch (err) {
      setFeePreview(null);
      setError('Invalid amount for fee calculation');
    }
  }, [form.amount, form.fee_bps]);

  const handleSubmit = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const payload = {
        message_type: form.message_type,
        chain_id: form.chain_id,
        amount: form.amount,
        sender: form.sender,
      };
      if (form.fee_bps) payload.fee_bps = Number(form.fee_bps);
      if (form.model_id) payload.model_id = form.model_id;
      if (form.input_hash) payload.input_hash = form.input_hash;
      if (form.output_hash) payload.output_hash = form.output_hash;
      if (form.subnet_id) payload.subnet_id = Number(form.subnet_id);
      if (form.theta_recipient) payload.theta_recipient = form.theta_recipient;
      if (form.max_gpu_hours) payload.max_gpu_hours = form.max_gpu_hours;
      if (form.memo) payload.memo = form.memo;

      const data = await submitTaskRequest(client, payload);
      setResult(data);
    } catch (err) {
      const detail = err.response?.data;
      if (detail?.details) {
        setError(detail.details.join('\n'));
      } else if (detail?.message) {
        setError(detail.message);
      } else {
        setError(err.message || 'Request failed');
      }
    } finally {
      setLoading(false);
    }
  };

  // Determine conditional fields
  const needsModelId = form.message_type === MESSAGE_TYPES.INFERENCE_REQUEST;
  const needsOutputHash = form.message_type === MESSAGE_TYPES.COMPUTE_RESULT;
  const needsInputHash = [MESSAGE_TYPES.INFERENCE_REQUEST, MESSAGE_TYPES.DATA_ATTESTATION].includes(form.message_type);
  const needsSubnetId = form.chain_id === CHAIN_IDS.BITTENSOR && form.message_type !== MESSAGE_TYPES.CAPABILITY_QUERY;

  return (
    <Box>
      <Typography variant="body2" sx={{ mb: 2 }}>
        Submit AI task intents to the M2M API. Supports INFERENCE_REQUEST, COMPUTE_BID, and more
        across Akash, Bittensor (TAO), Osmosis, and Theta chains.
      </Typography>

      <Grid container spacing={3}>
        {/* Form Card */}
        <Grid item xs={12} md={7}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <RocketLaunchIcon color="primary" /> Task Request
              </Typography>

              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <TextField
                    select
                    fullWidth
                    label="Message Type"
                    value={form.message_type}
                    onChange={handleChange('message_type')}
                  >
                    {MSG_TYPE_OPTIONS.map((o) => (
                      <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
                    ))}
                  </TextField>
                </Grid>

                <Grid item xs={12} sm={6}>
                  <TextField
                    select
                    fullWidth
                    label="Chain ID"
                    value={form.chain_id}
                    onChange={handleChange('chain_id')}
                  >
                    {CHAIN_OPTIONS.map((o) => (
                      <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
                    ))}
                  </TextField>
                </Grid>

                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    label="Amount (gross)"
                    value={form.amount}
                    onChange={handleChange('amount')}
                    helperText={`Min: ${FEE_CONFIG.minTaskAmount} (dust protection)`}
                  />
                </Grid>

                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    label="Fee (BPS)"
                    type="number"
                    value={form.fee_bps}
                    onChange={handleChange('fee_bps')}
                    helperText={`${FEE_CONFIG.minBps}–${FEE_CONFIG.maxBps} BPS (${(form.fee_bps / 100).toFixed(1)}%)`}
                    inputProps={{ min: FEE_CONFIG.minBps, max: FEE_CONFIG.maxBps }}
                  />
                </Grid>

                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    label="Sender Address"
                    value={form.sender}
                    onChange={handleChange('sender')}
                  />
                </Grid>

                {/* Conditional fields */}
                {needsModelId && (
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      label="Model ID *"
                      value={form.model_id}
                      onChange={handleChange('model_id')}
                      placeholder="e.g. llama-3-70b"
                    />
                  </Grid>
                )}

                {needsInputHash && (
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      label="Input Hash"
                      value={form.input_hash}
                      onChange={handleChange('input_hash')}
                      placeholder="0x..."
                    />
                  </Grid>
                )}

                {needsOutputHash && (
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      label="Output Hash *"
                      value={form.output_hash}
                      onChange={handleChange('output_hash')}
                      placeholder="0x..."
                    />
                  </Grid>
                )}

                {needsSubnetId && (
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      label="Subnet ID *"
                      type="number"
                      value={form.subnet_id}
                      onChange={handleChange('subnet_id')}
                      placeholder="e.g. 18 (Cortex)"
                    />
                  </Grid>
                )}

                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    label="Theta Recipient (optional)"
                    value={form.theta_recipient}
                    onChange={handleChange('theta_recipient')}
                    placeholder="0x..."
                  />
                </Grid>

                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    label="Max GPU Hours (optional)"
                    value={form.max_gpu_hours}
                    onChange={handleChange('max_gpu_hours')}
                  />
                </Grid>

                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    label="Memo (optional)"
                    value={form.memo}
                    onChange={handleChange('memo')}
                    multiline
                    maxRows={2}
                  />
                </Grid>
              </Grid>

              <Box sx={{ display: 'flex', gap: 2, mt: 3 }}>
                <Button
                  variant="outlined"
                  startIcon={<CalculateIcon />}
                  onClick={handlePreviewFee}
                >
                  Preview Fee
                </Button>
                <Button
                  variant="contained"
                  startIcon={loading ? <CircularProgress size={18} /> : <RocketLaunchIcon />}
                  onClick={handleSubmit}
                  disabled={loading}
                >
                  {loading ? 'Submitting...' : 'Submit Task'}
                </Button>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Preview & Result */}
        <Grid item xs={12} md={5}>
          {/* Fee Preview */}
          <Collapse in={!!feePreview}>
            <Card sx={{ mb: 2 }}>
              <CardContent>
                <Typography variant="subtitle2" gutterBottom sx={{ color: 'primary.main' }}>
                  Fee Preview
                </Typography>
                {feePreview && (
                  <Box>
                    <Row label="Gross Amount" value={feePreview.grossAmount} />
                    <Row label={`Fee (${feePreview.feePct}%)`} value={feePreview.feeAmount} highlight />
                    <Row label="Net Amount" value={feePreview.netAmount} />
                    <Divider sx={{ my: 1 }} />
                    <Typography variant="caption" sx={{ color: '#9ca3af' }}>
                      Revenue Split (30/30/25/15):
                    </Typography>
                    {Object.values(REVENUE_SPLIT).map((s) => {
                      const amt = (BigInt(feePreview.feeAmount) * BigInt(s.pct)) / 100n;
                      return (
                        <Row
                          key={s.label}
                          label={`${s.pct}% ${s.label}`}
                          value={amt.toString()}
                          small
                          color={s.color}
                        />
                      );
                    })}
                  </Box>
                )}
              </CardContent>
            </Card>
          </Collapse>

          {/* Error */}
          {error && (
            <Alert severity="error" sx={{ mb: 2, whiteSpace: 'pre-wrap' }}>
              {error}
            </Alert>
          )}

          {/* Result */}
          <Collapse in={!!result}>
            <Card>
              <CardContent>
                <Typography variant="subtitle2" gutterBottom sx={{ color: 'success.main' }}>
                  Task Accepted
                </Typography>
                {result && (
                  <Box>
                    <Row label="Task ID" value={result.task_id} mono />
                    <Row label="Status" value={<Chip size="small" label={result.status} color="success" />} />
                    <Row label="Message Type" value={result.message_type} />
                    <Row label="Chain" value={result.chain_id} />
                    <Row label="Gross" value={result.gross_amount} />
                    <Row label="Fee" value={result.fee_amount} highlight />
                    <Row label="Net" value={result.net_amount} />
                    <Row label="Fee BPS" value={result.fee_bps} />
                    <Divider sx={{ my: 1 }} />
                    <Typography variant="caption" sx={{ color: '#9ca3af' }}>
                      {result.fee_info?.description}
                    </Typography>
                  </Box>
                )}
              </CardContent>
            </Card>
          </Collapse>
        </Grid>
      </Grid>
    </Box>
  );
}

/** Simple key–value row component */
function Row({ label, value, highlight, mono, small, color }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 0.3 }}>
      <Typography variant={small ? 'caption' : 'body2'} sx={{ color: color || '#9ca3af' }}>
        {label}
      </Typography>
      <Typography
        variant={small ? 'caption' : 'body2'}
        sx={{
          fontWeight: highlight ? 700 : 500,
          color: highlight ? '#ffab40' : '#e0e0e0',
          fontFamily: mono ? 'monospace' : 'inherit',
          fontSize: mono ? 11 : undefined,
          maxWidth: '60%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {typeof value === 'string' || typeof value === 'number' ? value : value}
      </Typography>
    </Box>
  );
}
