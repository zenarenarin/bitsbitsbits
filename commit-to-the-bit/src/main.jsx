import { createRoot } from 'react-dom/client';
// one type family across the whole deck, bundled for offline use
import '@fontsource-variable/archivo/wdth.css';
import '@fontsource-variable/dm-sans';
import '@fontsource/space-mono/400.css';
import '@fontsource/space-mono/700.css';
import './styles/global.css';
import gsap from 'gsap';
import App from './App.jsx';

// ?shot: real-time clock even when frames are slow (headless capture)
if (new URLSearchParams(location.search).has('shot')) gsap.ticker.lagSmoothing(0);

createRoot(document.getElementById('root')).render(<App />);
