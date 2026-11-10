import { servePlugin, stdioIo } from '@light-launcher/plugin-sdk/runtime';
import { createPlugin } from './plugin';

if (import.meta.main) {
  const { handlers, notifications } = createPlugin();
  await servePlugin(handlers, stdioIo(), notifications, { validateParams: true });
}
