import React, { useState } from 'react';
import { Box, Alert, Typography, Link } from '@mui/material';
import WarningIcon from '@mui/icons-material/Warning';
import DashboardLayout from './components/DashboardLayout';
import TaskSimulator from './components/TaskSimulator';
import A2ASender from './components/A2ASender';
import StatusPoller from './components/StatusPoller';
import FeeVisualizer from './components/FeeVisualizer';
import HealthMonitor from './components/HealthMonitor';

/**
 * XFuel AI DePIN Dashboard — Main App
 *
 * Developer/testing interface for the M2M API (server.js).
 * NOT for production A2A traffic — production agents use the API directly.
 *
 * Pivoted from Persistence to Osmosis/Akash direct.
 */
export default function App() {
  const [activeTab, setActiveTab] = useState('task');

  const renderTab = () => {
    switch (activeTab) {
      case 'task':   return <TaskSimulator />;
      case 'a2a':    return <A2ASender />;
      case 'status': return <StatusPoller />;
      case 'fees':   return <FeeVisualizer />;
      case 'health': return <HealthMonitor />;
      default:       return <TaskSimulator />;
    }
  };

  return (
    <DashboardLayout activeTab={activeTab} onTabChange={setActiveTab}>
      {/* Maintenance / dev warning banner */}
      <Alert
        severity="warning"
        icon={<WarningIcon />}
        sx={{
          mb: 3,
          bgcolor: 'rgba(255,171,64,0.06)',
          border: '1px solid rgba(255,171,64,0.2)',
        }}
      >
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          Development / Testing Dashboard
        </Typography>
        <Typography variant="caption" sx={{ display: 'block', mt: 0.5 }}>
          This dashboard is for dev/testing purposes. Production M2M traffic uses the{' '}
          <Link href="#" sx={{ color: 'primary.main' }}>REST API</Link> directly.
          Pivoted from Persistence to Osmosis/Akash direct routing.
          See{' '}
          <Link
            href="https://github.com/XFuel-Lab/xfuel-protocol/blob/main/WHITEPAPER_v4.4.md"
            target="_blank"
            sx={{ color: 'primary.main' }}
          >
            Whitepaper v4.5
          </Link>{' '}
          Phase E for full specs.
        </Typography>
      </Alert>

      {renderTab()}
    </DashboardLayout>
  );
}
