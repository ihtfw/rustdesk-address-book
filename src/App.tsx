import { useState, useEffect, useCallback } from "react";
import type { Folder } from "./types";
import * as api from "./api";
import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { I18nProvider, type Locale, type Translations } from "./i18n";
import en from "./i18n/en";
import ru from "./i18n/ru";
import LockScreen from "./components/LockScreen";
import MainPage from "./components/MainPage";
import "./App.css";

const locales: Record<Locale, Translations> = { en, ru };

type AppScreen =
  | { kind: "loading" }
  | { kind: "lock"; exists: boolean; storagePath: string }
  | { kind: "main"; root: Folder };

function App() {
  const [screen, setScreen] = useState<AppScreen>({ kind: "loading" });
  const [locale, setLocale] = useState<Locale>("en");
  const t = locales[locale];

  const loadLockScreen = useCallback(async () => {
    const [exists, storagePath] = await Promise.all([
      api.addressBookExists(),
      api.getStoragePath(),
    ]);
    setScreen({ kind: "lock", exists, storagePath });
  }, []);

  useEffect(() => {
    loadLockScreen();
    api
      .getLanguage()
      .then((lang) => {
        if (lang in locales) setLocale(lang as Locale);
      })
      .catch(() => {});
  }, [loadLockScreen]);

  useEffect(() => {
    getVersion().then((v) => {
      getCurrentWindow().setTitle(`RustDesk Address Book v${v}`);
    });
  }, []);

  useEffect(() => {
    const checkForUpdates = async () => {
      try {
        const enabled = await api.getAutoUpdate();
        if (!enabled) return;
        const update = await check();
        if (update) {
          const yes = window.confirm(t.updateAvailable(update.version));
          if (yes) {
            await update.downloadAndInstall();
            await relaunch();
          }
        }
      } catch {
        // silently ignore update check errors
      }
    };

    checkForUpdates();
    const interval = setInterval(checkForUpdates, 4 * 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, [t]);

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

  const handleLocaleChange = async (newLocale: Locale) => {
    setLocale(newLocale);
    await api.setLanguage(newLocale);
  };

  if (screen.kind === "loading") {
    return <div className="loading">{t.loading}</div>;
  }

  if (screen.kind === "lock") {
    return (
      <I18nProvider value={t}>
        <LockScreen
          exists={screen.exists}
          storagePath={screen.storagePath}
          onUnlock={handleUnlock}
          onCreate={handleCreate}
          onPathChanged={loadLockScreen}
        />
      </I18nProvider>
    );
  }

  return (
    <I18nProvider value={t}>
      <MainPage
        initialRoot={screen.root}
        onLock={handleLock}
        locale={locale}
        onLocaleChange={handleLocaleChange}
      />
    </I18nProvider>
  );
}

export default App;
