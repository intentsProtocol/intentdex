import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { MeshProvider } from './context/MeshContext';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MeshProvider>
      <App />
    </MeshProvider>
  </React.StrictMode>
);
