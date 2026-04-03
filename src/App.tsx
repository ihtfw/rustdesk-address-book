import { useState, useEffect, useCallback } from "react";
import type { Folder } from "./types";
import * as api from "./api";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import LockScreen from "./components/LockScreen";
import MainPage from "./components/MainPage";
import "./App.css";

type AppScreen =
  | { kind: "loading" }
  | { kind: "lock"; exists: boolean; storagePath: string }
  | { kind: "main"; root: Folder };

function App() {
  const [screen, setScreen] = useState<AppScreen>({ kind: "loading" });

  const loadLockScreen = useCallback(async () => {
    const [exists, storagePath] = await Promise.all([
      api.addressBookExists(),
      api.getStoragePath(),
    ]);
    setScreen({ kind: "lock", exists, storagePath });
  }, []);

  useEffect(() => {
    loadLockScreen();
  }, [loadLockScreen]);

  useEffect(() => {
    (async () => {
      try {
        const enabled = await api.getAutoUpdate();
        if (!enabled) return;
        const update = await check();
        if (update) {
          const yes = window.confirm(
            `Update ${update.version} is available. Download and install?`,
          );
          if (yes) {
            await update.downloadAndInstall();
            await relaunch();
          }
        }
      } catch {
        // silently ignore update check errors
      }
    })();
  }, []);

  const handleUnlock = async (password: string) => {
    const root = await api.unlockAddressBook(password);
    setScreen({ kind: "main", root });
  };

  const handleCreate = async (password: string) => {
    const root = await api.createAddressBook(password);
    setScreen({ kind: "main", root });
  };

  const handleLock = async () => {
    await api.lockAddressBook();
    await loadLockScreen();
  };

  if (screen.kind === "loading") {
    return <div className="loading">Loading...</div>;
  }

  if (screen.kind === "lock") {
    return (
      <LockScreen
        exists={screen.exists}
        storagePath={screen.storagePath}
        onUnlock={handleUnlock}
        onCreate={handleCreate}
        onPathChanged={loadLockScreen}
      />
    );
  }

  return <MainPage initialRoot={screen.root} onLock={handleLock} />;
}

export default App;
