import { createRoot } from 'react-dom/client';
import '@fontsource/big-shoulders-display/600';
import '@fontsource/big-shoulders-display/800';
import '@fontsource/big-shoulders-display/900';
import '@fontsource/instrument-sans/400.css';
import '@fontsource/instrument-sans/500.css';
import '@fontsource/instrument-sans/600.css';
import '@fontsource/instrument-sans/400-italic.css';
// original type for the opening chapter (slides 01–03)
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/barlow-condensed/800.css';
import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/fraunces/400-italic.css';
import '@fontsource/fraunces/300-italic.css';
import '@fontsource/fraunces/500-italic.css';
import './styles/global.css';
import gsap from 'gsap';
import App from './App.jsx';

// ?shot: real-time clock even when frames are slow (headless capture)
if (new URLSearchParams(location.search).has('shot')) gsap.ticker.lagSmoothing(0);

createRoot(document.getElementById('root')).render(<App />);
