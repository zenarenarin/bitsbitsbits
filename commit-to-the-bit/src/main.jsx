import { createRoot } from 'react-dom/client';
import '@fontsource/barlow-condensed/500.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/barlow-condensed/800.css';
import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/fraunces/400-italic.css';
import '@fontsource/fraunces/300-italic.css';
import './styles/global.css';
import gsap from 'gsap';
import App from './App.jsx';

// ?shot: real-time clock even when frames are slow (headless capture)
if (new URLSearchParams(location.search).has('shot')) gsap.ticker.lagSmoothing(0);

createRoot(document.getElementById('root')).render(<App />);
