import { lightTheme } from '@rainbow-me/rainbowkit';

/** Use supported RainbowKit theme tokens rather than overriding generated classes. */
const base = lightTheme({ accentColor: '#112d94', accentColorForeground: '#ffffff', borderRadius: 'medium', fontStack: 'system', overlayBlur: 'small' });
export const walletTheme = {
  ...base,
  colors: { ...base.colors,
    accentColor: '#112d94', accentColorForeground: '#ffffff',
    modalBackground: '#ffffff', modalText: '#1d2433', modalTextSecondary: '#667086', modalTextDim: '#707b91',
    modalBackdrop: '#141c3299', modalBorder: '#e1e3e9', generalBorder: '#e1e3e9', generalBorderDim: '#eceef3',
    actionButtonBorder: '#e1e3e9', actionButtonBorderMobile: '#e1e3e9', actionButtonSecondaryBackground: '#f4f5f9',
    closeButton: '#667086', closeButtonBackground: '#f4f5f9',
    connectButtonBackground: '#112d94', connectButtonText: '#ffffff', connectButtonInnerBackground: '#f4f5f9',
    menuItemBackground: '#f4f5f9', profileForeground: '#faf9f6', profileAction: '#f4f5f9', profileActionHover: '#eceef7',
    selectedOptionBorder: '#112d94', error: '#ad302e', connectionIndicator: '#1a7a45',
    downloadTopCardBackground: '#f4f5f9', downloadBottomCardBackground: '#ffffff',
  },
  fonts: { body: 'Switzer, Arial, Helvetica, sans-serif' },
  radii: { ...base.radii, actionButton: '10px', connectButton: '9px', menuButton: '10px', modal: '20px', modalMobile: '20px' },
  shadows: { ...base.shadows, connectButton: 'none', dialog: '0 24px 96px rgba(17,29,67,.18)', selectedOption: 'none', selectedWallet: '0 0 0 1px #112d94' },
};
