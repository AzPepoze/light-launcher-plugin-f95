import type { CdpClient } from './cdp';

/**
 * Attaches to every page tab of the browser, including tabs opened later.
 * `onTab` runs once per tab with that tab's session id.
 */
export async function watchTabs(
  cdp: CdpClient,
  onTab: (sessionId: string) => Promise<void>,
): Promise<() => void> {
  const attachedTargets = new Set<string>();

  const attach = async (targetId: string) => {
    if (attachedTargets.has(targetId)) return;
    attachedTargets.add(targetId);
    const { sessionId } = await cdp.send<{ sessionId: string }>('Target.attachToTarget', {
      targetId,
      flatten: true,
    });
    await onTab(sessionId);
  };

  const off = cdp.on('Target.targetCreated', (params) => {
    const info = params?.targetInfo;
    if (info?.type === 'page' && info.targetId) void attach(info.targetId).catch(() => {});
  });
  // existing tabs are reported as targetCreated too
  await cdp.send('Target.setDiscoverTargets', { discover: true });
  return off;
}
