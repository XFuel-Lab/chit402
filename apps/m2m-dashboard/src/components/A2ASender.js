import React, { useState, useMemo } from 'react';
import {
  Box, Card, CardContent, Typography, TextField, MenuItem, Button,
  Alert, CircularProgress, Divider, Chip, Grid, Collapse, Tooltip,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import InfoIcon from '@mui/icons-material/Info';
import { useApi } from '../context/ApiContext';
import {
  MESSAGE_TYPES, CHAIN_IDS, ESCROW_RULES,
  calculateRelayFee, sendA2AMessage,
} from '../utils/api';

const MSG_TYPE_OPTIONS = Object.entries(MESSAGE_TYPES).map(([key, value]) => ({
  value,
  label: key.replace(/_/g, ' '),
}));

const CHAIN_OPTIONS = Object.entries(CHAIN_IDS).map(([key, value]) => ({
  value,
  label: key.charAt(0) + key.slice(1).toLowerCase(),
}));

export default function A2ASender() {
  const { client } = useApi();

  const [form, setForm] = useState({
    message_type: MESSAGE_TYPES.COMPUTE_BID,
    sender_chain: CHAIN_IDS.THETA,
    recipient_chain: CHAIN_IDS.AKASH,
    payload_hash: '',
    escrow_amount: '250000',
    ttl: 3600,
    sender_address: '0xYourAgentAddress',
    sender_identity: '0xPoseidonCommitmentHash',
    recipient_address: '',
    ibc_channel: '',
  });

  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleChange = (field) => (e) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
    setError(null);
  };

  const escrowRule = useMemo(
    () => ESCROW_RULES[form.message_type] || { required: false, label: 'Unknown' },
    [form.message_type],
  );

  const relayFee = useMemo(
    () => calculateRelayFee(form.escrow_amount),
    [form.escrow_amount],
  );

  const isCrossChain = form.sender_chain !== form.recipient_chain;

  const handleSubmit = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const payload = {
        message_type: form.message_type,
        sender_chain: form.sender_chain,
        recipient_chain: form.recipient_chain,
        payload_hash: form.payload_hash,
        ttl: Number(form.ttl),
        sender_address: form.sender_address,
        sender_identity: form.sender_identity,
      };
      if (form.escrow_amount && form.escrow_amount !== '0') {
        payload.escrow_amount = form.escrow_amount;
      }
      if (form.recipient_address) payload.recipient_address = form.recipient_address;
      if (form.ibc_channel) payload.ibc_channel = form.ibc_channel;

      const data = await sendA2AMessage(client, payload);
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

  return (
    <Box>
      <Typography variant="body2" sx={{ mb: 2 }}>
        Send ZK-verifiable Agent-to-Agent (A2A) messages with optional escrow.
        Integrates with AIDePINRouter.sendA2AMessage() and SP1 validate_a2a_message().
      </Typography>

      <Grid container spacing={3}>
        <Grid item xs={12} md={7}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <SendIcon color="primary" /> A2A Message
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
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Tooltip title={escrowRule.label}>
                      <Chip
                        icon={<InfoIcon />}
                        size="small"
                        label={`Escrow: ${escrowRule.required ? 'Required' : escrowRule.mustBeZero ? 'Must be 0' : 'Optional'}`}
                        color={escrowRule.required ? 'warning' : 'default'}
                        variant="outlined"
                        sx={{ mt: 1 }}
                      />
                    </Tooltip>
                  </Box>
                </Grid>

                <Grid item xs={12} sm={6}>
                  <TextField
                    select
                    fullWidth
                    label="Sender Chain"
                    value={form.sender_chain}
                    onChange={handleChange('sender_chain')}
                  >
                    {CHAIN_OPTIONS.map((o) => (
                      <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
                    ))}
                  </TextField>
                </Grid>

                <Grid item xs={12} sm={6}>
                  <TextField
                    select
                    fullWidth
                    label="Recipient Chain"
                    value={form.recipient_chain}
                    onChange={handleChange('recipient_chain')}
                  >
                    {CHAIN_OPTIONS.map((o) => (
                      <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
                    ))}
                  </TextField>
                </Grid>

                {isCrossChain && (
                  <Grid item xs={12}>
                    <Alert severity="info" sx={{ py: 0 }}>
                      Cross-chain A2A — IBC channel required.
                    </Alert>
                  </Grid>
                )}

                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    label="Payload Hash (SHA-256)"
                    value={form.payload_hash}
                    onChange={handleChange('payload_hash')}
                    placeholder="0xdeadbeef..."
                    helperText="Hex string, >= 8 chars"
                  />
                </Grid>

                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    label="Escrow Amount"
                    value={form.escrow_amount}
                    onChange={handleChange('escrow_amount')}
                    disabled={escrowRule.mustBeZero}
                    helperText={relayFee !== '0' ? `Relay fee: ${relayFee} (0.1%)` : 'No relay fee'}
                  />
                </Grid>

                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    label="TTL (seconds)"
                    type="number"
                    value={form.ttl}
                    onChange={handleChange('ttl')}
                    helperText="1 – 86400 (24h max)"
                    inputProps={{ min: 1, max: 86400 }}
                  />
                </Grid>

                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    label="Sender Address"
                    value={form.sender_address}
                    onChange={handleChange('sender_address')}
                  />
                </Grid>

                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    label="Sender Identity (commitment)"
                    value={form.sender_identity}
                    onChange={handleChange('sender_identity')}
                    placeholder="Poseidon hash hex"
                  />
                </Grid>

                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    label="Recipient Address (optional)"
                    value={form.recipient_address}
                    onChange={handleChange('recipient_address')}
                  />
                </Grid>

                {isCrossChain && (
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      label="IBC Channel *"
                      value={form.ibc_channel}
                      onChange={handleChange('ibc_channel')}
                      placeholder="channel-42"
                    />
                  </Grid>
                )}
              </Grid>

              <Box sx={{ mt: 3 }}>
                <Button
                  variant="contained"
                  startIcon={loading ? <CircularProgress size={18} /> : <SendIcon />}
                  onClick={handleSubmit}
                  disabled={loading}
                >
                  {loading ? 'Sending...' : 'Send A2A Message'}
                </Button>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Result panel */}
        <Grid item xs={12} md={5}>
          {error && (
            <Alert severity="error" sx={{ mb: 2, whiteSpace: 'pre-wrap' }}>
              {error}
            </Alert>
          )}

          <Collapse in={!!result}>
            <Card>
              <CardContent>
                <Typography variant="subtitle2" gutterBottom sx={{ color: 'success.main' }}>
                  A2A Message Accepted
                </Typography>
                {result && (
                  <Box>
                    <Row label="Message ID" value={result.message_id} mono />
                    <Row label="Status" value={<Chip size="small" label={result.status} color="success" />} />
                    <Row label="Type" value={result.message_type} />
                    <Row label="Sender Chain" value={result.sender_chain} />
                    <Row label="Recipient Chain" value={result.recipient_chain} />
                    <Row label="Escrow" value={result.escrow_amount} />
                    <Row label="Relay Fee" value={result.relay_fee} highlight />
                    <Row label="Nonce" value={result.nonce} />
                    <Row label="TTL" value={`${result.ttl}s`} />
                    <Divider sx={{ my: 1 }} />
                    <Typography variant="caption" sx={{ color: '#9ca3af' }}>
                      {result.relay_fee_info}
                    </Typography>
                  </Box>
                )}
              </CardContent>
            </Card>
          </Collapse>

          {/* Escrow Rules Reference */}
          <Card sx={{ mt: 2 }}>
            <CardContent>
              <Typography variant="subtitle2" gutterBottom>
                Escrow Rules
              </Typography>
              {Object.entries(ESCROW_RULES).map(([type, rule]) => (
                <Box key={type} sx={{ display: 'flex', justifyContent: 'space-between', py: 0.3 }}>
                  <Typography variant="caption" sx={{ color: '#9ca3af', textTransform: 'uppercase' }}>
                    {type.replace(/_/g, ' ')}
                  </Typography>
                  <Chip
                    size="small"
                    label={rule.required ? 'Required' : rule.mustBeZero ? 'Zero' : 'Optional'}
                    color={rule.required ? 'warning' : 'default'}
                    variant="outlined"
                    sx={{ fontSize: 10, height: 20 }}
                  />
                </Box>
              ))}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}

function Row({ label, value, highlight, mono }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 0.3 }}>
      <Typography variant="body2" sx={{ color: '#9ca3af' }}>{label}</Typography>
      <Typography
        variant="body2"
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
        {typeof value === 'object' && React.isValidElement(value) ? value : String(value ?? '')}
      </Typography>
    </Box>
  );
}
