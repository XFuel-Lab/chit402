import React, { useState } from 'react';
import {
  AppBar, Box, Drawer, IconButton, List, ListItemButton, ListItemIcon,
  ListItemText, Toolbar, Typography, Divider, Chip, TextField, Tooltip,
  useMediaQuery, useTheme,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import SendIcon from '@mui/icons-material/Send';
import PollIcon from '@mui/icons-material/Poll';
import BarChartIcon from '@mui/icons-material/BarChart';
import MonitorHeartIcon from '@mui/icons-material/MonitorHeart';
import VpnKeyIcon from '@mui/icons-material/VpnKey';
import { useApi } from '../context/ApiContext';

const DRAWER_WIDTH = 250;

const NAV_ITEMS = [
  { key: 'task',    label: 'Task Simulator',  icon: <RocketLaunchIcon /> },
  { key: 'a2a',     label: 'A2A Sender',      icon: <SendIcon /> },
  { key: 'status',  label: 'Status Poller',   icon: <PollIcon /> },
  { key: 'fees',    label: 'Fee Visualizer',  icon: <BarChartIcon /> },
  { key: 'health',  label: 'Health Monitor',  icon: <MonitorHeartIcon /> },
];

export default function DashboardLayout({ activeTab, onTabChange, children }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [mobileOpen, setMobileOpen] = useState(false);
  const { apiKey, setApiKey } = useApi();
  const [keyInput, setKeyInput] = useState(apiKey);

  const handleSaveKey = () => setApiKey(keyInput.trim());

  const drawer = (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Brand */}
      <Box sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box
          sx={{
            width: 32, height: 32, borderRadius: '50%',
            background: 'linear-gradient(135deg, #00e5ff, #b388ff)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 900, fontSize: 14, color: '#0a0e1a',
          }}
        >
          XF
        </Box>
        <Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#e0e0e0', lineHeight: 1.2 }}>
            XFuel AI DePIN
          </Typography>
          <Typography variant="caption" sx={{ color: '#9ca3af', lineHeight: 1 }}>
            Dashboard v0.1
          </Typography>
        </Box>
      </Box>

      <Divider />

      {/* Nav */}
      <List sx={{ flex: 1, px: 1, py: 0.5 }}>
        {NAV_ITEMS.map(({ key, label, icon }) => (
          <ListItemButton
            key={key}
            selected={activeTab === key}
            onClick={() => {
              onTabChange(key);
              if (isMobile) setMobileOpen(false);
            }}
            sx={{
              borderRadius: 2, mb: 0.5,
              '&.Mui-selected': {
                bgcolor: 'rgba(0,229,255,0.08)',
                '& .MuiListItemIcon-root': { color: 'primary.main' },
                '& .MuiListItemText-primary': { color: 'primary.main', fontWeight: 600 },
              },
            }}
          >
            <ListItemIcon sx={{ minWidth: 36, color: '#9ca3af' }}>{icon}</ListItemIcon>
            <ListItemText primary={label} primaryTypographyProps={{ fontSize: 14 }} />
          </ListItemButton>
        ))}
      </List>

      <Divider />

      {/* API Key */}
      <Box sx={{ p: 2 }}>
        <Typography variant="caption" sx={{ color: '#9ca3af', display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
          <VpnKeyIcon sx={{ fontSize: 14 }} /> API Key
        </Typography>
        <TextField
          fullWidth
          type="password"
          size="small"
          placeholder="Enter M2M API key"
          value={keyInput}
          onChange={(e) => setKeyInput(e.target.value)}
          onBlur={handleSaveKey}
          onKeyDown={(e) => e.key === 'Enter' && handleSaveKey()}
          sx={{ mb: 0.5 }}
        />
        <Tooltip title={apiKey ? 'Key configured' : 'No key — server may be in open mode'}>
          <Chip
            size="small"
            label={apiKey ? 'Authenticated' : 'Open Mode'}
            color={apiKey ? 'success' : 'warning'}
            variant="outlined"
            sx={{ fontSize: 11, height: 22 }}
          />
        </Tooltip>
      </Box>

      {/* Footer */}
      <Box sx={{ p: 2, pt: 0 }}>
        <Chip
          size="small"
          label="DEV / TESTING ONLY"
          color="warning"
          sx={{ fontSize: 10, height: 20, width: '100%' }}
        />
      </Box>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      {/* Sidebar */}
      {isMobile ? (
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{ '& .MuiDrawer-paper': { width: DRAWER_WIDTH } }}
        >
          {drawer}
        </Drawer>
      ) : (
        <Drawer
          variant="permanent"
          sx={{
            width: DRAWER_WIDTH,
            flexShrink: 0,
            '& .MuiDrawer-paper': { width: DRAWER_WIDTH, boxSizing: 'border-box' },
          }}
        >
          {drawer}
        </Drawer>
      )}

      {/* Main content */}
      <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
        <AppBar position="sticky" elevation={0}>
          <Toolbar variant="dense">
            {isMobile && (
              <IconButton edge="start" color="inherit" onClick={() => setMobileOpen(true)} sx={{ mr: 1 }}>
                <MenuIcon />
              </IconButton>
            )}
            <Typography variant="h6" sx={{ flexGrow: 1, fontSize: 16 }}>
              {NAV_ITEMS.find((n) => n.key === activeTab)?.label || 'Dashboard'}
            </Typography>
            <Chip
              size="small"
              label="Maintenance Mode"
              color="warning"
              variant="outlined"
              sx={{ fontSize: 11, height: 22 }}
            />
          </Toolbar>
        </AppBar>

        <Box
          component="main"
          sx={{
            flexGrow: 1,
            p: { xs: 2, md: 3 },
            maxWidth: 1200,
            width: '100%',
            mx: 'auto',
          }}
        >
          {children}
        </Box>
      </Box>
    </Box>
  );
}
