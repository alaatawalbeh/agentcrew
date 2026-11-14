import '@fontsource/instrument-sans/400.css';
import '@fontsource/instrument-sans/500.css';
import '@fontsource/instrument-sans/600.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/600.css';
import './styles/tokens.css';
import './styles/app.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { FaceGallery } from './robots/FaceGallery';

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');

// The browser preview can show every robot's face in every state instead of the app (?scenario=faces).
const gallery = !window.crew && new URLSearchParams(window.location.search).get('scenario') === 'faces';

createRoot(root).render(<StrictMode>{gallery ? <FaceGallery /> : <App />}</StrictMode>);
