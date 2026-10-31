import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MessageHost } from './components/NativeUi';
import './styles.css';
import { App } from './App';
import { ConfirmProvider } from './components/ConfirmProvider';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfirmProvider><App /><MessageHost /></ConfirmProvider>
  </StrictMode>,
);
