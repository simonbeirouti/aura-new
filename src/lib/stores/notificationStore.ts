import { writable, derived } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { registerActionTypes } from '@tauri-apps/plugin-notification';

export interface NotificationSettings {
  enabled: boolean;
  showBadge: boolean;
  playSound: boolean;
}

export interface NotificationAction {
  id: string;
  title: string;
  requiresAuthentication?: boolean;
  foreground?: boolean;
  destructive?: boolean;
  input?: boolean;
  inputButtonTitle?: string;
  inputPlaceholder?: string;
}

export interface ActionType {
  id: string;
  actions: NotificationAction[];
}

export interface AppNotification {
  id: string;
  title: string;
  body: string;
  icon?: string;
  actions?: NotificationAction[];
  timestamp: Date;
  read: boolean;
}

// Notification settings store
const createNotificationSettings = () => {
  const { subscribe, set, update } = writable<NotificationSettings>({
    enabled: true,
    showBadge: true,
    playSound: true
  });

  return {
    subscribe,
    set,
    update,
    initialize: async () => {
      try {
        const settings = await invoke<NotificationSettings>('get_notification_settings');
        set(settings);
      } catch (error) {
        console.error('Failed to load notification settings:', error);
      }
    },
    updateSettings: async (newSettings: Partial<NotificationSettings>) => {
      try {
        const updatedSettings = await invoke<NotificationSettings>('update_notification_settings', { settings: newSettings });
        set(updatedSettings);
        return updatedSettings;
      } catch (error) {
        console.error('Failed to update notification settings:', error);
        throw error;
      }
    }
  };
};

// In-app notifications store
const createInAppNotifications = () => {
  const { subscribe, set, update } = writable<AppNotification[]>([]);

  return {
    subscribe,
    add: (notification: Omit<AppNotification, 'id' | 'timestamp' | 'read'>) => {
      const newNotification: AppNotification = {
        ...notification,
        id: crypto.randomUUID(),
        timestamp: new Date(),
        read: false
      };
      
      update(notifications => [newNotification, ...notifications]);
      return newNotification;
    },
    markAsRead: (id: string) => {
      update(notifications => 
        notifications.map(n => n.id === id ? { ...n, read: true } : n)
      );
    },
    remove: (id: string) => {
      update(notifications => notifications.filter(n => n.id !== id));
    },
    clear: () => set([])
  };
};

export const notificationSettings = createNotificationSettings();
export const inAppNotifications = createInAppNotifications();

// Derived store for unread count
export const unreadCount = derived(
  inAppNotifications,
  $notifications => $notifications.filter(n => !n.read).length
);

// Notification actions
// Pre-defined action types for common use cases
export const commonActionTypes: ActionType[] = [
  {
    id: 'messages',
    actions: [
      {
        id: 'reply',
        title: 'Reply',
        input: true,
        inputButtonTitle: 'Send',
        inputPlaceholder: 'Type your reply...',
        foreground: true
      },
      {
        id: 'mark-read',
        title: 'Mark as Read',
        foreground: false
      }
    ]
  },
  {
    id: 'reminders',
    actions: [
      {
        id: 'snooze',
        title: 'Snooze',
        foreground: false
      },
      {
        id: 'complete',
        title: 'Complete',
        foreground: false
      },
      {
        id: 'dismiss',
        title: 'Dismiss',
        destructive: true,
        foreground: false
      }
    ]
  }
];

export const notificationActions = {
  // Request notification permission
  requestPermission: async (): Promise<boolean> => {
    try {
      const granted = await invoke<boolean>('request_notification_permission');
      return granted;
    } catch (error) {
      console.error('Failed to request notification permission:', error);
      return false;
    }
  },

  // Send a simple notification
  sendNotification: async (title: string, body: string, icon?: string): Promise<void> => {
    try {
      await invoke('send_notification', {
        title,
        body,
        icon: icon || null
      });
    } catch (error) {
      console.error('Failed to send notification:', error);
      throw error;
    }
  },

  // Register action types for interactive notifications
  registerActionTypes: async (actionTypes: ActionType[]): Promise<void> => {
    try {
      // Register with Tauri plugin
      await registerActionTypes(actionTypes);
      
      // Also register with backend for tracking
      await invoke('register_action_types', { actionTypes });
    } catch (error) {
      console.error('Failed to register action types:', error);
      throw error;
    }
  },

  // Send a notification with actions
  sendActionNotification: async (
    title: string, 
    body: string, 
    actionTypeId?: string,
    icon?: string
  ): Promise<void> => {
    try {
      await invoke('send_action_notification', {
        title,
        body,
        actionTypeId: actionTypeId || null,
        icon: icon || null
      });
    } catch (error) {
      console.error('Failed to send action notification:', error);
      throw error;
    }
  },


  // Initialize notification listeners
  initializeListeners: async () => {
    try {
      // Listen for backend events only (avoid plugin's onAction which causes issues)
      const unlistenAction = await listen('notification-action-performed', (event) => {
        const payload = event.payload as any;
        const actionId = payload.actionId || 'unknown';

        // Add to in-app notifications for tracking
        inAppNotifications.add({
          title: 'Action Performed',
          body: `Action "${actionId}" was performed`,
          actions: []
        });

        // Handle specific actions
        switch (actionId) {
          case 'reply':
            break;
          case 'mark-read':
            break;
          default:
            break;
        }
      });

      const unlistenClick = await listen('notification-clicked', (event) => {
        inAppNotifications.add({
          title: 'Notification Clicked',
          body: `Notification was clicked`,
        });
      });

      // Store unlisteners for cleanup if needed
      (window as any).notificationUnlisteners = [unlistenAction, unlistenClick];
    } catch (error) {
      console.error('Failed to initialize notification listeners:', error);
    }
  }
};

// Helper function to initialize common action types
export const initializeCommonActionTypes = async (): Promise<void> => {
  try {
    await notificationActions.registerActionTypes(commonActionTypes);
  } catch (error) {
    console.error('Failed to register common action types:', error);
  }
};
