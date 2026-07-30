import { create } from 'zustand';
import { Notification, NotificationType } from '../components/NotificationToast';

interface NotificationStore {
  notifications: Notification[];
  addNotification: (type: NotificationType, title: string, message: string, duration?: number) => void;
  removeNotification: (id: string) => void;
  clearAll: () => void;
}

/**
 * Notification store using Zustand
 * Manages application-wide notifications
 */
export const useNotificationStore = create<NotificationStore>((set) => ({
  notifications: [],

  addNotification: (type, title, message, duration = 5000) => {
    const id = `notification-${Date.now()}-${Math.random()}`;
    const notification: Notification = {
      id,
      type,
      title,
      message,
      duration,
    };

    set((state) => ({
      notifications: [...state.notifications, notification],
    }));
  },

  removeNotification: (id) => {
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    }));
  },

  clearAll: () => {
    set({ notifications: [] });
  },
}));

/**
 * Helper functions for easy notification creation
 */
export const notify = {
  success: (title: string, message: string, duration?: number) => {
    useNotificationStore.getState().addNotification('success', title, message, duration);
  },

  error: (title: string, message: string, duration?: number) => {
    useNotificationStore.getState().addNotification('error', title, message, duration);
  },

  warning: (title: string, message: string, duration?: number) => {
    useNotificationStore.getState().addNotification('warning', title, message, duration);
  },

  info: (title: string, message: string, duration?: number) => {
    useNotificationStore.getState().addNotification('info', title, message, duration);
  },
};
