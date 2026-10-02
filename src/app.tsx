import { effect } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { FeatureCard } from './components/FeatureCard';
import { Fabs } from './components/Fabs';
import { Hud } from './components/Hud';
import { LayersSheet } from './components/LayersSheet';
import { NearbySheet } from './components/NearbySheet';
import { ReportSheet } from './components/ReportSheet';
import { SettingsSheet } from './components/SettingsSheet';
import { SimSheet } from './components/SimSheet';
import { SourcesSheet } from './components/SourcesSheet';
import { StartOverlay } from './components/StartOverlay';
import { TopBar } from './components/TopBar';
import { MapView } from './map/MapView';
import { isDark, sheet, started, toast } from './state/store';

effect(() => {
  const dark = isDark.value;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0b1020' : '#eef1f5');
});

function Toast() {
  const t = toast.value;
  useEffect(() => {
    if (!t) return;
    const id = setTimeout(() => {
      if (toast.value?.id === t.id) toast.value = null;
    }, 3500);
    return () => clearTimeout(id);
  }, [t?.id]);
  return t ? (
    <div class="toast" role="status">
      {t.text}
    </div>
  ) : null;
}

export function App() {
  const s = sheet.value;
  return (
    <div class="app">
      <MapView />
      <TopBar />
      <Fabs />
      <FeatureCard />
      <Hud />
      {s === 'settings' && <SettingsSheet />}
      {s === 'layers' && <LayersSheet />}
      {s === 'nearby' && <NearbySheet />}
      {s === 'report' && <ReportSheet />}
      {s === 'sources' && <SourcesSheet />}
      {s === 'sim' && <SimSheet />}
      <Toast />
      {!started.value && <StartOverlay />}
    </div>
  );
}
