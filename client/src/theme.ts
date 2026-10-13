import { alpha, createTheme } from '@mui/material/styles';

export const theme = createTheme({
  palette: {
    primary: { main: '#008069', dark: '#075e54', light: '#dcf8c6' },
    secondary: { main: '#25d366' },
    info: { main: '#738eab' },
    background: { default: '#e8eeec', paper: '#ffffff' },
    text: { primary: '#182e2a', secondary: '#667a75' },
  },
  typography: {
    fontFamily: '"Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    button: { textTransform: 'none', fontWeight: 600 },
    h4: { fontWeight: 750, letterSpacing: '-1px' },
    h5: { fontWeight: 700 },
  },
  shape: { borderRadius: 12 },
  components: {
    MuiButton: { defaultProps: { disableElevation: true } },
    MuiTextField: { defaultProps: { size: 'small' } },
    MuiTooltip: { defaultProps: { arrow: true } },
    MuiCssBaseline: {
      styleOverrides: (theme) => ({
        'html, body, #root': {
          height: '100%',
          margin: 0,
        },
        body: {
          minWidth: 320,
        },
        '.chat-wallpaper': {
          backgroundColor: theme.palette.background.default,
          backgroundImage: [
            `radial-gradient(circle at 20% 30%, ${alpha(theme.palette.divider, 0.3)} 0 2px, transparent 3px)`,
            `radial-gradient(circle at 70% 65%, ${alpha(theme.palette.primary.main, 0.12)} 0 2px, transparent 3px)`,
          ].join(','),
          backgroundSize: `${theme.spacing(6)} ${theme.spacing(6)}, ${theme.spacing(9)} ${theme.spacing(9)}`,
        },
        '::-webkit-scrollbar': {
          width: theme.spacing(0.75),
        },
        '::-webkit-scrollbar-thumb': {
          background: theme.palette.action.disabled,
          borderRadius: theme.shape.borderRadius,
        },
      }),
    },
  },
});
