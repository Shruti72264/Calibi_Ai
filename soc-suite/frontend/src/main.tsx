import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { SocProvider } from './context/SocContext';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <SocProvider>
        <App />
      </SocProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
