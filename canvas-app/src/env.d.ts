/// <reference types="vite/client" />

declare interface Window {
  MonacoEnvironment?: {
    getWorker(workerId: string, label: string): Worker;
  };
}

// Allow `self.MonacoEnvironment` in module scope
declare let MonacoEnvironment: Window['MonacoEnvironment'];
