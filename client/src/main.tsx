import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { capturePasswordLink } from './lib/passwordLink';
import './index.css';
import App from './App';

// Capture and scrub once before React renders (including Strict Mode).
let initialPasswordLink = capturePasswordLink();
const application = <StrictMode><App initialPasswordLink={initialPasswordLink} /></StrictMode>;
initialPasswordLink = null;
createRoot(document.getElementById('root')!).render(application);
