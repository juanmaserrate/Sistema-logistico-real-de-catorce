import { registerRootComponent } from 'expo';

import './src/locationTask';
import App from './App';

// Carga en **development build** o APK/AAB (EAS). Expo Go no incluye Navigation SDK ni otros nativos.
registerRootComponent(App);
