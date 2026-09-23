import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider } from 'tdesign-react';
import 'tdesign-react/es/style/index.css';
import './styles.css';
import { AuthProvider } from './auth/AuthProvider';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider globalConfig={{ animation: { exclude: ['ripple'] } }}>
      <AuthProvider><App /></AuthProvider>
    </ConfigProvider>
  </StrictMode>,
);
