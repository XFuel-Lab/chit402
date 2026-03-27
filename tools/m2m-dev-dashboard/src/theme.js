import { createTheme } from '@mui/material/styles';

/**
 * XFuel AI DePIN Dashboard — Dark cyberpunk theme
 *
 * Matches the existing cyberpunk neon aesthetic from the main Vite frontend
 * while using Material-UI conventions.
 */
const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#00e5ff',      // Cyan neon
      light: '#6effff',
      dark: '#00b2cc',
      contrastText: '#0a0e1a',
    },
    secondary: {
      main: '#b388ff',      // Purple neon
      light: '#e7b9ff',
      dark: '#805acb',
      contrastText: '#0a0e1a',
    },
    error: {
      main: '#ff5252',
    },
    warning: {
      main: '#ffab40',
    },
    success: {
      main: '#69f0ae',
    },
    info: {
      main: '#40c4ff',
    },
    background: {
      default: '#0a0e1a',
      paper: '#111827',
    },
    text: {
      primary: '#e0e0e0',
      secondary: '#9ca3af',
    },
    divider: 'rgba(0, 229, 255, 0.12)',
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica Neue", Arial, sans-serif',
    h4: {
      fontWeight: 700,
      letterSpacing: '-0.02em',
    },
    h5: {
      fontWeight: 700,
      letterSpacing: '-0.01em',
    },
    h6: {
      fontWeight: 600,
    },
    subtitle1: {
      fontWeight: 500,
      color: '#9ca3af',
    },
    body2: {
      color: '#9ca3af',
    },
  },
  shape: {
    borderRadius: 12,
  },
  components: {
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          border: '1px solid rgba(0, 229, 255, 0.08)',
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          border: '1px solid rgba(0, 229, 255, 0.10)',
          backdropFilter: 'blur(12px)',
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 600,
          borderRadius: 8,
        },
        containedPrimary: {
          background: 'linear-gradient(135deg, #00e5ff 0%, #b388ff 100%)',
          '&:hover': {
            background: 'linear-gradient(135deg, #6effff 0%, #e7b9ff 100%)',
          },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          fontWeight: 600,
        },
      },
    },
    MuiTextField: {
      defaultProps: {
        variant: 'outlined',
        size: 'small',
      },
    },
    MuiSelect: {
      defaultProps: {
        size: 'small',
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundColor: '#0d1222',
          borderRight: '1px solid rgba(0, 229, 255, 0.08)',
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: '#0d1222',
          borderBottom: '1px solid rgba(0, 229, 255, 0.08)',
          backgroundImage: 'none',
        },
      },
    },
  },
});

export default theme;
