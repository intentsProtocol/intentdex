import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { ChamThemeProvider } from './context/ChamThemeContext';
import './index.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ChamThemeProvider>
      <App />
    </ChamThemeProvider>
  </React.StrictMode>
);
