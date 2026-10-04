import 'tdesign-react/es/_util/react-19-adapter';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider } from 'tdesign-react';
import 'tdesign-react/es/style/index.css';
import './styles.css';
import { AuthProvider } from './auth/AuthProvider';
import { App } from './App';
import { ConfirmProvider } from './components/ConfirmProvider';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider globalConfig={{ animation: { exclude: ['ripple'] }, loading: { indicator: false } }}>
      <ConfirmProvider><AuthProvider><App /></AuthProvider></ConfirmProvider>
    </ConfigProvider>
  </StrictMode>,
);
