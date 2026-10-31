/**
 * Local notifications for the agent: "back online, N actions are ready to review" and "your swap finished".
 * They are made on the phone; no push service and no server are involved.
 *
 * A background check runs while actions wait for the network (Android runs it about every 15 minutes at
 * best). It reads only the count of waiting actions, a plain number, so it never opens the encrypted chats.
 * Nothing runs by itself: the notification opens the wallet, and each action still needs the PIN.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as BackgroundTask from 'expo-background-task';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { deviceLanguage, tr } from '@/i18n';
import { checkOnline } from './network';
import { QUEUED_COUNT_KEY } from './store';

export const OUTBOX_TASK = 'agent-outbox-check';
const CHANNEL = 'agent';
const LAST_KEY = 'agent_notified_v1';
/** Do not repeat the same reminder more often than this. */
const REPEAT_MS = 6 * 60 * 60_000;

let configured = false;
export function configureNotifications(): void {
  if (configured) return;
  configured = true;
  Notifications.setNotificationHandler({
    // In the app the Agent tab shows its own banner; a system banner on top would say it twice.
    handleNotification: async () => ({ shouldShowBanner: false, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
  if (Platform.OS === 'android') {
    Notifications.setNotificationChannelAsync(CHANNEL, {
      name: tr(deviceLanguage(), 'agent.notify.channel'),
      importance: Notifications.AndroidImportance.DEFAULT,
    }).catch(() => {});
  }
}

export async function notificationsAllowed(): Promise<boolean> {
  try { return (await Notifications.getPermissionsAsync()).granted; } catch { return false; }
}

/** Asked when the user first queues an action, the moment the reason is obvious. */
export async function askForNotifications(): Promise<boolean> {
  try {
    const now = await Notifications.getPermissionsAsync();
    if (now.granted) return true;
    if (!now.canAskAgain) return false;
    return (await Notifications.requestPermissionsAsync()).granted;
  } catch { return false; }
}

async function post(title: string, body: string, route = '/agent'): Promise<void> {
  if (!(await notificationsAllowed())) return;
  await Notifications.scheduleNotificationAsync({
    content: { title, body, data: { route }, ...(Platform.OS === 'android' ? { channelId: CHANNEL } : null) } as Notifications.NotificationContentInput,
    trigger: null,
  }).catch(() => {});
}

/** "You're back online: 2 actions are ready to review." At most once per stretch offline, or every few hours. */
export async function notifyBackOnline(count: number, force = false): Promise<void> {
  if (count <= 0) return;
  const last = Number((await AsyncStorage.getItem(LAST_KEY).catch(() => null)) ?? 0);
  if (!force && Date.now() - last < REPEAT_MS) return;
  await AsyncStorage.setItem(LAST_KEY, String(Date.now())).catch(() => {});
  const lang = deviceLanguage();
  await post(tr(lang, 'agent.notify.online.title'), tr(lang, count === 1 ? 'agent.notify.online.one' : 'agent.notify.online.many', { count }));
}

/** A reviewed action finished while the user was elsewhere. */
export async function notifyFinished(body: string): Promise<void> {
  await post(tr(deviceLanguage(), 'agent.notify.done.title'), body);
}

/** A new stretch offline: the next "back online" reminder may go out straight away. */
export const resetReminder = () => AsyncStorage.removeItem(LAST_KEY).catch(() => {});

// The background check. It must be defined when the JavaScript bundle loads, outside any component.
TaskManager.defineTask(OUTBOX_TASK, async () => {
  try {
    const count = Number((await AsyncStorage.getItem(QUEUED_COUNT_KEY)) ?? 0);
    if (count > 0 && (await checkOnline())) await notifyBackOnline(count);
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

/** Runs the background check only while something waits; stops it when the outbox is clear. */
export async function syncBackgroundCheck(queued: number): Promise<void> {
  try {
    const on = await TaskManager.isTaskRegisteredAsync(OUTBOX_TASK);
    if (queued > 0 && !on) await BackgroundTask.registerTaskAsync(OUTBOX_TASK, { minimumInterval: 15 });
    if (queued === 0 && on) await BackgroundTask.unregisterTaskAsync(OUTBOX_TASK);
  } catch { /* background work is a bonus; the in-app banner still shows */ }
}
