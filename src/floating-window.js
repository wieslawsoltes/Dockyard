/** Web hosting extensions. Existing AvalonDock Float/Dock operations are unchanged. */
export const FloatingWindowMode = Object.freeze({ InPage: 'InPage', BrowserWindow: 'BrowserWindow' });
export const BrowserWindowCloseBehavior = Object.freeze({ Dock: 'Dock', InPage: 'InPage', Close: 'Close' });
export const BrowserWindowFallback = Object.freeze({ InPage: 'InPage', Cancel: 'Cancel' });
export function isFloatingWindowMode(value) { return Object.hasOwn(FloatingWindowMode, value); }

/** AvalonDock-shaped wrapper around an observable floating-control change. */
export class LayoutFloatingWindowControlCollectionChangedEventArgs {
  constructor(collectionChangedEventArgs) {
    Object.defineProperty(this, 'CollectionChangedEventArgs', { value: collectionChangedEventArgs, enumerable: true });
  }
}
