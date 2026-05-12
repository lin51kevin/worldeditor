import { useDialogStore } from '../stores/dialogStore';

let _counter = 0;

function nextId(): string {
  return `dialog-${++_counter}`;
}

/** Show a themed alert dialog. Returns a promise that resolves when the user dismisses it. */
export function showAlert(message: string, title?: string): Promise<void> {
  return new Promise<void>((resolve) => {
    useDialogStore.getState().pushDialog({
      id: nextId(),
      type: 'alert',
      title,
      message,
      resolve: () => resolve(),
    });
  });
}

/** Show a themed confirm dialog. Returns true if the user confirmed, false if cancelled. */
export function showConfirm(message: string, title?: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    useDialogStore.getState().pushDialog({
      id: nextId(),
      type: 'confirm',
      title,
      message,
      resolve: (value) => resolve(value === true),
    });
  });
}

/** Show a themed prompt dialog. Returns the entered string or null if cancelled. */
export function showPrompt(
  message: string,
  defaultValue?: string,
  title?: string,
): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    useDialogStore.getState().pushDialog({
      id: nextId(),
      type: 'prompt',
      title,
      message,
      defaultValue,
      resolve: (value) => resolve(typeof value === 'string' ? value : null),
    });
  });
}
