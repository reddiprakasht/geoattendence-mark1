import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { initializeStorage } from './utils/storage.js';
import './styles.css';

initializeStorage();

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
