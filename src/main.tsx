import { render } from 'preact';
import { App } from './app';
import { checkServer, loadCachedRadars, startDataLoops } from './services/data';
import { startEngine } from './services/engine';
import './styles.css';

startEngine();
render(<App />, document.getElementById('app')!);

void (async () => {
  await loadCachedRadars();
  await checkServer();
  startDataLoops();
})();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}
