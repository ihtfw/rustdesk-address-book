import { useState, useEffect } from "react";
import type { Folder } from "./types";
import * as api from "./api";
import LockScreen from "./components/LockScreen";
import MainPage from "./components/MainPage";
import "./App.css";

type AppScreen =
  | { kind: "loading" }
  | { kind: "lock"; exists: boolean }
  | { kind: "main"; root: Folder };

function App() {
  const [screen, setScreen] = useState<AppScreen>({ kind: "loading" });

  useEffect(() => {
    api.addressBookExists().then((exists) => {
      setScreen({ kind: "lock", exists });
    });
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
    setScreen({ kind: "lock", exists: true });
  };

  if (screen.kind === "loading") {
    return <div className="loading">Loading...</div>;
  }

  if (screen.kind === "lock") {
    return (
      <LockScreen
        exists={screen.exists}
        onUnlock={handleUnlock}
        onCreate={handleCreate}
      />
    );
  }

  return <MainPage initialRoot={screen.root} onLock={handleLock} />;
}

export default App;
