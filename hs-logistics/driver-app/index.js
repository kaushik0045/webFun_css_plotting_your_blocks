// The background location task MUST be defined before anything else runs,
// because Android may start the app headless (no UI) just to deliver locations.
import './src/locationTask';
import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
